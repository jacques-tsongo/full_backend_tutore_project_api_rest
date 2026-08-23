const db = require('../config/database');
const { success, fail } = require('../utils/apiResponse');
const asyncHandler = require('../utils/asyncHandler');
const User = require('../models/user.model');
const domaine = require('../services/domain.service');

/**
 * Champs personnalisables du profil professionnel (informations du CV
 * structurées, toutes FACULTATIVES). La table `profil_professionnel` reste le
 * foyer de ces données ; `utilisateur` ne conserve que l'identité de compte
 * (nom, prénom, email, téléphone) et les fichiers d'apparence.
 */
const PROFILE_FIELDS = [
  'bio',
  'accroche',
  'adresse',
  'date_naissance',
  'lieu_naissance',
  'post_nom',
  'sexe',
  'territoire',
  'province',
  'nationalite',
  'etat_civil',
  'id_domaine'
];

// Valeurs contrôlées (ENUM en base) : toute valeur hors liste est rejetée.
const SEXE_VALUES = ['Masculin', 'Féminin', 'Autre'];
const ETAT_CIVIL_VALUES = ['Célibataire', 'Marié(e)', 'Divorcé(e)', 'Veuf(ve)', 'Autre'];

const LANGUE_NIVEAUX = ['Débutant', 'Élémentaire', 'Intermédiaire', 'Courant', 'Langue maternelle'];

// Une chaîne vide (champ laissé vierge) devient NULL : aucune donnée « vide »
// n'est persistée, le profil reste réellement vide par défaut.
const clean = (v) => (typeof v === 'string' && v.trim() === '' ? null : v);

exports.get = asyncHandler(async (req, res) => {
  const [rows] = await db.execute(
    `SELECT p.*, d.nom_domaine
     FROM profil_professionnel p
     LEFT JOIN domaine d ON d.id_domaine = p.id_domaine
     WHERE p.id_utilisateur = ?`,
    [req.user.id_utilisateur]
  );
  success(res, 'Profil professionnel.', { profile: rows[0] || null });
});

exports.upsert = asyncHandler(async (req, res) => {
  const data = {};
  for (const f of PROFILE_FIELDS) {
    if (req.body[f] === undefined) continue;
    let value = clean(req.body[f]);
    // Contrôle des valeurs énumérées (cohérence avec les ENUM de la base).
    if (f === 'sexe' && value !== null && !SEXE_VALUES.includes(value)) {
      return fail(res, 'Sexe invalide.', ['sexe'], 422);
    }
    if (f === 'etat_civil' && value !== null && !ETAT_CIVIL_VALUES.includes(value)) {
      return fail(res, 'État civil invalide.', ['etat_civil'], 422);
    }
    if (f === 'id_domaine') {
      const selectedDomain = await domaine.findById(value);
      if (!selectedDomain) return fail(res, 'Veuillez sélectionner un domaine professionnel valide.', ['id_domaine'], 422);
      value = selectedDomain.id_domaine;
    }
    data[f] = value;
  }
  if (!Object.keys(data).length) return exports.get(req, res);

  const fields = Object.keys(data);
  const values = fields.map((f) => data[f]);
  const [existing] = await db.execute('SELECT id_profil FROM profil_professionnel WHERE id_utilisateur = ?', [req.user.id_utilisateur]);
  if (existing[0]) {
    await db.execute(
      `UPDATE profil_professionnel SET ${fields.map((f) => `${f} = ?`).join(', ')} WHERE id_utilisateur = ?`,
      [...values, req.user.id_utilisateur]
    );
  } else {
    await db.execute(
      `INSERT INTO profil_professionnel (${fields.concat('id_utilisateur').join(', ')}) VALUES (${fields.map(() => '?').concat('?').join(', ')})`,
      [...values, req.user.id_utilisateur]
    );
  }
  return exports.get(req, res);
});

exports.uploadPhoto = asyncHandler(async (req, res) => {
  if (!req.file) return fail(res, 'Photo requise.', [], 422);
  const user = await User.update(req.user.id_utilisateur, { photo: `uploads/photos/${req.file.filename}` });
  success(res, 'Photo enregistrée.', { user });
});

