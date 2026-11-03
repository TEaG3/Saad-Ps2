(function () {
  'use strict';

  const DB_NAME = 'saad-ps2-library';
  const DB_VERSION = 1;
  const CATALOG_MANIFEST_URL = './database/manifest.json';
  const CATALOG_URL = './database/catalog.json';
  let db = null;
  let catalogStatus = 'local';
  let lastSync = null;

  function openDatabase() {
    return new Promise((resolve, reject) => {
      if (!('indexedDB' in window)) {
        reject(new Error('IndexedDB is not supported'));
        return;
      }
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const database = request.result;
        if (!database.objectStoreNames.contains('games')) {
          const store = database.createObjectStore('games', { keyPath: 'gameId' });
          store.createIndex('title', 'title', { unique: false });
          store.createIndex('lastSeen', 'lastSeen', { unique: false });
        }
        if (!database.objectStoreNames.contains('meta')) {
          database.createObjectStore('meta', { keyPath: 'key' });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error('Database open failed'));
    });
  }

  function requestResult(request) {
    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error('Database request failed'));
    });
  }

  async function getAllGames() {
    const tx = db.transaction('games', 'readonly');
    return requestResult(tx.objectStore('games').getAll());
  }

  async function getMeta(key) {
    const tx = db.transaction('meta', 'readonly');
    const record = await requestResult(tx.objectStore('meta').get(key));
    return record ? record.value : null;
  }

  async function setMeta(key, value) {
    const tx = db.transaction('meta', 'readwrite');
    tx.objectStore('meta').put({ key, value });
    return new Promise((resolve, reject) => {
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error || new Error('Transaction aborted'));
    });
  }

  async function recordScan(games) {
    if (!db || !Array.isArray(games) || !games.length) return;
    const now = new Date().toISOString();
    const tx = db.transaction('games', 'readwrite');
    const store = tx.objectStore('games');
    for (const game of games) {
      if (!game || !game.gameId) continue;
      const id = String(game.gameId).toUpperCase().replace('-', '_');
      const request = store.get(id);
      request.onsuccess = () => {
        const previous = request.result || {};
        store.put({
          ...previous,
          gameId: id,
          title: previous.catalogTitle || String(game.title || previous.title || id),
          detectedTitle: String(game.title || previous.detectedTitle || id),
          format: game.format || previous.format || 'UNKNOWN',
          firstSeen: previous.firstSeen || now,
          lastSeen: now,
          scanCount: (previous.scanCount || 0) + 1,
          source: 'local-scan'
        });
      };
    }
    return new Promise((resolve, reject) => {
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error || new Error('Scan save aborted'));
    });
  }

  async function syncCatalog() {
    if (!db) throw new Error('Database is not initialized');
    try {
      const manifestResponse = await fetch(CATALOG_MANIFEST_URL + '?v=' + Date.now(), { cache: 'no-store' });
      if (!manifestResponse.ok) throw new Error('Manifest unavailable');
      const manifest = await manifestResponse.json();
      const savedVersion = await getMeta('catalogVersion');
      const savedAt = await getMeta('lastSync');
      if (savedVersion === manifest.version && savedAt) {
        lastSync = savedAt;
        catalogStatus = 'online';
        return { updated: false, status: 'online', version: manifest.version };
      }

      const catalogResponse = await fetch(CATALOG_URL + '?v=' + encodeURIComponent(manifest.version || '1'), { cache: 'no-store' });
      if (!catalogResponse.ok) throw new Error('Catalog unavailable');
      const catalog = await catalogResponse.json();
      if (!Array.isArray(catalog.games)) throw new Error('Invalid catalog format');

      const tx = db.transaction(['games', 'meta'], 'readwrite');
      const gamesStore = tx.objectStore('games');
      for (const item of catalog.games) {
        if (!item || !item.gameId) continue;
        const id = String(item.gameId).toUpperCase().replace('-', '_');
        const request = gamesStore.get(id);
        request.onsuccess = () => {
          const previous = request.result || {};
          gamesStore.put({
            ...previous,
            ...item,
            gameId: id,
            catalogTitle: item.title || previous.catalogTitle || null,
            catalogRecord: true,
            title: item.title || previous.title || id,
            firstSeen: previous.firstSeen || item.firstSeen || null,
            lastSeen: previous.lastSeen || null,
            source: previous.source || 'central-catalog'
          });
        };
      }
      const metaStore = tx.objectStore('meta');
      const syncedAt = new Date().toISOString();
      metaStore.put({ key: 'catalogVersion', value: manifest.version || catalog.version || '1' });
      metaStore.put({ key: 'lastSync', value: syncedAt });
      await new Promise((resolve, reject) => {
        tx.oncomplete = resolve;
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error || new Error('Catalog transaction aborted'));
      });
      lastSync = syncedAt;
      catalogStatus = 'online';
      return { updated: true, status: 'online', version: manifest.version, count: catalog.games.length };
    } catch (error) {
      catalogStatus = 'offline';
      lastSync = await getMeta('lastSync').catch(() => null);
      return { updated: false, status: 'offline', error: error.message };
    }
  }

  async function getStats() {
    const games = db ? await getAllGames() : [];
    const catalogVersion = db ? await getMeta('catalogVersion') : null;
    lastSync = db ? await getMeta('lastSync') : null;
    return {
      localCount: games.filter(game => game.source === 'local-scan' || game.lastSeen).length,
      catalogCount: games.filter(game => game.catalogRecord).length,
      totalCount: games.length,
      catalogVersion,
      lastSync,
      status: catalogStatus
    };
  }

  async function enrichGames(scannedGames) {
    const records = await getAllGames();
    const byId = new Map(records.map(record => [record.gameId, record]));
    return scannedGames.map(game => {
      const record = byId.get(String(game.gameId).toUpperCase().replace('-', '_'));
      if (!record) return game;
      return {
        ...game,
        title: record.catalogTitle || game.title,
        databaseRecord: record,
        publisher: record.publisher || '',
        developer: record.developer || '',
        releaseYear: record.releaseYear || '',
        region: record.region || '',
        genre: record.genre || '',
        description: record.description || ''
      };
    });
  }

  async function exportBackup() {
    const games = await getAllGames();
    return {
      application: 'Saad PS2',
      schemaVersion: DB_VERSION,
      exportedAt: new Date().toISOString(),
      catalogVersion: await getMeta('catalogVersion'),
      games
    };
  }

  async function init() {
    if (!db) db = await openDatabase();
    lastSync = await getMeta('lastSync');
    return true;
  }

  window.SaadGameDB = { init, recordScan, syncCatalog, getStats, exportBackup, getAllGames, enrichGames };
})();
