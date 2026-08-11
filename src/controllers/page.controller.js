/**
 * Contrôleur des pages EJS (rendu serveur).
 * Chaque handler agrège les données réelles (base de données via les modèles
 * et services existants) puis rend la vue correspondante. Aucune donnée
 * n'est codée en dur : les tableaux de bord, listes, compteurs et formulaires
 * reflètent l'état courant de la base.
 */
const db = require('../config/database');
const User = require('../models/user.model');
const Company = require('../models/company.model');
const matching = require('../services/matching.service');
const asyncHandler = require('../utils/asyncHandler');
const { collect } = require('../helpers/formPost');
const offerController = require('./offer.controller');
const jobController = require('./job.controller');
const resourceController = require('./resource.controller');
const messageController = require('./message.controller');
const notificationController = require('./notification.controller');
const adminController = require('./admin.controller');

const DASHBOARD_PATHS = {
  administrateur: '/dashboard',
  recruteur: '/dashboard',
  candidat: '/dashboard'
};
exports.dashboardPath = (user) => (user ? DASHBOARD_PATHS[user.role] || '/dashboard' : '/login');

/* ============================ Pages publiques ============================ */

exports.home = (req, res) => res.render('index', { title: 'LinkEmploi — Plateforme carrière', user: res.locals.user });
exports.about = (req, res) => res.render('about', { title: 'À propos', user: res.locals.user });
exports.contact = (req, res) => res.render('contact', { title: 'Contact', user: res.locals.user });

exports.loginPage = (req, res) => {
  if (res.locals.user) return res.redirect(exports.dashboardPath(res.locals.user));
  return res.render('login', { title: 'Connexion', user: null, query: req.query });
};
exports.registerPage = (req, res) => {
  if (res.locals.user) return res.redirect(exports.dashboardPath(res.locals.user));
  return res.render('register', { title: 'Inscription', user: null });
};

/* =========================== Tableau de bord ============================= */

exports.dashboard = asyncHandler(async (req, res) => {
  const user = req.user;
  const view = { title: 'Tableau de bord', user, stats: [], extra: {} };

  if (user.role === 'administrateur') {
    const { data } = await collect(adminController.stats, req);
    const { data: pending } = await collect(adminController.pendingCompanies, req);
    const { data: usersData } = await collect(adminController.users, req);
    const { data: skillsData } = await collect(resourceController.list('competences'), req);
    view.stats = [
      { label: 'Utilisateurs', value: data.users.total || 0, hint: `${data.users.candidats || 0} candidats · ${data.users.recruteurs || 0} recruteurs`, icon: 'users' },
      { label: 'Offres', value: data.offers.total || 0, hint: `${data.offers.ouvertes || 0} ouvertes`, icon: 'briefcase' },
      { label: 'Candidatures', value: data.applications.total || 0, hint: 'Total plateforme', icon: 'file-text' }
    ];
    view.extra = { pendingCompanies: pending.items || [], users: usersData.items || [], skills: skillsData.items || [] };
  } else if (user.role === 'recruteur') {
    const [apps, mine, company] = await Promise.all([
      collect(jobController.companyApplications, req).then((r) => r.data).catch(() => ({ items: [] })),
      collect(
        (rq, rs) => { rq.query = { ...rq.query, mine: '1', limit: '100' }; return offerController.list(rq, rs, () => {}); },
        req
      ).then((r) => r.data).catch(() => ({ items: [] })),
      Company.findApprovedByOwner(user.id_utilisateur)
    ]);
    const appItems = apps.items || [];
    const offerItems = mine.items || [];
    view.stats = [
      { label: 'Mes offres', value: offerItems.length, hint: 'Publiées', icon: 'briefcase' },
      { label: 'Candidatures reçues', value: appItems.length, hint: 'Depuis vos offres', icon: 'users' },
      { label: 'En attente', value: appItems.filter((a) => a.statut_candidature === 'En attente').length, hint: 'À examiner', icon: 'clock' }
    ];
    const [[skills]] = await Promise.all([
      db.execute('SELECT id_competence, nom_competence FROM competence ORDER BY nom_competence')
    ]);
    const [offerSkills] = await db.execute(
      `SELECT oc.id_offre, oc.id_competence, oc.niveau_requis, c.nom_competence
       FROM offre_competence oc JOIN competence c ON c.id_competence = oc.id_competence
       JOIN offre_emploi o ON o.id_offre = oc.id_offre
       WHERE o.id_entreprise = ?`,
      [company ? company.id_entreprise : 0]
    );
    view.extra = { offers: offerItems, skills: skills || [], offerSkills: offerSkills || [], company };
  } else {
    const { data } = await collect(jobController.myApplications, req).catch(() => ({ data: { items: [] } }));
    const items = data.items || [];
    view.stats = [
      { label: 'Mes candidatures', value: items.length, hint: 'Suivi actif', icon: 'file-text' },
      { label: 'En attente', value: items.filter((a) => a.statut_candidature === 'En attente').length, hint: 'En cours d’examen', icon: 'clock' },
      { label: 'Entretiens', value: items.filter((a) => a.statut_candidature === 'Entretien').length, hint: 'Programmés', icon: 'calendar' }
    ];
    view.extra = { applications: items.slice(0, 5) };
  }
  return res.render('dashboard', view);
});

