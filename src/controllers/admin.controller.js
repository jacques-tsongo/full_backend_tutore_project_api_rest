const db = require('../config/database');
const Company = require('../models/company.model');
const User = require('../models/user.model');
const { success, fail } = require('../utils/apiResponse');
const asyncHandler = require('../utils/asyncHandler');
const notify = require('../services/notification.service');

exports.users = asyncHandler(async (req, res) => {
  // Recherche facultative (page /admin/utilisateurs) : filtre sur nom, prénom,
  // email et rôle. Tout est paramétré plutôt que concaténé (aucune injection SQL).
  const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
  let rows;
  if (q) {
    const like = `%${q}%`;
    [rows] = await db.execute(
      `SELECT id_utilisateur, nom, prenom, email, telephone, photo, role, date_inscription, statut_compte
       FROM utilisateur
       WHERE nom LIKE ? OR prenom LIKE ? OR email LIKE ? OR role LIKE ?
       ORDER BY date_inscription DESC`,
      [like, like, like, like]
    );
  } else {
    // `photo` est inclus pour afficher l'avatar à côté du nom dans le tableau.
    [rows] = await db.execute('SELECT id_utilisateur, nom, prenom, email, telephone, photo, role, date_inscription, statut_compte FROM utilisateur ORDER BY date_inscription DESC');
  }
  success(res, 'Utilisateurs récupérés.', { items: rows, q });
});

exports.userStatus = asyncHandler(async (req, res) => {
  if (!['actif', 'inactif', 'suspendu'].includes(req.body.statut_compte)) return fail(res, 'Statut invalide.', [], 422);
  const [r] = await db.execute('UPDATE utilisateur SET statut_compte=? WHERE id_utilisateur=?', [req.body.statut_compte, req.params.id]);
  if (!r.affectedRows) return fail(res, 'Utilisateur introuvable.', [], 404);
  success(res, 'Statut utilisateur mis à jour.');
});

exports.stats = asyncHandler(async (req, res) => {
  const [[users]] = await db.execute("SELECT COUNT(*) total, SUM(role='candidat') candidats, SUM(role='recruteur') recruteurs FROM utilisateur");
  const [[offers]] = await db.execute("SELECT COUNT(*) total, SUM(statut_offre='Ouverte') ouvertes FROM offre_emploi");
  const [[applications]] = await db.execute('SELECT COUNT(*) total FROM candidature');
  // Total des compétences de la plateforme (carte « Compétences » du dashboard admin).
  const [[skills]] = await db.execute('SELECT COUNT(*) total FROM competence');
  const [[domains]] = await db.execute('SELECT COUNT(*) total FROM domaine');
  const [[suggestions]] = await db.execute(
    "SELECT COUNT(*) total, SUM(statut = 'EN_ATTENTE') en_attente FROM demande_suggestion"
  );
  success(res, 'Statistiques générales.', { users, offers, applications, skills, domains, suggestions });
});

exports.pendingCompanies = asyncHandler(async (req, res) => {
  success(res, 'Entreprises en attente récupérées.', { items: await Company.findPending() });
});

exports.company = asyncHandler(async (req, res) => {
  const company = await Company.findById(req.params.id);
  return company ? success(res, 'Entreprise récupérée.', { company }) : fail(res, 'Entreprise introuvable.', [], 404);
});

exports.approveCompany = asyncHandler(async (req, res) => {
  const company = await Company.findById(req.params.id);
  if (!company) return fail(res, 'Entreprise introuvable.', [], 404);
  if (company.status !== 'pending') return fail(res, 'Cette demande a déjà été traitée.', [], 409);
  if (!company.id_utilisateur) return fail(res, 'Cette entreprise n’est liée à aucun utilisateur candidat.', [], 422);

  const approved = await Company.approve(req.params.id, req.user.id_utilisateur);
  await notify.create(approved.id_utilisateur, `Votre entreprise « ${approved.nom_entreprise} » a été approuvée. Vous êtes maintenant recruteur.`);
  success(res, 'Entreprise approuvée et utilisateur promu recruteur.');
});

exports.rejectCompany = asyncHandler(async (req, res) => {
  const company = await Company.findById(req.params.id);
  if (!company) return fail(res, 'Entreprise introuvable.', [], 404);
  if (company.status !== 'pending') return fail(res, 'Cette demande a déjà été traitée.', [], 409);
  if (!company.id_utilisateur) return fail(res, 'Cette entreprise n’est liée à aucun utilisateur candidat.', [], 422);

  await Company.reject(req.params.id, req.user.id_utilisateur);
  await notify.create(company.id_utilisateur, req.body.reason
    ? `Votre demande recruteur pour « ${company.nom_entreprise} » a été rejetée : ${req.body.reason}`
    : `Votre demande recruteur pour « ${company.nom_entreprise} » a été rejetée.`);
  success(res, 'Entreprise rejetée. Le rôle utilisateur reste candidat.');
});
