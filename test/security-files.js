/**
 * Tests de sécurité des fichiers privés — aucune base MySQL nécessaire.
 *
 * Vérifie les garanties qui peuvent l'être hors serveur :
 * - validation par contenu (magic numbers) et listes blanches MIME ;
 * - refus des chemins hors STORAGE_DIR ;
 * - politique d'accès par catégorie (propriétaire, admin, recruteur légitime) ;
 * - absence d'exposition statique de `uploads/` et présence de la route /files.
 *
 * La vérification HTTP complète (cookie/Bearer + 404 interdit) est couverte par
 * les tests d'intégration une fois la base et le serveur disponibles.
 *
 * Exécution : node test/security-files.js
 */
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const files = require('../src/services/fileStorage.service');
const access = require('../src/services/fileAccess.service');

let checks = 0;
const test = (name, fn) => {
  try {
    fn();
    checks += 1;
    console.log(`  OK   ${name}`);
  } catch (error) {
    console.error(`  ECHEC ${name}`);
    console.error(`        ${error.message}`);
    process.exitCode = 1;
  }
};
const testAsync = async (name, fn) => {
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

// PNG 1x1 valide (signature + IHDR/IDAT/IEND) : suffisant pour file-type.
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64'
);
const PDF = Buffer.from('%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF\n');
const TEXT = Buffer.from('ceci nest pas un fichier autorise');

const user = (id, role = 'candidat') => ({ id_utilisateur: id, role });
const file = (owner, categorie) => ({ id_utilisateur: owner, categorie });
const noApplication = { hasLegitimateApplication: async () => false };
const withApplication = { hasLegitimateApplication: async () => true };