/* ============================== Profil =================================== */

exports.profile = asyncHandler(async (req, res) => {
  const [profile] = await db.execute('SELECT * FROM profil_professionnel WHERE id_utilisateur = ?', [req.user.id_utilisateur]);
  const { data: mine } = await collect(resourceController.mySkills, req).catch(() => ({ data: { items: [] } }));
  const [catalog] = await db.execute('SELECT id_competence, nom_competence FROM competence ORDER BY nom_competence');
  const [experiences] = await db.execute('SELECT * FROM experience_professionnelle WHERE id_utilisateur = ? ORDER BY date_debut DESC', [req.user.id_utilisateur]);
  const [diplomes] = await db.execute('SELECT * FROM diplome WHERE id_utilisateur = ? ORDER BY annee_obtention DESC', [req.user.id_utilisateur]);
  res.render('profile', {
    title: 'Mon profil',
    user: req.user,
    profile: profile[0] || null,
    mySkills: mine.items || [],
    catalog: catalog || [],
    experiences: experiences || [],
    diplomes: diplomes || []
  });
});

/* =============================== Offres ================================== */

exports.offers = asyncHandler(async (req, res) => {
  req.query.limit = req.query.limit || '10';
  const { data } = await collect(offerController.list, req);
  const { data: mine } = req.user.role === 'candidat'
    ? await collect(jobController.myApplications, req).catch(() => ({ data: { items: [] } }))
    : { data: { items: [] } };
  const appliedIds = new Set((mine.items || []).map((a) => Number(a.id_offre)));
  res.render('offers', {
    title: 'Offres d’emploi',
    user: req.user,
    items: data.items || [],
    pagination: data.pagination,
    appliedIds,
    q: req.query.q || '',
    statut: req.query.statut || ''
  });
});

exports.offerDetails = asyncHandler(async (req, res) => {
  const { data } = await collect(offerController.get, req);
  const item = data.item;
  const view = { title: item.titre_offre, user: req.user, item, alreadyApplied: false, matching: null, isOwner: false };
  if (req.user.role === 'candidat') {
    const [app] = await db.execute('SELECT id_candidature FROM candidature WHERE id_utilisateur = ? AND id_offre = ?', [req.user.id_utilisateur, req.params.id]);
    view.alreadyApplied = !!app[0];
    view.matching = await matching.calculate(req.user.id_utilisateur, req.params.id);
  }
  view.isOwner = req.user.role === 'recruteur' && Number(item.id_recruteur) === Number(req.user.id_utilisateur);
  res.render('offer-details', view);
});

/* ============================ Candidatures =============================== */

exports.applications = asyncHandler(async (req, res) => {
  const isSPA = req.headers['x-spa-content'] === '1';
  if (req.user.role === 'recruteur') {
    const { data } = await collect(jobController.companyApplications, req).catch(() => ({ data: { items: [] } }));
    if (isSPA) return res.render('partials/content/applications-received-content', { title: 'Candidatures reçues', user: req.user, items: data.items || [] });
    return res.render('applications-received', { title: 'Candidatures reçues', user: req.user, items: data.items || [] });
  }
  const { data } = await collect(jobController.myApplications, req).catch(() => ({ data: { items: [] } }));
  if (isSPA) return res.render('partials/content/applications-content', { title: 'Mes candidatures', user: req.user, items: data.items || [] });
  return res.render('applications', { title: 'Mes candidatures', user: req.user, items: data.items || [] });
});

