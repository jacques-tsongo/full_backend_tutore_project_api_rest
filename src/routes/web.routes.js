/**
 * Routes « pages » (rendu EJS) + actions de formulaires HTML.
 * Les actions POST enrobent les contrôleurs API existants (aucune logique
 * métier dupliquée) et appliquent le pattern Post/Redirect/Get avec flash.
 */
const router = require('express').Router();
const db = require('../config/database');

const page = require('../controllers/page.controller');
const auth = require('../controllers/auth.controller');
const profile = require('../controllers/profile.controller');
const offer = require('../controllers/offer.controller');
const job = require('../controllers/job.controller');
const company = require('../controllers/company.controller');
const resource = require('../controllers/resource.controller');
const message = require('../controllers/message.controller');
const notification = require('../controllers/notification.controller');
const admin = require('../controllers/admin.controller');
const suggestion = require('../controllers/suggestion.controller');

const { webAuth, webOptionalAuth, webAuthorize, COOKIE_NAME } = require('../middlewares/auth.middleware');
const { formPost } = require('../helpers/formPost');
const { flash } = require('../helpers/flash');
const { photoUpload, cvUpload, coverUpload, companyUpload } = require('../middlewares/upload.middleware');

/* ---------- Compteurs de navigation (badges Messages / Notifications) ---------- */
const loadNavCounts = async (req, res, next) => {
  if (!req.user) return next();
  try {
    // Messages reçus non lus (table message : id_destinataire = connecté, lu = 0).
    const [[msg]] = await db.execute('SELECT COUNT(*) AS total FROM message WHERE id_destinataire = ? AND lu = 0', [req.user.id_utilisateur]);
    // Notifications non lues (table notification : id_utilisateur = connecté).
    const [[notif]] = await db.execute("SELECT COUNT(*) AS total FROM notification WHERE id_utilisateur = ? AND statut_notification = 'Non lue'", [req.user.id_utilisateur]);
    res.locals.unreadMessages = msg.total;
    res.locals.unreadNotifications = notif.total;
    // Candidatures en attente d'examen (recruteur uniquement) : candidatures
    // « En attente » déposées sur les offres de SES entreprises. Le recruteur
    // doit encore prendre une décision : badge sur « Candidatures reçues ».
    if (req.user.role === 'recruteur') {
      const [[apps]] = await db.execute(
        `SELECT COUNT(*) AS total
         FROM candidature c
         JOIN offre_emploi o ON o.id_offre = c.id_offre
         JOIN entreprise e ON e.id_entreprise = o.id_entreprise
         WHERE e.id_utilisateur = ? AND c.statut_candidature = 'En attente'`,
        [req.user.id_utilisateur]
      );
      res.locals.pendingApplications = apps.total;
    }
    // Demandes de création d'entreprise en attente (administrateur uniquement) :
    // chaque entreprise au statut « pending » attend validation ou rejet.
    if (req.user.role === 'administrateur') {
      const [[comp]] = await db.execute("SELECT COUNT(*) AS total FROM entreprise WHERE status = 'pending'", []);
      const [[suggestions]] = await db.execute("SELECT COUNT(*) AS total FROM demande_suggestion WHERE statut = 'EN_ATTENTE'", []);
      res.locals.pendingCompanies = comp.total;
      res.locals.pendingSuggestions = suggestions.total;
    }
  } catch (_) {
    // En cas d'erreur ponctuelle, aucun badge ne doit bloquer la page.
    res.locals.unreadMessages = 0;
    res.locals.unreadNotifications = 0;
    res.locals.pendingApplications = 0;
    res.locals.pendingCompanies = 0;
    res.locals.pendingSuggestions = 0;
  }
  next();
};

const noCache = (req, res, next) => {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.set('Pragma', 'no-cache');
  res.set('Expires', '0');
  res.set('Surrogate-Control', 'no-store');
  next();
};

const authed = [webAuth, noCache, loadNavCounts];

