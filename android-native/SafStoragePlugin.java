package com.saadps2.artwork;

import android.content.Intent;
import android.net.Uri;
import android.util.Base64;
import androidx.activity.result.ActivityResult;
import androidx.documentfile.provider.DocumentFile;
import com.getcapacitor.*;
import com.getcapacitor.annotation.*;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;

@CapacitorPlugin(name = "SafStorage")
public class SafStoragePlugin extends Plugin {
    @PluginMethod
    public void pickFolder(PluginCall call) {
        Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT_TREE);
        intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION | Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION);
        startActivityForResult(call, intent, "folderPicked");
    }

    @ActivityCallback
    private void folderPicked(PluginCall call, ActivityResult result) {
        Uri uri = result.getData() == null ? null : result.getData().getData();
        if (uri == null) { call.reject("لم يتم اختيار مجلد"); return; }
        int flags = result.getData().getFlags() & (Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION);
        try { getContext().getContentResolver().takePersistableUriPermission(uri, flags); } catch (SecurityException ignored) {}
        DocumentFile folder = DocumentFile.fromTreeUri(getContext(), uri);
        JSObject ret = new JSObject();
        ret.put("uri", uri.toString());
        ret.put("name", folder == null ? "Storage" : folder.getName());
        ret.put("canWrite", folder != null && folder.canWrite());
        call.resolve(ret);
    }

    private DocumentFile folder(PluginCall call) {
        String raw = call.getString("uri");
        if (raw == null || raw.isEmpty()) { call.reject("عنوان مجلد التخزين مطلوب"); return null; }
        DocumentFile dir = DocumentFile.fromTreeUri(getContext(), Uri.parse(raw));
        if (dir == null || !dir.isDirectory()) { call.reject("مجلد التخزين غير متاح"); return null; }
        String relativePath = call.getString("path");
        if (relativePath != null && !relativePath.isEmpty()) {
            for (String part : relativePath.split("/")) {
                if (part.isEmpty() || part.equals(".") || part.equals("..")) continue;
                DocumentFile child = dir.findFile(part);
                if (child == null || !child.isDirectory()) {
                    call.reject("المجلد الفرعي غير موجود: " + part);
                    return null;
                }
                dir = child;
            }
        }
        return dir;
    }

    @PluginMethod
    public void listFiles(PluginCall call) {
        DocumentFile dir = folder(call); if (dir == null) return;
        JSArray files = new JSArray();
        for (DocumentFile f : dir.listFiles()) {
            JSObject item = new JSObject();
            item.put("name", f.getName());
            item.put("uri", f.getUri().toString());
            item.put("directory", f.isDirectory());
            item.put("size", f.length());
            files.put(item);
        }
        JSObject ret = new JSObject(); ret.put("files", files); call.resolve(ret);
    }

    @PluginMethod
    public void readFile(PluginCall call) {
        DocumentFile dir = folder(call); if (dir == null) return;
        String name = call.getString("name");
        DocumentFile file = name == null ? null : dir.findFile(name);
        if (file == null || !file.isFile()) { call.reject("الملف غير موجود: " + name); return; }
        try (InputStream in = getContext().getContentResolver().openInputStream(file.getUri());
             ByteArrayOutputStream out = new ByteArrayOutputStream()) {
            if (in == null) throw new IllegalStateException("تعذر فتح الملف");
            byte[] buf = new byte[65536]; int n;
            while ((n = in.read(buf)) >= 0) out.write(buf, 0, n);
            JSObject ret = new JSObject();
            ret.put("name", name); ret.put("size", file.length());
            ret.put("data", Base64.encodeToString(out.toByteArray(), Base64.NO_WRAP));
            call.resolve(ret);
        } catch (Exception e) { call.reject("تعذرت قراءة الملف", e); }
    }

    @PluginMethod
    public void readFileRange(PluginCall call) {
        DocumentFile dir = folder(call); if (dir == null) return;
        String name = call.getString("name");
        long offset = Math.max(0, call.getData().optLong("offset", 0L));
        int length = (int)Math.max(0, Math.min(8L * 1024 * 1024, call.getData().optLong("length", 0L)));
        DocumentFile file = name == null ? null : dir.findFile(name);
        if (file == null || !file.isFile()) { call.reject("الملف غير موجود: " + name); return; }
        try (InputStream in = getContext().getContentResolver().openInputStream(file.getUri());
             ByteArrayOutputStream out = new ByteArrayOutputStream()) {
            if (in == null) throw new IllegalStateException("تعذر فتح الملف");
            long skipped = 0;
            while (skipped < offset) {
                long n = in.skip(offset - skipped);
                if (n <= 0) { if (in.read() < 0) break; n = 1; }
                skipped += n;
            }
            byte[] buf = new byte[65536]; int remaining = length; int n;
            while (remaining > 0 && (n = in.read(buf, 0, Math.min(buf.length, remaining))) >= 0) {
                out.write(buf, 0, n); remaining -= n;
            }
            JSObject ret = new JSObject();
            ret.put("name", name); ret.put("size", file.length());
            ret.put("data", Base64.encodeToString(out.toByteArray(), Base64.NO_WRAP));
            call.resolve(ret);
        } catch (Exception e) { call.reject("تعذرت قراءة جزء من الملف", e); }
    }

    @PluginMethod
    public void writeFile(PluginCall call) {
        DocumentFile dir = folder(call); if (dir == null) return;
        String name = call.getString("name"); String encoded = call.getString("data");
        if (name == null || encoded == null) { call.reject("اسم الملف ومحتواه مطلوبان"); return; }
        if (name.contains("/") || name.contains("\\\\") || name.equals(".") || name.equals("..")) {
            call.reject("اسم الملف غير صالح"); return;
        }
        try {
            byte[] bytes = Base64.decode(encoded, Base64.DEFAULT);
            DocumentFile file = dir.findFile(name);
            if (file != null && !file.isFile()) throw new IllegalStateException("يوجد مجلد بالاسم نفسه");
            if (file == null) file = dir.createFile(name.toLowerCase().endsWith(".png") ? "image/png" : "image/jpeg", name);
            if (file == null || !file.canWrite()) throw new IllegalStateException("تعذر إنشاء ملف قابل للكتابة");
            java.io.OutputStream stream = getContext().getContentResolver().openOutputStream(file.getUri(), "wt");
            if (stream == null) throw new IllegalStateException("مزود التخزين لم يفتح الملف للكتابة");
            try (java.io.OutputStream out = stream) { out.write(bytes); out.flush(); }
            long savedLength = file.length();
            if (savedLength > 0 && savedLength != bytes.length) {
                throw new IllegalStateException("لم تُحفظ كل بيانات الصورة؛ أعد المحاولة أو افحص الفلاش");
            }
            JSObject ret = new JSObject();
            ret.put("name", name);
            ret.put("uri", file.getUri().toString());
            ret.put("bytesWritten", bytes.length);
            call.resolve(ret);
        } catch (Exception e) { call.reject("تعذرت كتابة الملف على الفلاش: " + e.getMessage(), e); }
    }

    @PluginMethod
    public void createDirectory(PluginCall call) {
        DocumentFile dir = folder(call); if (dir == null) return;
        String name = call.getString("name");
        if (name == null) { call.reject("اسم المجلد مطلوب"); return; }
        DocumentFile child = dir.findFile(name);
        if (child == null) child = dir.createDirectory(name);
        if (child == null || !child.isDirectory()) { call.reject("تعذر إنشاء المجلد"); return; }
        JSObject ret = new JSObject(); ret.put("name", child.getName()); ret.put("uri", child.getUri().toString()); call.resolve(ret);
    }
}