const main = async () => {
  console.log('Tests de sécurité des fichiers privés');

  await testAsync('un PNG est accepté comme photo', async () => {
    const result = await files.validateFile({ buffer: PNG, categorie: 'PHOTO', originalname: 'a.png' });
    assert.equal(result.mime, 'image/png');
    assert.equal(result.ext, 'png');
  });

  await testAsync('un PDF est accepté comme CV', async () => {
    const result = await files.validateFile({ buffer: PDF, categorie: 'CV', originalname: 'cv.pdf' });
    assert.equal(result.mime, 'application/pdf');
  });

  await testAsync('un PDF est accepté comme justificatif', async () => {
    const result = await files.validateFile({ buffer: PDF, categorie: 'JUSTIFICATIF', originalname: 'rccm.pdf' });
    assert.equal(result.mime, 'application/pdf');
  });

  await testAsync('un PNG est refusé comme CV (type non autorisé)', async () => {
    await assert.rejects(
      files.validateFile({ buffer: PNG, categorie: 'CV', originalname: 'faux.pdf' }),
      /non autorisé/
    );
  });

  await testAsync('un PNG est refusé comme justificatif', async () => {
    await assert.rejects(
      files.validateFile({ buffer: PNG, categorie: 'JUSTIFICATIF', originalname: 'faux.pdf' }),
      /non autorisé/
    );
  });

  await testAsync('un contenu texte est refusé partout', async () => {
    await assert.rejects(
      files.validateFile({ buffer: TEXT, categorie: 'PHOTO', originalname: 'photo.png' }),
      /non reconnu/
    );
  });

  await testAsync('un fichier vide est refusé', async () => {
    await assert.rejects(
      files.validateFile({ buffer: Buffer.alloc(0), categorie: 'PHOTO', originalname: 'vide.png' }),
      /vide/
    );
  });

  await testAsync('une catégorie inconnue est refusée', async () => {
    await assert.rejects(
      files.validateFile({ buffer: PNG, categorie: 'INCONNUE', originalname: 'a.png' }),
      /Catégorie/
    );
  });

  test('le nom d’origine ne peut pas porter de chemin', () => {
    assert.equal(files.sanitizeOriginalName('../../etc/passwd'), 'passwd');
    assert.equal(files.sanitizeOriginalName('C:\\secret\\cv.pdf'), 'cv.pdf');
    assert.equal(files.sanitizeOriginalName('a\u0000b"c.pdf'), 'abc.pdf');
  });

  test('un chemin hors STORAGE_DIR est refusé', () => {
    assert.throws(() => files.resolveStoredPath('../../secret.txt'), /invalide/);
    assert.throws(() => files.resolveStoredPath('C:\\Windows\\win.ini'), /invalide/);
    const inside = files.resolveStoredPath('photos/a.png');
    assert.ok(inside.startsWith(files.storageRoot()));
  });

  test('les dossiers de stockage ne sont pas dans uploads/', () => {
    for (const rule of Object.values(files.CATEGORIES)) {
      assert.notEqual(rule.dir, 'uploads');
      assert.ok(!rule.dir.startsWith('uploads'));
    }
  });

  await testAsync('le propriétaire accède toujours à son fichier', async () => {
    assert.equal(await access.canAccess(file(7, 'CV'), user(7), noApplication), true);
  });

  await testAsync('un administrateur accède à tous les fichiers', async () => {
    for (const categorie of ['PHOTO', 'COUVERTURE', 'LOGO', 'CV', 'JUSTIFICATIF']) {
      assert.equal(await access.canAccess(file(7, categorie), user(1, 'administrateur'), noApplication), true);
    }
  });

  await testAsync('photo, couverture et logo sont visibles par tout authentifié', async () => {
    for (const categorie of ['PHOTO', 'COUVERTURE', 'LOGO']) {
      assert.equal(await access.canAccess(file(7, categorie), user(9), noApplication), true);
    }
  });

  await testAsync('un CV est refusé à un recruteur sans candidature', async () => {
    assert.equal(await access.canAccess(file(7, 'CV'), user(9, 'recruteur'), noApplication), false);
  });

  await testAsync('un CV est autorisé au recruteur d’une candidature réelle', async () => {
    assert.equal(await access.canAccess(file(7, 'CV'), user(9, 'recruteur'), withApplication), true);
  });

  await testAsync('un CV est refusé à un autre candidat', async () => {
    assert.equal(await access.canAccess(file(7, 'CV'), user(9, 'candidat'), withApplication), false);
  });

  await testAsync('un justificatif est refusé hors propriétaire/admin', async () => {
    assert.equal(await access.canAccess(file(7, 'JUSTIFICATIF'), user(9, 'recruteur'), withApplication), false);
  });

  await testAsync('une catégorie inconnue est refusée', async () => {
    assert.equal(await access.canAccess(file(7, 'AUTRE'), user(9), withApplication), false);
  });

  test('uploads/ n’est plus servi statiquement et /files est monté', () => {
    const source = fs.readFileSync(path.join(process.cwd(), 'src', 'app.js'), 'utf8');
    assert.doesNotMatch(source, /express\.static\([^\n]*uploads/);
    assert.match(source, /app\.use\('\/files'/);
  });

  test('le logo d’entreprise ne peut plus venir du corps de requête', () => {
    const source = fs.readFileSync(path.join(process.cwd(), 'src', 'models', 'company.model.js'), 'utf8');
    assert.doesNotMatch(source, /logo:\s*[^\n]*body\.logo/);
    assert.doesNotMatch(source, /\/uploads\/companies/);
  });

  test('photo et couverture ne sont pas modifiables via le corps de requête', () => {
    const source = fs.readFileSync(path.join(process.cwd(), 'src', 'models', 'user.model.js'), 'utf8');
    const updateBlock = source.match(/exports\.update = async[\s\S]*?\n};/);
    assert.ok(updateBlock, 'exports.update introuvable');
    assert.doesNotMatch(updateBlock[0], /'photo'|'photo_couverture'/);
    assert.match(source, /exports\.updateAppearance = async/);
  });

  test('la migration crée la table fichier avec les colonnes attendues', () => {
    const sql = fs.readFileSync(
      path.join(process.cwd(), 'database', 'migrations', '20261107_01_fichier.sql'),
      'utf8'
    );
    assert.match(sql, /CREATE TABLE IF NOT EXISTS fichier/);
    for (const column of ['id_fichier', 'id_utilisateur', 'categorie', 'chemin', 'nom_original', 'type_mime', 'taille']) {
      assert.match(sql, new RegExp(`\\b${column}\\b`));
    }
    assert.match(sql, /FOREIGN KEY \(id_utilisateur\) REFERENCES utilisateur\(id_utilisateur\)/);
  });

  if (process.exitCode) {
    console.error(`\n${checks} test(s) réussi(s), des erreurs subsistent.`);
  } else {
    console.log(`\n${checks} test(s) réussi(s).`);
  }
};

main();
