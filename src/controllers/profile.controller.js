const db = require('../config/database');
const { success, fail } = require('../utils/apiResponse');
const asyncHandler = require('../utils/asyncHandler');
const User = require('../models/user.model');

exports.get = asyncHandler(async (req, res) => {
  const [rows] = await db.execute('SELECT * FROM profil_professionnel WHERE id_utilisateur = ?', [req.user.id_utilisateur]);
  success(res, 'Profil professionnel.', { profile: rows[0] || null });
});
exports.upsert = asyncHandler(async (req, res) => {
  const fields = ['bio', 'adresse', 'date_naissance', 'lieu_naissance'];
  const data = fields.filter((f) => req.body[f] !== undefined);
  const values = data.map((f) => req.body[f]);
  const [existing] = await db.execute('SELECT id_profil FROM profil_professionnel WHERE id_utilisateur = ?', [req.user.id_utilisateur]);
  if (existing[0]) await db.execute(`UPDATE profil_professionnel SET ${data.map((f) => `${f} = ?`).join(', ')} WHERE id_utilisateur = ?`, [...values, req.user.id_utilisateur]);
  else await db.execute(`INSERT INTO profil_professionnel (${data.concat('id_utilisateur').join(', ')}) VALUES (${data.map(() => '?').concat('?').join(', ')})`, [...values, req.user.id_utilisateur]);
  exports.get(req, res);
});
exports.uploadPhoto = asyncHandler(async (req, res) => {
  if (!req.file) return fail(res, 'Photo requise.', [], 422);
  const user = await User.update(req.user.id_utilisateur, { photo: `uploads/photos/${req.file.filename}` });
  success(res, 'Photo enregistrée.', { user });
});
exports.uploadCv = asyncHandler(async (req, res) => {
  if (!req.file) return fail(res, 'CV requis.', [], 422);
  const cv = `uploads/cv/${req.file.filename}`;
  const [existing] = await db.execute('SELECT id_profil FROM profil_professionnel WHERE id_utilisateur = ?', [req.user.id_utilisateur]);
  if (existing[0]) await db.execute('UPDATE profil_professionnel SET cv = ? WHERE id_utilisateur = ?', [cv, req.user.id_utilisateur]);
  else await db.execute('INSERT INTO profil_professionnel (id_utilisateur, cv) VALUES (?, ?)', [req.user.id_utilisateur, cv]);
  success(res, 'CV enregistré.', { cv });
});
