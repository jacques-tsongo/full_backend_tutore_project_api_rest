const db = require('../config/database');
const socket = require('../socket');

/**
 * Crée une notification pour un utilisateur puis la pousse en temps réel
 * sur sa room `user_<id>` (événement `nouvelle_notification`).
 * La base reste la source de vérité ; Socket.IO ne fait qu'informer le client.
 */
exports.create = async (idUtilisateur, content) => {
  const [r] = await db.execute('INSERT INTO notification (contenu_notification, id_utilisateur) VALUES (?, ?)', [content, idUtilisateur]);
  socket.emitToUser(idUtilisateur, 'nouvelle_notification', {
    notification: {
      id_notification: r.insertId,
      contenu_notification: content,
      date_notification: new Date(),
      statut_notification: 'Non lue',
      id_utilisateur: idUtilisateur
    }
  });
  return r;
};
