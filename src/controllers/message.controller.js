const db = require('../config/database');
const { success, fail } = require('../utils/apiResponse');
const asyncHandler = require('../utils/asyncHandler');
const notify = require('../services/notification.service');
const socket = require('../socket');

exports.send = asyncHandler(async (req, res) => {
  // L'expéditeur est TOUJOURS l'utilisateur authentifié (req.user) :
  // toute valeur `id_expediteur` envoyée par le navigateur est ignorée
  // (impossibilité d'envoyer un message en se faisant passer pour quelqu'un d'autre).
  const me = req.user.id_utilisateur;
  const { id_destinataire, contenu } = req.body;

  // Validation côté serveur (indépendante des validateurs de route) : elle
  // protège aussi le formulaire HTML /messages qui ne passe pas par
  // express-validator.
  const destId = Number(id_destinataire);
  if (!Number.isInteger(destId) || destId < 1) return fail(res, 'Destinataire invalide.', [], 422);
  if (destId === me) return fail(res, 'Vous ne pouvez pas vous écrire.', [], 422);
  const texte = typeof contenu === 'string' ? contenu.trim() : '';
  if (!texte) return fail(res, 'Le message ne peut pas être vide.', [], 422);
  if (texte.length > 5000) return fail(res, 'Le message est trop long (5000 caractères maximum).', [], 422);

  const [recipient] = await db.execute("SELECT id_utilisateur FROM utilisateur WHERE id_utilisateur=? AND statut_compte='actif'", [destId]);
  if (!recipient[0]) return fail(res, 'Destinataire introuvable.', [], 404);
  // Les nouveaux messages sont non lus (lu = 0) : ils alimentent le compteur du destinataire.
  const [r] = await db.execute('INSERT INTO message (id_expediteur, id_destinataire, contenu) VALUES (?, ?, ?)', [me, destId, texte]);
  await notify.create(destId, 'Vous avez reçu un nouveau message.');
  // Temps réel : le message est poussé au destinataire (room user_destId) et à
  // l'expéditeur (autres onglets du même utilisateur) pour la liste de conversations.
  const payload = {
    message: {
      id_message: r.insertId,
      contenu: texte,
      date_message: new Date(),
      id_expediteur: me,
      id_destinataire: destId,
      lu: 0
    },
    expediteur: {
      id_utilisateur: me,
      nom: req.user.nom,
      prenom: req.user.prenom,
      photo: req.user.photo
    }
  };
  socket.emitToUser(destId, 'nouveau_message', payload);
  socket.emitToUser(me, 'nouveau_message', payload);
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
  // Consulter la conversation marque comme lus les messages qui m'étaient adressés :
  // le compteur de non lus de l'utilisateur connecté se met à jour en conséquence.
  await db.execute(
    'UPDATE message SET lu = 1, date_lecture = NOW() WHERE id_expediteur = ? AND id_destinataire = ? AND lu = 0',
    [id, req.user.id_utilisateur]
  );
  // Temps réel : l'interlocuteur apprend que ses messages ont été lus (« Vu »),
  // et l'utilisateur connecté met à jour son compteur dans ses autres onglets.
  socket.emitToUser(id, 'message_lu', { id_expediteur: id, id_destinataire: req.user.id_utilisateur });
  socket.emitToUser(req.user.id_utilisateur, 'message_lu', { id_expediteur: id, id_destinataire: req.user.id_utilisateur });
  success(res, 'Conversation récupérée.', { items: rows });
});

exports.conversations = asyncHandler(async (req, res) => {
  const [rows] = await db.execute(
    `SELECT u.id_utilisateur, u.nom, u.prenom, u.photo, MAX(m.date_message) derniere_date,
            SUM(m.id_destinataire = ? AND m.lu = 0) AS non_lus,
            SUBSTRING_INDEX(GROUP_CONCAT(m.contenu ORDER BY m.date_message DESC SEPARATOR '\n'), '\n', 1) dernier_message
     FROM message m
     JOIN utilisateur u ON u.id_utilisateur = CASE WHEN m.id_expediteur=? THEN m.id_destinataire ELSE m.id_expediteur END
     WHERE m.id_expediteur=? OR m.id_destinataire=?
     GROUP BY u.id_utilisateur, u.nom, u.prenom, u.photo
     ORDER BY derniere_date DESC`,
    [req.user.id_utilisateur, req.user.id_utilisateur, req.user.id_utilisateur, req.user.id_utilisateur]
  );
  success(res, 'Conversations récupérées.', { items: rows });
});

/** Nombre de messages reçus non lus par l'utilisateur connecté (badge « Messages [n] »). */
exports.unreadCount = asyncHandler(async (req, res) => {
  const [[{ total }]] = await db.execute(
    'SELECT COUNT(*) AS total FROM message WHERE id_destinataire = ? AND lu = 0',
    [req.user.id_utilisateur]
  );
  success(res, 'Messages non lus.', { total });
});

/**
 * Contacts légitimes de l'utilisateur connecté :
 * - candidat  → recruteurs des entreprises approuvées ;
 * - recruteur → candidats ayant postulé à ses offres ;
 * - admin     → tous les utilisateurs actifs.
 */
exports.contacts = asyncHandler(async (req, res) => {
  const me = req.user.id_utilisateur;
  // Recherche dynamique (barre « Nouveau message ») : filtre par nom,
  // prénom ou email, insensible à la casse et aux accents de saisie.
  const q = (req.query.q || '').toString().trim().slice(0, 100);
  const like = q ? `%${q}%` : null;
  const searchWhere = q
    ? 'AND (u.nom LIKE ? OR u.prenom LIKE ? OR CONCAT(u.prenom, \' \', u.nom) LIKE ? OR u.email LIKE ?)'
    : '';
  const searchValues = q ? [like, like, like, like] : [];
  let rows;
  if (req.user.role === 'candidat') {
    [rows] = await db.execute(
      `SELECT DISTINCT u.id_utilisateur, u.nom, u.prenom, u.photo, u.email
       FROM entreprise e JOIN utilisateur u ON u.id_utilisateur = e.id_utilisateur
       WHERE e.status = 'approved' AND u.id_utilisateur != ? AND u.statut_compte = 'actif'
       ${searchWhere}
       ORDER BY u.nom, u.prenom
       LIMIT ?`,
      [me, ...searchValues, 50]
    );
  } else if (req.user.role === 'recruteur') {
    [rows] = await db.execute(
      `SELECT DISTINCT u.id_utilisateur, u.nom, u.prenom, u.photo, u.email
       FROM candidature c
       JOIN offre_emploi o ON o.id_offre = c.id_offre
       JOIN entreprise e ON e.id_entreprise = o.id_entreprise
       JOIN utilisateur u ON u.id_utilisateur = c.id_utilisateur
       WHERE e.id_utilisateur = ? AND u.id_utilisateur != ? AND u.statut_compte = 'actif'
       ${searchWhere}
       ORDER BY u.nom, u.prenom
       LIMIT ?`,
      [me, me, ...searchValues, 50]
    );
  } else {
    [rows] = await db.execute(
      `SELECT u.id_utilisateur, u.nom, u.prenom, u.photo, u.email
       FROM utilisateur u
       WHERE u.id_utilisateur != ? AND u.statut_compte = 'actif'
       ${searchWhere}
       ORDER BY u.nom, u.prenom
       LIMIT ?`,
      [me, ...searchValues, 50]
    );
  }
  success(res, 'Contacts récupérés.', { items: rows });
});
