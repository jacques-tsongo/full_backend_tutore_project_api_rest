const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { detectFileType, __setLoaderForTests } = require('../src/utils/fileType');

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64'
);
const JPEG = Buffer.from(
  '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwcJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPDIzNP/bAEMBCQkJDAsMGA0NGDIhHCEyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAf/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAAAAX/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIRAxEAPwCdABmX/9k=',
  'base64'
);
const PDF = Buffer.from('%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n');
const CFB = Buffer.concat([Buffer.from('d0cf11e0a1b11ae1', 'hex'), Buffer.alloc(512)]);
const TEXT = Buffer.from('ceci nest pas un fichier avec une signature reconnue');

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i += 1) {
    let value = i;
    for (let bit = 0; bit < 8; bit += 1) value = value & 1 ? 0xEDB88320 ^ (value >>> 1) : value >>> 1;
    table[i] = value >>> 0;
  }
  return table;
})();

const crc32 = (buffer) => {
  let value = 0xFFFFFFFF;
  for (const byte of buffer) value = CRC_TABLE[(value ^ byte) & 0xFF] ^ (value >>> 8);
  return (value ^ 0xFFFFFFFF) >>> 0;
};

const makeZip = (entries) => {
  const localParts = [];
  const centralParts = [];
  let offset = 0;

  for (const [name, content] of entries) {
    const filename = Buffer.from(name, 'utf8');
    const data = Buffer.isBuffer(content) ? content : Buffer.from(content, 'utf8');
    const crc = crc32(data);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034B50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(0, 8);
    local.writeUInt16LE(0, 10);
    local.writeUInt16LE(0, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(filename.length, 26);
    local.writeUInt16LE(0, 28);
    const localPart = Buffer.concat([local, filename, data]);
    localParts.push(localPart);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014B50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt16LE(0, 12);
    central.writeUInt16LE(0, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(filename.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE(0, 38);
    central.writeUInt32LE(offset, 42);
    centralParts.push(Buffer.concat([central, filename]));
    offset += localPart.length;
  }

  const centralBuffer = Buffer.concat(centralParts);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054B50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralBuffer.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...localParts, centralBuffer, end]);
};

const DOCX = makeZip([
  [
    '[Content_Types].xml',
    '<?xml version="1.0" encoding="UTF-8"?>'
    + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
    + '<Default Extension="xml" ContentType="application/xml"/>'
    + '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>'
    + '</Types>'
  ],
  [
    'word/document.xml',
    '<?xml version="1.0" encoding="UTF-8"?>'
    + '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body/></w:document>'
  ]
]);

let checks = 0;
const test = async (name, fn) => {
  try {
    await fn();
    checks += 1;
    console.log(`  OK   ${name}`);
  } catch (error) {
    console.error(`  ECHEC ${name}`);
    console.error(`        ${error.message}`);
    process.exitCode = 1;
  }
};

const jsFiles = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
  const full = path.join(dir, entry.name);
  return entry.isDirectory() ? jsFiles(full) : (entry.name.endsWith('.js') ? [full] : []);
});

const main = async () => {
  console.log('Tests de compatibilité file-type (vraie bibliothèque installée)');

  await test('PNG 1x1 détecté comme image/png', async () => {
    assert.deepEqual(await detectFileType(PNG), { ext: 'png', mime: 'image/png' });
  });

  await test('JPEG détecté comme image/jpeg', async () => {
    assert.deepEqual(await detectFileType(JPEG), { ext: 'jpg', mime: 'image/jpeg' });
  });

  await test('PDF détecté comme application/pdf', async () => {
    assert.deepEqual(await detectFileType(PDF), { ext: 'pdf', mime: 'application/pdf' });
  });

  await test('signature CFB détectée comme application/x-cfb (ancien .doc)', async () => {
    assert.deepEqual(await detectFileType(CFB), { ext: 'cfb', mime: 'application/x-cfb' });
  });

  await test('DOCX minimal détecté comme wordprocessingml.document', async () => {
    const detected = await detectFileType(DOCX);
    assert.equal(detected?.mime, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
  });

  await test('texte brut non reconnu', async () => {
    assert.equal(await detectFileType(TEXT), undefined);
  });

  await test('garde-fou : aucun require(file-type) ni ancien appel fromBuffer dans src/ et scripts/', () => {
    const offenders = [];
    for (const file of [...jsFiles('src'), ...jsFiles('scripts')]) {
      const source = fs.readFileSync(file, 'utf8');
      if (/require\(\s*['"]file-type['"]\s*\)/.test(source)) offenders.push(`${file} : require(file-type)`);
      if (/\.fromBuffer\s*\(/.test(source)) offenders.push(`${file} : ancien appel fromBuffer`);
    }
    assert.deepEqual(offenders, []);
  });

  await test('un échec de chargement n’est pas mis en cache', async () => {
    let calls = 0;
    __setLoaderForTests(() => {
      calls += 1;
      if (calls === 1) return Promise.reject(new Error('chargement impossible'));
      return Promise.resolve({ fileTypeFromBuffer: async () => ({ ext: 'png', mime: 'image/png' }) });
    });
    await assert.rejects(detectFileType(PNG), /chargement impossible/);
    assert.deepEqual(await detectFileType(PNG), { ext: 'png', mime: 'image/png' });
    assert.equal(calls, 2);
  });

  await test('une bibliothèque sans fileTypeFromBuffer est refusée explicitement', async () => {
    __setLoaderForTests(async () => ({}));
    await assert.rejects(
      detectFileType(PNG),
      /Version incompatible de file-type : fileTypeFromBuffer introuvable/
    );
  });
  __setLoaderForTests();

  if (process.exitCode) console.error(`\n${checks} test(s) réussi(s), des erreurs subsistent.`);
  else console.log(`\n${checks} test(s) réussi(s).`);
};

main();
