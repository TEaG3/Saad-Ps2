'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const catalog = require('../database/catalog.json');
const manifest = require('../database/manifest.json');

test('catalogue count matches the published manifest', () => {
  assert.equal(catalog.games.length, manifest.gameCount);
  assert.equal(catalog.version, manifest.version);
  assert.ok(catalog.games.length > 0);
});

test('catalogue game IDs are normalized and unique', () => {
  const ids = catalog.games.map(game => game.gameId);
  assert.equal(new Set(ids).size, ids.length);
  for (const id of ids) assert.match(id, /^[A-Z]{4}_\d{3}\.\d{2}$/);
});

test('every catalogue entry has a trusted artwork URL and source', () => {
  for (const game of catalog.games) {
    assert.match(game.coverUrl, /^https:\/\/raw\.githubusercontent\.com\/xlenore\/ps2-covers\/main\/covers\/default\/[A-Z]{4}-\d{5}\.jpg$/);
    assert.equal(game.source, 'xlenore/ps2-covers');
  }
});
