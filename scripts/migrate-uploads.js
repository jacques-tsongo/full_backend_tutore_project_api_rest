/**
 * Migration des fichiers historiques de `uploads/` vers le stockage privé.
 *
 * Contexte : avant le problème « fichiers privés », les fichiers étaient écrits
 * dans `uploads/` et servis publiquement. Ils sont désormais enregistrés dans
 * la table `fichier` et accessibles uniquement via GET /files/:id.
 *
 * Ce script, IDEMPOTENT :
 * 1. parcourt `uploads/` (hors fichiers `default-*` et `.gitkeep`) ;
 * 2. retrouve le propriétaire en croisant les colonnes existantes
 *    (`utilisateur.photo`, `photo_couverture`, `profil_professionnel.cv`,
 *    `entreprise.logo`, `entreprise.documents_justificatifs`) ;
 * 3. copie l'octet dans STORAGE_DIR sous `legacy/<chemin d'origine>` (les
 *    originaux ne sont JAMAIS supprimés par ce script) ;
 * 4. enregistre la ligne `fichier` (si absente) ;
 * 5. remplace les références `uploads/...` par `/files/<id>`.
 *
 * Les fichiers sans propriétaire identifiable (fixtures de test, orphelins)
 * sont seulement signalés et laissés en place.
 *
 * Exécution :
 *   npm run files:migrate            (applique)
 *   npm run files:migrate -- --dry-run (simulation, aucune écriture)
 *
 * Prérequis : `npm run migrate` (table `fichier`).
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { detectFileType } = require('../src/utils/fileType');
const db = require('../src/config/database');
const { resolveStoredPath } = require('../src/services/fileStorage.service');

const ROOT = path.join(process.cwd(), 'uploads');
const LEGACY_PREFIX = 'legacy';
const DRY_RUN = process.argv.includes('--dry-run');

const FOLDER_CATEGORY = {
  photos: 'PHOTO',
  covers: 'COUVERTURE',
  cv: 'CV',
  companies: 'JUSTIFICATIF'
};

const EXT_MIME = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.pdf': 'application/pdf',
  '.doc': 'application/msword',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
};

const stats = {
  registered: 0,
  already: 0,
  skipped: 0,
  references: 0,
  defaults: 0
};

const toPosix = (p) => p.split(path.sep).join('/');
const variants = (relative) => [`uploads/${relative}`, `/uploads/${relative}`];

const walk = (dir, acc = []) => {
  if (!fs.existsSync(dir)) return acc;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const absolute = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(absolute, acc);
    else if (!entry.name.startsWith('.') && !/^default-/.test(entry.name)) acc.push(absolute);
  }
  return acc;
};

const findOwner = async (relative, filename) => {
  const folder = relative.split('/')[0];
  const category = FOLDER_CATEGORY[folder];
  if (!category) return null;
  const [a, b] = variants(relative);

  if (category === 'PHOTO' || category === 'COUVERTURE') {
    const column = category === 'PHOTO' ? 'photo' : 'photo_couverture';
    const [rows] = await db.execute(
      `SELECT id_utilisateur FROM utilisateur WHERE ${column} IN (?, ?) LIMIT 1`,
      [a, b]
    );
    return rows[0] ? { ownerId: rows[0].id_utilisateur, categorie: category } : null;
  }
  if (category === 'CV') {
    const [rows] = await db.execute(
      'SELECT id_utilisateur FROM profil_professionnel WHERE cv IN (?, ?) LIMIT 1',
      [a, b]
    );
    return rows[0] ? { ownerId: rows[0].id_utilisateur, categorie: category } : null;
  }

  // companies : logo (image) ou justificatif (PDF) selon la colonne qui pointe
  // vers ce fichier.
  const [logos] = await db.execute(
    'SELECT id_utilisateur FROM entreprise WHERE logo IN (?, ?) LIMIT 1',
    [a, b]
  );
  if (logos[0]) return { ownerId: logos[0].id_utilisateur, categorie: 'LOGO' };

  const [docs] = await db.execute(
    'SELECT id_utilisateur FROM entreprise WHERE documents_justificatifs LIKE ? LIMIT 1',
    [`%${relative}%`]
  );
  if (docs[0]) return { ownerId: docs[0].id_utilisateur, categorie: 'JUSTIFICATIF' };
  return null;
};

const detectMime = async (buffer, relative) => {
  const detected = await detectFileType(buffer);
  if (detected) return detected.mime;
  const ext = path.extname(relative).toLowerCase();
  return EXT_MIME[ext] || null;
};

const ensureRecord = async ({ absolute, relative, ownerId, categorie }) => {
  const storedPath = path.posix.join(LEGACY_PREFIX, relative);
  const [existing] = await db.execute('SELECT id_fichier FROM fichier WHERE chemin = ?', [storedPath]);
  if (existing[0]) {
    stats.already += 1;
    return existing[0].id_fichier;
  }

  const buffer = fs.readFileSync(absolute);
  const mime = await detectMime(buffer, relative);
  if (!mime) {
    console.warn(`  IGNORE  type non reconnu : ${relative}`);
    stats.skipped += 1;
    return null;
  }

  if (DRY_RUN) {
    stats.registered += 1;
    return -1; // identifiant factice : aucune écriture en simulation
  }

  const destination = resolveStoredPath(storedPath);
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  if (!fs.existsSync(destination)) fs.copyFileSync(absolute, destination);

  const [result] = await db.execute(
    `INSERT INTO fichier (id_utilisateur, categorie, chemin, nom_original, type_mime, taille)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [ownerId, categorie, storedPath, path.basename(relative), mime, buffer.length]
  );
  stats.registered += 1;
  return result.insertId;
};

const updatePhoto = async (table, column, relative, url) => {
  const [a, b] = variants(relative);
  const [result] = await db.execute(
    `UPDATE ${table} SET ${column} = ? WHERE ${column} IN (?, ?)`,
    [url, a, b]
  );
  stats.references += result.affectedRows;
};

const updateDocuments = async (relative, url) => {
  const [a, b] = variants(relative);
  const [result] = await db.execute(
    `UPDATE entreprise
     SET documents_justificatifs = REPLACE(REPLACE(documents_justificatifs, ?, ?), ?, ?)
     WHERE documents_justificatifs LIKE ? OR documents_justificatifs LIKE ?`,
    [a, url, b, url, `%${a}%`, `%${b}%`]
  );
  stats.references += result.affectedRows;
};

const applyReferences = async (relative, categorie, id) => {
  const url = `/files/${id}`;
  if (categorie === 'PHOTO') return updatePhoto('utilisateur', 'photo', relative, url);
  if (categorie === 'COUVERTURE') return updatePhoto('utilisateur', 'photo_couverture', relative, url);
  if (categorie === 'CV') return updatePhoto('profil_professionnel', 'cv', relative, url);
  if (categorie === 'LOGO') return updatePhoto('entreprise', 'logo', relative, url);
  if (categorie === 'JUSTIFICATIF') return updateDocuments(relative, url);
  return undefined;
};

const migrateDefaults = async () => {
  const defaults = [
    ['photo', 'uploads/photos/default-avatar.png', '/images/defaults/default-avatar.png'],
    ['photo', '/uploads/photos/default-avatar.png', '/images/defaults/default-avatar.png'],
    ['photo_couverture', 'uploads/covers/default-cover.png', '/images/defaults/default-cover.png'],
    ['photo_couverture', '/uploads/covers/default-cover.png', '/images/defaults/default-cover.png']
  ];
  for (const [column, oldPath, newPath] of defaults) {
    if (DRY_RUN) continue;
    const [result] = await db.execute(
      `UPDATE utilisateur SET ${column} = ? WHERE ${column} = ?`,
      [newPath, oldPath]
    );
    stats.defaults += result.affectedRows;
  }
};

const run = async () => {
  if (!fs.existsSync(ROOT)) {
    console.log('Aucun dossier uploads/ : rien à migrer.');
    return;
  }

  console.log(`Migration des fichiers historiques${DRY_RUN ? ' (simulation)' : ''}.`);
  await migrateDefaults();

  const filePaths = walk(ROOT);
  for (const absolute of filePaths) {
    const relative = toPosix(path.relative(ROOT, absolute));
    const storedPath = path.posix.join(LEGACY_PREFIX, relative);
    const [known] = await db.execute('SELECT id_fichier FROM fichier WHERE chemin = ?', [storedPath]);
    if (known[0]) {
      stats.already += 1;
      console.log(`  DEJA     ${relative} -> /files/${known[0].id_fichier}`);
      continue;
    }
    const owner = await findOwner(relative, path.basename(absolute));
    if (!owner) {
      console.warn(`  ORPHELIN ${relative} (aucune référence en base)`);
      stats.skipped += 1;
      continue;
    }
    const id = await ensureRecord({ absolute, relative, ...owner });
    if (!id) continue;
    if (!DRY_RUN) await applyReferences(relative, owner.categorie, id);
    console.log(`  OK       ${relative} -> ${id === -1 ? '/files/<id>' : `/files/${id}`} (${owner.categorie})`);
  }

  console.log('\nRésumé :');
  console.log(`  fichiers enregistrés : ${stats.registered}`);
  console.log(`  déjà enregistrés     : ${stats.already}`);
  console.log(`  ignorés/orphelins    : ${stats.skipped}`);
  console.log(`  références mises à jour : ${stats.references}`);
  console.log(`  valeurs par défaut mises à jour : ${stats.defaults}`);
  if (DRY_RUN) console.log('Simulation : aucune écriture effectuée.');
  else console.log('Les originaux de uploads/ sont conservés (suppression manuelle après vérification).');
};

run()
  .catch((error) => {
    console.error('Échec de la migration des fichiers :', error.code || error.message || error);
    process.exitCode = 1;
  })
  .finally(() => db.end());
