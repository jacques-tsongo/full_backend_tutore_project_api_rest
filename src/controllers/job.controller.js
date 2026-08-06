const db = require('../config/database');
const { success, fail } = require('../utils/apiResponse');
const asyncHandler = require('../utils/asyncHandler');
const matching = require('../services/matching.service');
const notify = require('../services/notification.service');
const Company = require('../models/company.model');

const recruiterCompany = (userId) => Company.findApprovedByOwner(userId);

exports.setSkills = asyncHandler(async (req, res) => {
  const company = await recruiterCompany(req.user.id_utilisateur);
  if (!company || company.status !== 'approved') return fail(res, 'Entreprise approuvée et profil recruteur requis.', [], 403);
  const [offer] = await db.execute('SELECT id_offre FROM offre_emploi WHERE id_offre=? AND id_entreprise=?', [req.params.id, company.id_entreprise]);
  if (!offer[0]) return fail(res, 'Offre introuvable.', [], 404);
  await db.execute('DELETE FROM offre_competence WHERE id_offre = ?', [req.params.id]);
  for (const skill of req.body.competences || []) {
    await db.execute('INSERT INTO offre_competence (id_offre, id_competence, niveau_requis) VALUES (?, ?, ?)', [req.params.id, skill.id_competence, skill.niveau_requis]);
  }
  success(res, 'Compétences requises mises à jour.');
});

exports.apply = asyncHandler(async (req, res) => {
  const id = req.params.id;
  const [offer] = await db.execute("SELECT * FROM offre_emploi WHERE id_offre=? AND statut_offre='Ouverte' AND date_expiration >= CURDATE()", [id]);
  if (!offer[0]) return fail(res, 'Offre indisponible.', [], 404);
  const lettre = req.body.lettre_motivation ?? req.body.lettreMotivation ?? null;
  const [r] = await db.execute(
    'INSERT INTO candidature (id_utilisateur, id_offre, lettre_motivation) VALUES (?, ?, ?)',
    [req.user.id_utilisateur, id, lettre]
  );
  const score = await matching.calculate(req.user.id_utilisateur, id);
  const [recruiters] = await db.execute("SELECT id_utilisateur FROM entreprise WHERE id_entreprise = ? AND status = 'approved'", [offer[0].id_entreprise]);
  await Promise.all(recruiters.map((x) => notify.create(x.id_utilisateur, `Nouvelle candidature pour « ${offer[0].titre_offre} ».`)));
  success(res, 'Candidature envoyée.', { id_candidature: r.insertId, matching: score }, 201);
});

exports.myApplications = asyncHandler(async (req, res) => {
  const [rows] = await db.execute(
    `SELECT c.*, o.titre_offre, o.localisation, o.statut_offre, o.date_expiration,
            e.nom_entreprise, e.logo AS logo_entreprise, e.id_utilisateur AS id_recruteur, m.score_compatibilite
     FROM candidature c
     JOIN offre_emploi o ON o.id_offre = c.id_offre
     JOIN entreprise e ON e.id_entreprise = o.id_entreprise
     LEFT JOIN matching m ON m.id_utilisateur = c.id_utilisateur AND m.id_offre = c.id_offre
     WHERE c.id_utilisateur = ?
     ORDER BY c.date_candidature DESC`,
    [req.user.id_utilisateur]
  );
  success(res, 'Mes candidatures.', { items: rows });
});

exports.cancel = asyncHandler(async (req, res) => {
  const [r] = await db.execute(
    "UPDATE candidature SET statut_candidature='Annulée' WHERE id_candidature=? AND id_utilisateur=? AND statut_candidature='En attente'",
    [req.params.id, req.user.id_utilisateur]
  );
  if (!r.affectedRows) return fail(res, 'Candidature non annulable.', [], 400);
  success(res, 'Candidature annulée.');
});

exports.companyApplications = asyncHandler(async (req, res) => {
  const company = await recruiterCompany(req.user.id_utilisateur);
  if (!company || company.status !== 'approved') return fail(res, 'Entreprise approuvée et profil recruteur requis.', [], 403);
  const [rows] = await db.execute(
    `SELECT c.*, u.nom, u.prenom, u.email, u.telephone, u.photo, p.cv, p.bio,
            o.titre_offre, o.localisation, m.score_compatibilite,
            (SELECT GROUP_CONCAT(CONCAT(comp.nom_competence, ' (', uc.niveau_competence, ')') SEPARATOR ', ')
             FROM utilisateur_competence uc JOIN competence comp ON comp.id_competence = uc.id_competence
             WHERE uc.id_utilisateur = c.id_utilisateur) AS competences
     FROM candidature c
     JOIN offre_emploi o ON o.id_offre = c.id_offre
     JOIN utilisateur u ON u.id_utilisateur = c.id_utilisateur
     LEFT JOIN profil_professionnel p ON p.id_utilisateur = c.id_utilisateur
     LEFT JOIN matching m ON m.id_utilisateur = c.id_utilisateur AND m.id_offre = c.id_offre
     WHERE o.id_entreprise = ?
     ORDER BY c.date_candidature DESC`,
    [company.id_entreprise]
  );
  success(res, 'Candidatures reçues.', { items: rows });
});

exports.updateApplicationStatus = asyncHandler(async (req, res) => {
  const company = await recruiterCompany(req.user.id_utilisateur);
  const allowed = ['En attente', 'Présélectionnée', 'Entretien', 'Acceptée', 'Refusée'];
  const statut = req.body.statut_candidature ?? req.body.statut;
  if (!company || company.status !== 'approved' || !allowed.includes(statut)) return fail(res, 'Action invalide.', [], 422);
  const [rows] = await db.execute(
    'SELECT c.id_utilisateur, o.titre_offre FROM candidature c JOIN offre_emploi o ON o.id_offre=c.id_offre WHERE c.id_candidature=? AND o.id_entreprise=?',
    [req.params.id, company.id_entreprise]
  );
  if (!rows[0]) return fail(res, 'Candidature introuvable.', [], 404);
  await db.execute('UPDATE candidature SET statut_candidature=? WHERE id_candidature=?', [statut, req.params.id]);
  await notify.create(rows[0].id_utilisateur, `Votre candidature pour « ${rows[0].titre_offre} » est maintenant : ${statut}.`);
  success(res, 'Statut de candidature mis à jour.');
});

exports.matchOffer = asyncHandler(async (req, res) => {
  success(res, 'Score de compatibilité calculé.', { matching: await matching.calculate(req.user.id_utilisateur, req.params.id) });
});
