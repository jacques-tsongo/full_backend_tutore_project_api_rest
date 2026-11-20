const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { errorHandler } = require('../src/middlewares/error.middleware');

const STORAGE = fs.mkdtempSync(path.join(os.tmpdir(), 'linkemploi-uploads-'));
process.env.STORAGE_DIR = STORAGE;

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64'
);
const PDF = Buffer.from('%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n');
const TEXT = Buffer.from('ceci nest pas une image');

const queries = [];
let nextId = 500;
let failPhotoUpdate = false;
let userRow = { id_utilisateur: 7, photo: null, photo_couverture: null };

const fakeDb = {
  execute: async (sql, params = []) => {
    queries.push({ sql, params });
    if (failPhotoUpdate && /^UPDATE utilisateur SET photo\b/.test(sql)) {
      throw new Error('UPDATE utilisateur simulé en échec');
    }
    if (/^UPDATE utilisateur SET photo = \?/.test(sql)) userRow.photo = params[0];
    if (/^UPDATE utilisateur SET photo_couverture = \?/.test(sql)) userRow.photo_couverture = params[0];
    if (/^INSERT INTO fichier\b/.test(sql)) return [{ insertId: nextId++ }, []];
    if (/^SELECT id_utilisateur, nom, prenom/.test(sql)) {
      return [[{ ...userRow }], []];
    }
    if (/^SELECT id_profil FROM profil_professionnel/.test(sql)) return [[]];
    if (/^INSERT INTO profil_professionnel/.test(sql)) return [{ insertId: 1 }, []];
    if (/^DELETE FROM fichier/.test(sql)) return [{ affectedRows: 1 }, []];
    return [{ affectedRows: 1 }, []];
  }
};

const databasePath = require.resolve('../src/config/database');
require.cache[databasePath] = { id: databasePath, filename: databasePath, loaded: true, exports: fakeDb };

const files = require('../src/services/fileStorage.service');
const profile = require('../src/controllers/profile.controller');

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

const reset = () => {
  fs.rmSync(STORAGE, { recursive: true, force: true });
  fs.mkdirSync(STORAGE, { recursive: true });
  queries.length = 0;
  failPhotoUpdate = false;
  userRow = { id_utilisateur: 7, photo: null, photo_couverture: null };
};

const makeRes = () => ({
  statusCode: 200,
  payload: null,
  status(code) { this.statusCode = code; return this; },
  json(payload) { this.payload = payload; return this; },
  render() { return this; }
});

const call = async (controller, req) => {
  const res = makeRes();
  let nextError;
  await controller(req, res, (error) => { nextError = error; });
  return { res, nextError };
};

const httpStatusOf = (error) => {
  const res = makeRes();
  const original = console.error;
  console.error = () => {};
  try {
    errorHandler(error, { path: '/api/profil/photo', accepts: () => 'json' }, res, () => {});
  } finally {
    console.error = original;
  }
  return res.statusCode;
};

const storedFiles = () => {
  const found = [];
  const walk = (dir, prefix = '') => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) walk(path.join(dir, entry.name), relative);
      else found.push(relative);
    }
  };
  walk(STORAGE);
  return found;
};

const insertFichier = () => queries.find((q) => /^INSERT INTO fichier\b/.test(q.sql));
const updateOf = (column) => queries.find((q) => new RegExp(`^UPDATE \\w+ SET ${column} = \\?`).test(q.sql));

const reqFor = (buffer, originalname) => ({
  file: { buffer, originalname },
  user: { id_utilisateur: 7, role: 'candidat' }
});