/* ============================== Matching ================================= */

exports.matching = asyncHandler(async (req, res) => {
  req.query.limit = '100';
  const { data } = await collect(offerController.list, req);
  const selectedId = Number(req.query.id_offre || 0) || null;
  const score = selectedId ? await matching.calculate(req.user.id_utilisateur, selectedId) : null;
  res.render('matching', {
    title: 'Matching',
    user: req.user,
    items: (data.items || []).filter((o) => o.statut_offre === 'Ouverte'),
    selectedId,
    score
  });
});

/* ============================== Messages ================================= */

exports.messages = asyncHandler(async (req, res) => {
  const { data: convs } = await collect(messageController.conversations, req);
  const { data: contactsData } = await collect(messageController.contacts, req).catch(() => ({ data: { items: [] } }));
  const dest = Number(req.query.dest || 0) || null;
  let thread = null;
  let threadUser = null;
  if (dest) {
    // L'API `conversation` peut renvoyer 404 si le destinataire est introuvable
    // ou n'est pas un contact légitime de l'utilisateur — on retombe alors
    // sur la liste des conversations au lieu d'afficher une page d'erreur.
    try {
      req.params.userId = String(dest);
      const { data: conv } = await collect(messageController.conversation, req);
      thread = conv.items || [];
      threadUser = (contactsData.items || []).find((c) => Number(c.id_utilisateur) === dest)
        || (convs.items || []).find((c) => Number(c.id_utilisateur) === dest)
        || (await User.findById(dest));
      // Le fil vient d'être marqué lu : recalcule le badge de navigation pour CE rendu.
      const [[{ total }]] = await db.execute(
        'SELECT COUNT(*) AS total FROM message WHERE id_destinataire = ? AND lu = 0',
        [req.user.id_utilisateur]
      );
      res.locals.unreadMessages = total;
    } catch (err) {
      // Destinataire inexistant / hors conversation : on retourne à la liste.
      return res.redirect('/messages');
    }
  }
  res.render('messages', {
    title: 'Messages',
    user: req.user,
    conversations: convs.items || [],
    contacts: contactsData.items || [],
    thread,
    threadUser,
    dest
  });
});

/* ============================ Notifications ============================== */

exports.notifications = asyncHandler(async (req, res) => {
  const { data } = await collect(notificationController.list, req);
  res.render('notifications', { title: 'Notifications', user: req.user, items: data.items || [] });
});

/* ============================= Entreprises =============================== */

exports.companies = asyncHandler(async (req, res) => {
  const { data } = await collect(resourceController.list('entreprises'), req);
  res.render('companies', { title: 'Entreprises', user: req.user, items: data.items || [] });
});

exports.companyDetails = asyncHandler(async (req, res) => {
  const { data } = await collect(
    (rq, rs) => { rq.params.name = 'entreprises'; return resourceController.get('entreprises')(rq, rs, () => {}); },
    req
  );
  res.render('company-details', { title: data.item.nom_entreprise, user: req.user, item: data.item });
});

/** Gestion de SON entreprise (recruteur : uniquement approuvée). */
exports.myCompany = asyncHandler(async (req, res) => {
  const company = await Company.findApprovedByOwner(req.user.id_utilisateur);
  if (!company) {
    return res.render('company-manage', { title: 'Mon entreprise', user: req.user, company: null });
  }
  return res.render('company-manage', { title: 'Mon entreprise', user: req.user, company });
});

/** Demande de création d'entreprise (candidat) — consultable depuis les paramètres. */
exports.companyRequest = asyncHandler(async (req, res) => {
  const companies = await Company.findByOwner(req.user.id_utilisateur);
  const current = companies[0] || null;
  const block = current && ['pending', 'approved'].includes(current.status);
  res.render('company-request', { title: 'Demande recruteur', user: req.user, current, block });
});

/* ============================= Paramètres ================================ */

exports.settings = asyncHandler(async (req, res) => {
  const companies = await Company.findByOwner(req.user.id_utilisateur);
  res.render('settings', {
    title: 'Paramètres',
    user: req.user,
    company: companies[0] || null
  });
});

/* ============================== Erreurs ================================== */

exports.notFoundPage = (req, res) => res.status(404).render('404', { title: 'Page introuvable', user: res.locals.user || null });
