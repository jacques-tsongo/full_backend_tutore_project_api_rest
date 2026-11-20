/**
 * Stockage privé des fichiers téléversés.
 *
 * Règles de sécurité appliquées ici (et non dans les contrôleurs) :
 * - le type réel est déterminé par les octets (magic numbers, `file-type`),
 *   jamais par l'extension ou le Content-Type déclaré par le navigateur ;
 * - une liste blanche de types MIME est appliquée par catégorie ;
 * - le nom sur disque est aléatoire (UUID) : aucun nom fourni par l'utilisateur
 *   n'est utilisé pour construire un chemin ;
 * - les fichiers sont écrits dans STORAGE_DIR, HORS de la racine servie
 *   statiquement (frontend/), puis référencés en base par leur identifiant ;
 * - en cas d'échec d'insertion en base, l'octet déjà écrit est supprimé.
 */
const crypto = require('crypto');
const fs = require('fs/promises');
const path = require('path');
const { detectFileType } = require('../utils/fileType');
const db = require('../config/database');

const IMAGE_MIMES = ['image/jpeg', 'image/png'];
const CV_MIMES = [
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/x-cfb' // anciens .doc (Compound File Binary)
];

const CATEGORIES = Object.freeze({
  PHOTO: { dir: 'photos', mimes: IMAGE_MIMES, maxBytes: 5 * 1024 * 1024 },
  COUVERTURE: { dir: 'covers', mimes: IMAGE_MIMES, maxBytes: 5 * 1024 * 1024 },
  LOGO: { dir: 'logos', mimes: IMAGE_MIMES, maxBytes: 5 * 1024 * 1024 },
  CV: { dir: 'cv', mimes: CV_MIMES, maxBytes: 10 * 1024 * 1024 },
  JUSTIFICATIF: { dir: 'justificatifs', mimes: ['application/pdf'], maxBytes: 10 * 1024 * 1024 }
});

const SELF_CHECK_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64'
);

class FileValidationError extends Error {
  constructor(message, statusCode = 422) {
    super(message);
    this.name = 'FileValidationError';
    this.statusCode = statusCode;
  }
}

/** Racine de stockage (hors racine web). Chemin relatif résolu depuis le cwd. */
const storageRoot = () => path.resolve(process.cwd(), process.env.STORAGE_DIR || 'storage');

/**
 * Résout un chemin relatif stocké en base et refuse toute sortie de la racine
 * de stockage (défense en profondeur contre `..` ou un chemin absolu).
 */
const resolveStoredPath = (chemin) => {
  const root = storageRoot();
  const absolute = path.resolve(root, String(chemin || ''));
  if (absolute !== root && !absolute.startsWith(root + path.sep)) {
    throw new FileValidationError('Chemin de fichier invalide.', 400);
  }
  return absolute;
};