/* ================================ Publiques =============================== */
router.get('/', webOptionalAuth, page.home);
router.get('/about', webOptionalAuth, page.about);
router.get('/contact', webOptionalAuth, page.contact);
// Formulaire de contact : accusé de réception immédiat (pas d'envoi d'e-mail réel).
router.post('/contact', (req, res) => {
  flash(res, 'success', 'Message envoyé. Notre équipe vous répondra par e-mail.');
  res.redirect('/contact');
});

router.get('/login', webOptionalAuth, page.loginPage);
router.post('/login', formPost(auth.login, { redirectTo: (req, payload) => page.dashboardPath(payload?.data?.user) }));
router.get('/register', webOptionalAuth, page.registerPage);
// Après la création du compte, le nouveau candidat est dirigé vers la page
// « Ajouter vos compétences » (choix multiples → « Suivant » ou « Ignorer »)
// avant d'atteindre son tableau de bord.
router.post('/register', formPost(auth.register, { redirectTo: (req, payload) => (payload?.success === false ? '/register' : '/competences') }));

// Déconnexion : invalide la session navigateur (cookie httpOnly supprimé).
router.post('/logout', (req, res) => {
  res.clearCookie(COOKIE_NAME, { path: '/' });
  res.redirect('/login');
});
// Compatibilité : un GET /logout historique redirige proprement vers la page de connexion.
router.get('/logout', (req, res) => {
  res.clearCookie(COOKIE_NAME, { path: '/' });
  res.redirect('/login');
});

/* ============================== Tableau de bord =========================== */
router.get('/dashboard', authed, page.dashboard);

/* ==================== Compétences (après inscription) ===================== */
// Page intermédiaire post-inscription : choix multiples + « Suivant » ou
// « Ignorer ». L'enregistrement réutilise l'API de liaison existante.
router.get('/competences', authed, webAuthorize('candidat', 'recruteur'), page.skillsOnboarding);
router.post('/competences', authed, webAuthorize('candidat', 'recruteur'), formPost(resource.addSkills, { redirectTo: '/dashboard' }));

/* ================================ Profil ================================== */
router.get('/profil', authed, webAuthorize('candidat', 'recruteur'), page.profile);
router.post('/profil', authed, webAuthorize('candidat', 'recruteur'), formPost(profile.upsert, { redirectTo: '/profil' }));
router.post('/profil/photo', authed, webAuthorize('candidat', 'recruteur'), photoUpload, formPost(profile.uploadPhoto, { redirectTo: '/profil' }));
router.post('/profil/couverture', authed, webAuthorize('candidat', 'recruteur'), coverUpload, formPost(profile.uploadCover, { redirectTo: '/profil' }));
router.post('/profil/cv', authed, webAuthorize('candidat', 'recruteur'), cvUpload, formPost(profile.uploadCv, { redirectTo: '/profil' }));
router.post('/profil/competences', authed, webAuthorize('candidat'), formPost(resource.addSkill, { redirectTo: '/profil' }));
router.post('/profil/competences/:id/supprimer', authed, webAuthorize('candidat'), formPost(resource.removeSkill, { redirectTo: '/profil' }));
router.post('/profil/experiences', authed, webAuthorize('candidat'), formPost(resource.create('experiences'), { redirectTo: '/profil' }));
router.post('/profil/experiences/:id/maj', authed, webAuthorize('candidat'), formPost(resource.update('experiences'), { redirectTo: '/profil' }));
router.post('/profil/experiences/:id/supprimer', authed, webAuthorize('candidat'), formPost(resource.remove('experiences'), { redirectTo: '/profil' }));
router.post('/profil/diplomes', authed, webAuthorize('candidat'), formPost(resource.create('diplomes'), { redirectTo: '/profil' }));
router.post('/profil/diplomes/:id/maj', authed, webAuthorize('candidat'), formPost(resource.update('diplomes'), { redirectTo: '/profil' }));
router.post('/profil/diplomes/:id/supprimer', authed, webAuthorize('candidat'), formPost(resource.remove('diplomes'), { redirectTo: '/profil' }));
// Langues du profil (relation N:N) : ajout / modification de niveau / retrait.
router.post('/profil/langues', authed, webAuthorize('candidat'), formPost(profile.addLanguage, { redirectTo: '/profil' }));
router.post('/profil/langues/:id/maj', authed, webAuthorize('candidat'), formPost(profile.updateLanguage, { redirectTo: '/profil' }));
router.post('/profil/langues/:id/supprimer', authed, webAuthorize('candidat'), formPost(profile.removeLanguage, { redirectTo: '/profil' }));

