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

const { webAuth, webOptionalAuth, webAuthorize, COOKIE_NAME } = require('../middlewares/auth.middleware');
const { formPost } = require('../helpers/formPost');
const { flash } = require('../helpers/flash');
const { photoUpload, cvUpload, companyUpload } = require('../middlewares/upload.middleware');

/* ---------- Compteurs de navigation (badges Messages / Notifications) ---------- */
const loadNavCounts = async (req, res, next) => {
  if (!req.user) return next();
  try {
    const [[msg]] = await db.execute('SELECT COUNT(*) AS total FROM message WHERE id_destinataire = ? AND lu = 0', [req.user.id_utilisateur]);
    const [[notif]] = await db.execute("SELECT COUNT(*) AS total FROM notification WHERE id_utilisateur = ? AND statut_notification = 'Non lue'", [req.user.id_utilisateur]);
    res.locals.unreadMessages = msg.total;
    res.locals.unreadNotifications = notif.total;
  } catch (_) {
    res.locals.unreadMessages = 0;
    res.locals.unreadNotifications = 0;
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
router.post('/register', formPost(auth.register, { redirectTo: () => '/dashboard' }));

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

/* ================================ Profil ================================== */
router.get('/profil', authed, webAuthorize('candidat', 'recruteur'), page.profile);
router.post('/profil', authed, webAuthorize('candidat', 'recruteur'), formPost(profile.upsert, { redirectTo: '/profil' }));
router.post('/profil/photo', authed, webAuthorize('candidat', 'recruteur'), photoUpload, formPost(profile.uploadPhoto, { redirectTo: '/profil' }));
router.post('/profil/cv', authed, webAuthorize('candidat', 'recruteur'), cvUpload, formPost(profile.uploadCv, { redirectTo: '/profil' }));
router.post('/profil/competences', authed, webAuthorize('candidat'), formPost(resource.addSkill, { redirectTo: '/profil' }));
router.post('/profil/competences/:id/supprimer', authed, webAuthorize('candidat'), formPost(resource.removeSkill, { redirectTo: '/profil' }));
router.post('/profil/experiences', authed, webAuthorize('candidat'), formPost(resource.create('experiences'), { redirectTo: '/profil' }));
router.post('/profil/experiences/:id/maj', authed, webAuthorize('candidat'), formPost(resource.update('experiences'), { redirectTo: '/profil' }));
router.post('/profil/experiences/:id/supprimer', authed, webAuthorize('candidat'), formPost(resource.remove('experiences'), { redirectTo: '/profil' }));
router.post('/profil/diplomes', authed, webAuthorize('candidat'), formPost(resource.create('diplomes'), { redirectTo: '/profil' }));
router.post('/profil/diplomes/:id/maj', authed, webAuthorize('candidat'), formPost(resource.update('diplomes'), { redirectTo: '/profil' }));
router.post('/profil/diplomes/:id/supprimer', authed, webAuthorize('candidat'), formPost(resource.remove('diplomes'), { redirectTo: '/profil' }));

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
router.post('/admin/companies/:id(\\d+)/approve', authed, webAuthorize('administrateur'), formPost(admin.approveCompany, { redirectTo: '/dashboard' }));
router.post('/admin/companies/:id(\\d+)/reject', authed, webAuthorize('administrateur'), formPost(admin.rejectCompany, { redirectTo: '/dashboard' }));
router.post('/admin/utilisateurs/:id(\\d+)/statut', authed, webAuthorize('administrateur'), formPost(admin.userStatus, { redirectTo: '/dashboard' }));
router.post('/admin/competences', authed, webAuthorize('administrateur'), formPost(resource.create('competences'), { redirectTo: '/dashboard' }));
router.post('/admin/competences/:id(\\d+)/supprimer', authed, webAuthorize('administrateur'), formPost(resource.remove('competences'), { redirectTo: '/dashboard' }));

module.exports = router;