const sanitizeOriginalName = (name) => {
  const base = path.basename(String(name || 'fichier'));
  const cleaned = base.replace(/[\u0000-\u001f\u007f"]/g, '').trim().slice(0, 255);
  return cleaned || 'fichier';
};

const ruleFor = (categorie) => {
  const rule = CATEGORIES[categorie];
  if (!rule) throw new FileValidationError('Catégorie de fichier inconnue.', 400);
  return rule;
};

/**
 * Valide un fichier en mémoire et retourne son type réel.
 * Aucune écriture disque n'est effectuée : utilisable en test unitaire.
 */
const validateFile = async ({ buffer, categorie, originalname }) => {
  const rule = ruleFor(categorie);
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
    throw new FileValidationError('Fichier vide ou illisible.');
  }
  if (buffer.length > rule.maxBytes) {
    throw new FileValidationError('Fichier trop volumineux.', 413);
  }
  const detected = await detectFileType(buffer);
  if (!detected) {
    throw new FileValidationError('Type de fichier non reconnu.');
  }
  if (!rule.mimes.includes(detected.mime)) {
    throw new FileValidationError(
      `Type de fichier non autorisé (${detected.mime}). Types acceptés : ${rule.mimes.join(', ')}.`
    );
  }
  return { ext: detected.ext, mime: detected.mime, originalname: sanitizeOriginalName(originalname) };
};

/**
 * Enregistre un fichier sur disque puis en base.
 * @returns {{id_fichier:number,url:string,categorie:string,nom_original:string,type_mime:string,taille:number}}
 */
const save = async ({ buffer, originalname, ownerId, categorie, connection = db }) => {
  const { ext, mime, originalname: safeName } = await validateFile({ buffer, categorie, originalname });
  const rule = ruleFor(categorie);
  const filename = `${crypto.randomUUID()}.${ext}`;
  const relativePath = path.posix.join(rule.dir, filename);
  const absolutePath = resolveStoredPath(relativePath);

  await fs.mkdir(path.dirname(absolutePath), { recursive: true });
  await fs.writeFile(absolutePath, buffer, { flag: 'wx' });

  try {
    const [result] = await connection.execute(
      `INSERT INTO fichier (id_utilisateur, categorie, chemin, nom_original, type_mime, taille)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [ownerId, categorie, relativePath, safeName, mime, buffer.length]
    );
    return {
      id_fichier: result.insertId,
      url: `/files/${result.insertId}`,
      categorie,
      chemin: relativePath,
      nom_original: safeName,
      type_mime: mime,
      taille: buffer.length
    };
  } catch (error) {
    // Aucune ligne en base : l'octet ne doit pas rester orphelin.
    await fs.unlink(absolutePath).catch(() => {});
    throw error;
  }
};

/** Supprime l'octet correspondant (utilisé par les scripts de maintenance). */
const removeStored = async (chemin) => {
  const absolutePath = resolveStoredPath(chemin);
  await fs.unlink(absolutePath).catch((error) => {
    if (error.code !== 'ENOENT') throw error;
  });
};

/**
 * Annule un fichier tout juste enregistré (échec d'une opération métier
 * multi-fichiers) : supprime la ligne puis l'octet, sans propager d'erreur.
 */
const discard = async (saved) => {
  if (!saved) return;
  if (saved.id_fichier) {
    await db.execute('DELETE FROM fichier WHERE id_fichier = ?', [saved.id_fichier]).catch(() => {});
  }
  if (saved.chemin) await removeStored(saved.chemin).catch(() => {});
};

const shortError = (error) => String(error?.code || error?.message || error).slice(0, 200);

/**
 * Auto-diagnostic affiché au démarrage : détection réelle par file-type,
 * droit d'écriture dans STORAGE_DIR et présence de la table `fichier`.
 * Non bloquant : chaque contrôle est indépendant et toujours signalé.
 */
const selfCheck = async ({ connection = db } = {}) => {
  const root = storageRoot();
  const checks = { detection: 'OK', dossier: 'OK', table: 'OK' };

  try {
    const detected = await detectFileType(SELF_CHECK_PNG);
    if (detected?.mime !== 'image/png') throw new Error('PNG de contrôle non reconnu comme image/png');
  } catch (error) {
    checks.detection = shortError(error);
  }

  try {
    await fs.mkdir(root, { recursive: true });
    const temporary = path.join(root, `.selfcheck-${process.pid}-${crypto.randomUUID()}`);
    await fs.writeFile(temporary, 'ok', { flag: 'wx' });
    await fs.unlink(temporary);
  } catch (error) {
    checks.dossier = shortError(error);
  }

  try {
    const [rows] = await connection.execute("SHOW TABLES LIKE 'fichier'");
    if (!rows.length) throw new Error("table 'fichier' absente");
  } catch (error) {
    checks.table = shortError(error);
  }

  const errors = Object.entries(checks)
    .filter(([, value]) => value !== 'OK')
    .map(([key, value]) => `${key} : ${value}`);
  return { ok: errors.length === 0, path: root, checks, errors };
};

const describeSelfCheck = (state) => (state.ok
  ? `Stockage privé des fichiers : OK (${state.path})`
  : `Stockage privé des fichiers : ERREUR — ${state.errors.join(' ; ')} : LES TÉLÉVERSEMENTS ÉCHOUERONT`);

module.exports = {
  CATEGORIES,
  FileValidationError,
  storageRoot,
  resolveStoredPath,
  sanitizeOriginalName,
  validateFile,
  save,
  removeStored,
  discard,
  selfCheck,
  describeSelfCheck
};
