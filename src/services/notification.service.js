const db = require('../config/database');
const socket = require('../socket');

/** Émet une notification déjà persistée (utile après le COMMIT d'une transaction). */
const emit = (notification) => {
  if (!notification) return;
  socket.emitToUser(notification.id_utilisateur, 'nouvelle_notification', { notification });
};
exports.emit = emit;

/**
 * Crée une notification dans la table existante `notification`.
 *
 * options :
 * - type : type fonctionnel (défaut GENERALE) ;
 * - referenceType / referenceId : lien vers l'objet métier ;
 * - connection : connexion transactionnelle mysql2 facultative ;
 * - emit : false diffère l'événement Socket.IO jusqu'après le COMMIT.
 *
 * Les anciens appels `create(id, contenu)` restent entièrement compatibles.
 */
exports.create = async (idUtilisateur, content, options = {}) => {
  const connection = options.connection || db;
  const type = options.type || 'GENERALE';
  const referenceType = options.referenceType || null;
  const referenceId = options.referenceId || null;
  const [result] = await connection.execute(
    `INSERT INTO notification
       (contenu_notification, id_utilisateur, type_notification, type_reference, id_reference)
     VALUES (?, ?, ?, ?, ?)`,
    [content, idUtilisateur, type, referenceType, referenceId]
  );
  const notification = {
    id_notification: result.insertId,
    contenu_notification: content,
    date_notification: new Date(),
    statut_notification: 'Non lue',
    type_notification: type,
    type_reference: referenceType,
    id_reference: referenceId,
    id_utilisateur: idUtilisateur
  };
  if (options.emit !== false) emit(notification);
  return { ...result, notification };
};

/** URL d'ouverture calculée côté serveur à partir de la référence, jamais du texte. */
exports.actionUrl = (notification, user) => {
  const id = Number(notification?.id_reference);
  if (!notification?.type_reference || !id) return null;
  switch (notification.type_reference) {
    case 'DEMANDE_SUGGESTION':
      return user?.role === 'administrateur'
        ? `/admin/suggestions/${id}`
        : `/suggestions/${id}`;
    case 'ENTREPRISE':
      // Demande de création d'entreprise : l'administrateur est conduit vers
      // la liste des demandes en attente (ancre sur la demande concernée) ;
      // le demandeur, vers ses paramètres (suivi de sa demande).
      return user?.role === 'administrateur'
        ? `/dashboard#entreprise-${id}`
        : '/parametres';
    case 'OFFRE':
      // Offre proche de l'expiration : le recruteur est conduit vers les
      // candidatures de CETTE offre (classées par pertinence).
      return user?.role === 'recruteur'
        ? `/candidatures?offre=${id}`
        : `/offres/${id}`;
    default:
      return null;
  }
};