/* ================================ Offres ================================== */
router.get('/offres', authed, page.offers);
router.post('/offres', authed, webAuthorize('recruteur'), formPost(offer.create, { redirectTo: '/dashboard' }));
router.get('/offres/:id(\\d+)', authed, page.offerDetails);
router.post('/offres/:id(\\d+)', authed, webAuthorize('recruteur'), formPost(offer.update, { redirectTo: '/dashboard' }));
router.post('/offres/:id(\\d+)/supprimer', authed, webAuthorize('recruteur'), formPost(offer.remove, { redirectTo: '/dashboard' }));
// Compétences requises d'une offre : le recruteur ajoute/maj une compétence.
router.post('/offres/:id(\\d+)/competences', authed, webAuthorize('recruteur'), async (req, res, next) => {
  try {
    const [rows] = await db.execute('SELECT id_competence, niveau_requis FROM offre_competence WHERE id_offre = ?', [req.params.id]);
    const merged = new Map(rows.map((r) => [Number(r.id_competence), r.niveau_requis]));
    merged.set(Number(req.body.id_competence), req.body.niveau_requis);
    if (req.body.remove) merged.delete(Number(req.body.id_competence));
    req.body = { competences: Array.from(merged, ([id_competence, niveau_requis]) => ({ id_competence, niveau_requis })) };
    return formPost(job.setSkills, { redirectTo: '/dashboard' })(req, res, next);
  } catch (err) { return next(err); }
});
router.post('/offres/:id(\\d+)/postuler', authed, webAuthorize('candidat'), formPost(job.apply, { redirectTo: '/candidatures' }));

/* ============================== Candidatures ============================== */
router.get('/candidatures', authed, page.applications);
router.post('/candidatures/:id(\\d+)/statut', authed, webAuthorize('recruteur'), formPost(job.updateApplicationStatus, { redirectTo: '/candidatures' }));
router.post('/candidatures/:id(\\d+)/annuler', authed, webAuthorize('candidat'), formPost(job.cancel, { redirectTo: '/candidatures' }));

/* ================================ Matching ================================ */
router.get('/matching', authed, webAuthorize('candidat'), page.matching);

/* ================================ Messages ================================ */
router.get('/messages', authed, page.messages);
router.post('/messages', authed, formPost(message.send, { redirectTo: (req) => `/messages?dest=${req.body.id_destinataire}` }));

/* ============================= Notifications ============================== */
router.get('/notifications', authed, page.notifications);
router.post('/notifications/lire-toutes', authed, formPost(notification.readAll, { redirectTo: '/notifications' }));
router.post('/notifications/:id(\\d+)/lire', authed, formPost(notification.read, { redirectTo: '/notifications' }));
router.get('/notifications/:id(\\d+)/ouvrir', authed, notification.open);

/* ============================== Suggestions ============================== */
router.get('/suggestions', authed, webAuthorize('candidat', 'recruteur'), page.suggestions);
router.get('/suggestions/nouvelle', authed, webAuthorize('candidat', 'recruteur'), page.newSuggestion);
router.post('/suggestions', authed, webAuthorize('candidat', 'recruteur'), formPost(suggestion.create, {
  redirectTo: (req, payload) => payload?.success === false
    ? `/suggestions/nouvelle?type=${encodeURIComponent(req.body.type_demande || 'DOMAINE')}`
    : `/suggestions/${payload?.data?.item?.id_demande || ''}`
}));
router.get('/suggestions/:id(\\d+)', authed, webAuthorize('candidat', 'recruteur'), page.suggestionDetails);

