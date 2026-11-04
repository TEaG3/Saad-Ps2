(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.SaadPs2GameId = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const SECTOR_SIZE = 2048;
  const MAX_DIRECTORY_BYTES = 1024 * 1024;
  const MAX_SYSTEM_CNF_BYTES = 4096;

  function normalizeId(value) {
    const match = String(value || '').toUpperCase().match(/^([A-Z]{4})[-_]([0-9]{3})\.([0-9]{2})$/);
    return match ? match[1] + '_' + match[2] + '.' + match[3] : null;
  }

  async function readExact(file, start, length) {
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(length) || start < 0 || length < 0) return new Uint8Array();
    return new Uint8Array(await file.slice(start, start + length).arrayBuffer());
  }

  async function readSystemCnfId(file) {
    try {
      if (!file || typeof file.slice !== 'function' || !Number.isFinite(file.size) || file.size < 17 * SECTOR_SIZE) return null;
      const pvdBytes = await readExact(file, 16 * SECTOR_SIZE, SECTOR_SIZE);
      if (pvdBytes.length !== SECTOR_SIZE) return null;
      const pvd = new DataView(pvdBytes.buffer, pvdBytes.byteOffset, pvdBytes.byteLength);
      if (pvd.getUint8(0) !== 1 ||
          String.fromCharCode(...pvdBytes.subarray(1, 6)) !== 'CD001' ||
          pvd.getUint8(6) !== 1) return null;

      const rootRecordOffset = 156;
      const rootRecordLength = pvd.getUint8(rootRecordOffset);
      if (rootRecordLength < 34) return null;
      const rootLba = pvd.getUint32(rootRecordOffset + 2, true);
      const rootSize = pvd.getUint32(rootRecordOffset + 10, true);
      if (!rootLba || !rootSize) return null;

      const directoryLength = Math.min(rootSize, MAX_DIRECTORY_BYTES);
      const directory = await readExact(file, rootLba * SECTOR_SIZE, directoryLength);
      let offset = 0;
      while (offset < directory.length) {
        const recordLength = directory[offset];
        if (recordLength === 0) {
          offset = (Math.floor(offset / SECTOR_SIZE) + 1) * SECTOR_SIZE;
          continue;
        }
        if (recordLength < 34 || offset + recordLength > directory.length) {
          offset += Math.max(recordLength, 1);
          continue;
        }
        const record = new DataView(directory.buffer, directory.byteOffset + offset, recordLength);
        const identifierLength = record.getUint8(32);
        if (33 + identifierLength > recordLength) {
          offset += recordLength;
          continue;
        }
        const identifier = new TextDecoder('ascii').decode(directory.subarray(offset + 33, offset + 33 + identifierLength));
        if (/^SYSTEM\.CNF(?:;[0-9]+)?$/i.test(identifier)) {
          const extent = record.getUint32(2, true);
          const fileSize = Math.min(record.getUint32(10, true), MAX_SYSTEM_CNF_BYTES);
          if (!extent || !fileSize) return null;
          const cnfBytes = await readExact(file, extent * SECTOR_SIZE, fileSize);
          const cnf = new TextDecoder('ascii').decode(cnfBytes);
          const boot = cnf.match(/(?:^|[\r\n])\s*BOOT2?\s*=\s*cdrom0:\\?([A-Z]{4}[-_]\d{3}\.\d{2})(?=\s|;|$)/im);
          return boot ? normalizeId(boot[1]) : null;
        }
        offset += recordLength;
      }
    } catch (_) {
      return null;
    }
    return null;
  }

  function idFromFileName(name) {
    const base = String(name || '').replace(/\.iso$/i, '');
    const match = base.match(/(?:^|[^A-Z0-9])([A-Z]{4}[-_]\d{3}\.\d{2})(?=$|[^0-9])/i);
    return match ? normalizeId(match[1]) : null;
  }

  async function extractGameIdFromIso(file) {
    const fromSystem = await readSystemCnfId(file);
    return fromSystem || idFromFileName(file && file.name);
  }

  return { normalizeId, readSystemCnfId, idFromFileName, extractGameIdFromIso };
});
