/* ==========================================================================
   Saad PS2 Artwork Station — منطق التطبيق
   الأقسام: الإعدادات ▸ الأدوات ▸ الواجهة ▸ التخزين ▸ الفحص ▸ العرض ▸ الدُفعات ▸ التهيئة
   ملاحظة: كل المعالجة تجري محلياً داخل المتصفح/WebView.
   ========================================================================== */
(function () {
    'use strict';

    /* ------------------------------------------------------------------
       1) الثوابت
       ------------------------------------------------------------------ */
    var CONFIG = {
        coverWidth: 140,
        coverHeight: 200,
        iconSize: 64,
        fetchTimeoutMs: 12000,
        maxScanBytes: 4 * 1024 * 1024,
        maxManualImageBytes: 12 * 1024 * 1024,
        rawBase: 'https://raw.githubusercontent.com/xlenore/ps2-covers/main/covers/default',
        version: '1.1.0',
        releasePage: 'https://github.com/TEaG3/Saad-Ps2/releases/tag/android-latest',
        regions: {
            SLUS: 'US', SCUS: 'US', SLES: 'EN', SCES: 'EN', SCED: 'EN', SLED: 'EN',
            SLKA: 'KO', SCKA: 'KO', SLPS: 'JA', SLPM: 'JA', SCPS: 'JA', SCAJ: 'JA', SLED: 'EN'
        }
    };

    var SETTINGS_KEY = 'saadps2:settings:v1';
    var DISMISSED_VERSION_KEY = 'saadps2:dismissed-app-version';

    var DEFAULT_SETTINGS = {
        theme: 'dark',
        view: 'grid',
        source: 'online',
        quality: 0.82,
        concurrency: 2
    };

    /* ------------------------------------------------------------------
       2) حالة التطبيق
       ------------------------------------------------------------------ */
    var state = {
        rootHandle: null,
        offlineHandle: null,
        offlineFiles: new Map(),
        games: [],
        artFiles: new Map(),
        iconFiles: new Map(),
        indexById: new Map(),
        filter: 'all',
        selection: new Set(),
        busy: false,
        scanning: false,
        cancelRequested: false,
        lastFailed: [],
        lastRendered: [],
        view: 'grid',
        manualTarget: null,
        nodeScan: null,
        settings: Object.assign({}, DEFAULT_SETTINGS)
    };

    var viewRefs = {};
    var coverUrlCache = new Map();   // gameId -> [urls]
    var localUrlCache = new Map();   // gameId -> blob: URL
    var brokenCovers = new Set();    // gameId التي فشلت كل روابطها
    var previewObserver = null;
    var collator = new Intl.Collator('ar', { numeric: true, sensitivity: 'base' });
    var isNativeAndroid = false;
    var supportsFsApi = false;
    var nativeSaf = null;

    /* ------------------------------------------------------------------
       3) أدوات مساعدة عامة
       ------------------------------------------------------------------ */
    function $(id) { return document.getElementById(id); }
    function $$(selector, root) { return Array.prototype.slice.call((root || document).querySelectorAll(selector)); }

    function escapeHtml(value) {
        return String(value == null ? '' : value).replace(/[&<>"']/g, function (ch) {
            return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch];
        });
    }

    /** تطبيع نص عربي للبحث: إزالة التشكيل وتوحيد الألف والياء والتاء المربوطة. */
    function normalizeText(value) {
        return String(value == null ? '' : value)
            .toLowerCase()
            .replace(/[\u064B-\u0652\u0670\u0640]/g, '')
            .replace(/[أإآٱ]/g, 'ا')
            .replace(/ى/g, 'ي')
            .replace(/ة/g, 'ه')
            .trim();
    }

    function normalizeId(raw) {
        return String(raw || '').toUpperCase().replace(/-/g, '_');
    }

    function idVariants(gameId) {
        var match = String(gameId || '').match(/^([A-Z]{4})_(\d{3})\.(\d{2})$/);
        if (!match) {
            return { prefix: '', serial: gameId, dashDot: gameId, dot: gameId };
        }
        return {
            prefix: match[1],
            serial: match[1] + '-' + match[2] + match[3],  // SLUS-20062
            dashDot: match[1] + '-' + match[2] + '.' + match[3], // SLUS-200.62
            dot: gameId                                      // SLUS_200.62
        };
    }

    function onlineCoverUrls(gameId) {
        var cached = coverUrlCache.get(gameId);
        if (cached) return cached;
        var v = idVariants(gameId);
        var urls = [CONFIG.rawBase + '/' + v.serial + '.jpg'];
        var region = CONFIG.regions[v.prefix];
        if (region) urls.push('https://art.gametdb.com/ps2/cover/' + region + '/' + v.serial + '.jpg');
        urls.push(CONFIG.rawBase + '/' + v.dashDot + '.jpg');
        urls.push(CONFIG.rawBase + '/' + v.dot + '.jpg');
        urls = urls.filter(function (url, i, all) { return all.indexOf(url) === i; });
        coverUrlCache.set(gameId, urls);
        return urls;
    }

    /**
     * روابط قابلة للتنزيل عبر fetch() فقط.
     * GameTDB لا يرسل ترويسة CORS، لذا يصلح للمعاينة كـ <img> لكن لا يمكن قراءة بايتاته،
     * ولذلك يُستبعد من مسار الحفظ.
     */
    function coverFetchUrls(gameId) {
        var v = idVariants(gameId);
        return [
            CONFIG.rawBase + '/' + v.serial + '.jpg',
            CONFIG.rawBase + '/' + v.dashDot + '.jpg',
            CONFIG.rawBase + '/' + v.dot + '.jpg'
        ].filter(function (url, i, all) { return all.indexOf(url) === i; });
    }

    function debounce(fn, wait) {
        var timer = null;
        return function () {
            var args = arguments, ctx = this;
            clearTimeout(timer);
            timer = setTimeout(function () { fn.apply(ctx, args); }, wait);
        };
    }

    function setText(id, value) {
        var node = $(id);
        if (node) node.textContent = value;
    }

    function humanDuration(ms) {
        if (!isFinite(ms) || ms <= 0) return '';
        var seconds = Math.round(ms / 1000);
        if (seconds < 60) return seconds + ' ث';
        var minutes = Math.floor(seconds / 60);
        return minutes + ' د ' + (seconds % 60) + ' ث';
    }

    function byteSize(bytes) {
        if (!bytes) return '0 B';
        if (bytes < 1024) return bytes + ' B';
        if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
        return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
    }

    /* ------------------------------------------------------------------
       4) الإعدادات والمظهر
       ------------------------------------------------------------------ */
    function loadSettings() {
        try {
            var raw = localStorage.getItem(SETTINGS_KEY);
            if (raw) {
                var parsed = JSON.parse(raw);
                if (parsed && typeof parsed === 'object') {
                    state.settings = Object.assign({}, DEFAULT_SETTINGS, parsed);
                }
            }
        } catch (error) { /* تجاهل */ }
    }

    function saveSettings() {
        try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(state.settings)); } catch (error) { /* تجاهل */ }
    }

    function applyTheme(theme) {
        var next = theme === 'light' ? 'light' : 'dark';
        document.documentElement.setAttribute('data-theme', next);
        state.settings.theme = next;
        saveSettings();
        var meta = $('themeColorMeta');
        if (meta) meta.setAttribute('content', next === 'light' ? '#f4f6fb' : '#060913');
        var toggle = $('themeToggle');
        var icon = $('themeToggleIcon');
        if (icon) icon.textContent = next === 'light' ? '🌙' : '☀️';
        if (toggle) {
            toggle.setAttribute('aria-label', next === 'light' ? 'التبديل إلى المظهر الداكن' : 'التبديل إلى المظهر الفاتح');
            toggle.title = toggle.getAttribute('aria-label');
        }
    }

    /* ------------------------------------------------------------------
       5) التنبيهات والنوافذ (بديل alert/confirm)
       ------------------------------------------------------------------ */
    function toast(message, type, duration) {
        var host = $('toastHost');
        if (!host) return;
        var node = document.createElement('div');
        node.className = 'toast' + (type ? ' is-' + type : '');
        node.setAttribute('role', type === 'error' ? 'alert' : 'status');
        node.textContent = message;
        host.appendChild(node);
        var timeout = typeof duration === 'number' ? duration : (type === 'error' ? 7000 : 4200);
        setTimeout(function () {
            node.classList.add('is-hiding');
            setTimeout(function () { node.remove(); }, 220);
        }, timeout);
    }

    var modalState = { lastFocus: null, active: null };

    function openModal(id) {
        var modal = $(id);
        if (!modal) return;
        modalState.lastFocus = document.activeElement;
        modalState.active = modal;
        modal.classList.add('open');
        document.body.style.overflow = 'hidden';
        var focusable = modal.querySelector('button, [href], input, select, textarea');
        if (focusable) focusable.focus();
    }

    function closeModal(id) {
        var modal = $(id);
        if (!modal) return;
        modal.classList.remove('open');
        if (modalState.active === modal) {
            modalState.active = null;
            document.body.style.overflow = '';
            if (modalState.lastFocus && typeof modalState.lastFocus.focus === 'function') {
                modalState.lastFocus.focus();
            }
        }
    }

    var confirmResolver = null;

    function askConfirm(options) {
        var opts = options || {};
        setText('confirmTitle', opts.title || 'تأكيد العملية');
        var messageNode = $('confirmMessage');
        if (messageNode) messageNode.textContent = opts.message || '';
        var okBtn = $('confirmOk');
        var cancelBtn = $('confirmCancel');
        if (okBtn) {
            okBtn.textContent = opts.confirmText || 'تأكيد';
            okBtn.className = 'btn ' + (opts.danger === false ? 'btn-primary' : 'btn-danger');
        }
        if (cancelBtn) cancelBtn.textContent = opts.cancelText || 'إلغاء';
        openModal('confirmModal');
        return new Promise(function (resolve) {
            confirmResolver = resolve;
        });
    }

    function settleConfirm(value) {
        closeModal('confirmModal');
        if (confirmResolver) {
            var resolver = confirmResolver;
            confirmResolver = null;
            resolver(value);
        }
    }

    /* ------------------------------------------------------------------
       6) مراجع الواجهة + كشف المنصّة
       ------------------------------------------------------------------ */
    function cacheViewRefs() {
        [
            'sourceMode', 'sourceHint', 'btnSelectUsb', 'btnRescan', 'btnLocalOffline',
            'btnDownloadMissing', 'btnDownloadAll', 'qualitySelect', 'concurrencySelect',
            'statTotal', 'statIso', 'statUl', 'statReady', 'statMissing',
            'dbLocalCount', 'dbCatalogCount', 'dbSyncState', 'dbLastSync', 'dbMessage',
            'btnSyncDatabase', 'btnExportDatabase', 'btnImportDatabase', 'importFileInput',
            'progressWrapper', 'progressText', 'progressCount', 'progressBar', 'progressBarWrap', 'btnCancel',
            'report', 'searchInput', 'btnClearSearch', 'sortSelect', 'viewGrid', 'viewList',
            'btnSelectMode', 'btnExportCsv', 'visibleCount', 'filterChips',
            'selectionBar', 'selectionCount', 'btnDownloadSelected', 'btnClearSelection',
            'artGrid', 'tableWrap', 'gamesTableBody', 'manualFileInput',
            'coverModal', 'modalTitle', 'modalImg', 'modalMeta', 'btnCloseModal', 'btnModalDownload',
            'confirmModal', 'confirmTitle', 'confirmMessage', 'confirmOk', 'confirmCancel',
            'toastHost', 'themeToggle', 'themeToggleIcon', 'themeColorMeta',
            'installAppBtn', 'apkLink', 'mBtnSelect', 'mBtnSync',
            'appUpdateNotice', 'appUpdateTitle', 'appUpdateText', 'appUpdateLink', 'dismissAppUpdate',
            'swUpdateNotice', 'reloadForUpdate', 'unsupportedNotice'
        ].forEach(function (id) { viewRefs[id] = $(id); });
    }

    function detectPlatform() {
        nativeSaf = window.SafStorage ||
            (window.Capacitor && window.Capacitor.Plugins ? window.Capacitor.Plugins.SafStorage : null) ||
            null;
        isNativeAndroid = !!(nativeSaf && window.Capacitor && window.Capacitor.isNativePlatform &&
            window.Capacitor.getPlatform() === 'android');
        supportsFsApi = ('showDirectoryPicker' in window) || isNativeAndroid;
        if (!supportsFsApi && viewRefs.unsupportedNotice) viewRefs.unsupportedNotice.hidden = false;
        if (isNativeAndroid) {
            viewRefs.btnSelectUsb.innerHTML = '<span aria-hidden="true">📁</span> اختر مجلد الألعاب (الهاتف / OTG)';
            viewRefs.qualitySelect.value = '0.82';
            // داخل التطبيق لا معنى لتحميل ملف APK
            if (viewRefs.apkLink) viewRefs.apkLink.hidden = true;
        }
    }

    /* ------------------------------------------------------------------
       7) محوّل Android SAF — يحاكي File System Access API
       ------------------------------------------------------------------ */
    function base64ToBlob(value, type) {
        var binary = atob(value || '');
        var chunks = [];
        var step = 32768;
        for (var i = 0; i < binary.length; i += step) {
            var part = binary.slice(i, i + step);
            var bytes = new Uint8Array(part.length);
            for (var j = 0; j < part.length; j++) bytes[j] = part.charCodeAt(j);
            chunks.push(bytes);
        }
        return new Blob(chunks, { type: type || 'application/octet-stream' });
    }

    function blobToBase64(blob) {
        return blob.arrayBuffer().then(function (buffer) {
            var bytes = new Uint8Array(buffer);
            var binary = '';
            var step = 0x8000;
            for (var i = 0; i < bytes.length; i += step) {
                binary += String.fromCharCode.apply(null, bytes.subarray(i, i + step));
            }
            return btoa(binary);
        });
    }

    function NativeFileHandle(rootUri, parentPath, name, size) {
        this.kind = 'file';
        this.rootUri = rootUri;
        this.parentPath = parentPath || [];
        this.name = name;
        this.size = size || 0;
    }

    NativeFileHandle.prototype.getFile = function () {
        var handle = this;
        if (/\.iso$/i.test(this.name)) {
            return Promise.resolve({
                name: handle.name,
                size: handle.size,
                slice: function (start, end) {
                    return {
                        arrayBuffer: function () {
                            var from = Math.max(0, Number(start) || 0);
                            var to = Number(end) || handle.size;
                            return nativeSaf.readFileRange({
                                uri: handle.rootUri,
                                path: handle.parentPath.join('/'),
                                name: handle.name,
                                offset: from,
                                length: Math.max(0, Math.min(8 * 1024 * 1024, to - from))
                            }).then(function (result) { return base64ToBlob(result.data).arrayBuffer(); });
                        }
                    };
                }
            });
        }
        return nativeSaf.readFile({
            uri: this.rootUri,
            path: this.parentPath.join('/'),
            name: this.name
        }).then(function (result) {
            var mime = /\.png$/i.test(handle.name) ? 'image/png'
                : /\.jpe?g$/i.test(handle.name) ? 'image/jpeg'
                    : 'application/octet-stream';
            return new File([base64ToBlob(result.data, mime)], handle.name, { type: mime, lastModified: Date.now() });
        });
    };

    NativeFileHandle.prototype.createWritable = function () {
        var handle = this;
        var pending = null;
        return Promise.resolve({
            write: function (data) {
                pending = data instanceof Blob ? data : new Blob([data]);
            },
            close: function () {
                if (!pending) pending = new Blob([]);
                return blobToBase64(pending).then(function (base64) {
                    return nativeSaf.writeFile({
                        uri: handle.rootUri,
                        path: handle.parentPath.join('/'),
                        name: handle.name,
                        data: base64
                    });
                });
            }
        });
    };

    function NativeDirectoryHandle(rootUri, name, path) {
        this.kind = 'directory';
        this.rootUri = rootUri;
        this.path = path || [];
        this.name = name || 'Storage';
    }

    NativeDirectoryHandle.prototype.list = function () {
        return nativeSaf.listFiles({ uri: this.rootUri, path: this.path.join('/') })
            .then(function (result) { return (result && result.files) || []; });
    };

    NativeDirectoryHandle.prototype.values = async function* () {
        var items = await this.list();
        for (var i = 0; i < items.length; i++) {
            var item = items[i];
            yield item.directory
                ? new NativeDirectoryHandle(this.rootUri, item.name, this.path.concat(item.name))
                : new NativeFileHandle(this.rootUri, this.path, item.name, item.size);
        }
    };

    NativeDirectoryHandle.prototype.getDirectoryHandle = function (name, options) {
        var self = this;
        return this.list().then(function (items) {
            var found = items.filter(function (item) { return item.directory && item.name === name; })[0];
            if (found) return new NativeDirectoryHandle(self.rootUri, found.name, self.path.concat(found.name));
            if (!options || !options.create) throw new DOMException('Directory not found', 'NotFoundError');
            return nativeSaf.createDirectory({ uri: self.rootUri, path: self.path.join('/'), name: name })
                .then(function (created) {
                    return new NativeDirectoryHandle(self.rootUri, created.name, self.path.concat(created.name));
                });
        });
    };

    NativeDirectoryHandle.prototype.getFileHandle = function (name, options) {
        var self = this;
        return this.list().then(function (items) {
            var found = items.filter(function (item) { return !item.directory && item.name === name; })[0];
            if (!found && (!options || !options.create)) throw new DOMException('File not found', 'NotFoundError');
            return new NativeFileHandle(self.rootUri, self.path, name, found ? found.size : 0);
        });
    };

    function pickNativeFolder() {
        return nativeSaf.pickFolder().then(function (picked) {
            if (!picked || !picked.uri) throw new Error('لم يتم اختيار مجلد تخزين صالح.');
            if (picked.canWrite === false) {
                throw new Error('المجلد المحدد يسمح بالقراءة فقط. اختر جذر الفلاش أو مجلداً قابلاً للكتابة.');
            }
            if (typeof nativeSaf.testStorage === 'function') {
                return nativeSaf.testStorage({ uri: picked.uri, path: '' }).then(function () {
                    return new NativeDirectoryHandle(picked.uri, picked.name, []);
                }, function (error) {
                    throw new Error('فشل اختبار القراءة والكتابة على هذا المجلد. جرّب اختيار جذر الفلاش مباشرة أو استخدم مدير ملفات آخر. (' +
                        (error && error.message ? error.message : error) + ')');
                });
            }
            return new NativeDirectoryHandle(picked.uri, picked.name, []);
        });
    }

    /* ------------------------------------------------------------------
       8) قراءة/كتابة الملفات
       ------------------------------------------------------------------ */
    function listDir(handle) {
        var map = new Map();
        return (async function () {
            for await (var entry of handle.values()) {
                if (entry.kind === 'file') map.set(entry.name.toUpperCase(), entry);
            }
            return map;
        })();
    }

    function writeFile(directoryHandle, fileName, data) {
        var lastError = null;
        var attempt = 0;

        function tryWrite() {
            attempt++;
            return directoryHandle.getFileHandle(fileName, { create: true })
                .then(function (fileHandle) {
                    return fileHandle.createWritable().then(function (writable) {
                        return writable.write(data).then(function () { return writable.close(); });
                    }).then(function () { return fileHandle.getFile(); });
                })
                .then(function (saved) {
                    if (!saved || saved.size !== data.size) {
                        throw new Error('حجم الملف بعد الحفظ غير مطابق (' + (saved ? saved.size : 0) + '/' + data.size + ' بايت).');
                    }
                    if (typeof saved.arrayBuffer === 'function' && typeof data.arrayBuffer === 'function') {
                        return Promise.all([saved.arrayBuffer(), data.arrayBuffer()]).then(function (buffers) {
                            var a = new Uint8Array(buffers[0]);
                            var b = new Uint8Array(buffers[1]);
                            if (a.length !== b.length) throw new Error('حجم الملف المقروء غير مطابق.');
                            for (var i = 0; i < a.length; i++) {
                                if (a[i] !== b[i]) throw new Error('محتوى الملف المحفوظ غير مطابق.');
                            }
                        });
                    }
                })
                .catch(function (error) {
                    lastError = error;
                    if (attempt < 3) {
                        return new Promise(function (resolve) { setTimeout(resolve, 350 * attempt); }).then(tryWrite);
                    }
                    throw new Error('فشل حفظ ' + fileName + ' بعد 3 محاولات: ' +
                        (lastError && lastError.message ? lastError.message : lastError));
                });
        }

        return tryWrite();
    }

    /* ------------------------------------------------------------------
       9) قاعدة البيانات المحلية
       ------------------------------------------------------------------ */
    function database() { return window.SaadGameDB || null; }

    function refreshDatabasePanel() {
        var db = database();
        if (!db) {
            setText('dbSyncState', 'غير متاحة');
            return Promise.resolve();
        }
        return db.getStats().then(function (info) {
            setText('dbLocalCount', info.localCount);
            setText('dbCatalogCount', info.catalogCount);
            setText('dbSyncState', info.status === 'online' ? 'محدّثة' : (info.status === 'offline' ? 'دون اتصال' : 'محلية'));
            setText('dbLastSync', info.lastSync
                ? 'آخر مزامنة: ' + new Date(info.lastSync).toLocaleString('ar')
                : 'لم تتم مزامنة الكتالوج بعد.');
        }).catch(function () { /* تجاهل */ });
    }

    function syncGameDatabase(announce) {
        var db = database();
        var button = viewRefs.btnSyncDatabase;
        if (!db) return Promise.resolve();
        if (button) button.disabled = true;
        setText('dbMessage', 'جاري التحقق من تحديثات الكتالوج…');
        return db.syncCatalog().then(function (result) {
            return refreshDatabasePanel().then(function () {
                if (result.updated) {
                    setText('dbMessage', 'تم تحديث الكتالوج بنجاح.');
                    if (announce) toast('تم تحديث كتالوج الألعاب.', 'success');
                } else if (result.status === 'offline') {
                    setText('dbMessage', 'لا يوجد اتصال؛ مكتبتك المحلية متاحة كما هي.');
                } else {
                    setText('dbMessage', 'قاعدة البيانات محدّثة بالفعل.');
                }
            });
        }).catch(function () {
            setText('dbMessage', 'تعذّر تحديث الكتالوج الآن. يمكنك متابعة الفحص بشكل طبيعي.');
        }).then(function () {
            if (button) button.disabled = false;
        });
    }

    function downloadBlob(blob, filename) {
        var url = URL.createObjectURL(blob);
        var anchor = document.createElement('a');
        anchor.href = url;
        anchor.download = filename;
        document.body.appendChild(anchor);
        anchor.click();
        anchor.remove();
        setTimeout(function () { URL.revokeObjectURL(url); }, 1500);
    }

    function exportDatabase() {
        var db = database();
        if (!db) return;
        db.exportBackup().then(function (backup) {
            downloadBlob(new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' }),
                'saad-ps2-database-' + new Date().toISOString().slice(0, 10) + '.json');
            setText('dbMessage', 'تم تصدير النسخة الاحتياطية.');
            toast('تم إنشاء النسخة الاحتياطية.', 'success');
        }).catch(function () {
            setText('dbMessage', 'تعذّر إنشاء النسخة الاحتياطية.');
            toast('تعذّر إنشاء النسخة الاحتياطية.', 'error');
        });
    }

    function importDatabase(file) {
        var db = database();
        if (!db || !file) return;
        if (file.size > 12 * 1024 * 1024) {
            toast('الملف كبير جداً ليكون نسخة احتياطية صالحة.', 'error');
            return;
        }
        var reader = new FileReader();
        reader.onload = function () {
            var backup;
            try {
                backup = JSON.parse(String(reader.result));
            } catch (error) {
                toast('الملف ليس JSON صالحاً.', 'error');
                return;
            }
            db.importBackup(backup).then(function (result) {
                setText('dbMessage', 'تم استيراد ' + result.imported + ' سجل.');
                toast('تم استيراد ' + result.imported + ' سجل إلى المكتبة المحلية.', 'success');
                return refreshDatabasePanel();
            }).catch(function (error) {
                toast(error && error.message ? error.message : 'تعذّر استيراد النسخة.', 'error');
            });
        };
        reader.onerror = function () { toast('تعذّر قراءة الملف.', 'error'); };
        reader.readAsText(file);
    }

    /* ------------------------------------------------------------------
       10) الفحص: قراءة ISO وul.cfg
       ------------------------------------------------------------------ */
    function setProgress(text, options) {
        var opts = options || {};
        var wrapper = viewRefs.progressWrapper;
        if (!wrapper) return;
        wrapper.hidden = false;
        setText('progressText', text);
        setText('progressCount', opts.count || '');
        var bar = viewRefs.progressBar;
        var barWrap = viewRefs.progressBarWrap;
        if (barWrap) barWrap.classList.toggle('indeterminate', !!opts.indeterminate);
        if (bar) bar.style.width = typeof opts.percent === 'number' ? Math.max(0, Math.min(100, opts.percent)) + '%' : '0%';
        if (viewRefs.btnCancel) {
            viewRefs.btnCancel.hidden = !opts.cancelable;
            if (opts.cancelable) viewRefs.btnCancel.disabled = false;
        }
    }

    function hideProgress() {
        if (viewRefs.progressWrapper) viewRefs.progressWrapper.hidden = true;
    }

    function showReport(html) {
        var report = viewRefs.report;
        if (!report) return;
        report.innerHTML = html;
        report.hidden = false;
    }

    function hideReport() {
        if (viewRefs.report) {
            viewRefs.report.hidden = true;
            viewRefs.report.innerHTML = '';
        }
    }

    function emptyState(title, hint, icon) {
        return '<div class="empty">' +
            '<span class="empty-icon" aria-hidden="true">' + (icon || '🎮') + '</span>' +
            '<b>' + escapeHtml(title) + '</b>' +
            (hint ? '<span>' + escapeHtml(hint) + '</span>' : '') +
            '</div>';
    }

    function showEmpty(title, hint, icon) {
        if (viewRefs.artGrid) viewRefs.artGrid.innerHTML = emptyState(title, hint, icon);
        if (viewRefs.gamesTableBody) {
            viewRefs.gamesTableBody.innerHTML = '<tr><td colspan="7" style="border:none;padding:0">' +
                emptyState(title, hint, icon) + '</td></tr>';
        }
    }

    function cleanTitle(fileName) {
        var title = String(fileName || '')
            .replace(/\.iso$/i, '')
            .replace(/^[A-Z]{4}[_-]\d{3}\.\d{2}[\s._-]*/i, '')
            .replace(/_/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
        return title || String(fileName || '').replace(/\.iso$/i, '');
    }

    /** يقرأ SYSTEM.CNF من نظام ISO9660 لاستخراج كود اللعبة بدقة. */
    function readSystemCnfId(file) {
        var SECTOR = 2048;
        return (async function () {
            try {
                var pvdBuffer = await file.slice(16 * SECTOR, 17 * SECTOR).arrayBuffer();
                var pvd = new DataView(pvdBuffer);
                if (pvd.byteLength < SECTOR || pvd.getUint8(0) !== 1) return null;
                var rootLba = pvd.getUint32(158, true);
                var rootSize = pvd.getUint32(166, true);
                var dirBytes = new Uint8Array(await file.slice(rootLba * SECTOR,
                    rootLba * SECTOR + Math.min(rootSize, 64 * 1024)).arrayBuffer());
                var offset = 0;
                while (offset < dirBytes.length) {
                    var len = dirBytes[offset];
                    if (len === 0) {
                        offset = (Math.floor(offset / SECTOR) + 1) * SECTOR;
                        continue;
                    }
                    var dv = new DataView(dirBytes.buffer, dirBytes.byteOffset + offset, len);
                    var nameLen = dv.getUint8(32);
                    var name = new TextDecoder('ascii').decode(dirBytes.slice(offset + 33, offset + 33 + nameLen));
                    if (/^SYSTEM\.CNF/i.test(name)) {
                        var lba = dv.getUint32(2, true);
                        var size = Math.min(dv.getUint32(10, true), 4096);
                        var text = new TextDecoder('ascii').decode(
                            await file.slice(lba * SECTOR, lba * SECTOR + size).arrayBuffer());
                        var match = text.match(/BOOT2?\s*=\s*cdrom0:\\?([A-Z]{4}[_-]\d{3}\.\d{2})/i);
                        return match ? normalizeId(match[1]) : null;
                    }
                    offset += len;
                }
            } catch (error) { /* ليست صورة ISO صالحة */ }
            return null;
        })();
    }

    function extractGameIdFromIso(file) {
        return readSystemCnfId(file).then(function (fromCnf) {
            if (fromCnf) return fromCnf;
            var maxBytes = Math.min(file.size || 0, CONFIG.maxScanBytes);
            if (!maxBytes) return null;
            return file.slice(0, maxBytes).arrayBuffer().then(function (buffer) {
                var text = new TextDecoder('latin1').decode(buffer);
                // لا نأخذ أول كود يشبه رقم لعبة من بيانات ISO عشوائية؛
                // قد يكون كوداً مضمناً لملف آخر ويؤدي لربط غلاف لعبة خاطئة.
                var bootMatch = text.match(/BOOT2?\s*=\s*cdrom0:\\?([A-Z]{4}[_-]\d{3}\.\d{2})/i);
                if (bootMatch) return normalizeId(bootMatch[1]);

                // عند تعذّر قراءة SYSTEM.CNF، نعتمد اسم الملف فقط إذا احتوى
                // معرّفاً صريحاً، وإلا نترك اللعبة غير معرّفة بدلاً من التخمين.
                var fromName = String(file.name || '').match(/(?:^|[^A-Z0-9])([A-Z]{4}[_-]\d{3}\.\d{2})(?:[^0-9]|$)/i);
                return fromName ? normalizeId(fromName[1]) : null;
            });
        }).catch(function () { return null; });
    }

    function parseUlCfg(fileHandle) {
        return fileHandle.getFile().then(function (file) {
            return file.arrayBuffer();
        }).then(function (buffer) {
            var bytes = new Uint8Array(buffer);
            var games = [];
            var decoder = new TextDecoder('utf-8');
            var ascii = new TextDecoder('ascii');
            for (var offset = 0; offset + 64 <= bytes.length; offset += 64) {
                var title = decoder.decode(bytes.slice(offset, offset + 32)).replace(/\0+$/, '').trim();
                var rawId = ascii.decode(bytes.slice(offset + 32, offset + 47)).replace(/\0+$/, '').trim();
                var cleanId = rawId.replace(/^ul\./i, '').toUpperCase();
                if (title && /^[A-Z]{4}_\d{3}\.\d{2}$/.test(cleanId)) {
                    games.push({ title: title, gameId: cleanId, format: 'UL', hasCover: false, hasIcon: false });
                }
            }
            return games;
        }).catch(function () { return []; });
    }

    function scanIsoFolder(parentHandle, folderName, progressBase) {
        return (async function () {
            var list = [];
            var dirHandle;
            try {
                dirHandle = await parentHandle.getDirectoryHandle(folderName);
            } catch (error) {
                return list; // المجلد غير موجود
            }
            var count = 0;
            for await (var entry of dirHandle.values()) {
                if (state.cancelRequested) break;
                if (entry.kind !== 'file' || !/\.iso$/i.test(entry.name)) continue;
                count++;
                setProgress('جاري فحص ' + folderName + ': ' + entry.name, {
                    count: progressBase + count + ' ملف',
                    indeterminate: true,
                    cancelable: true
                });
                try {
                    var file = await entry.getFile();
                    var gameId = await extractGameIdFromIso(file);
                    if (gameId) {
                        list.push({
                            title: cleanTitle(entry.name),
                            gameId: gameId,
                            format: 'ISO',
                            folder: folderName,
                            fileName: entry.name,
                            size: file.size || 0,
                            hasCover: false,
                            hasIcon: false
                        });
                    }
                } catch (error) { /* تخطي الملف التالف */ }
            }
            return list;
        })();
    }

    function dedupeGames(games) {
        var seen = new Set();
        return games.filter(function (game) {
            var key = game.format + ':' + game.gameId;
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
        });
    }

    function checkExistingArtwork(games) {
        state.artFiles = new Map();
        state.iconFiles = new Map();
        return Promise.all([
            state.rootHandle.getDirectoryHandle('ART').then(listDir).catch(function () { return new Map(); }),
            state.rootHandle.getDirectoryHandle('ICONS').then(listDir).catch(function () { return new Map(); })
        ]).then(function (results) {
            state.artFiles = results[0];
            state.iconFiles = results[1];
            games.forEach(function (game) {
                var id = String(game.gameId).toUpperCase();
                var coverName = [id + '_COV.JPG', id + '_COV.PNG', id + '.JPG', id + '.PNG']
                    .filter(function (name) { return state.artFiles.has(name); })[0];
                game.coverHandle = coverName ? state.artFiles.get(coverName) : null;
                game.hasCover = !!coverName;
                game.hasIcon = [id + '_ICO.PNG', id + '.PNG', id + '.JPG']
                    .some(function (name) { return state.iconFiles.has(name); });
            });
        });
    }

    function indexGames() {
        state.indexById = new Map();
        state.games.forEach(function (game, index) { state.indexById.set(game.gameId, index); });
    }

    function isMissing(game) { return !game.hasCover || !game.hasIcon; }

    /* ------------------------------------------------------------------
       11) تنفيذ الفحص الكامل
       ------------------------------------------------------------------ */
    async function runScan() {
        if (!state.rootHandle || state.busy) return;
        state.busy = true;
        state.scanning = true;
        state.cancelRequested = false;
        state.games = [];
        state.lastFailed = [];
        state.selection.clear();
        revokeLocalPreviews();
        brokenCovers.clear();
        hideReport();
        indexGames();
        render();
        updateButtons();
        setProgress('جاري تجهيز الفحص…', { indeterminate: true, cancelable: true, count: '' });

        try {
            var all = [];
            all = all.concat(await scanIsoFolder(state.rootHandle, 'DVD', all.length));
            if (!state.cancelRequested) {
                all = all.concat(await scanIsoFolder(state.rootHandle, 'CD', all.length));
            }
            if (!state.cancelRequested) {
                setProgress('قراءة ملف ul.cfg…', { indeterminate: true, cancelable: true, count: all.length + ' لعبة' });
                try {
                    var ulHandle = await state.rootHandle.getFileHandle('ul.cfg');
                    all = all.concat(await parseUlCfg(ulHandle));
                } catch (error) { /* لا يوجد ul.cfg */ }
            }

            state.games = dedupeGames(all);

            if (state.games.length) {
                setProgress('التحقق من الأغلفة والأيقونات الموجودة…', {
                    indeterminate: true, cancelable: true, count: state.games.length + ' لعبة'
                });
                await checkExistingArtwork(state.games);

                var db = database();
                if (db) {
                    try {
                        await db.recordScan(state.games);
                        state.games = await db.enrichGames(state.games);
                        await refreshDatabasePanel();
                    } catch (dbError) {
                        console.warn('تعذّر حفظ نتائج الفحص محلياً:', dbError);
                    }
                }
            }
        } finally {
            state.busy = false;
            state.scanning = false;
            hideProgress();
            indexGames();
            render();
            updateButtons();
            reportScanSummary();
        }
    }

    function reportScanSummary() {
        var total = state.games.length;
        if (!total) {
            showReport('<strong>لم يتم العثور على ألعاب قابلة للتعرّف.</strong>' +
                '<p class="helper" style="margin-top:6px">تأكد من وجود مجلد <span class="mono" dir="ltr">DVD</span> أو ' +
                '<span class="mono" dir="ltr">CD</span> أو ملف <span class="mono" dir="ltr">ul.cfg</span> في جذر الفلاش المختار.</p>');
            return;
        }
        var missing = state.games.filter(isMissing);
        if (!missing.length) {
            showReport('<strong>اكتمل الفحص: ' + total + ' لعبة، وجميع الأغلفة والأيقونات موجودة.</strong>' +
                '<p class="helper" style="margin-top:6px">لم يتم تعديل أي ملف على الفلاش.</p>');
            return;
        }
        if (state.settings.source === 'offline' && !state.offlineHandle) {
            showReport('<strong>اكتمل الفحص: ' + total + ' لعبة، منها ' + missing.length + ' تحتاج صوراً.</strong>' +
                '<p class="helper" style="margin-top:6px">اختر مجلد الصور الأوفلاين، ثم اضغط «مزامنة الناقص». لم يُنزَّل أو يُستبدل أي ملف.</p>');
            return;
        }
        showReport('<strong>اكتمل الفحص: ' + total + ' لعبة، منها ' + missing.length + ' تحتاج غلافاً أو أيقونة.</strong>' +
            '<p class="helper" style="margin-top:6px">راجع المعاينات ثم اضغط «مزامنة الناقص» لبدء الحفظ. لم تتغير ملفات الفلاش أثناء الفحص.</p>');
    }

    async function chooseRootFolder() {
        if (state.busy) return;
        try {
            var handle = isNativeAndroid
                ? await pickNativeFolder()
                : await window.showDirectoryPicker({ mode: 'readwrite' });
            state.rootHandle = handle;
            if (viewRefs.btnSelectUsb) {
                /* الاسم المعروض ثابت كما طلب المستخدم، والاسم الحقيقي يظهر في التلميح */
                viewRefs.btnSelectUsb.innerHTML = '<span aria-hidden="true">✅</span> فلاش ميموري';
                viewRefs.btnSelectUsb.title = 'الفلاش المحدد: ' + handle.name + ' — اضغط للتبديل';
                viewRefs.btnSelectUsb.setAttribute('aria-label',
                    'فلاش ميموري: ' + handle.name + '. اضغط لتغيير المجلد');
            }
            toast('تم فتح: ' + handle.name, 'success', 2500);
            await runScan();
        } catch (error) {
            if (error && (error.name === 'AbortError' || error.name === 'NotAllowedError' && !error.message)) return;
            toast(error && error.message ? error.message : 'تعذّر اختيار المجلد.', 'error');
        }
    }

    async function chooseOfflineFolder() {
        if (!supportsFsApi) return;
        try {
            state.offlineHandle = isNativeAndroid
                ? await pickNativeFolder()
                : await window.showDirectoryPicker({ mode: 'read' });
            state.offlineFiles = await listDir(state.offlineHandle);
            viewRefs.btnLocalOffline.innerHTML = '<span aria-hidden="true">✅</span> ' +
                escapeHtml(state.offlineHandle.name) + ' (' + state.offlineFiles.size + ')';
            toast('مجلد الأوفلاين جاهز: ' + state.offlineFiles.size + ' ملف.', 'success');
            scheduleRender();
        } catch (error) {
            if (error && error.name === 'AbortError') return;
            toast(error && error.message ? error.message : 'تعذّر اختيار مجلد الصور.', 'error');
        }
    }

    /* ------------------------------------------------------------------
       12) العرض
       ------------------------------------------------------------------ */
    var renderQueued = false;

    function scheduleRender() {
        if (renderQueued) return;
        renderQueued = true;
        requestAnimationFrame(function () {
            renderQueued = false;
            render();
        });
    }

    function getVisibleGames() {
        var query = normalizeText(viewRefs.searchInput.value);
        var filter = state.filter;
        var list = state.games.filter(function (game) {
            if (query) {
                var haystack = normalizeText(game.title + ' ' + game.gameId +
                    ' ' + (game.publisher || '') + ' ' + (game.genre || ''));
                if (haystack.indexOf(query) === -1) return false;
            }
            switch (filter) {
                case 'missing': return isMissing(game);
                case 'nocover': return !game.hasCover;
                case 'noicon': return !game.hasIcon;
                case 'complete': return !isMissing(game);
                case 'ISO': return game.format === 'ISO';
                case 'UL': return game.format === 'UL';
                default: return true;
            }
        });

        var sort = viewRefs.sortSelect.value;
        return list.slice().sort(function (a, b) {
            if (sort === 'id') return collator.compare(a.gameId, b.gameId);
            if (sort === 'format') return collator.compare(a.format + a.title, b.format + b.title);
            if (sort === 'status') return (Number(isMissing(b)) - Number(isMissing(a))) || collator.compare(a.title, b.title);
            return collator.compare(a.title, b.title);
        });
    }

    function renderStats() {
        var iso = 0, ul = 0, ready = 0, missing = 0;
        state.games.forEach(function (game) {
            if (game.format === 'ISO') iso++;
            if (game.format === 'UL') ul++;
            if (game.hasCover) ready++;
            if (isMissing(game)) missing++;
        });
        setText('statTotal', state.games.length);
        setText('statIso', iso);
        setText('statUl', ul);
        setText('statReady', ready);
        setText('statMissing', missing);
    }

    function cardHtml(game, order) {
        var idx = state.indexById.get(game.gameId);
        var selected = state.selection.has(game.gameId);
        var hideMedia = !game.hasCover && (state.settings.source === 'offline' || brokenCovers.has(game.gameId));
        return '<article class="game-card' + (selected ? ' is-selected' : '') + (hideMedia ? ' no-cover' : '') +
            '" data-idx="' + idx + '" data-gid="' + escapeHtml(game.gameId) + '"' +
            ' style="animation-delay:' + Math.min(order * 12, 200) + 'ms">' +
            '<div class="poster-wrap">' +
                '<div class="poster-skeleton" aria-hidden="true"></div>' +
                '<img class="poster cover-img" alt="" loading="lazy" decoding="async" data-idx="' + idx + '">' +
                '<div class="poster-top"><span class="badge-format' + (game.format === 'UL' ? ' is-ul' : '') + '">' +
                    escapeHtml(game.format) + '</span></div>' +
                '<span class="select-check" aria-hidden="true">✓</span>' +
                '<div class="status-dots" title="الغلاف / الأيقونة">' +
                    '<span class="dot' + (game.hasCover ? ' ok' : '') + '"></span>' +
                    '<span class="dot' + (game.hasIcon ? ' ok' : '') + '"></span>' +
                '</div>' +
            '</div>' +
            '<div class="card-body">' +
                '<h3 class="card-title" title="' + escapeHtml(game.title) + '">' + escapeHtml(game.title) + '</h3>' +
                '<div class="card-meta">' +
                    '<code class="gid" data-copy="' + escapeHtml(game.gameId) + '" title="انسخ كود اللعبة">' +
                        escapeHtml(game.gameId) + '</code>' +
                '</div>' +
                '<div class="card-actions">' +
                    '<button class="btn btn-ghost" type="button" data-action="download">⬇️ تحميل</button>' +
                    '<button class="btn btn-ghost" type="button" data-action="manual">📎 يدوي</button>' +
                '</div>' +
            '</div>' +
        '</article>';
    }

    function rowHtml(game) {
        var idx = state.indexById.get(game.gameId);
        var selected = state.selection.has(game.gameId);
        return '<tr data-idx="' + idx + '" data-gid="' + escapeHtml(game.gameId) + '"' + (selected ? ' class="is-selected"' : '') + '>' +
            '<td data-label="الغلاف"><img class="thumb cover-img" alt="" loading="lazy" decoding="async" data-idx="' + idx + '"></td>' +
            '<td data-label="اسم اللعبة" style="font-weight:600">' + escapeHtml(game.title) + '</td>' +
            '<td data-label="الكود"><code class="gid" data-copy="' + escapeHtml(game.gameId) + '">' + escapeHtml(game.gameId) + '</code></td>' +
            '<td data-label="الصيغة"><span class="badge ' + (game.format === 'ISO' ? 'badge-iso' : 'badge-ul') + '">' +
                escapeHtml(game.format) + '</span></td>' +
            '<td data-label="ART"><span class="badge ' + (game.hasCover ? 'badge-ok' : 'badge-missing') + '" data-badge="cover">' +
                (game.hasCover ? 'متوفر ✓' : 'ناقص ✗') + '</span></td>' +
            '<td data-label="ICONS"><span class="badge ' + (game.hasIcon ? 'badge-ok' : 'badge-missing') + '" data-badge="icon">' +
                (game.hasIcon ? 'متوفر ✓' : 'ناقص ✗') + '</span></td>' +
            '<td data-label="إجراءات"><div class="row-actions">' +
                '<button class="btn btn-ghost btn-sm" type="button" data-action="download">⬇️ تحميل</button>' +
                '<button class="btn btn-ghost btn-sm" type="button" data-action="manual">📎 يدوي</button>' +
            '</div></td>' +
        '</tr>';
    }

    function showSkeletons() {
        var skeleton = '';
        for (var i = 0; i < 8; i++) {
            skeleton += '<div class="game-card skeleton" aria-hidden="true">' +
                '<div class="poster-wrap"><div class="poster-skeleton"></div></div>' +
                '<div class="card-body"><div class="sk-line"></div><div class="sk-line short"></div></div>' +
                '</div>';
        }
        viewRefs.artGrid.innerHTML = skeleton;
        viewRefs.artGrid.hidden = false;
        viewRefs.tableWrap.hidden = true;
    }

    function render() {
        if (!viewRefs.artGrid) return;
        renderStats();
        updateButtons();

        if (state.scanning) {
            setText('visibleCount', '');
            showSkeletons();
            syncSelectionUI();
            return;
        }

        var total = state.games.length;
        var visible = getVisibleGames();
        state.lastRendered = visible;
        setText('visibleCount', total ? visible.length + ' من ' + total : '');

        if (!total) {
            showEmpty(
                state.rootHandle ? 'لا ألعاب في هذا المخزن' : 'ابدأ باختيار الفلاش',
                state.rootHandle
                    ? 'لم نجد ملفات ISO داخل DVD أو CD ولا مدخلات في ul.cfg.'
                    : 'اختر مجلد الفلاش (الجذر) ليبدأ الفحص التلقائي.',
                state.rootHandle ? '🔎' : '📁'
            );
            syncSelectionUI();
            return;
        }

        if (!visible.length) {
            showEmpty('لا نتائج مطابقة', 'جرّب كلمة بحث أخرى أو أزل عوامل التصفية.', '🔍');
            syncSelectionUI();
            return;
        }

        if (state.view === 'grid') {
            viewRefs.artGrid.innerHTML = visible.map(cardHtml).join('');
            viewRefs.artGrid.hidden = false;
            viewRefs.tableWrap.hidden = true;
            attachPreviews(viewRefs.artGrid);
        } else {
            viewRefs.gamesTableBody.innerHTML = visible.map(rowHtml).join('');
            viewRefs.artGrid.hidden = true;
            viewRefs.tableWrap.hidden = false;
            attachPreviews(viewRefs.gamesTableBody);
        }
        syncSelectionUI();
    }

    /* ------------------------------------------------------------------
       13) المعاينات (Lazy + بدائل)
       ------------------------------------------------------------------ */
    function readyImage(img) {
        img.classList.add('is-loaded');
        var card = img.closest('.game-card');
        if (card) {
            card.classList.add('is-media-ready');
            card.classList.remove('no-cover');
        }
    }

    function markNoCover(img) {
        img.removeAttribute('src');
        img.classList.add('is-missing');
        var card = img.closest('.game-card');
        if (card) {
            card.classList.add('no-cover', 'is-media-ready');
        }
    }

    function loadLocalPreview(img, game) {
        var cached = localUrlCache.get(game.gameId);
        if (cached) {
            img.onload = function () { readyImage(img); };
            img.src = cached;
            return;
        }
        game.coverHandle.getFile().then(function (file) {
            var url = URL.createObjectURL(file);
            localUrlCache.set(game.gameId, url);
            img.onload = function () { readyImage(img); };
            img.src = url;
        }).catch(function () {
            if (state.settings.source === 'offline') markNoCover(img);
            else loadOnlinePreview(img, game);
        });
    }

    function loadOfflinePreview(img, game) {
        var v = idVariants(game.gameId);
        var names = [v.dot, v.serial, v.dashDot].reduce(function (acc, base) {
            return acc.concat([base + '.JPG', base + '.PNG', base + '_COV.JPG', base + '_COV.PNG']);
        }, []);
        for (var i = 0; i < names.length; i++) {
            var handle = state.offlineFiles.get(names[i]);
            if (!handle) continue;
            handle.getFile().then(function (file) {
                var url = URL.createObjectURL(file);
                localUrlCache.set(game.gameId, url);
                img.onload = function () { readyImage(img); };
                img.src = url;
            }).catch(function () { markNoCover(img); });
            return;
        }
        markNoCover(img);
    }

    function loadOnlinePreview(img, game) {
        if (brokenCovers.has(game.gameId)) {
            markNoCover(img);
            return;
        }
        var urls = onlineCoverUrls(game.gameId);
        var attempt = 0;
        function next() {
            if (attempt >= urls.length) {
                brokenCovers.add(game.gameId);
                markNoCover(img);
                return;
            }
            img.onload = function () {
                img.onerror = null;
                readyImage(img);
            };
            img.onerror = function () {
                attempt++;
                next();
            };
            try {
                img.src = urls[attempt++];
            } catch (error) {
                attempt++;
                next();
            }
        }
        next();
    }

    function loadPreview(img) {
        var game = state.games[Number(img.dataset.idx)];
        if (!game) return;
        if (game.hasCover && game.coverHandle) {
            loadLocalPreview(img, game);
        } else if (state.settings.source === 'offline') {
            loadOfflinePreview(img, game);
        } else {
            loadOnlinePreview(img, game);
        }
    }

    function attachPreviews(container) {
        if (!previewObserver) {
            previewObserver = new IntersectionObserver(function (entries) {
                entries.forEach(function (entry) {
                    if (!entry.isIntersecting) return;
                    previewObserver.unobserve(entry.target);
                    loadPreview(entry.target);
                });
            }, { rootMargin: '260px' });
        }
        $$('img.cover-img', container).forEach(function (img) {
            if (img.dataset.observed === '1') return;
            img.dataset.observed = '1';
            previewObserver.observe(img);
        });
    }

    function revokeLocalPreviews() {
        localUrlCache.forEach(function (url) {
            try { URL.revokeObjectURL(url); } catch (error) { /* تجاهل */ }
        });
        localUrlCache.clear();
    }

    /* ------------------------------------------------------------------
       14) الصور والكتابة على الفلاش
       ------------------------------------------------------------------ */
    function decodeWithImage(blob) {
        return new Promise(function (resolve, reject) {
            var url = URL.createObjectURL(blob);
            var image = new Image();
            image.onload = function () {
                URL.revokeObjectURL(url);
                resolve(image);
            };
            image.onerror = function () {
                URL.revokeObjectURL(url);
                reject(new Error('الصورة غير صالحة أو تالفة.'));
            };
            image.src = url;
        });
    }

    function decodeImage(blob) {
        if (typeof createImageBitmap === 'function') {
            return createImageBitmap(blob).catch(function () { return decodeWithImage(blob); });
        }
        return decodeWithImage(blob);
    }

    function canvasToBlob(canvas, type, quality) {
        return new Promise(function (resolve, reject) {
            canvas.toBlob(function (blob) {
                if (blob) resolve(blob);
                else reject(new Error('تعذّر توليد الصورة.'));
            }, type, quality);
        });
    }

    function toCoverJpeg(bitmap) {
        var canvas = document.createElement('canvas');
        canvas.width = CONFIG.coverWidth;
        canvas.height = CONFIG.coverHeight;
        var ctx = canvas.getContext('2d', { alpha: false });
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, CONFIG.coverWidth, CONFIG.coverHeight);
        var scale = Math.max(CONFIG.coverWidth / bitmap.width, CONFIG.coverHeight / bitmap.height);
        var width = bitmap.width * scale;
        var height = bitmap.height * scale;
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(bitmap, (CONFIG.coverWidth - width) / 2, (CONFIG.coverHeight - height) / 2, width, height);
        return canvasToBlob(canvas, 'image/jpeg', state.settings.quality);
    }

    function toIconPng(bitmap) {
        var canvas = document.createElement('canvas');
        canvas.width = CONFIG.iconSize;
        canvas.height = CONFIG.iconSize;
        var ctx = canvas.getContext('2d');
        ctx.clearRect(0, 0, CONFIG.iconSize, CONFIG.iconSize);
        var scale = Math.min(CONFIG.iconSize / bitmap.width, CONFIG.iconSize / bitmap.height);
        var width = bitmap.width * scale;
        var height = bitmap.height * scale;
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(bitmap, (CONFIG.iconSize - width) / 2, (CONFIG.iconSize - height) / 2, width, height);
        return canvasToBlob(canvas, 'image/png');
    }

    function fetchWithTimeout(url) {
        var controller = new AbortController();
        var timer = setTimeout(function () { controller.abort(); }, CONFIG.fetchTimeoutMs);
        return fetch(url, { signal: controller.signal, cache: 'no-store', referrerPolicy: 'no-referrer' })
            .finally(function () { clearTimeout(timer); });
    }

    function fetchGameCoverBlob(gameId) {
        if (state.settings.source === 'offline') {
            if (!state.offlineHandle) return Promise.reject(new Error('اختر مجلد الصور الأوفلاين أولاً.'));
            var v = idVariants(gameId);
            var names = [v.dot, v.serial, v.dashDot].reduce(function (acc, base) {
                return acc.concat([base + '.JPG', base + '.PNG', base + '_COV.JPG', base + '_COV.PNG']);
            }, []);
            var chain = Promise.resolve(null);
            names.forEach(function (name) {
                chain = chain.then(function (found) {
                    if (found) return found;
                    var handle = state.offlineFiles.get(name);
                    if (!handle) return null;
                    return handle.getFile().then(function (file) {
                        return decodeImage(file).then(function (bitmap) {
                            if (bitmap.close) bitmap.close();
                            return file;
                        }).catch(function () { return null; });
                    });
                });
            });
            return chain;
        }

        var urls = coverFetchUrls(gameId);
        var index = 0;
        function attempt() {
            if (index >= urls.length) return Promise.resolve(null);
            var url = urls[index++];
            return fetchWithTimeout(url).then(function (response) {
                if (!response.ok) return attempt();
                return response.blob().then(function (blob) {
                    return decodeImage(blob).then(function (bitmap) {
                        if (bitmap.close) bitmap.close();
                        return blob;
                    }).catch(function () { return attempt(); });
                });
            }).catch(function () { return attempt(); });
        }
        return attempt();
    }

    var artDirHandle = null;
    var iconDirHandle = null;

    function ensureDirs() {
        return Promise.all([
            state.rootHandle.getDirectoryHandle('ART', { create: true }),
            state.rootHandle.getDirectoryHandle('ICONS', { create: true })
        ]).then(function (handles) {
            artDirHandle = handles[0];
            iconDirHandle = handles[1];
        });
    }

    async function saveArtwork(game, sourceBlob, needs) {
        var bitmap = await decodeImage(sourceBlob);
        try {
            if (needs.cover) {
                var jpeg = await toCoverJpeg(bitmap);
                var coverName = game.gameId + '_COV.jpg';
                await writeFile(artDirHandle, coverName, jpeg);
                game.hasCover = true;
                game.coverHandle = await artDirHandle.getFileHandle(coverName);
                state.artFiles.set(coverName.toUpperCase(), game.coverHandle);
            }
            if (needs.icon) {
                var png = await toIconPng(bitmap);
                var iconName = game.gameId + '_ICO.png';
                await writeFile(iconDirHandle, iconName, png);
                game.hasIcon = true;
                state.iconFiles.set(iconName.toUpperCase(), null);
            }
            localUrlCache.delete(game.gameId);
        } finally {
            if (bitmap && bitmap.close) bitmap.close();
        }
    }

    async function processGame(game, overwrite) {
        var needCover = overwrite || !game.hasCover;
        var needIcon = overwrite || !game.hasIcon;
        if (!needCover && !needIcon) return 'skipped';

        var source = null;
        if (!needCover && needIcon && game.coverHandle) {
            try { source = await game.coverHandle.getFile(); } catch (error) { source = null; }
        }
        if (!source) source = await fetchGameCoverBlob(game.gameId);
        if (!source) throw new Error('لا توجد صورة متاحة لهذه اللعبة في المصدر المحدد.');

        await saveArtwork(game, source, { cover: needCover, icon: needIcon });
        return 'ok';
    }

    /* ------------------------------------------------------------------
       15) الدُفعات والتقارير
       ------------------------------------------------------------------ */
    function setCardBusy(game, busy) {
        var idx = state.indexById.get(game.gameId);
        $$('[data-idx="' + idx + '"]').forEach(function (node) {
            if (node.classList.contains('game-card')) node.classList.toggle('is-busy', busy);
        });
    }

    function updateGameVisual(game) {
        var idx = state.indexById.get(game.gameId);
        var card = viewRefs.artGrid.querySelector('.game-card[data-idx="' + idx + '"]');
        if (card) {
            var dots = card.querySelectorAll('.status-dots .dot');
            if (dots[0]) dots[0].classList.toggle('ok', !!game.hasCover);
            if (dots[1]) dots[1].classList.toggle('ok', !!game.hasIcon);
            card.classList.remove('is-busy', 'is-failed');
            if (game.hasCover) card.classList.remove('no-cover');
        }
        var row = viewRefs.gamesTableBody.querySelector('tr[data-idx="' + idx + '"]');
        if (row) {
            row.querySelectorAll('.badge[data-badge]').forEach(function (badge) {
                var kind = badge.getAttribute('data-badge');
                var ok = kind === 'cover' ? game.hasCover : game.hasIcon;
                badge.className = 'badge ' + (ok ? 'badge-ok' : 'badge-missing');
                badge.textContent = ok ? 'متوفر ✓' : 'ناقص ✗';
            });
        }
        renderStats();
    }

    function batchProgress(text, done, total, startedAt) {
        var percent = total ? (done / total) * 100 : 0;
        var eta = '';
        if (done > 0 && done < total) {
            var elapsed = Date.now() - startedAt;
            eta = ' · متبقي ~' + humanDuration((elapsed / done) * (total - done));
        }
        setProgress(text, {
            percent: percent,
            count: done + ' / ' + total + eta,
            cancelable: true
        });
    }

    async function runBatch(targets, overwrite) {
        if (!state.rootHandle) { toast('اختر مجلد الفلاش أولاً.', 'warning'); return; }
        if (state.busy) return;
        if (!targets.length) { toast('كل الألعاب المستهدفة مكتملة بالفعل.', 'info'); return; }
        if (state.settings.source === 'offline' && !state.offlineHandle) {
            toast('اختر مجلد الصور الأوفلاين أولاً.', 'warning');
            return;
        }

        state.busy = true;
        state.cancelRequested = false;
        hideReport();
        updateButtons();

        try {
            await ensureDirs();
        } catch (error) {
            state.busy = false;
            updateButtons();
            toast('تعذّر إنشاء مجلدات ART وICONS. تحقق من صلاحية الكتابة على وحدة التخزين.', 'error');
            return;
        }

        var total = targets.length;
        var done = 0;
        var successful = 0;
        var failed = [];
        var cursor = 0;
        var startedAt = Date.now();

        setProgress('جاري البدء…', { percent: 0, count: '0 / ' + total, cancelable: true });

        async function worker() {
            while (!state.cancelRequested) {
                var index = cursor++;
                if (index >= targets.length) return;
                var game = targets[index];
                setCardBusy(game, true);
                batchProgress('جاري معالجة: ' + game.title + ' (' + game.gameId + ')', done, total, startedAt);
                try {
                    var result = await processGame(game, overwrite);
                    if (result === 'ok') successful++;
                    updateGameVisual(game);
                } catch (error) {
                    game.lastError = error && error.message ? error.message : String(error);
                    failed.push(game);
                    var idx = state.indexById.get(game.gameId);
                    $$('.game-card[data-idx="' + idx + '"]').forEach(function (node) {
                        node.classList.add('is-failed');
                    });
                }
                done++;
                setCardBusy(game, false);
                batchProgress('جاري معالجة: ' + game.title + ' (' + game.gameId + ')', done, total, startedAt);
            }
        }

        var workers = [];
        var parallel = Math.max(1, Math.min(Number(state.settings.concurrency) || 1, total));
        for (var i = 0; i < parallel; i++) workers.push(worker());
        await Promise.all(workers);

        var cancelled = state.cancelRequested;
        var skipped = total - done;
        state.busy = false;
        state.cancelRequested = false;
        state.lastFailed = failed;
        hideProgress();
        updateButtons();
        render();
        showBatchReport(successful, failed, skipped, cancelled, total);
    }

    function showBatchReport(successful, failed, skipped, cancelled, total) {
        var html = '<strong>' + (cancelled ? 'تم إيقاف العملية.' : 'اكتملت المزامنة.') + '</strong> ' +
            'من ' + total + ' لعبة: نجح ' + successful + '، فشل ' + failed.length +
            (skipped ? '، لم تُعالج ' + skipped : '') + '.';
        html += '<p class="helper" style="margin-top:6px">لا تُحتسب الصورة محفوظة إلا بعد إعادة قراءة الملف والتحقق من محتواه.</p>';
        if (failed.length) {
            html += '<ul>' + failed.map(function (game) {
                return '<li>' + escapeHtml(game.title) + ' <span dir="ltr">(' + escapeHtml(game.gameId) + ')</span>' +
                    (game.lastError ? ' — <span class="report-error">' + escapeHtml(game.lastError) + '</span>' : '') + '</li>';
            }).join('') + '</ul>';
            html += '<p class="helper" style="margin-top:8px;color:var(--warning)">إذا تكرر الخطأ: تحقق من صلاحيات المجلد، مساحة الفلاش، واتصال OTG. بعض موفّرات ملفات Android تمنع الكتابة على exFAT.</p>';
        }
        html += '<div class="report-actions">' +
            (failed.length ? '<button class="btn btn-warning btn-sm" data-report-action="retry">🔁 إعادة محاولة الفاشل</button>' : '') +
            '<button class="btn btn-ghost btn-sm" data-report-action="copy">📋 نسخ التقرير</button>' +
            '<button class="btn btn-ghost btn-sm" data-report-action="csv">📄 تصدير CSV</button>' +
            '</div>';
        showReport(html);
        if (!cancelled && !failed.length) toast('تمت مزامنة ' + successful + ' لعبة بنجاح.', 'success');
        if (failed.length) toast(failed.length + ' لعبة فشلت. راجع التقرير.', 'error');
    }

    /* ------------------------------------------------------------------
       16) التحديد والأدوات
       ------------------------------------------------------------------ */
    function toggleSelection(game) {
        if (state.selection.has(game.gameId)) state.selection.delete(game.gameId);
        else state.selection.add(game.gameId);
        syncSelectionUI();
    }

    function syncSelectionUI() {
        var count = state.selection.size;
        if (viewRefs.selectionBar) viewRefs.selectionBar.hidden = count === 0;
        setText('selectionCount', count + ' محددة');
        if (viewRefs.btnDownloadSelected) viewRefs.btnDownloadSelected.disabled = count === 0 || state.busy;
        $$('.game-card').forEach(function (card) {
            card.classList.toggle('is-selected', state.selection.has(card.dataset.gid));
        });
        $$('#gamesTableBody tr[data-gid]').forEach(function (row) {
            row.classList.toggle('is-selected', state.selection.has(row.dataset.gid));
        });
    }

    function exitSelectionMode() {
        document.body.classList.remove('selection-mode');
        state.selection.clear();
        if (viewRefs.btnSelectMode) viewRefs.btnSelectMode.setAttribute('aria-pressed', 'false');
        syncSelectionUI();
    }

    function exportCsv() {
        var rows = state.lastRendered.length ? state.lastRendered : state.games;
        if (!rows.length) { toast('لا توجد ألعاب لتصديرها.', 'warning'); return; }
        function cell(value) {
            var text = value == null ? '' : String(value);
            return /[",\r\n]/.test(text) ? '"' + text.replace(/"/g, '""') + '"' : text;
        }
        var lines = [['Game ID', 'Title', 'Format', 'Publisher', 'Developer', 'Year', 'Region', 'Genre', 'ART', 'ICONS'].join(',')];
        rows.forEach(function (game) {
            lines.push([
                game.gameId, game.title, game.format, game.publisher || '', game.developer || '',
                game.releaseYear || '', game.region || '', game.genre || '',
                game.hasCover ? 'yes' : 'no', game.hasIcon ? 'yes' : 'no'
            ].map(cell).join(','));
        });
        downloadBlob(new Blob(['\ufeff' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' }),
            'saad-ps2-games-' + new Date().toISOString().slice(0, 10) + '.csv');
        toast('تم تصدير ' + rows.length + ' سجل.', 'success');
    }

    function legacyCopy(text) {
        try {
            var area = document.createElement('textarea');
            area.value = text;
            area.setAttribute('readonly', 'readonly');
            area.style.position = 'fixed';
            area.style.top = '-1000px';
            area.style.opacity = '0';
            document.body.appendChild(area);
            area.select();
            var ok = document.execCommand('copy');
            area.remove();
            return ok;
        } catch (error) { return false; }
    }

    function copyText(text) {
        if (navigator.clipboard && window.isSecureContext) {
            return navigator.clipboard.writeText(text)
                .then(function () { return true; })
                .catch(function () { return legacyCopy(text); });
        }
        return Promise.resolve(legacyCopy(text));
    }

    /* ------------------------------------------------------------------
       17) التفاعلات
       ------------------------------------------------------------------ */
    function updateButtons() {
        var ready = state.games.length > 0 && !!state.rootHandle && !state.busy;
        if (viewRefs.btnDownloadMissing) viewRefs.btnDownloadMissing.disabled = !ready;
        if (viewRefs.btnDownloadAll) viewRefs.btnDownloadAll.disabled = !ready;
        if (viewRefs.btnRescan) viewRefs.btnRescan.disabled = !state.rootHandle || state.busy;
        if (viewRefs.btnSelectUsb) viewRefs.btnSelectUsb.disabled = state.busy;
        if (viewRefs.mBtnSelect) viewRefs.mBtnSelect.disabled = state.busy;
        if (viewRefs.mBtnSync) viewRefs.mBtnSync.disabled = !ready;
        if (viewRefs.btnSelectMode) viewRefs.btnSelectMode.disabled = state.games.length === 0;
        if (viewRefs.btnExportCsv) viewRefs.btnExportCsv.disabled = state.games.length === 0;
        if (viewRefs.btnDownloadSelected) viewRefs.btnDownloadSelected.disabled = state.selection.size === 0 || state.busy;
    }

    function setView(view, shouldRender) {
        state.view = view === 'list' ? 'list' : 'grid';
        state.settings.view = state.view;
        saveSettings();
        if (viewRefs.viewGrid) viewRefs.viewGrid.setAttribute('aria-pressed', String(state.view === 'grid'));
        if (viewRefs.viewList) viewRefs.viewList.setAttribute('aria-pressed', String(state.view === 'list'));
        if (shouldRender !== false) render();
    }

    function syncSourceUI() {
        var offline = state.settings.source === 'offline';
        if (viewRefs.btnLocalOffline) viewRefs.btnLocalOffline.hidden = !offline;
        if (viewRefs.sourceHint) {
            viewRefs.sourceHint.textContent = offline
                ? 'يقرأ الصور من مجلد محلي اخترته، دون اتصال بالإنترنت.'
                : 'يبحث في xlenore و GameTDB ويحفظ أفضل غلاف متاح.';
        }
        if (offline && state.offlineHandle && viewRefs.btnLocalOffline) {
            viewRefs.btnLocalOffline.innerHTML = '<span aria-hidden="true">✅</span> ' +
                escapeHtml(state.offlineHandle.name) + ' (' + state.offlineFiles.size + ')';
        }
    }

    var modalGame = null;

    function openPreview(game, src) {
        if (!src) { toast('المعاينة لم تُحمَّل بعد. انتظر لحظة ثم أعد المحاولة.', 'info'); return; }
        modalGame = game;
        setText('modalTitle', game.title);
        var img = viewRefs.modalImg;
        if (img) {
            img.src = src;
            img.alt = 'غلاف ' + game.title;
        }
        setText('modalMeta', game.gameId + ' · ' + game.format);
        openModal('coverModal');
    }

    function startManual(game) {
        if (!state.rootHandle) { toast('اختر مجلد الفلاش أولاً.', 'warning'); return; }
        state.manualTarget = game;
        if (viewRefs.manualFileInput) {
            viewRefs.manualFileInput.value = '';
            viewRefs.manualFileInput.click();
        }
    }

    function handleLibraryClick(event) {
        var gidNode = event.target.closest('[data-copy]');
        if (gidNode) {
            event.preventDefault();
            var code = gidNode.getAttribute('data-copy');
            copyText(code).then(function (ok) {
                toast(ok ? 'تم نسخ الكود: ' + code : 'تعذّر النسخ من المتصفح.', ok ? 'success' : 'error', 2200);
            });
            return;
        }

        var container = event.currentTarget;
        var row = event.target.closest('[data-idx]');
        if (!row || !container.contains(row)) return;
        var game = state.games[Number(row.dataset.idx)];
        if (!game) return;

        if (document.body.classList.contains('selection-mode')) {
            toggleSelection(game);
            return;
        }

        var image = event.target.closest('img.cover-img');
        if (image) {
            openPreview(game, image.getAttribute('src'));
            return;
        }

        var button = event.target.closest('button[data-action]');
        if (!button || state.busy) return;
        if (button.dataset.action === 'download') {
            runBatch([game], true);
        } else if (button.dataset.action === 'manual') {
            startManual(game);
        }
    }

    function bindEvents() {
        /* المظهر والإعدادات */
        viewRefs.themeToggle.addEventListener('click', function () {
            applyTheme(state.settings.theme === 'light' ? 'dark' : 'light');
        });

        viewRefs.sourceMode.addEventListener('change', function () {
            state.settings.source = viewRefs.sourceMode.value === 'offline' ? 'offline' : 'online';
            saveSettings();
            syncSourceUI();
            revokeLocalPreviews();
            scheduleRender();
        });

        viewRefs.qualitySelect.addEventListener('change', function () {
            state.settings.quality = Number(viewRefs.qualitySelect.value) || 0.82;
            saveSettings();
            toast('جودة الحفظ: ' + Math.round(state.settings.quality * 100) + '%', 'info', 2000);
        });

        viewRefs.concurrencySelect.addEventListener('change', function () {
            state.settings.concurrency = Math.max(1, Math.min(3, Number(viewRefs.concurrencySelect.value) || 1));
            saveSettings();
        });

        /* الفحص */
        viewRefs.btnSelectUsb.addEventListener('click', chooseRootFolder);
        if (viewRefs.mBtnSelect) viewRefs.mBtnSelect.addEventListener('click', chooseRootFolder);
        viewRefs.btnRescan.addEventListener('click', function () { runScan(); });
        viewRefs.btnLocalOffline.addEventListener('click', chooseOfflineFolder);

        function syncMissing() {
            if (!state.games.length) { toast('افحص الفلاش أولاً.', 'warning'); return; }
            var targets = state.games.filter(isMissing);
            if (!targets.length) { toast('كل الأغلفة والأيقونات موجودة بالفعل.', 'success'); return; }
            runBatch(targets, false);
        }
        viewRefs.btnDownloadMissing.addEventListener('click', syncMissing);
        if (viewRefs.mBtnSync) viewRefs.mBtnSync.addEventListener('click', syncMissing);

        viewRefs.btnDownloadAll.addEventListener('click', function () {
            if (!state.games.length) { toast('افحص الفلاش أولاً.', 'warning'); return; }
            askConfirm({
                title: 'تحديث كل الأغلفة؟',
                message: 'سيتم استبدال الأغلفة والأيقونات الموجودة لجميع الألعاب (' + state.games.length + '). لا يمكن التراجع عن هذه العملية.',
                confirmText: 'نعم، حدّث الكل'
            }).then(function (ok) { if (ok) runBatch(state.games.slice(), true); });
        });

        viewRefs.btnCancel.addEventListener('click', function () {
            state.cancelRequested = true;
            viewRefs.btnCancel.disabled = true;
            toast('سيتم الإيقاف بعد انتهاء الملف الحالي.', 'info');
        });

        /* البحث والتصفية */
        var debouncedRender = debounce(scheduleRender, 140);
        viewRefs.searchInput.addEventListener('input', function () {
            viewRefs.btnClearSearch.hidden = !viewRefs.searchInput.value;
            debouncedRender();
        });
        viewRefs.btnClearSearch.addEventListener('click', function () {
            viewRefs.searchInput.value = '';
            viewRefs.btnClearSearch.hidden = true;
            viewRefs.searchInput.focus();
            scheduleRender();
        });
        viewRefs.sortSelect.addEventListener('change', scheduleRender);

        viewRefs.filterChips.addEventListener('click', function (event) {
            var chip = event.target.closest('[data-filter]');
            if (!chip) return;
            state.filter = chip.getAttribute('data-filter') || 'all';
            $$('.chip', viewRefs.filterChips).forEach(function (node) {
                node.setAttribute('aria-pressed', String(node === chip));
            });
            scheduleRender();
        });

        viewRefs.viewGrid.addEventListener('click', function () { setView('grid'); });
        viewRefs.viewList.addEventListener('click', function () { setView('list'); });

        /* التحديد */
        viewRefs.btnSelectMode.addEventListener('click', function () {
            var active = document.body.classList.toggle('selection-mode');
            viewRefs.btnSelectMode.setAttribute('aria-pressed', String(active));
            if (!active) state.selection.clear();
            syncSelectionUI();
        });
        viewRefs.btnClearSelection.addEventListener('click', exitSelectionMode);
        viewRefs.btnDownloadSelected.addEventListener('click', function () {
            var targets = state.games.filter(function (game) { return state.selection.has(game.gameId); });
            if (!targets.length) return;
            runBatch(targets, false);
            exitSelectionMode();
        });
        viewRefs.btnExportCsv.addEventListener('click', exportCsv);

        /* المكتبة */
        viewRefs.artGrid.addEventListener('click', handleLibraryClick);
        viewRefs.gamesTableBody.addEventListener('click', handleLibraryClick);

        /* المعاينة */
        viewRefs.btnCloseModal.addEventListener('click', function () { closeModal('coverModal'); });
        viewRefs.coverModal.addEventListener('click', function (event) {
            if (event.target === viewRefs.coverModal) closeModal('coverModal');
        });
        viewRefs.btnModalDownload.addEventListener('click', function () {
            if (modalGame) {
                closeModal('coverModal');
                runBatch([modalGame], true);
            }
        });

        /* التأكيد */
        viewRefs.confirmOk.addEventListener('click', function () { settleConfirm(true); });
        viewRefs.confirmCancel.addEventListener('click', function () { settleConfirm(false); });
        viewRefs.confirmModal.addEventListener('click', function (event) {
            if (event.target === viewRefs.confirmModal) settleConfirm(false);
        });

        document.addEventListener('keydown', function (event) {
            if (event.key === 'Escape') {
                if (viewRefs.confirmModal.classList.contains('open')) settleConfirm(false);
                if (viewRefs.coverModal.classList.contains('open')) closeModal('coverModal');
                if (document.body.classList.contains('selection-mode')) exitSelectionMode();
            }
            var tag = (event.target.tagName || '').toLowerCase();
            if (event.key === '/' && tag !== 'input' && tag !== 'textarea' && tag !== 'select') {
                event.preventDefault();
                viewRefs.searchInput.focus();
            }
        });

        /* الرفع اليدوي */
        viewRefs.manualFileInput.addEventListener('change', function (event) {
            var file = event.target.files && event.target.files[0];
            var game = state.manualTarget;
            state.manualTarget = null;
            if (!file || !game) return;
            if (!/^image\//.test(file.type)) {
                toast('الملف المحدد ليس صورة.', 'error');
                return;
            }
            if (file.size > CONFIG.maxManualImageBytes) {
                toast('الصورة كبيرة جداً (' + byteSize(file.size) + '). الحد الأقصى 12 ميغابايت.', 'error');
                return;
            }
            (async function () {
                try {
                    await ensureDirs();
                    await saveArtwork(game, file, { cover: true, icon: true });
                    updateGameVisual(game);
                    syncSelectionUI();
                    toast('تم حفظ غلاف وأيقونة: ' + game.title, 'success');
                } catch (error) {
                    toast('تعذّر حفظ الصورة: ' + (error && error.message ? error.message : error), 'error');
                }
            })();
        });

        /* قاعدة البيانات */
        viewRefs.btnSyncDatabase.addEventListener('click', function () { syncGameDatabase(true); });
        viewRefs.btnExportDatabase.addEventListener('click', exportDatabase);
        viewRefs.btnImportDatabase.addEventListener('click', function () { viewRefs.importFileInput.click(); });
        viewRefs.importFileInput.addEventListener('change', function (event) {
            var file = event.target.files && event.target.files[0];
            event.target.value = '';
            if (file) importDatabase(file);
        });

        /* أزرار التقارير */
        document.addEventListener('click', function (event) {
            var button = event.target.closest('[data-report-action]');
            if (!button) return;
            var action = button.getAttribute('data-report-action');
            if (action === 'retry') {
                runBatch(state.lastFailed.slice(), false);
            } else if (action === 'copy') {
                copyText(viewRefs.report.textContent || '').then(function (ok) {
                    toast(ok ? 'تم نسخ التقرير.' : 'تعذّر النسخ.', ok ? 'success' : 'error');
                });
            } else if (action === 'csv') {
                exportCsv();
            }
        });

        window.addEventListener('beforeunload', function (event) {
            if (state.busy) {
                event.preventDefault();
                event.returnValue = '';
            }
        });

        window.addEventListener('online', function () { toast('عاد الاتصال بالإنترنت.', 'success', 2500); });
        window.addEventListener('offline', function () { toast('انقطع الاتصال — وضع الأوفلاين متاح.', 'warning', 3500); });
    }

    /* ------------------------------------------------------------------
       18) التحديثات والتثبيت وService Worker
       ------------------------------------------------------------------ */
    function compareVersions(a, b) {
        var left = String(a || '0').split('.').map(function (part) { return parseInt(part, 10) || 0; });
        var right = String(b || '0').split('.').map(function (part) { return parseInt(part, 10) || 0; });
        for (var i = 0; i < Math.max(left.length, right.length); i++) {
            var x = left[i] || 0;
            var y = right[i] || 0;
            if (x > y) return 1;
            if (x < y) return -1;
        }
        return 0;
    }

    function checkForAppUpdate() {
        var notice = viewRefs.appUpdateNotice;
        if (!notice) return;
        fetch('https://raw.githubusercontent.com/TEaG3/Saad-Ps2/main/package.json?check=' + Date.now(), { cache: 'no-store' })
            .then(function (response) {
                if (!response.ok) throw new Error('unavailable');
                return response.json();
            })
            .then(function (remote) {
                var latest = remote && remote.version;
                if (!latest || compareVersions(latest, CONFIG.version) <= 0) return;
                try { if (localStorage.getItem(DISMISSED_VERSION_KEY) === latest) return; } catch (error) { /* تجاهل */ }
                setText('appUpdateTitle', 'يتوفر تحديث جديد لـ Saad PS2');
                setText('appUpdateText', 'المثبّت: ' + CONFIG.version + ' — المتاح: ' + latest +
                    '. راجع تفاصيل الإصدار قبل التثبيت.');
                viewRefs.appUpdateLink.href = CONFIG.releasePage;
                notice.hidden = false;
            })
            .catch(function () { /* لا اتصال أو الملف غير متاح */ });

        viewRefs.dismissAppUpdate.addEventListener('click', function () {
            viewRefs.appUpdateNotice.hidden = true;
            try {
                fetch('https://raw.githubusercontent.com/TEaG3/Saad-Ps2/main/package.json?check=' + Date.now(), { cache: 'no-store' })
                    .then(function (response) { return response.ok ? response.json() : null; })
                    .then(function (remote) {
                        if (remote && remote.version) localStorage.setItem(DISMISSED_VERSION_KEY, remote.version);
                    })
                    .catch(function () { /* تجاهل */ });
            } catch (error) { /* تجاهل */ }
        });
    }

    var deferredInstallPrompt = null;
    var isStandalone = false;

    function initInstall() {
        var button = viewRefs.installAppBtn;
        if (!button) return;
        isStandalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
        if (isStandalone) {
            button.innerHTML = '<span aria-hidden="true">✓</span><span class="label">مثبّت</span>';
            button.disabled = true;
        }
        window.addEventListener('beforeinstallprompt', function (event) {
            event.preventDefault();
            deferredInstallPrompt = event;
            button.hidden = false;
        });
        window.addEventListener('appinstalled', function () {
            deferredInstallPrompt = null;
            button.innerHTML = '<span aria-hidden="true">✓</span><span class="label">تم التثبيت</span>';
            button.disabled = true;
            toast('تم تثبيت التطبيق بنجاح.', 'success');
        });
        button.addEventListener('click', function () {
            if (deferredInstallPrompt) {
                deferredInstallPrompt.prompt();
                Promise.resolve(deferredInstallPrompt.userChoice).then(function () {
                    deferredInstallPrompt = null;
                });
                return;
            }
            if (isStandalone) return;
            var isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
            askConfirm({
                title: 'تثبيت Saad PS2',
                message: isIOS
                    ? 'على iPhone/iPad: افتح الموقع في Safari، اضغط زر المشاركة، ثم «إضافة إلى الشاشة الرئيسية».'
                    : 'افتح قائمة المتصفح (⋮) واختر «تثبيت التطبيق» أو «إضافة إلى الشاشة الرئيسية».',
                confirmText: 'فهمت',
                cancelText: 'إغلاق',
                danger: false
            });
        });
    }

    var swRegistration = null;

    function showSwNotice(registration) {
        swRegistration = registration;
        if (viewRefs.swUpdateNotice) viewRefs.swUpdateNotice.hidden = false;
    }

    function initServiceWorker() {
        if (!('serviceWorker' in navigator) || !location.protocol.startsWith('http')) return;
        window.addEventListener('load', function () {
            navigator.serviceWorker.register('./sw.js', { scope: './' }).then(function (registration) {
                if (registration.waiting && navigator.serviceWorker.controller) showSwNotice(registration);
                registration.addEventListener('updatefound', function () {
                    var installing = registration.installing;
                    if (!installing) return;
                    installing.addEventListener('statechange', function () {
                        if (installing.state === 'installed' && navigator.serviceWorker.controller) {
                            showSwNotice(registration);
                        }
                    });
                });
            }).catch(function (error) {
                console.warn('تعذّر تسجيل Service Worker:', error);
            });
        });

        if (viewRefs.reloadForUpdate) {
            viewRefs.reloadForUpdate.addEventListener('click', function () {
                if (swRegistration && swRegistration.waiting) {
                    swRegistration.waiting.postMessage({ type: 'SKIP_WAITING' });
                    setTimeout(function () { location.reload(); }, 350);
                } else {
                    location.reload();
                }
            });
        }
    }

    /* ------------------------------------------------------------------
       19) التهيئة
       ------------------------------------------------------------------ */
    function initDatabase() {
        var db = database();
        if (!db) return;
        db.init()
            .then(function () { return refreshDatabasePanel(); })
            .then(function () { return syncGameDatabase(false); })
            .catch(function (error) { console.warn('قاعدة البيانات المحلية غير متاحة:', error); });
    }

    function init() {
        loadSettings();

        /* تطبيع القيم المحفوظة حتى لا يفسد تخزين قديم الواجهة */
        state.settings.theme = state.settings.theme === 'light' ? 'light' : 'dark';
        state.settings.source = state.settings.source === 'offline' ? 'offline' : 'online';
        state.settings.view = state.settings.view === 'list' ? 'list' : 'grid';
        state.settings.quality = Math.min(0.95, Math.max(0.6, Number(state.settings.quality) || 0.82));
        state.settings.concurrency = Math.min(3, Math.max(1, Number(state.settings.concurrency) || 2));

        cacheViewRefs();

        applyTheme(state.settings.theme);
        state.view = state.settings.view === 'list' ? 'list' : 'grid';
        state.filter = 'all';

        viewRefs.sourceMode.value = state.settings.source;
        viewRefs.qualitySelect.value = String(state.settings.quality);
        viewRefs.concurrencySelect.value = String(state.settings.concurrency);

        detectPlatform();
        syncSourceUI();
        bindEvents();
        setView(state.view, false);
        render();
        initDatabase();
        checkForAppUpdate();
        initInstall();
        initServiceWorker();

        console.info('Saad PS2 v' + CONFIG.version + ' — جاهز');
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();