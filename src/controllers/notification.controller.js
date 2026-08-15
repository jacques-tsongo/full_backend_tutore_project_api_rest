const db = require('../config/database');
const { success, fail } = require('../utils/apiResponse');
const asyncHandler = require('../utils/asyncHandler');
const socket = require('../socket');
exports.list = asyncHandler(async (req, res) => { 
    const [rows] = await db.execute('SELECT * FROM notification WHERE id_utilisateur=? ORDER BY date_notification DESC', [req.user.id_utilisateur]); 
    success(res, 'Notifications récupérées.', { items: rows }); });
exports.read = asyncHandler(async (req, res) => { 
    const [result] = await db.execute("UPDATE notification SET statut_notification='Lue' WHERE id_notification=? AND id_utilisateur=?", [req.params.id, req.user.id_utilisateur]); 
    if (!result.affectedRows) return fail(res, 'Notification introuvable.', [], 404);
    // Le compteur de l'utilisateur a changé : les clients connectés le rafraîchissent.
    socket.emitToUser(req.user.id_utilisateur, 'notification_lue', { id_notification: Number(req.params.id) });
    success(res, 'Notification marquée comme lue.'); });
exports.readAll = asyncHandler(async (req, res) => {
    await db.execute("UPDATE notification SET statut_notification='Lue' WHERE id_utilisateur=? AND statut_notification='Non lue'", [req.user.id_utilisateur]);
    socket.emitToUser(req.user.id_utilisateur, 'notification_lue', { toutes: true });
    success(res, 'Toutes les notifications ont été marquées comme lues.');
});
/** Nombre de notifications non lues de l'utilisateur connecté (badge « Notifications [n] »). */
exports.unreadCount = asyncHandler(async (req, res) => {
    const [[{ total }]] = await db.execute(
        "SELECT COUNT(*) AS total FROM notification WHERE id_utilisateur = ? AND statut_notification = 'Non lue'",
        [req.user.id_utilisateur]
    );
    success(res, 'Notifications non lues.', { total });
});
