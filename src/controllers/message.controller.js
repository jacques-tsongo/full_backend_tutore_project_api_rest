const db = require('../config/database');
const { success, fail } = require('../utils/apiResponse');
const asyncHandler = require('../utils/asyncHandler');
const notify = require('../services/notification.service');

exports.send = asyncHandler(async (req, res) => {
  const { id_destinataire, contenu } = req.body;
  if (Number(id_destinataire) === req.user.id_utilisateur) return fail(res, 'Vous ne pouvez pas vous écrire.', [], 422);
  const [recipient] = await db.execute("SELECT id_utilisateur FROM utilisateur WHERE id_utilisateur=? AND statut_compte='actif'", [id_destinataire]);
  if (!recipient[0]) return fail(res, 'Destinataire introuvable.', [], 404);
  const [r] = await db.execute('INSERT INTO message (id_expediteur, id_destinataire, contenu) VALUES (?, ?, ?)', [req.user.id_utilisateur, id_destinataire, contenu]);
  await notify.create(id_destinataire, 'Vous avez reçu un nouveau message.');
  success(res, 'Message envoyé.', { id_message: r.insertId }, 201);
});

exports.conversation = asyncHandler(async (req, res) => {
  const id = Number(req.params.userId);
  const [recipient] = await db.execute("SELECT id_utilisateur FROM utilisateur WHERE id_utilisateur=? AND statut_compte='actif'", [id]);
  if (!recipient[0]) return fail(res, 'Utilisateur introuvable.', [], 404);
  const [rows] = await db.execute(
    `SELECT m.*, u.nom expediteur_nom, u.prenom expediteur_prenom
     FROM message m JOIN utilisateur u ON u.id_utilisateur = m.id_expediteur
     WHERE (m.id_expediteur=? AND m.id_destinataire=?) OR (m.id_expediteur=? AND m.id_destinataire=?)
     ORDER BY m.date_message ASC`,
    [req.user.id_utilisateur, id, id, req.user.id_utilisateur]
  );
  success(res, 'Conversation récupérée.', { items: rows });
});

exports.conversations = asyncHandler(async (req, res) => {
  const [rows] = await db.execute(
    `SELECT u.id_utilisateur, u.nom, u.prenom, u.photo, MAX(m.date_message) derniere_date,
            SUBSTRING_INDEX(GROUP_CONCAT(m.contenu ORDER BY m.date_message DESC SEPARATOR '\n'), '\n', 1) dernier_message
     FROM message m
     JOIN utilisateur u ON u.id_utilisateur = CASE WHEN m.id_expediteur=? THEN m.id_destinataire ELSE m.id_expediteur END
     WHERE m.id_expediteur=? OR m.id_destinataire=?
     GROUP BY u.id_utilisateur, u.nom, u.prenom, u.photo
     ORDER BY derniere_date DESC`,
    [req.user.id_utilisateur, req.user.id_utilisateur, req.user.id_utilisateur]
  );
  success(res, 'Conversations récupérées.', { items: rows });
});

/**
 * Contacts légitimes de l'utilisateur connecté :
 * - candidat  → recruteurs des entreprises approuvées ;
 * - recruteur → candidats ayant postulé à ses offres ;
 * - admin     → tous les utilisateurs actifs.
 */
exports.contacts = asyncHandler(async (req, res) => {
  const me = req.user.id_utilisateur;
  let rows;
  if (req.user.role === 'candidat') {
    [rows] = await db.execute(
      `SELECT DISTINCT u.id_utilisateur, u.nom, u.prenom, u.photo, u.email
       FROM entreprise e JOIN utilisateur u ON u.id_utilisateur = e.id_utilisateur
       WHERE e.status = 'approved' AND u.id_utilisateur != ? AND u.statut_compte = 'actif'
       ORDER BY u.nom, u.prenom`,
      [me]
    );
  } else if (req.user.role === 'recruteur') {
    [rows] = await db.execute(
      `SELECT DISTINCT u.id_utilisateur, u.nom, u.prenom, u.photo, u.email
       FROM candidature c
       JOIN offre_emploi o ON o.id_offre = c.id_offre
       JOIN entreprise e ON e.id_entreprise = o.id_entreprise
       JOIN utilisateur u ON u.id_utilisateur = c.id_utilisateur
       WHERE e.id_utilisateur = ? AND u.id_utilisateur != ? AND u.statut_compte = 'actif'
       ORDER BY u.nom, u.prenom`,
      [me, me]
    );
  } else {
    [rows] = await db.execute(
      "SELECT id_utilisateur, nom, prenom, photo, email FROM utilisateur WHERE id_utilisateur != ? AND statut_compte = 'actif' ORDER BY nom, prenom",
      [me]
    );
  }
  success(res, 'Contacts récupérés.', { items: rows });
});
