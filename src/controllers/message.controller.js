const db = require('../config/database');
const { success, fail } = require('../utils/apiResponse');
const asyncHandler = require('../utils/asyncHandler');
const notify = require('../services/notification.service');

exports.send = asyncHandler(async (req, res) => {
  const { id_destinataire, contenu } = req.body;
  if (Number(id_destinataire) === req.user.id_utilisateur) return fail(res, 'Vous ne pouvez pas vous écrire.', [], 422);
  const [recipient] = await db.execute('SELECT id_utilisateur FROM utilisateur WHERE id_utilisateur=? AND statut_compte=\'actif\'', [id_destinataire]);
  if (!recipient[0]) return fail(res, 'Destinataire introuvable.', [], 404);
  const [r] = await db.execute('INSERT INTO message (id_expediteur, id_destinataire, contenu) VALUES (?, ?, ?)', [req.user.id_utilisateur, id_destinataire, contenu]);
  await notify.create(id_destinataire, 'Vous avez reçu un nouveau message.');
  success(res, 'Message envoyé.', { id_message: r.insertId }, 201);
});
exports.conversation = asyncHandler(async (req, res) => { const id = Number(req.params.userId); const [rows] = await db.execute('SELECT m.*, u.nom expediteur_nom, u.prenom expediteur_prenom FROM message m JOIN utilisateur u ON u.id_utilisateur=m.id_expediteur WHERE (m.id_expediteur=? AND m.id_destinataire=?) OR (m.id_expediteur=? AND m.id_destinataire=?) ORDER BY m.date_message ASC', [req.user.id_utilisateur, id, id, req.user.id_utilisateur]); success(res, 'Conversation récupérée.', { items: rows }); });
exports.conversations = asyncHandler(async (req, res) => { const [rows] = await db.execute(`SELECT u.id_utilisateur, u.nom, u.prenom, u.photo, MAX(m.date_message) derniere_date, SUBSTRING_INDEX(GROUP_CONCAT(m.contenu ORDER BY m.date_message DESC SEPARATOR '\\n'), '\\n', 1) dernier_message FROM message m JOIN utilisateur u ON u.id_utilisateur = CASE WHEN m.id_expediteur=? THEN m.id_destinataire ELSE m.id_expediteur END WHERE m.id_expediteur=? OR m.id_destinataire=? GROUP BY u.id_utilisateur, u.nom, u.prenom, u.photo ORDER BY derniere_date DESC`, [req.user.id_utilisateur, req.user.id_utilisateur, req.user.id_utilisateur]); success(res, 'Conversations récupérées.', { items: rows }); });
