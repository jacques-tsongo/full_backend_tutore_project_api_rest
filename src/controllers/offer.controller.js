const db = require('../config/database');
const { success, fail } = require('../utils/apiResponse');
const asyncHandler = require('../utils/asyncHandler');
const { pagination, listResult } = require('../utils/query');
const notify = require('../services/notification.service');
const matching = require('../services/matching.service');
const socket = require('../socket');
const Company = require('../models/company.model');

const companyFor = (id) => Company.findApprovedByOwner(id);

const OFFER_FIELDS = ['titre_offre', 'description_offre', 'salaire', 'localisation', 'date_expiration', 'statut_offre'];

const normalizeDate = (value) => {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === 'string') return value.slice(0, 10);
  return value;
};

const today = () => new Date().toISOString().slice(0, 10);

const dateOnly = (value) => {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString().slice(0, 10);
  if (typeof value === 'string') return value.slice(0, 10);
  return '';
};

const offerSelect = `
  SELECT o.*, e.nom_entreprise, e.logo AS logo_entreprise, e.ville AS ville_entreprise,
         e.pays AS pays_entreprise, e.id_utilisateur AS id_recruteur
  FROM offre_emploi o
  JOIN entreprise e ON e.id_entreprise = o.id_entreprise
`;

/** Récupère une offre complète depuis la base (source de vérité) pour la diffuser. */
const offerPayload = async (idOffre) => {
  const [rows] = await db.execute(`${offerSelect} WHERE o.id_offre = ?`, [idOffre]);
  return rows[0] || null;
};

/**
 * Diffusion d'une offre selon les règles d'accès existantes :
 * - candidats : uniquement si l'offre est « Ouverte » et non expirée ;
 * - recruteurs / administrateurs : toutes les offres (règles actuelles).
 */
const broadcastOffer = async (event, rows) => {
  const visiblePourCandidat = rows && rows.statut_offre === 'Ouverte' && String(rows.date_expiration).slice(0, 10) >= today() && rows.date_publication;
  if (visiblePourCandidat) socket.emitToRole('candidat', event, { offer: rows });
  socket.emitToRole('recruteur', event, { offer: rows });
  socket.emitToRole('administrateur', event, { offer: rows });
};

exports.list = asyncHandler(async (req, res) => {
  const { page, limit, offset } = pagination(req.query);
  const where = [];
  const values = [];

  // Un candidat ne voit que les offres ouvertes, non expirées ET compatibles
  // (il possède TOUTES les compétences requises). Une offre incompatible est
  // simplement absente de la liste — jamais « affichée comme non compatible ».
  // Un recruteur voit toutes les offres (ou les siennes avec ?mine=1).
  if (req.user.role === 'candidat') {
    where.push("o.statut_offre = 'Ouverte'");
    where.push('o.date_expiration >= CURDATE()');
    // Exclut toute offre ayant au moins une compétence requise que le
    // candidat ne possède pas (donc seules restent les offres dont TOUTES
    // les compétences requises sont couvertes, y compris sans compétence).
    where.push(`o.id_offre NOT IN (
      SELECT oc.id_offre FROM offre_competence oc
      WHERE oc.id_competence NOT IN (
        SELECT uc.id_competence FROM utilisateur_competence uc WHERE uc.id_utilisateur = ?
      )
    )`);
    values.push(req.user.id_utilisateur);
  }
  if (req.query.statut) {
    if (!['Ouverte', 'Fermée', 'Suspendue'].includes(req.query.statut)) {
      return fail(res, 'Statut d\'offre invalide.', [], 422);
    }
    where.push('o.statut_offre = ?');
    values.push(req.query.statut);
  }
  if (req.query.mine === '1' || req.query.mine === 'true') {
    if (req.user.role !== 'recruteur' && req.user.role !== 'administrateur') {
      return fail(res, 'Accès non autorisé.', [], 403);
    }
    const company = await companyFor(req.user.id_utilisateur);
    if (!company) return success(res, 'Mes offres.', { items: [], pagination: { page, limit, total: 0, pages: 0 } });
    where.push('o.id_entreprise = ?');
    values.push(company.id_entreprise);
  }
  if (req.query.q) {
    where.push('(o.titre_offre LIKE ? OR o.localisation LIKE ? OR e.nom_entreprise LIKE ?)');
    const like = `%${req.query.q}%`;
    values.push(like, like, like);
  }

  const sortable = ['id_offre', 'titre_offre', 'localisation', 'salaire', 'date_publication', 'date_expiration'];
  const order = sortable.includes(req.query.sort) ? req.query.sort : 'date_publication';
  const direction = String(req.query.order).toUpperCase() === 'ASC' ? 'ASC' : 'DESC';

  const condition = where.length ? ` WHERE ${where.join(' AND ')}` : '';
  const [rows] = await db.execute(
    `${offerSelect}${condition} ORDER BY o.${order} ${direction} LIMIT ? OFFSET ?`,
    [...values, limit, offset]
  );
  const [[{ total }]] = await db.execute(`SELECT COUNT(*) total FROM offre_emploi o JOIN entreprise e ON e.id_entreprise = o.id_entreprise${condition}`, values);

  return success(res, 'Offres récupérées.', listResult(rows, total, page, limit));
});