exports.uploadCover = asyncHandler(async (req, res) => {
  if (!req.file) return fail(res, 'Photo de couverture requise.', [], 422);
  const user = await User.update(req.user.id_utilisateur, { photo_couverture: `uploads/covers/${req.file.filename}` });
  success(res, 'Photo de couverture enregistrée.', { user });
});

exports.uploadCv = asyncHandler(async (req, res) => {
  if (!req.file) return fail(res, 'CV requis.', [], 422);
  const cv = `uploads/cv/${req.file.filename}`;
  const [existing] = await db.execute('SELECT id_profil FROM profil_professionnel WHERE id_utilisateur = ?', [req.user.id_utilisateur]);
  if (existing[0]) await db.execute('UPDATE profil_professionnel SET cv = ? WHERE id_utilisateur = ?', [cv, req.user.id_utilisateur]);
  else await db.execute('INSERT INTO profil_professionnel (id_utilisateur, cv) VALUES (?, ?)', [req.user.id_utilisateur, cv]);
  success(res, 'CV enregistré.', { cv });
});

/* ------------------------- Langues (N:N langue ⇄ utilisateur) ------------- */

/** Liste des langues du profil courant (relation utilisateur_langue). */
exports.listLanguages = asyncHandler(async (req, res) => {
  const [rows] = await db.execute(
    `SELECT l.id_langue, l.nom_langue, ul.niveau
     FROM utilisateur_langue ul
     JOIN langue l ON l.id_langue = ul.id_langue
     WHERE ul.id_utilisateur = ?
     ORDER BY l.nom_langue`,
    [req.user.id_utilisateur]
  );
  success(res, 'Langues du profil.', { items: rows });
});

/**
 * Ajoute une langue. Le nom est résolu par rapport au catalogue `langue`
 * (find-or-create) afin de garder une structure relationnelle propre ; le
 * niveau est contrôlé (ENUM).
 */
exports.addLanguage = asyncHandler(async (req, res) => {
  const nom = clean(req.body.nom_langue);
  const niveau = req.body.niveau || 'Débutant';
  if (!nom) return fail(res, 'Nom de langue requis.', ['nom_langue'], 422);
  if (!LANGUE_NIVEAUX.includes(niveau)) return fail(res, 'Niveau de langue invalide.', ['niveau'], 422);

  // Find-or-create dans le catalogue (clé unique nom_langue).
  await db.execute(
    'INSERT INTO langue (nom_langue) VALUES (?) ON DUPLICATE KEY UPDATE id_langue = LAST_INSERT_ID(id_langue)',
    [nom]
  );
  const [[{ id_langue }]] = await db.execute('SELECT id_langue FROM langue WHERE nom_langue = ?', [nom]);

  await db.execute(
    `INSERT INTO utilisateur_langue (id_utilisateur, id_langue, niveau) VALUES (?, ?, ?)
     ON DUPLICATE KEY UPDATE niveau = VALUES(niveau)`,
    [req.user.id_utilisateur, id_langue, niveau]
  );
  success(res, 'Langue ajoutée.', { id_langue, nom_langue: nom, niveau });
});

/** Met à jour uniquement le niveau d'une langue déjà associée au profil. */
exports.updateLanguage = asyncHandler(async (req, res) => {
  const niveau = req.body.niveau;
  if (!LANGUE_NIVEAUX.includes(niveau)) return fail(res, 'Niveau de langue invalide.', ['niveau'], 422);
  const [r] = await db.execute(
    'UPDATE utilisateur_langue SET niveau = ? WHERE id_utilisateur = ? AND id_langue = ?',
    [niveau, req.user.id_utilisateur, req.params.id]
  );
  if (!r.affectedRows) return fail(res, 'Langue introuvable.', [], 404);
  success(res, 'Niveau de langue mis à jour.');
});

/** Retire une langue du profil (l'association est supprimée, pas la langue). */
exports.removeLanguage = asyncHandler(async (req, res) => {
  const [r] = await db.execute(
    'DELETE FROM utilisateur_langue WHERE id_utilisateur = ? AND id_langue = ?',
    [req.user.id_utilisateur, req.params.id]
  );
  if (!r.affectedRows) return fail(res, 'Langue introuvable.', [], 404);
  success(res, 'Langue retirée.');
});
