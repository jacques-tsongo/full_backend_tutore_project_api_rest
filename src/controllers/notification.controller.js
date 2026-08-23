const db = require('../config/database');
const { success, fail } = require('../utils/apiResponse');
const asyncHandler = require('../utils/asyncHandler');
const socket = require('../socket');
const notificationService = require('../services/notification.service');

exports.list = asyncHandler(async (req, res) => {
  const [rows] = await db.execute(
    'SELECT * FROM notification WHERE id_utilisateur = ? ORDER BY date_notification DESC',
    [req.user.id_utilisateur]
  );
  const items = rows.map((row) => ({
    ...row,
    action_url: notificationService.actionUrl(row, req.user)
  }));
  success(res, 'Notifications récupérées.', { items });
});

exports.read = asyncHandler(async (req, res) => {
  const [result] = await db.execute(
    "UPDATE notification SET statut_notification = 'Lue' WHERE id_notification = ? AND id_utilisateur = ?",
    [req.params.id, req.user.id_utilisateur]
  );
  if (!result.affectedRows) return fail(res, 'Notification introuvable.', [], 404);
  socket.emitToUser(req.user.id_utilisateur, 'notification_lue', { id_notification: Number(req.params.id) });
  success(res, 'Notification marquée comme lue.');
});

exports.readAll = asyncHandler(async (req, res) => {
  await db.execute(
    "UPDATE notification SET statut_notification = 'Lue' WHERE id_utilisateur = ? AND statut_notification = 'Non lue'",
    [req.user.id_utilisateur]
  );
  socket.emitToUser(req.user.id_utilisateur, 'notification_lue', { toutes: true });
  success(res, 'Toutes les notifications ont été marquées comme lues.');
});

/** Nombre de notifications non lues (badge de navigation). */
exports.unreadCount = asyncHandler(async (req, res) => {
  const [[{ total }]] = await db.execute(
    "SELECT COUNT(*) AS total FROM notification WHERE id_utilisateur = ? AND statut_notification = 'Non lue'",
    [req.user.id_utilisateur]
  );
  success(res, 'Notifications non lues.', { total });
});

/**
 * Ouverture d'une notification référencée depuis l'interface EJS : vérifie le
 * propriétaire, marque comme lue puis redirige vers l'objet métier. Le texte
 * de notification n'est jamais analysé pour construire cette destination.
 */
exports.open = asyncHandler(async (req, res) => {
  const [rows] = await db.execute(
    'SELECT * FROM notification WHERE id_notification = ? AND id_utilisateur = ?',
    [req.params.id, req.user.id_utilisateur]
  );
  const item = rows[0];
  if (!item) return res.status(404).render('error', {
    title: 'Notification introuvable',
    status: 404,
    message: 'Cette notification est introuvable.',
    user: req.user
  });
  const target = notificationService.actionUrl(item, req.user);
  if (!target) return res.redirect('/notifications');

  if (item.statut_notification === 'Non lue') {
    await db.execute(
      "UPDATE notification SET statut_notification = 'Lue' WHERE id_notification = ? AND id_utilisateur = ?",
      [item.id_notification, req.user.id_utilisateur]
    );
    socket.emitToUser(req.user.id_utilisateur, 'notification_lue', {
      id_notification: Number(item.id_notification)
    });
  }
  return res.redirect(target);
});
