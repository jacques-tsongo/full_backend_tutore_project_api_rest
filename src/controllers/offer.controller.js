const db = require('../config/database');
const { success, fail } = require('../utils/apiResponse');
const asyncHandler = require('../utils/asyncHandler');
const { pagination, listResult } = require('../utils/query');
const notify = require('../services/notification.service');
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

exports.list = asyncHandler(async (req, res) => {
  const { page, limit, offset } = pagination(req.query);
  const where = [];
  const values = [];

  // Un candidat ne voit que les offres ouvertes et non expirées.
  // Un recruteur voit toutes les offres (ou les siennes avec ?mine=1).
  if (req.user.role === 'candidat') {
    where.push("o.statut_offre = 'Ouverte'");
    where.push('o.date_expiration >= CURDATE()');
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
  if (req.user.role === 'candidat' && (offer.statut_offre !== 'Ouverte' || dateOnly(offer.date_expiration) < today())) {
    // Un candidat peut consulter une offre fermée seulement s'il y a déjà candidaté.
    const [app] = await db.execute('SELECT id_candidature FROM candidature WHERE id_utilisateur = ? AND id_offre = ?', [req.user.id_utilisateur, req.params.id]);
    if (!app[0]) return fail(res, 'Offre introuvable.', [], 404);
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

  const [candidates] = await db.execute("SELECT id_utilisateur FROM utilisateur WHERE role='candidat' AND statut_compte='actif'");
  await Promise.all(candidates.map((u) => notify.create(u.id_utilisateur, `Nouvelle offre : « ${req.body.titre_offre} ».`)));

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
  return success(res, 'Offre mise à jour.');
});

exports.remove = asyncHandler(async (req, res) => {
  const company = await companyFor(req.user.id_utilisateur);
  if (!company || company.status !== 'approved') return fail(res, 'Entreprise approuvée et profil recruteur requis.', [], 403);
  const [r] = await db.execute('DELETE FROM offre_emploi WHERE id_offre=? AND id_entreprise=?', [req.params.id, company.id_entreprise]);
  if (!r.affectedRows) return fail(res, 'Offre introuvable ou accès refusé.', [], 404);
  return success(res, 'Offre supprimée.');
});
