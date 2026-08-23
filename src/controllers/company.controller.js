const db = require('../config/database');
const Company = require('../models/company.model');
const { success, fail } = require('../utils/apiResponse');
const asyncHandler = require('../utils/asyncHandler');
const notify = require('../services/notification.service');
const domaine = require('../services/domain.service');

const requiredCompanyFields = [
  'nom_entreprise',
  'id_domaine',
  'secteur_activite',
  'adresse',
  'pays',
  'ville',
  'telephone',
  'email',
  'description',
  'numero_rccm'
];

exports.createRecruiter = asyncHandler(async (req, res) => {
  if (req.user.role !== 'candidat') return fail(res, 'Seul un candidat peut soumettre une demande recruteur.', [], 403);
  const existing = await Company.hasOpenRequest(req.user.id_utilisateur);
  if (existing) return fail(res, 'Une demande recruteur est déjà en cours ou approuvée.', [], 409);

  const payload = Company.normalizePayload(req.body, req.files);
  const missing = requiredCompanyFields.filter((field) => !payload[field]);
  if (missing.length) return fail(res, 'Informations entreprise incomplètes.', missing, 422);
  const selectedDomain = await domaine.findById(payload.id_domaine);
  if (!selectedDomain) return fail(res, 'Veuillez sélectionner un domaine d’activité valide.', ['id_domaine'], 422);
  payload.id_domaine = selectedDomain.id_domaine;
  if (!payload.documents_justificatifs) return fail(res, 'Document justificatif PDF requis.', ['documents'], 422);

  const company = await Company.createPending(req.user.id_utilisateur, payload);
  await notify.create(req.user.id_utilisateur, `Votre demande pour l'entreprise « ${company.nom_entreprise} » a été soumise et attend validation.`);
  success(res, 'Entreprise soumise pour validation.', { company }, 201);
});
exports.myRecruiter = asyncHandler(async (req, res) => { 
  const company = await Company.findApprovedByOwner(req.user.id_utilisateur);
    success(res, 'Profil recruteur.', { recruiter: company || null, company: company || null }); 
  });

/**
 * Entreprise(s) de l'utilisateur connecté, quel que soit le statut
 * (utilisé par la page Paramètres et la page de gestion du recruteur).
 */
exports.mine = asyncHandler(async (req, res) => {
  const companies = await Company.findByOwner(req.user.id_utilisateur);
  success(res, 'Mes entreprises.', { items: companies });
});

/**
 * Mise à jour de l'entreprise :
 *  - recruteur   → uniquement SON entreprise approuvée ;
 *  - administrateur → toute entreprise (hors workflow de validation).
 * Le statut de validation ne peut pas être modifié via cette route.
 */
exports.updateOwn = asyncHandler(async (req, res) => {
  const company = await Company.findById(req.params.id);
  if (!company) return fail(res, 'Entreprise introuvable.', [], 404);
  const isOwner = company.id_utilisateur === req.user.id_utilisateur;
  if (req.user.role === 'recruteur') {
    if (!isOwner) return fail(res, 'Vous ne pouvez modifier que votre propre entreprise.', [], 403);
    if (company.status !== 'approved') return fail(res, 'Seule une entreprise approuvée peut être modifiée.', [], 422);
  } else if (req.user.role !== 'administrateur') {
    return fail(res, 'Accès non autorisé.', [], 403);
  }

  const payload = Company.normalizePayload(req.body, req.files || {});
  const data = {};
  for (const field of Company.EDITABLE_FIELDS) if (payload[field] !== undefined) data[field] = payload[field];
  if (data.id_domaine !== undefined) {
    const selectedDomain = await domaine.findById(data.id_domaine);
    if (!selectedDomain) return fail(res, 'Veuillez sélectionner un domaine d’activité valide.', ['id_domaine'], 422);
    // VERROUILLAGE DÉFINITIF DU DOMAINE D'ENTREPRISE (règle serveur) :
    // une fois le domaine d'activité confirmé, il ne peut plus être remplacé,
    // ni par le recruteur ni via une requête API directe (l'administrateur
    // n'a pas non plus de procédure de changement arbitraire — pas de logique
    // métier de « changement de domaine » à ce stade du projet).
    if (company.id_domaine && Number(company.id_domaine) !== selectedDomain.id_domaine) {
      return fail(res, 'Le domaine d’activité de l’entreprise est définitif et ne peut plus être modifié.', ['id_domaine'], 403);
    }
    data.id_domaine = selectedDomain.id_domaine;
  }

  const updated = await Company.updateOwn(req.params.id, data);
  // Première définition du domaine (ancienne entreprise sans domaine) : les
  // offres déjà publiées sans domaine sont alignées sur celui de l'entreprise
  // (source métier unique : entreprise.id_domaine).
  if (data.id_domaine !== undefined) {
    await db.execute('UPDATE offre_emploi SET id_domaine = ? WHERE id_entreprise = ? AND id_domaine IS NULL', [data.id_domaine, req.params.id]);
  }
  success(res, 'Entreprise mise à jour.', { company: updated });
});
exports.validate = asyncHandler(async (req, res) => {
  const map = { 'Validée': 'approved', 'Rejetée': 'rejected', pending: 'pending', approved: 'approved', rejected: 'rejected' };
  const status = map[req.body.status] || map[req.body.statut_validation];
  if (!['pending', 'approved', 'rejected'].includes(status)) return fail(res, 'Statut de validation invalide.', [], 422);
  const company = await Company.findById(req.params.id);
  if (!company) return fail(res, 'Entreprise introuvable.', [], 404);

  // Idempotence : éviter d'approuver / rejeter deux fois la même entreprise.
  if (company.status === 'rejected' && status === 'rejected') {
    return fail(res, 'Cette demande a déjà été rejetée.', [], 409);
  }
  if (company.status === 'approved' && status === 'approved') {
    return fail(res, 'Cette entreprise a déjà été approuvée.', [], 409);
  }

  if (status === 'approved') {
    const approved = await Company.approve(req.params.id, req.user.id_utilisateur);
    await notify.create(approved.id_utilisateur, `Votre entreprise « ${approved.nom_entreprise} » a été approuvée. Vous êtes maintenant recruteur.`);
  } else if (status === 'rejected') {
    await Company.reject(req.params.id, req.user.id_utilisateur);
    if (company.id_utilisateur) await notify.create(company.id_utilisateur, `Votre demande recruteur pour « ${company.nom_entreprise} » a été rejetée.`);
  } else {
    await Company.setStatus(req.params.id, 'pending', null);
  }
  success(res, 'Entreprise mise à jour.');
});