exports.get = asyncHandler(async (req, res) => {
  const [rows] = await db.execute(`${offerSelect} WHERE o.id_offre = ?`, [req.params.id]);
  if (!rows[0]) return fail(res, 'Offre introuvable.', [], 404);
  const offer = rows[0];
  if (req.user.role === 'candidat') {
    const [app] = await db.execute('SELECT id_candidature FROM candidature WHERE id_utilisateur = ? AND id_offre = ?', [req.user.id_utilisateur, req.params.id]);
    const alreadyApplied = !!app[0];
    // Un candidat peut consulter une offre fermée seulement s'il y a déjà candidaté.
    if ((offer.statut_offre !== 'Ouverte' || dateOnly(offer.date_expiration) < today()) && !alreadyApplied) {
      return fail(res, 'Offre introuvable.', [], 404);
    }
    // Sécurité : même en accédant directement à /offres/:id, un candidat qui
    // n'a pas encore postulé et qui manque au moins une compétence requise se
    // voit refuser l'accès. Le filtrage n'est PAS limité au frontend.
    if (!alreadyApplied) {
      const compatible = await matching.hasAllRequired(req.user.id_utilisateur, req.params.id);
      if (!compatible) return fail(res, 'Accès refusé : vos compétences ne couvrent pas toutes les compétences requises par cette offre.', [], 403);
    }
  }
  const [skills] = await db.execute(
    `SELECT c.id_competence, c.nom_competence, oc.niveau_requis
     FROM offre_competence oc
     JOIN competence c ON c.id_competence = oc.id_competence
     WHERE oc.id_offre = ?`,
    [req.params.id]
  );
  return success(res, 'Offre récupérée.', { item: { ...offer, competences: skills } });
});

