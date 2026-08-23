const crypto = require('crypto');
const db = require('../config/database');
const Suggestion = require('../models/suggestion.model');
const notify = require('./notification.service');
const socket = require('../socket');

const { TYPES, STATUSES, cleanName, normalizeName } = Suggestion;

class BusinessError extends Error {
  constructor(message, statusCode = 422, errors = []) {
    super(message);
    this.name = 'BusinessError';
    this.statusCode = statusCode;
    this.errors = errors;
  }
}
exports.BusinessError = BusinessError;

const lockKey = (type, normalizedName, domainId = 0, userId = 0) => {
  const digest = crypto.createHash('sha256')
    .update(`${type}|${domainId || 0}|${normalizedName}|${userId || 0}`)
    .digest('hex');
  return `suggestion:${digest.slice(0, 48)}`;
};

const acquireLock = async (connection, key) => {
  const [[row]] = await connection.execute('SELECT GET_LOCK(?, 10) AS acquired', [key]);
  if (Number(row.acquired) !== 1) {
    throw new BusinessError('La suggestion est en cours de traitement. Veuillez réessayer.', 409);
  }
  return key;
};

const releaseLock = async (connection, key) => {
  if (!key) return;
  await connection.execute('SELECT RELEASE_LOCK(?)', [key]).catch(() => {});
};

const validatePayload = (body = {}) => {
  const type = String(body.type_demande || '').toUpperCase();
  if (!Object.values(TYPES).includes(type)) {
    throw new BusinessError('Type de suggestion invalide.', 422, ['type_demande']);
  }
  const name = cleanName(body.nom_propose);
  const max = type === TYPES.DOMAIN ? 150 : 100;
  if (name.length < 2 || name.length > max) {
    throw new BusinessError(`Le nom proposé doit contenir entre 2 et ${max} caractères.`, 422, ['nom_propose']);
  }
  const description = String(body.description ?? '').normalize('NFKC').replace(/\r\n?/g, '\n').trim();
  if (description.length > 2000) {
    throw new BusinessError('La description ne peut pas dépasser 2 000 caractères.', 422, ['description']);
  }
  return { type, name, normalizedName: normalizeName(name), description: description || null };
};
exports.validatePayload = validatePayload;

/** Soumission atomique + notification de tous les comptes administrateurs. */
exports.submit = async (user, body) => {
  if (!user || !['candidat', 'recruteur'].includes(user.role)) {
    throw new BusinessError('Seuls les candidats et recruteurs peuvent proposer une suggestion.', 403);
  }
  const data = validatePayload(body);
  const connection = await db.getConnection();
  let acquired = null;
  const notifications = [];
  try {
    await connection.beginTransaction();

    let domain = null;
    if (data.type === TYPES.SKILL) {
      // Le domaine est dérivé du profil ou de l'entreprise approuvée. Tout
      // id_domaine envoyé par le client est volontairement ignoré.
      domain = await Suggestion.getUserSkillDomain(user, connection);
      if (!domain) {
        throw new BusinessError(
          user.role === 'recruteur'
            ? 'Votre entreprise approuvée doit avoir un domaine avant de proposer une compétence.'
            : 'Votre profil doit avoir un domaine professionnel avant de proposer une compétence.',
          422,
          ['id_domaine']
        );
      }
    }

    acquired = await acquireLock(
      connection,
      lockKey(data.type, data.normalizedName, domain?.id_domaine, user.id_utilisateur)
    );

    const existing = await Suggestion.findCatalogItem(data.type, data.name, connection);
    if (existing) {
      throw new BusinessError(
        data.type === TYPES.DOMAIN ? 'Ce domaine existe déjà.' : 'Cette compétence existe déjà.',
        409,
        ['nom_propose']
      );
    }

    const duplicate = await Suggestion.findPendingDuplicate({
      userId: user.id_utilisateur,
      type: data.type,
      normalizedName: data.normalizedName,
      domainId: domain?.id_domaine || null
    }, connection);
    if (duplicate) {
      throw new BusinessError('Vous avez déjà une suggestion identique en attente.', 409, ['nom_propose']);
    }

    const requestId = await Suggestion.create({
      ...data,
      userId: user.id_utilisateur,
      domainId: domain?.id_domaine || null
    }, connection);

    // Aucun ID en dur et aucune hypothèse d'admin unique : tous les comptes
    // portant réellement le rôle administrateur reçoivent la notification.
    const [admins] = await connection.execute(
      "SELECT id_utilisateur FROM utilisateur WHERE role = 'administrateur'"
    );
    const kind = data.type === TYPES.DOMAIN ? 'domaine' : 'compétence';
    for (const admin of admins) {
      const created = await notify.create(
        admin.id_utilisateur,
        `Nouvelle suggestion de ${kind} : « ${data.name} »`,
        {
          type: data.type === TYPES.DOMAIN ? 'NOUVELLE_SUGGESTION_DOMAINE' : 'NOUVELLE_SUGGESTION_COMPETENCE',
          referenceType: 'DEMANDE_SUGGESTION',
          referenceId: requestId,
          connection,
          emit: false
        }
      );
      notifications.push(created.notification);
    }

    const createdRequest = await Suggestion.findById(requestId, { connection });
    await connection.commit();
    notifications.forEach(notify.emit);
    socket.emitToRole('administrateur', 'nouvelle_suggestion', { id_demande: requestId });
    return createdRequest;
  } catch (error) {
    await connection.rollback().catch(() => {});
    throw error;
  } finally {
    await releaseLock(connection, acquired);
    connection.release();
  }
};

