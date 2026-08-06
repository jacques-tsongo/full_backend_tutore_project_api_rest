const db = require('../config/database');
const Company = require('../models/company.model');
const User = require('../models/user.model');
const { success, fail } = require('../utils/apiResponse');
const asyncHandler = require('../utils/asyncHandler');
const notify = require('../services/notification.service');
exports.users = asyncHandler(async (req, res) => { 
    const [rows] = await db.execute('SELECT id_utilisateur, nom, prenom, email, telephone, role, date_inscription, statut_compte FROM utilisateur ORDER BY date_inscription DESC'); 
    success(res, 'Utilisateurs récupérés.', { items: rows }); 
});
exports.userStatus = asyncHandler(async (req, res) => { 
    if (!['actif','inactif','suspendu'].includes(req.body.statut_compte)) return fail(res, 'Statut invalide.', [], 422); 
    await db.execute('UPDATE utilisateur SET statut_compte=? WHERE id_utilisateur=?', [req.body.statut_compte, req.params.id]); 
    success(res, 'Statut utilisateur mis à jour.'); 
});
exports.stats = asyncHandler(async (req, res) => { 
    const [[users]] = await db.execute('SELECT COUNT(*) total, SUM(role=\'candidat\') candidats, SUM(role=\'recruteur\') recruteurs FROM utilisateur'); 
    const [[offers]] = await db.execute('SELECT COUNT(*) total, SUM(statut_offre=\'Ouverte\') ouvertes FROM offre_emploi'); 
    const [[applications]] = await db.execute('SELECT COUNT(*) total FROM candidature'); 
    success(res, 'Statistiques générales.', { users, offers, applications }); 
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
    if (!company.id_utilisateur) return fail(res, 'Cette entreprise n’est liée à aucun utilisateur candidat.', [], 422);

    const connection = await db.getConnection();
    try {
        await connection.beginTransaction();
        await Company.setStatus(company.id_entreprise, 'approved', req.user.id_utilisateur, connection);
        await User.updateRole(company.id_utilisateur, 'recruteur', connection);
        await connection.commit();
    } catch (error) {
        await connection.rollback();
        throw error;
    } finally {
        connection.release();
    }

    await notify.create(company.id_utilisateur, `Votre entreprise « ${company.nom_entreprise} » a été approuvée. Vous êtes maintenant recruteur.`);
    success(res, 'Entreprise approuvée et utilisateur promu recruteur.');
});

exports.rejectCompany = asyncHandler(async (req, res) => {
    const company = await Company.findById(req.params.id);
    if (!company) return fail(res, 'Entreprise introuvable.', [], 404);
    if (!company.id_utilisateur) return fail(res, 'Cette entreprise n’est liée à aucun utilisateur candidat.', [], 422);

    await Company.setStatus(company.id_entreprise, 'rejected', req.user.id_utilisateur);
    await notify.create(company.id_utilisateur, req.body.reason
        ? `Votre demande recruteur pour « ${company.nom_entreprise} » a été rejetée : ${req.body.reason}`
        : `Votre demande recruteur pour « ${company.nom_entreprise} » a été rejetée.`);
    success(res, 'Entreprise rejetée. Le rôle utilisateur reste candidat.');
});
