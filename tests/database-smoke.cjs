/* Smoke tests for SaadGameDB using an isolated in-memory IndexedDB. */
require('fake-indexeddb/auto');
global.window = global;
global.fetch = async function (url) {
  const value = String(url);
  if (value.includes('manifest.json')) {
    return { ok: true, json: async () => ({ version: 'test-1' }) };
  }
  if (value.includes('catalog.json')) {
    return { ok: true, json: async () => ({ games: [
      { gameId: 'SLUS_123.45', title: 'Catalog title', publisher: 'Test Publisher' }
    ] }) };
  }
  throw new Error('Unexpected fetch URL: ' + value);
};
require('../game-database.js');

(async function () {
  const db = window.SaadGameDB;
  await db.init();
  await db.recordScan([{ gameId: 'SLUS_123.45', title: 'Detected title', format: 'ISO' }]);
  const sync = await db.syncCatalog();
  if (!sync.updated || sync.count !== 1) throw new Error('Catalog sync did not apply');
  const enriched = await db.enrichGames([{ gameId: 'SLUS_123.45', title: 'Detected title' }]);
  if (enriched[0].title !== 'Catalog title') throw new Error('Catalog enrichment failed');
  const backup = await db.exportBackup();
  if (!Array.isArray(backup.games) || backup.games.length !== 1) throw new Error('Backup export failed');
  backup.games.push({ gameId: 'SLES_222.33', title: 'Imported title' });
  const imported = await db.importBackup(backup);
  if (imported.imported !== 2 || imported.skipped !== 0) throw new Error('Backup import failed');
  const all = await db.getAllGames();
  if (all.length !== 2 || !all.some(x => x.gameId === 'SLES_222.33')) throw new Error('Imported record missing');
  const stats = await db.getStats();
  if (stats.totalCount !== 2 || stats.catalogCount !== 1) throw new Error('Database stats mismatch');
  console.log('Database smoke tests passed: scan, catalog merge, export, import, stats.');
})().catch(error => { console.error(error); process.exitCode = 1; });