const ensurePending = (request) => {
  if (!request) throw new BusinessError('Suggestion introuvable.', 404);
  if (request.statut !== STATUSES.PENDING) {
    throw new BusinessError('Cette suggestion a déjà été traitée.', 409);
  }
};

const decisionComment = (value) => {
  const comment = cleanName(value);
  if (comment.length > 2000) {
    throw new BusinessError('Le commentaire administrateur ne peut pas dépasser 2 000 caractères.', 422, ['commentaire_admin']);
  }
  return comment || null;
};

/** Approbation atomique : catalogue + demande + notification du demandeur. */
exports.approve = async (requestId, admin, body = {}) => {
  if (!admin || admin.role !== 'administrateur') {
    throw new BusinessError('Seul un administrateur peut approuver une suggestion.', 403);
  }
  const comment = decisionComment(body.commentaire_admin);
  const connection = await db.getConnection();
  let acquired = null;
  let notification = null;
  let catalogItem = null;
  let alreadyExisted = false;
  let request;
  try {
    await connection.beginTransaction();
    request = await Suggestion.findForUpdate(requestId, connection);
    ensurePending(request);

    acquired = await acquireLock(
      connection,
      lockKey(request.type_demande, request.nom_normalise, request.id_domaine)
    );

    catalogItem = await Suggestion.findCatalogItem(request.type_demande, request.nom_propose, connection);
    alreadyExisted = !!catalogItem;
    if (
      catalogItem && request.type_demande === TYPES.SKILL
      && Number(catalogItem.id_domaine || 0) !== Number(request.id_domaine)
    ) {
      throw new BusinessError(
        'Cette compétence existe désormais dans un autre domaine. Refusez la demande ou vérifiez le classement du catalogue.',
        409
      );
    }

    if (!catalogItem && request.type_demande === TYPES.DOMAIN) {
      try {
        const [created] = await connection.execute(
          'INSERT INTO domaine (nom_domaine) VALUES (?)',
          [request.nom_propose]
        );
        catalogItem = { id_domaine: created.insertId, nom_domaine: request.nom_propose };
      } catch (error) {
        if (error.code !== 'ER_DUP_ENTRY') throw error;
        catalogItem = await Suggestion.findCatalogItem(request.type_demande, request.nom_propose, connection);
        alreadyExisted = true;
      }
    } else if (!catalogItem && request.type_demande === TYPES.SKILL) {
      // Le domaine conservé dans la demande doit toujours exister au moment
      // de l'approbation (FK RESTRICT + vérification explicite).
      const [domains] = await connection.execute(
        'SELECT id_domaine, nom_domaine FROM domaine WHERE id_domaine = ?',
        [request.id_domaine]
      );
      if (!domains[0]) throw new BusinessError('Le domaine lié à cette compétence n’existe plus.', 409);
      try {
        const [created] = await connection.execute(
          'INSERT INTO competence (nom_competence, description, id_domaine) VALUES (?, NULL, ?)',
          [request.nom_propose, request.id_domaine]
        );
        catalogItem = {
          id_competence: created.insertId,
          nom_competence: request.nom_propose,
          description: null,
          id_domaine: Number(request.id_domaine),
          nom_domaine: domains[0].nom_domaine
        };
      } catch (error) {
        if (error.code !== 'ER_DUP_ENTRY') throw error;
        catalogItem = await Suggestion.findCatalogItem(request.type_demande, request.nom_propose, connection);
        alreadyExisted = true;
      }
    }

    if (!catalogItem) {
      throw new BusinessError('Le catalogue a changé pendant le traitement. Veuillez réessayer.', 409);
    }
    if (
      request.type_demande === TYPES.SKILL
      && Number(catalogItem.id_domaine || 0) !== Number(request.id_domaine)
    ) {
      throw new BusinessError(
        'Cette compétence existe désormais dans un autre domaine. Refusez la demande ou vérifiez le classement du catalogue.',
        409
      );
    }

    await connection.execute(
      `UPDATE demande_suggestion
       SET statut = 'APPROUVEE', date_traitement = CURRENT_TIMESTAMP,
           id_admin_traitement = ?, commentaire_admin = ?
       WHERE id_demande = ?`,
      [admin.id_utilisateur, comment, request.id_demande]
    );

    const kind = request.type_demande === TYPES.DOMAIN ? 'domaine' : 'compétence';
    const createdNotification = await notify.create(
      request.id_utilisateur,
      `Votre suggestion de ${kind} « ${request.nom_propose} » a été approuvée.`,
      {
        type: 'SUGGESTION_APPROUVEE',
        referenceType: 'DEMANDE_SUGGESTION',
        referenceId: request.id_demande,
        connection,
        emit: false
      }
    );
    notification = createdNotification.notification;
    const updatedRequest = await Suggestion.findById(request.id_demande, { connection });

    await connection.commit();
    notify.emit(notification);
    if (!alreadyExisted && request.type_demande === TYPES.DOMAIN) {
      socket.emitAll('nouveau_domaine', { domaine: catalogItem });
    }
    if (!alreadyExisted && request.type_demande === TYPES.SKILL) {
      socket.emitAll('nouvelle_competence', {
        competence: catalogItem,
        id_competence: catalogItem.id_competence
      });
    }
    socket.emitToRole('administrateur', 'suggestion_traitee', {
      id_demande: Number(request.id_demande),
      statut: STATUSES.APPROVED
    });
    return { request: updatedRequest, catalogItem, alreadyExisted };
  } catch (error) {
    await connection.rollback().catch(() => {});
    throw error;
  } finally {
    await releaseLock(connection, acquired);
    connection.release();
  }
};

