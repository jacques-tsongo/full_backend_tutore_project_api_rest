const db = require('../config/database');
const { success, fail } = require('../utils/apiResponse');
const asyncHandler = require('../utils/asyncHandler');

exports.createRecruiter = asyncHandler(async (req, res) => {
  const { id_entreprise, fonction } = req.body;
  const [existing] = await db.execute('SELECT id_recruteur FROM recruteur WHERE id_utilisateur = ?', [req.user.id_utilisateur]);
  if (existing[0]) return fail(res, 'Ce compte possède déjà un profil recruteur.', [], 409);
  const [r] = await db.execute('INSERT INTO recruteur (id_utilisateur, id_entreprise, fonction) VALUES (?, ?, ?)', [req.user.id_utilisateur, id_entreprise, fonction]);
  success(res, 'Profil recruteur créé.', { id_recruteur: r.insertId }, 201);
});
exports.myRecruiter = asyncHandler(async (req, res) => { const [rows] = await db.execute('SELECT r.*, e.nom_entreprise, e.statut_validation FROM recruteur r JOIN entreprise e ON e.id_entreprise=r.id_entreprise WHERE r.id_utilisateur=?', [req.user.id_utilisateur]); success(res, 'Profil recruteur.', { recruiter: rows[0] || null }); });
exports.validate = asyncHandler(async (req, res) => { const status = req.body.statut_validation; if (!['Validée', 'Rejetée'].includes(status)) return fail(res, 'Statut de validation invalide.', [], 422); await db.execute('UPDATE entreprise SET statut_validation = ? WHERE id_entreprise = ?', [status, req.params.id]); success(res, 'Entreprise mise à jour.'); });
