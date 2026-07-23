const db = require('../config/database');
exports.create = async (idUtilisateur, content) => db.execute('INSERT INTO notification (contenu_notification, id_utilisateur) VALUES (?, ?)', [content, idUtilisateur]);
