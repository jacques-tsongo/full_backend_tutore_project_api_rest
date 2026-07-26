const db = require('../config/database');
const { success } = require('../utils/apiResponse');
const asyncHandler = require('../utils/asyncHandler');
exports.list = asyncHandler(async (req, res) => { 
    const [rows] = await db.execute('SELECT * FROM notification WHERE id_utilisateur=? ORDER BY date_notification DESC', [req.user.id_utilisateur]); 
    success(res, 'Notifications récupérées.', { items: rows }); });
exports.read = asyncHandler(async (req, res) => { 
    await db.execute("UPDATE notification SET statut_notification='Lue' WHERE id_notification=? AND id_utilisateur=?", [req.params.id, req.user.id_utilisateur]); 
    success(res, 'Notification marquée comme lue.'); });
