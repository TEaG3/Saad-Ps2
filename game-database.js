/* ==========================================================================
   Saad PS2 — قاعدة البيانات المحلية (IndexedDB)
   - games : مكتبة الألعاب المتعرّف عليها محلياً + سجلات الكتالوج المركزي
   - meta  : إصدار الكتالوج وتاريخ آخر مزامنة
   لا تُرسل أي بيانات إلى أي خادم؛ المزامنة تقرأ ملفات الكتالوج فقط.
   ========================================================================== */
(function () {
  'use strict';

  var DB_NAME = 'saad-ps2-library';
  var DB_VERSION = 1;
  var CATALOG_MANIFEST_URL = './database/manifest.json';
  var CATALOG_URL = './database/catalog.json';
  var MAX_IMPORT_RECORDS = 20000;

  var db = null;
  var catalogStatus = 'local';
  var lastSync = null;

  function normalizeId(raw) {
    return String(raw || '').toUpperCase().replace(/-/g, '_').trim();
  }

  function openDatabase() {
    return new Promise(function (resolve, reject) {
      if (!('indexedDB' in window)) {
        reject(new Error('IndexedDB غير مدعوم في هذا المتصفح.'));
        return;
      }
      var request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = function () {
        var database = request.result;
        if (!database.objectStoreNames.contains('games')) {
          var store = database.createObjectStore('games', { keyPath: 'gameId' });
          store.createIndex('title', 'title', { unique: false });
          store.createIndex('lastSeen', 'lastSeen', { unique: false });
        }
        if (!database.objectStoreNames.contains('meta')) {
          database.createObjectStore('meta', { keyPath: 'key' });
        }
      };
      request.onsuccess = function () { resolve(request.result); };
      request.onerror = function () { reject(request.error || new Error('تعذّر فتح قاعدة البيانات.')); };
    });
  }

  function requestResult(request) {
    return new Promise(function (resolve, reject) {
      request.onsuccess = function () { resolve(request.result); };
      request.onerror = function () { reject(request.error || new Error('فشل طلب قاعدة البيانات.')); };
    });
  }

  function requireDb() {
    if (!db) throw new Error('قاعدة البيانات غير مهيأة.');
    return db;
  }

  function getAllGames() {
    return requestResult(requireDb().transaction('games', 'readonly').objectStore('games').getAll());
  }

  function getMeta(key) {
    return requestResult(requireDb().transaction('meta', 'readonly').objectStore('meta').get(key))
      .then(function (record) { return record ? record.value : null; });
  }

  function setMeta(key, value) {
    var tx = requireDb().transaction('meta', 'readwrite');
    tx.objectStore('meta').put({ key: key, value: value });
    return new Promise(function (resolve, reject) {
      tx.oncomplete = function () { resolve(); };
      tx.onerror = function () { reject(tx.error); };
      tx.onabort = function () { reject(tx.error || new Error('أُلغيت المعاملة.')); };
    });
  }

  /** يحفظ نتائج الفحص دون المساس ببيانات الكتالوج الأغنى إن وُجدت. */
  function recordScan(games) {
    if (!db || !Array.isArray(games) || !games.length) return Promise.resolve();
    var now = new Date().toISOString();
    var tx = db.transaction('games', 'readwrite');
    var store = tx.objectStore('games');

    games.forEach(function (game) {
      if (!game || !game.gameId) return;
      var id = normalizeId(game.gameId);
      var request = store.get(id);
      request.onsuccess = function () {
        var previous = request.result || {};
        store.put(Object.assign({}, previous, {
          gameId: id,
          title: previous.catalogTitle || String(game.title || previous.title || id),
          detectedTitle: String(game.title || previous.detectedTitle || id),
          format: game.format || previous.format || 'UNKNOWN',
          firstSeen: previous.firstSeen || now,
          lastSeen: now,
          scanCount: (previous.scanCount || 0) + 1,
          source: previous.source || 'local-scan'
        }));
      };
    });

    return new Promise(function (resolve, reject) {
      tx.oncomplete = function () { resolve(); };
      tx.onerror = function () { reject(tx.error); };
      tx.onabort = function () { reject(tx.error || new Error('أُلغيت معاملة الحفظ.')); };
    });
  }

  /** يقرأ مانيفست الكتالوج ويطبّق السجلات الجديدة فقط عند تغيّر الإصدار. */
  function syncCatalog() {
    if (!db) return Promise.reject(new Error('قاعدة البيانات غير مهيأة.'));
    return fetch(CATALOG_MANIFEST_URL + '?v=' + Date.now(), { cache: 'no-store' })
      .then(function (response) {
        if (!response.ok) throw new Error('بيان الكتالوج غير متاح.');
        return response.json();
      })
      .then(function (manifest) {
        return getMeta('catalogVersion').then(function (savedVersion) {
          return getMeta('lastSync').then(function (savedAt) {
            if (savedVersion === manifest.version && savedAt) {
              lastSync = savedAt;
              catalogStatus = 'online';
              return { updated: false, status: 'online', version: manifest.version };
            }
            return fetch(CATALOG_URL + '?v=' + encodeURIComponent(manifest.version || '1'), { cache: 'no-store' })
              .then(function (response) {
                if (!response.ok) throw new Error('ملف الكتالوج غير متاح.');
                return response.json();
              })
              .then(function (catalog) {
                if (!Array.isArray(catalog.games)) throw new Error('صيغة الكتالوج غير صالحة.');
                return applyCatalog(catalog, manifest);
              });
          });
        });
      })
      .catch(function (error) {
        catalogStatus = 'offline';
        return getMeta('lastSync').catch(function () { return null; }).then(function (savedAt) {
          lastSync = savedAt;
          return { updated: false, status: 'offline', error: error.message };
        });
      });
  }

  function applyCatalog(catalog, manifest) {
    var tx = db.transaction(['games', 'meta'], 'readwrite');
    var gamesStore = tx.objectStore('games');
    var syncedAt = new Date().toISOString();

    catalog.games.forEach(function (item) {
      if (!item || !item.gameId) return;
      var id = normalizeId(item.gameId);
      var request = gamesStore.get(id);
      request.onsuccess = function () {
        var previous = request.result || {};
        gamesStore.put(Object.assign({}, previous, item, {
          gameId: id,
          catalogTitle: item.title || previous.catalogTitle || null,
          catalogRecord: true,
          title: item.title || previous.title || id,
          firstSeen: previous.firstSeen || item.firstSeen || null,
          lastSeen: previous.lastSeen || null,
          source: previous.source || 'central-catalog'
        }));
      };
    });

    var metaStore = tx.objectStore('meta');
    metaStore.put({ key: 'catalogVersion', value: manifest.version || catalog.version || '1' });
    metaStore.put({ key: 'lastSync', value: syncedAt });

    return new Promise(function (resolve, reject) {
      tx.oncomplete = function () {
        lastSync = syncedAt;
        catalogStatus = 'online';
        resolve({ updated: true, status: 'online', version: manifest.version, count: catalog.games.length });
      };
      tx.onerror = function () { reject(tx.error); };
      tx.onabort = function () { reject(tx.error || new Error('أُلغيت معاملة الكتالوج.')); };
    });
  }

  function getStats() {
    if (!db) return Promise.resolve({ localCount: 0, catalogCount: 0, totalCount: 0, catalogVersion: null, lastSync: null, status: catalogStatus });
    return getAllGames().then(function (games) {
      return Promise.all([getMeta('catalogVersion'), getMeta('lastSync')]).then(function (meta) {
        lastSync = meta[1];
        return {
          localCount: games.filter(function (game) { return game.source === 'local-scan' || game.lastSeen; }).length,
          catalogCount: games.filter(function (game) { return game.catalogRecord; }).length,
          totalCount: games.length,
          catalogVersion: meta[0],
          lastSync: meta[1],
          status: catalogStatus
        };
      });
    });
  }

  function enrichGames(scannedGames) {
    return getAllGames().then(function (records) {
      var byId = new Map(records.map(function (record) { return [record.gameId, record]; }));
      return scannedGames.map(function (game) {
        var record = byId.get(normalizeId(game.gameId));
        if (!record) return game;
        return Object.assign({}, game, {
          title: record.catalogTitle || game.title,
          databaseRecord: record,
          publisher: record.publisher || '',
          developer: record.developer || '',
          releaseYear: record.releaseYear || '',
          region: record.region || '',
          genre: record.genre || '',
          description: record.description || ''
        });
      });
    });
  }

  function exportBackup() {
    return getAllGames().then(function (games) {
      return Promise.all([getMeta('catalogVersion'), getMeta('lastSync')]).then(function (meta) {
        return {
          application: 'Saad PS2',
          schemaVersion: DB_VERSION,
          exportedAt: new Date().toISOString(),
          catalogVersion: meta[0],
          lastSync: meta[1],
          games: games
        };
      });
    });
  }

  /**
   * يستورد نسخة احتياطية أنشأها التطبيق.
   * يحل محل السجل بنفس gameId ويحتفظ ببقية المكتبة.
   */
  function importBackup(backup) {
    if (!db) return Promise.reject(new Error('قاعدة البيانات غير مهيأة.'));
    if (!backup || !Array.isArray(backup.games)) {
      return Promise.reject(new Error('الملف لا يحتوي نسخة احتياطية صالحة.'));
    }
    if (backup.application && backup.application !== 'Saad PS2') {
      return Promise.reject(new Error('هذه النسخة لا تنتمي إلى Saad PS2.'));
    }
    if (backup.games.length > MAX_IMPORT_RECORDS) {
      return Promise.reject(new Error('عدد السجلات أكبر من الحد المسموح.'));
    }

    var tx = db.transaction('games', 'readwrite');
    var store = tx.objectStore('games');
    var imported = 0;
    var skipped = 0;

    backup.games.forEach(function (item) {
      if (!item || !item.gameId || typeof item.gameId !== 'string') { skipped++; return; }
      var id = normalizeId(item.gameId);
      if (!/^[A-Z0-9]{4}_\d{3}\.\d{2}$/.test(id)) { skipped++; return; }
      store.put(Object.assign({}, item, {
        gameId: id,
        title: String(item.title || item.detectedTitle || id).slice(0, 200),
        source: item.source || 'local-scan',
        lastSeen: item.lastSeen || new Date().toISOString()
      }));
      imported++;
    });

    return new Promise(function (resolve, reject) {
      tx.oncomplete = function () { resolve({ imported: imported, skipped: skipped }); };
      tx.onerror = function () { reject(tx.error); };
      tx.onabort = function () { reject(tx.error || new Error('أُلغيت معاملة الاستيراد.')); };
    });
  }

  function init() {
    if (db) return Promise.resolve(true);
    return openDatabase().then(function (database) {
      db = database;
      return getMeta('lastSync').then(function (savedAt) {
        lastSync = savedAt;
        return true;
      });
    });
  }

  window.SaadGameDB = {
    init: init,
    recordScan: recordScan,
    syncCatalog: syncCatalog,
    getStats: getStats,
    exportBackup: exportBackup,
    importBackup: importBackup,
    getAllGames: getAllGames,
    enrichGames: enrichGames
  };
})();