const main = async () => {
  console.log('Tests des contrôleurs d’envoi de fichiers (base simulée)');

  await test('photo PNG : 200, octet écrit et ligne fichier + utilisateur mis à jour', async () => {
    reset();
    const { res, nextError } = await call(profile.uploadPhoto, reqFor(PNG, 'avatar.png'));
    assert.equal(nextError, undefined);
    assert.equal(res.statusCode, 200);
    assert.equal(res.payload.success, true);
    const id = res.payload.data.file.id_fichier;
    assert.equal(res.payload.data.file.url, `/files/${id}`);
    assert.equal(res.payload.data.user.photo, `/files/${id}`);
    assert.match(storedFiles()[0], /^photos\/[0-9a-f-]{36}\.png$/);
    assert.equal(storedFiles().length, 1);
    const insert = insertFichier();
    assert.ok(insert);
    assert.deepEqual(insert.params, [7, 'PHOTO', storedFiles()[0], 'avatar.png', 'image/png', PNG.length]);
    assert.equal(updateOf('photo').params[0], `/files/${id}`);
  });

  await test('couverture PNG : catégorie COUVERTURE et colonne photo_couverture', async () => {
    reset();
    const { res, nextError } = await call(profile.uploadCover, reqFor(PNG, 'cover.png'));
    assert.equal(nextError, undefined);
    assert.equal(res.statusCode, 200);
    assert.equal(insertFichier().params[1], 'COUVERTURE');
    assert.match(storedFiles()[0], /^covers\/[0-9a-f-]{36}\.png$/);
    assert.equal(updateOf('photo_couverture').params[0], res.payload.data.file.url);
  });

  await test('CV PDF : catégorie CV et profil_professionnel.cv mis à jour', async () => {
    reset();
    const { res, nextError } = await call(profile.uploadCv, reqFor(PDF, 'cv.pdf'));
    assert.equal(nextError, undefined);
    assert.equal(res.statusCode, 200);
    assert.equal(insertFichier().params[1], 'CV');
    assert.match(storedFiles()[0], /^cv\/[0-9a-f-]{36}\.pdf$/);
    const cvUpdate = queries.find((q) => /^INSERT INTO profil_professionnel/.test(q.sql));
    assert.equal(cvUpdate.params[1], res.payload.data.file.url);
  });

  await test('texte renommé en .png : 422 et aucun octet écrit', async () => {
    reset();
    const { nextError, res } = await call(profile.uploadPhoto, reqFor(TEXT, 'faux.png'));
    assert.ok(nextError);
    assert.equal(httpStatusOf(nextError), 422);
    assert.match(nextError.message, /non reconnu/);
    assert.equal(res.payload, null);
    assert.deepEqual(storedFiles(), []);
    assert.equal(insertFichier(), undefined);
  });

  await test('type réel interdit : PNG nommé cv.pdf refusé en 422', async () => {
    reset();
    const { nextError } = await call(profile.uploadCv, reqFor(PNG, 'cv.pdf'));
    assert.ok(nextError);
    assert.equal(httpStatusOf(nextError), 422);
    assert.match(nextError.message, /non autorisé/);
    assert.deepEqual(storedFiles(), []);
  });

  await test('échec de l’UPDATE : discard supprime la ligne et l’octet', async () => {
    reset();
    failPhotoUpdate = true;
    const { nextError } = await call(profile.uploadPhoto, reqFor(PNG, 'avatar.png'));
    assert.ok(nextError);
    assert.match(nextError.message, /UPDATE utilisateur simulé en échec/);
    assert.deepEqual(storedFiles(), []);
    assert.ok(queries.some((q) => /^DELETE FROM fichier/.test(q.sql)));
  });

  await test('logo PNG et justificatif PDF enregistrés via le service', async () => {
    reset();
    const logo = await files.save({
      buffer: PNG, originalname: 'logo.png', ownerId: 7, categorie: 'LOGO'
    });
    assert.equal(logo.type_mime, 'image/png');
    assert.match(logo.chemin, /^logos\/[0-9a-f-]{36}\.png$/);
    const document = await files.save({
      buffer: PDF, originalname: 'rccm.pdf', ownerId: 7, categorie: 'JUSTIFICATIF'
    });
    assert.equal(document.type_mime, 'application/pdf');
    assert.match(document.chemin, /^justificatifs\/[0-9a-f-]{36}\.pdf$/);
    const inserted = queries.filter((q) => /^INSERT INTO fichier/.test(q.sql));
    assert.deepEqual(inserted.map((q) => q.params[1]), ['LOGO', 'JUSTIFICATIF']);
    assert.equal(storedFiles().length, 2);
  });

  await test('auto-diagnostic : OK avec le chemin absolu, fichier temporaire supprimé', async () => {
    reset();
    const connection = { execute: async () => [[{ Table: 'fichier' }]] };
    const state = await files.selfCheck({ connection });
    assert.equal(state.ok, true);
    assert.equal(files.describeSelfCheck(state), `Stockage privé des fichiers : OK (${STORAGE})`);
    assert.deepEqual(storedFiles(), []);
  });

  await test('auto-diagnostic : table absente signalée, sans bloquer', async () => {
    const state = await files.selfCheck({ connection: { execute: async () => [[]] } });
    assert.equal(state.ok, false);
    assert.match(
      files.describeSelfCheck(state),
      /ERREUR — table : table 'fichier' absente : LES TÉLÉVERSEMENTS ÉCHOUERONT/
    );
  });

  fs.rmSync(STORAGE, { recursive: true, force: true });
  if (process.exitCode) console.error(`\n${checks} test(s) réussi(s), des erreurs subsistent.`);
  else console.log(`\n${checks} test(s) réussi(s).`);
};

main();
