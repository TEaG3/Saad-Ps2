'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { extractGameIdFromIso, idFromFileName } = require('../game-id-parser.js');

const SECTOR = 2048;

function writeBothEndian32(view, offset, value) {
  view.setUint32(offset, value, true);
  view.setUint32(offset + 4, value, false);
}

function directoryRecord(extent, size, name) {
  const nameBytes = Buffer.from(name, 'ascii');
  const length = 33 + nameBytes.length + (nameBytes.length % 2 === 0 ? 1 : 0);
  const record = Buffer.alloc(length);
  record[0] = length;
  record[1] = 0;
  writeBothEndian32(new DataView(record.buffer, record.byteOffset, record.byteLength), 2, extent);
  writeBothEndian32(new DataView(record.buffer, record.byteOffset, record.byteLength), 10, size);
  record[25] = 0;
  record[28] = 1;
  record[31] = 1;
  record[32] = nameBytes.length;
  nameBytes.copy(record, 33);
  return record;
}

function makeIso(cnfText, filename = 'disc.iso') {
  const pvdLba = 16, rootLba = 20, cnfLba = 21;
  const cnf = Buffer.from(cnfText, 'ascii');
  const root = directoryRecord(cnfLba, cnf.length, 'SYSTEM.CNF;1');
  const image = Buffer.alloc(22 * SECTOR);
  const pvd = image.subarray(pvdLba * SECTOR, (pvdLba + 1) * SECTOR);
  pvd[0] = 1; pvd.write('CD001', 1, 'ascii'); pvd[6] = 1;
  const rootRecord = directoryRecord(rootLba, root.length, '\0');
  rootRecord.copy(pvd, 156);
  root.copy(image, rootLba * SECTOR);
  cnf.copy(image, cnfLba * SECTOR);
  return Object.assign(new Blob([image]), { name: filename });
}

test('prefers the serial in SYSTEM.CNF over a different filename serial', async () => {
  const iso = makeIso('BOOT2 = cdrom0:\\SLUS_212.34;1\n', 'SLES_999.99.Other.iso');
  assert.equal(await extractGameIdFromIso(iso), 'SLUS_212.34');
});

test('uses a valid serial from the filename only when SYSTEM.CNF is unavailable', async () => {
  const iso = new Blob(['not an ISO image']);
  iso.name = 'SLES_543.21.Game.iso';
  assert.equal(await extractGameIdFromIso(iso), 'SLES_543.21');
});

test('does not accept random serial-like text inside ISO data', async () => {
  const iso = new Blob(['random bytes SLUS_123.45 and SLES_678.90']);
  iso.name = 'disc.iso';
  assert.equal(await extractGameIdFromIso(iso), null);
});

test('requires a complete, clearly delimited serial in a filename', () => {
  assert.equal(idFromFileName('prefix-SLUS_200.62.Game.iso'), 'SLUS_200.62');
  assert.equal(idFromFileName('unrelatedSLUS_200.62.iso'), null);
  assert.equal(idFromFileName('disc.iso'), null);
});
