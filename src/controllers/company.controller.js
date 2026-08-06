const db = require('../config/database');
const Company = require('../models/company.model');
const User = require('../models/user.model');
const { success, fail } = require('../utils/apiResponse');
const asyncHandler = require('../utils/asyncHandler');
const notify = require('../services/notification.service');

const requiredCompanyFields = [
  'nom_entreprise',
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
  if (!payload.documents_justificatifs) return fail(res, 'Document justificatif PDF requis.', ['documents'], 422);

  const company = await Company.createPending(req.user.id_utilisateur, payload);
  await notify.create(req.user.id_utilisateur, `Votre demande pour l'entreprise « ${company.nom_entreprise} » a été soumise et attend validation.`);
  success(res, 'Entreprise soumise pour validation.', { company }, 201);
});
exports.myRecruiter = asyncHandler(async (req, res) => { 
  const company = await Company.findApprovedByOwner(req.user.id_utilisateur);
    success(res, 'Profil recruteur.', { recruiter: company || null, company: company || null }); 
  });
exports.validate = asyncHandler(async (req, res) => { 
  const map = { 'Validée': 'approved', 'Rejetée': 'rejected', pending: 'pending', approved: 'approved', rejected: 'rejected' };
  const status = map[req.body.status] || map[req.body.statut_validation];
  if (!['pending', 'approved', 'rejected'].includes(status)) return fail(res, 'Statut de validation invalide.', [], 422); 
  const company = await Company.findById(req.params.id);
  if (!company) return fail(res, 'Entreprise introuvable.', [], 404);
  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();
    await Company.setStatus(req.params.id, status, req.user.id_utilisateur, connection);
    if (status === 'approved' && company.id_utilisateur) await User.updateRole(company.id_utilisateur, 'recruteur', connection);
    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
  if (company.id_utilisateur && status === 'approved') await notify.create(company.id_utilisateur, `Votre entreprise « ${company.nom_entreprise} » a été approuvée. Vous êtes maintenant recruteur.`);
  if (company.id_utilisateur && status === 'rejected') await notify.create(company.id_utilisateur, `Votre demande recruteur pour « ${company.nom_entreprise} » a été rejetée.`);
  success(res, 'Entreprise mise à jour.'); });