exports.create = asyncHandler(async (req, res) => {
  const company = await companyFor(req.user.id_utilisateur);
  if (!company || company.status !== 'approved') return fail(res, 'Entreprise approuvée et profil recruteur requis.', [], 403);

  const date = normalizeDate(req.body.date_expiration);
  if (!date || date < today()) {
    return fail(res, 'La date d\'expiration doit être dans le futur.', ['date_expiration'], 422);
  }

  const f = [...OFFER_FIELDS];
  const values = f.map((x) => req.body[x] ?? (x === 'statut_offre' ? 'Ouverte' : null));
  values[f.indexOf('date_expiration')] = date;

  const [r] = await db.execute(
    `INSERT INTO offre_emploi (${f.concat('id_entreprise').join(',')}) VALUES (${f.map(() => '?').concat('?').join(',')})`,
    [...values, company.id_entreprise]
  );

  // Compétences requises sélectionnées à la création : on réutilise la table
  // `offre_competence` existante (aucune nouvelle table). Niveau par défaut
  // « Débutant » ; le recruteur peut l'affiner ensuite depuis son tableau de
  // bord (même mécanisme que pour le profil candidat).
  const competences = Array.isArray(req.body.competences) ? req.body.competences : [];
  for (const item of competences) {
    const idc = Number(item?.id_competence ?? item);
    if (!Number.isInteger(idc) || idc < 1) continue;
    const niveau = typeof item === 'object' && item?.niveau_requis
      ? item.niveau_requis
      : 'Débutant';
    await db.execute(
      'INSERT INTO offre_competence (id_offre, id_competence, niveau_requis) VALUES (?, ?, ?)',
      [r.insertId, idc, niveau]
    );
  }

  // Notifications : uniquement les candidats compatibles (possédant TOUTES les
  // compétences requises). Le filtrage est effectué AVANT la création des
  // notifications — on ne notifie jamais tous les candidats pour filtrer ensuite.
  const [candidates] = await db.execute("SELECT id_utilisateur FROM utilisateur WHERE role='candidat' AND statut_compte='actif'");
  const recipients = [];
  for (const c of candidates) {
    if (await matching.hasAllRequired(c.id_utilisateur, r.insertId)) recipients.push(c.id_utilisateur);
  }
  await Promise.all(recipients.map((id) => notify.create(id, `Nouvelle offre : « ${req.body.titre_offre} ».`)));

  // Temps réel : la nouvelle offre est diffusée aux recruteurs/admins et,
  // pour les candidats, uniquement à ceux qui sont compatibles (jamais à tous).
  const fresh = await offerPayload(r.insertId);
  if (fresh) {
    const visiblePourCandidat = fresh.statut_offre === 'Ouverte' && String(fresh.date_expiration).slice(0, 10) >= today() && fresh.date_publication;
    socket.emitToRole('recruteur', 'nouvelle_offre', { offer: fresh });
    socket.emitToRole('administrateur', 'nouvelle_offre', { offer: fresh });
    if (visiblePourCandidat) {
      recipients.forEach((id) => socket.emitToUser(id, 'nouvelle_offre', { offer: fresh }));
    }
  }

  return success(res, 'Offre créée.', { id_offre: r.insertId }, 201);
});

exports.update = asyncHandler(async (req, res) => {
  const company = await companyFor(req.user.id_utilisateur);
  if (!company || company.status !== 'approved') return fail(res, 'Entreprise approuvée et profil recruteur requis.', [], 403);

  const [found] = await db.execute('SELECT id_offre FROM offre_emploi WHERE id_offre=? AND id_entreprise=?', [req.params.id, company.id_entreprise]);
  if (!found[0]) return fail(res, 'Offre introuvable ou accès refusé.', [], 404);

  if (req.body.date_expiration !== undefined) {
    const date = normalizeDate(req.body.date_expiration);
    if (!date || date < today()) {
      return fail(res, 'La date d\'expiration doit être dans le futur.', ['date_expiration'], 422);
    }
    req.body.date_expiration = date;
  }

  const f = OFFER_FIELDS.filter((x) => req.body[x] !== undefined);
  if (f.length) {
    await db.execute(`UPDATE offre_emploi SET ${f.map((x) => `${x}=?`).join(',')} WHERE id_offre=?`, [...f.map((x) => req.body[x]), req.params.id]);
  }
  // Temps réel : les clients affichant cette offre reçoivent la version à jour.
  const fresh = await offerPayload(req.params.id);
  if (fresh) await broadcastOffer('offre_modifiee', fresh);
  return success(res, 'Offre mise à jour.');
});

exports.remove = asyncHandler(async (req, res) => {
  const company = await companyFor(req.user.id_utilisateur);
  if (!company || company.status !== 'approved') return fail(res, 'Entreprise approuvée et profil recruteur requis.', [], 403);
  const [r] = await db.execute('DELETE FROM offre_emploi WHERE id_offre=? AND id_entreprise=?', [req.params.id, company.id_entreprise]);
  if (!r.affectedRows) return fail(res, 'Offre introuvable ou accès refusé.', [], 404);
  // Temps réel : tous les clients retirent l'offre de leur affichage.
  socket.emitToRole('candidat', 'offre_supprimee', { id_offre: Number(req.params.id) });
  socket.emitToRole('recruteur', 'offre_supprimee', { id_offre: Number(req.params.id) });
  socket.emitToRole('administrateur', 'offre_supprimee', { id_offre: Number(req.params.id) });
  return success(res, 'Offre supprimée.');
});
