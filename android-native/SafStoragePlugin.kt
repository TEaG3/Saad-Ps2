package com.saadps2.artwork

import android.content.Intent
import android.net.Uri
import android.util.Base64
import androidx.documentfile.provider.DocumentFile
import com.getcapacitor.*
import com.getcapacitor.annotation.*
import java.io.ByteArrayOutputStream

@CapacitorPlugin(name = "SafStorage")
class SafStoragePlugin : Plugin() {
    private var rootUri: Uri? = null

    @PluginMethod
    fun pickFolder(call: PluginCall) {
        val intent = Intent(Intent.ACTION_OPEN_DOCUMENT_TREE)
        intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_WRITE_URI_PERMISSION or Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION)
        startActivityForResult(call, intent, "folderPicked")
    }

    @ActivityCallback
    private fun folderPicked(call: PluginCall, result: ActivityResult) {
        val uri = result.data?.data
        if (uri == null) { call.reject("لم يتم اختيار مجلد"); return }
        val flags = result.data?.flags ?: 0
        try {
            context.contentResolver.takePersistableUriPermission(uri, flags and (Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_WRITE_URI_PERMISSION))
        } catch (_: SecurityException) { }
        rootUri = uri
        val folder = DocumentFile.fromTreeUri(context, uri)
        val ret = JSObject()
        ret.put("uri", uri.toString())
        ret.put("name", folder?.name ?: "Storage")
        ret.put("canWrite", folder?.canWrite() ?: false)
        call.resolve(ret)
    }

    private fun root(call: PluginCall): DocumentFile? {
        val raw = call.getString("uri") ?: rootUri?.toString()
        if (raw.isNullOrBlank()) { call.reject("اختر مجلد التخزين أولاً"); return null }
        return DocumentFile.fromTreeUri(context, Uri.parse(raw))
    }

    @PluginMethod
    fun listFiles(call: PluginCall) {
        val folder = root(call) ?: return
        val arr = JSArray()
        folder.listFiles().forEach { f ->
            val item = JSObject()
            item.put("name", f.name)
            item.put("uri", f.uri.toString())
            item.put("directory", f.isDirectory)
            item.put("size", f.length())
            arr.put(item)
        }
        val ret = JSObject()
        ret.put("files", arr)
        call.resolve(ret)
    }

    @PluginMethod
    fun readFile(call: PluginCall) {
        val folder = root(call) ?: return
        val name = call.getString("name") ?: run { call.reject("اسم الملف مطلوب"); return }
        val file = folder.findFile(name) ?: run { call.reject("الملف غير موجود"); return }
        try {
            val bytes = context.contentResolver.openInputStream(file.uri)?.use { input ->
                val out = ByteArrayOutputStream()
                input.copyTo(out)
                out.toByteArray()
            } ?: ByteArray(0)
            val ret = JSObject()
            ret.put("data", Base64.encodeToString(bytes, Base64.NO_WRAP))
            ret.put("name", name)
            call.resolve(ret)
        } catch (e: Exception) { call.reject("تعذرت قراءة الملف", e) }
    }

    @PluginMethod
    fun writeFile(call: PluginCall) {
        val folder = root(call) ?: return
        val name = call.getString("name") ?: run { call.reject("اسم الملف مطلوب"); return }
        val data = call.getString("data") ?: run { call.reject("محتوى الملف مطلوب"); return }
        try {
            val file = folder.findFile(name) ?: folder.createFile(mimeFor(name), name)
            if (file == null) { call.reject("تعذر إنشاء الملف"); return }
            context.contentResolver.openOutputStream(file.uri, "wt")?.use { it.write(Base64.decode(data, Base64.DEFAULT)) }
                ?: run { call.reject("تعذرت الكتابة إلى الملف"); return }
            val ret = JSObject()
            ret.put("name", name)
            ret.put("uri", file.uri.toString())
            call.resolve(ret)
        } catch (e: Exception) { call.reject("تعذرت كتابة الملف", e) }
    }

    @PluginMethod
    fun createDirectory(call: PluginCall) {
        val folder = root(call) ?: return
        val name = call.getString("name") ?: run { call.reject("اسم المجلد مطلوب"); return }
        val dir = folder.findFile(name) ?: folder.createDirectory(name)
        if (dir == null) { call.reject("تعذر إنشاء المجلد"); return }
        val ret = JSObject()
        ret.put("name", dir.name)
        ret.put("uri", dir.uri.toString())
        call.resolve(ret)
    }

    private fun mimeFor(name: String): String =
        if (name.lowercase().endsWith(".png")) "image/png" else
        if (name.lowercase().endsWith(".jpg") || name.lowercase().endsWith(".jpeg")) "image/jpeg" else
        "application/octet-stream"
}