/* ============================== Entreprises =============================== */
router.get('/entreprises', authed, page.companies);
router.get('/entreprise', authed, webAuthorize('recruteur'), page.myCompany);
router.post('/entreprise/:id(\\d+)', authed, webAuthorize('recruteur'), companyUpload, formPost(company.updateOwn, { redirectTo: '/entreprise' }));
router.get('/entreprise/demande', authed, webAuthorize('candidat'), page.companyRequest);
router.post('/entreprise/demande', authed, webAuthorize('candidat'), companyUpload, formPost(company.createRecruiter, { redirectTo: '/parametres' }));
router.get('/entreprises/:id(\\d+)', authed, page.companyDetails);

/* ============================== Paramètres ================================ */
router.get('/parametres', authed, page.settings);
router.post('/parametres', authed, formPost(auth.updateMe, { redirectTo: '/parametres' }));
router.post('/parametres/mot-de-passe', authed, formPost(auth.changePassword, { redirectTo: '/parametres' }));

/* ============================ Administration ============================== */
// Pages dédiées de l'espace admin : le dashboard ne contient plus les grands
// tableaux, ils vivent ici (GET) ; les actions conservent leurs routes POST.
router.get('/admin/utilisateurs', authed, webAuthorize('administrateur'), page.adminUsers);
router.get('/admin/competences', authed, webAuthorize('administrateur'), page.adminSkills);
router.get('/admin/domaines', authed, webAuthorize('administrateur'), page.adminDomains);
router.get('/admin/suggestions', authed, webAuthorize('administrateur'), page.adminSuggestions);
router.get('/admin/suggestions/:id(\\d+)', authed, webAuthorize('administrateur'), page.adminSuggestionDetails);
router.post('/admin/suggestions/:id(\\d+)/approuver', authed, webAuthorize('administrateur'), formPost(suggestion.approve, {
  redirectTo: (req) => `/admin/suggestions/${req.params.id}`
}));
router.post('/admin/suggestions/:id(\\d+)/refuser', authed, webAuthorize('administrateur'), formPost(suggestion.reject, {
  redirectTo: (req) => `/admin/suggestions/${req.params.id}`
}));
router.post('/admin/companies/:id(\\d+)/approve', authed, webAuthorize('administrateur'), formPost(admin.approveCompany, { redirectTo: '/dashboard' }));
router.post('/admin/companies/:id(\\d+)/reject', authed, webAuthorize('administrateur'), formPost(admin.rejectCompany, { redirectTo: '/dashboard' }));
router.post('/admin/utilisateurs/:id(\\d+)/statut', authed, webAuthorize('administrateur'), formPost(admin.userStatus, { redirectTo: '/admin/utilisateurs' }));
router.post('/admin/competences', authed, webAuthorize('administrateur'), formPost(resource.create('competences'), { redirectTo: '/admin/competences' }));
router.post('/admin/competences/:id(\\d+)/supprimer', authed, webAuthorize('administrateur'), formPost(resource.remove('competences'), { redirectTo: '/admin/competences' }));
// Classement d'une compétence historique dans un domaine (relation
// DOMAINE → COMPÉTENCE) : réutilise la mise à jour générique du catalogue.
router.post('/admin/competences/:id(\\d+)/domaine', authed, webAuthorize('administrateur'), formPost(resource.update('competences'), { redirectTo: '/admin/competences' }));
router.post('/admin/domaines', authed, webAuthorize('administrateur'), formPost(resource.create('domaines'), { redirectTo: '/admin/domaines' }));
router.post('/admin/domaines/:id(\\d+)/maj', authed, webAuthorize('administrateur'), formPost(resource.update('domaines'), { redirectTo: '/admin/domaines' }));
router.post('/admin/domaines/:id(\\d+)/supprimer', authed, webAuthorize('administrateur'), formPost(resource.remove('domaines'), { redirectTo: '/admin/domaines' }));

module.exports = router;