/** Refus atomique : aucune création catalogue, décision + notification. */
exports.reject = async (requestId, admin, body = {}) => {
  if (!admin || admin.role !== 'administrateur') {
    throw new BusinessError('Seul un administrateur peut refuser une suggestion.', 403);
  }
  const comment = decisionComment(body.commentaire_admin || body.raison);
  const connection = await db.getConnection();
  let notification = null;
  let request;
  try {
    await connection.beginTransaction();
    request = await Suggestion.findForUpdate(requestId, connection);
    ensurePending(request);

    await connection.execute(
      `UPDATE demande_suggestion
       SET statut = 'REFUSEE', date_traitement = CURRENT_TIMESTAMP,
           id_admin_traitement = ?, commentaire_admin = ?
       WHERE id_demande = ?`,
      [admin.id_utilisateur, comment, request.id_demande]
    );

    const kind = request.type_demande === TYPES.DOMAIN ? 'domaine' : 'compétence';
    const reason = comment ? ` Motif : ${comment}` : '';
    const createdNotification = await notify.create(
      request.id_utilisateur,
      `Votre suggestion de ${kind} « ${request.nom_propose} » a été refusée.${reason}`,
      {
        type: 'SUGGESTION_REFUSEE',
        referenceType: 'DEMANDE_SUGGESTION',
        referenceId: request.id_demande,
        connection,
        emit: false
      }
    );
    notification = createdNotification.notification;
    const updatedRequest = await Suggestion.findById(request.id_demande, { connection });

    await connection.commit();
    notify.emit(notification);
    socket.emitToRole('administrateur', 'suggestion_traitee', {
      id_demande: Number(request.id_demande),
      statut: STATUSES.REJECTED
    });
    return updatedRequest;
  } catch (error) {
    await connection.rollback().catch(() => {});
    throw error;
  } finally {
    connection.release();
  }
};
