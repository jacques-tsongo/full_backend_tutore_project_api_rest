/**
 * Test de fumée des pages EJS (rendu serveur) — n'utilise que l'HTTP réel.
 * Prérequis : serveur démarré (PORT 5000) + base initialisée
 * (database/schema.sql + database/migrations/*.sql + database/seed.sql).
 *
 * Couverture : pages publiques, protections, session cookie httpOnly,
 * navigation par rôle, compteurs non lus (messages + notifications),
 * workflows entreprise (demande → approbation → gestion), offres,
 * candidatures, paramètres (infos, mot de passe), déconnexion, erreurs.
 *
 * Exécution : node test/frontend-smoke.js
 */
const BASE = `http://127.0.0.1:${process.env.PORT || 5000}`;
const results = [];
const step = (name, ok, detail = '') => {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  → ' + detail : ''}`);
};

/** Mini-client HTTP avec jar à cookies (simule un navigateur). */
const browser = () => {
  const cookies = new Map();
  const cookieHeader = () => Array.from(cookies, ([k, v]) => `${k}=${v}`).join('; ');
  const store = (setCookies) => {
    for (const sc of setCookies) {
      const [pair] = sc.split(';');
      const eq = pair.indexOf('=');
      const name = pair.slice(0, eq).trim();
      const value = pair.slice(eq + 1).trim();
      if (value === '' || /max-age=0/i.test(sc)) cookies.delete(name);
      else cookies.set(name, value);
    }
  };
  const call = async (method, path, { form, headers = {}, redirect = 'manual', body, multipart } = {}) => {
    const opts = { method, redirect, headers: { ...headers } };
    if (cookies.size) opts.headers.cookie = cookieHeader();
    if (multipart instanceof FormData) opts.body = multipart;
    else if (form) {
      opts.headers['content-type'] = 'application/x-www-form-urlencoded';
      opts.body = new URLSearchParams(form).toString();
    } else if (body !== undefined) {
      opts.headers['content-type'] = 'application/json';
      opts.body = JSON.stringify(body);
    }
    const res = await fetch(`${BASE}${path}`, opts);
    store(res.headers.getSetCookie ? res.headers.getSetCookie() : []);
    const text = await res.text();
    return { status: res.status, location: res.headers.get('location'), text, json: () => { try { return JSON.parse(text); } catch (_) { return null; } } };
  };
  return {
    get: (path, opts = {}) => call('GET', path, opts),
    post: (path, opts = {}) => call('POST', path, opts),
    has: (name) => cookies.has(name),
    value: (name) => cookies.get(name)
  };
};

const freshId = () => Math.random().toString(36).slice(2, 8);

const run = async () => {
  /* ---------- 1. Pages publiques & protection ---------- */
  for (const p of ['/', '/login', '/register', '/about', '/contact']) {
    const r = await browser().get(p);
    step(`GET ${p} (public)`, r.status === 200 && r.text.includes('LinkEmploi'));
  }
  const guest = browser();
  for (const p of ['/dashboard', '/offres', '/parametres', '/messages']) {
    const r = await guest.get(p);
    step(`GET ${p} sans session → login`, r.status === 302 && r.location.includes('/login'));
  }
  const legacy = await guest.get('/jobs.html');
  step('Legacy /jobs.html → 301 /offres', legacy.status === 301 && legacy.location.includes('/offres'));
  const notFound = await guest.get('/page-inexistante');
  step('404 rendue en HTML', notFound.status === 404 && notFound.text.includes('Page introuvable'));

  /* ---------- 2. Inscription & session ---------- */
  const candidate = browser();
  const email = `smoke.candidat.${freshId()}@example.com`;
  const register = await candidate.post('/register', { form: { nom: 'Smoke', prenom: 'Testeur', email, mot_de_passe: 'Secret123!', telephone: '+2438000000' } });
  step('POST /register → 302 /competences + cookie httpOnly', register.status === 302 && register.location.includes('/competences') && candidate.has('gc_token'));
  const onboard = await candidate.get('/competences');
  step('Page compétences post-inscription rendue (SSR)', onboard.status === 200 && onboard.text.includes('Ajouter vos compétences') && onboard.text.includes('skills-onboarding-form'));
  const skip = await candidate.post('/competences', { form: {} });
  step('« Ignorer » (POST /competences sans choix) → /dashboard', skip.status === 302 && skip.location.includes('/dashboard'));
  const authedHome = await candidate.get('/login');
  step('Session persistante : /login redirige vers /dashboard', authedHome.status === 302 && authedHome.location.includes('/dashboard'));
  const dashCandidate = await candidate.get('/dashboard');
  step('Dashboard candidat rendu (SSR)', dashCandidate.status === 200 && dashCandidate.text.includes('Suivi de vos') && dashCandidate.text.includes('Testeur Smoke'));
  step('Nav candidat : liens rôle (Pas d’administration)', dashCandidate.text.includes('/profil') && dashCandidate.text.includes('/matching') && !dashCandidate.text.includes('Nouvelle compétence'));
  step('Nav sans « devenir recruteur » permanent', !dashCandidate.text.includes('/entreprise/demande'));
  step('Badges non lus cachés quand 0', dashCandidate.text.includes('count hidden" data-count="unread-messages"') && dashCandidate.text.includes('count hidden" data-count="unread-notifications"'));

  /* ---------- 3. Paramètres : infos personnelles + mot de passe ---------- */
  const updInfo = await candidate.post('/parametres', { form: { prenom: 'Smoke', nom: 'Testeur', telephone: '+2439999999' } });
  const setPage = await candidate.get('/parametres');
  step('Paramètres : mise à jour téléphone', updInfo.status === 302 && setPage.text.includes('+2439999999'));
  const badPass = await candidate.post('/parametres/mot-de-passe', { form: { mot_de_passe_actuel: 'WrongPass1!', nouveau_mot_de_passe: 'NouveauSecret123!' } });
  step('Mot de passe : mauvais actuel → redirect + flash erreur', badPass.status === 302 && candidate.value('gc_flash')?.includes('danger'));
  const goodPass = await candidate.post('/parametres/mot-de-passe', { form: { mot_de_passe_actuel: 'Secret123!', nouveau_mot_de_passe: 'NouveauSecret123!' } });
  const relog = browser();
  const relogRes = await relog.post('/login', { form: { email, mot_de_passe: 'NouveauSecret123!' } });
  step('Mot de passe : changement effectif', goodPass.status === 302 && relogRes.status === 302 && relog.has('gc_token'));

  /* ---------- 4. Profil candidat (bio, compétences, expérience, diplôme) ---------- */
  // Les ids de compétences ne sont pas stables d'une base à l'autre (le seed
  // n'impose pas d'auto-increment) : on les résout via la page de sélection
  // post-inscription dont le rendu SSR inclut le catalogue complet.
  const onboardPage = await candidate.get('/competences');
  const catById = new Map();
  const catRe = /data-skill-id="(\d+)" aria-pressed="(?:true|false)">[\s\S]*?<span>([^<]+)<\/span>/g;
  let cm;
  while ((cm = catRe.exec(onboardPage.text))) catById.set(cm[2].trim(), Number(cm[1]));
  const cid = (name) => catById.get(name);
  const skillJs = cid('JavaScript');
  const skillNode = cid('Node.js');
  step('Catalogue de compétences résolu (page SSR)', catById.size > 0 && !!skillJs && !!skillNode, `js=${skillJs} node=${skillNode} total=${catById.size}`);
  const profilForm = await candidate.post('/profil', { form: { bio: 'Profil de test fumée', adresse: 'Kinshasa', date_naissance: '1996-01-01', lieu_naissance: 'Goma' } });
  const profilPage = await candidate.get('/profil');
  step('Profil : bio enregistrée (SSR)', profilForm.status === 302 && profilPage.text.includes('Profil de test fumée'));
  const skillAdd = await candidate.post('/profil/competences', { form: { id_competence: String(skillJs), niveau_competence: 'Avancé' } });
  const profilPage2 = await candidate.get('/profil');
  step('Profil : compétence associée', skillAdd.status === 302 && profilPage2.text.includes('JavaScript'));
  const xpAdd = await candidate.post('/profil/experiences', { form: { poste: 'Dev', entreprise: 'ACME', date_debut: '2020-01-01', description: 'Stage' } });
  const dipAdd = await candidate.post('/profil/diplomes', { form: { intitule: 'Licence Info', etablissement: 'Unikin', annee_obtention: '2019' } });
  const profilPage3 = await candidate.get('/profil');
  step('Profil : expérience + diplôme', xpAdd.status === 302 && dipAdd.status === 302 && profilPage3.text.includes('Dev') && profilPage3.text.includes('Licence Info'));

  /* ---------- 5. Demande recruteur → approbation admin → gestion ---------- */
  const fd = new FormData();
  const companyName = `Smoke Corp ${freshId()}`;
  fd.append('nom_entreprise', companyName);
  fd.append('secteur_activite', 'Informatique');
  fd.append('adresse', '1 Av. Test');
  fd.append('ville', 'Kinshasa');
  fd.append('pays', 'RDC');
  fd.append('telephone', '+2438100000');
  fd.append('email', `smokecorp${freshId()}@example.com`);
  fd.append('numero_rccm', 'RCCM/SMOKE/001');
  fd.append('numero_fiscal', 'FISC-001');
  fd.append('description', 'Entreprise de test fumée.');
  fd.append('supporting_documents', new Blob(['%PDF-1.4 fake'], { type: 'application/pdf' }), 'justif.pdf');
  const request = await candidate.post('/entreprise/demande', { multipart: fd });
  const settings = await candidate.get('/parametres');
  step('Demande entreprise soumise → statut « en attente » dans paramètres', request.status === 302 && settings.text.includes('en attente de validation'));

  // L'annuaire ne montre pas l'entreprise en attente aux non-admins
  const annuaire = await candidate.get('/entreprises');
  step('Annuaire : entreprise en attente masquée aux candidats', !annuaire.text.includes(companyName));

  // API entreprises/mine donne la demande
  const mineApi = await candidate.get('/api/entreprises/mine');
  const mineJson = mineApi.json();
  const myCompanyId = mineJson?.data?.items?.[0]?.id_entreprise;
  step('API /api/entreprises/mine (pending)', mineApi.status === 200 && !!myCompanyId);

  // Approbation par l'administrateur (compte seedé)
  const admin = browser();
  await admin.post('/login', { form: { email: 'admin@example.com', mot_de_passe: 'Admin123!' } });
  const adminDash = await admin.get('/dashboard');
  step('Dashboard admin : demande en attente visible', adminDash.text.includes(companyName));
  const approve = await admin.post(`/admin/companies/${myCompanyId}/approve`, { form: {} });
  step('Admin approuve la demande', approve.status === 302);

  const dashAfter = await candidate.get('/dashboard');
  step('Utilisateur promu recruteur (dashboard recruteur)', dashAfter.text.includes('Nouvelle offre'));
  const manage = await candidate.get('/entreprise');
  step('Gestion entreprise : page accessible', manage.status === 200 && manage.text.includes(companyName));
  const logical = await candidate.post(`/entreprise/${myCompanyId}`, { form: { nom_entreprise: companyName, description: 'Description mise à jour', adresse: '2 Av. Nouvelle', ville: 'Kinshasa', pays: 'RDC', telephone: '+2438100000', email: `smokecorp@example.com` } });
  const manage2 = await candidate.get('/entreprise');
  step('Recruteur modifie SA société (description/adr)', logical.status === 302 && manage2.text.includes('Description mise à jour'));
  // Le recruteur ne peut PAS modifier l'entreprise d'un autre (seed : id 1 = Tech Solutions)
  const otherResp = await fetch(`${BASE}/api/entreprises/1`, { method: 'PUT', headers: { 'content-type': 'application/json', cookie: `gc_token=${candidate.value('gc_token')}` }, body: JSON.stringify({ nom_entreprise: 'Piratage SARL' }) });
  step('Interdiction de modifier l’entreprise d’un autre (403)', otherResp.status === 403);

  /* ---------- 6. Offres : création → publication → candidature ---------- */
  const deadline = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);
  const offerTitle = `Offre Smoke ${freshId()}`;
  const create = await candidate.post('/offres', { form: { titre_offre: offerTitle, description_offre: 'Description offre smoke', localisation: 'Kinshasa', salaire: '1500', date_expiration: deadline } });
  step('Recruteur publie une offre', create.status === 302);
  const listRec = await candidate.get('/offres');
  step('Offre visible dans /offres (recruteur)', listRec.text.includes(offerTitle));
  const pastDate = await candidate.post('/offres', { form: { titre_offre: 'Old', description_offre: 'x', localisation: 'kin', date_expiration: '2000-01-01' } });
  step('Validation : date passée refusée (flash erreur)', pastDate.status === 302 && candidate.value('gc_flash')?.includes('danger'));

  // Identifiant de l'offre nouvellement créée via API (cookie authentifié)
  const offersApi = await candidate.get('/api/offres?mine=1&limit=100');
  const myOffer = offersApi.json()?.data?.items?.find((o) => o.titre_offre === offerTitle);
  step('Offre retrouvée via API', !!myOffer);
  const setSkill = await candidate.post(`/offres/${myOffer.id_offre}/competences`, { form: { id_competence: String(skillNode), niveau_requis: 'Avancé' } });
  const offerPage = await candidate.get(`/offres/${myOffer.id_offre}`);
  step('Compétence requise ajoutée à l’offre', setSkill.status === 302 && offerPage.text.includes('Node.js'));

  /* ---------- 7. Candidature (candidat fraîchement créé, autonome) ---------- */
  // NB : le compte seedé candidat@example.com peut avoir été promu « recruteur »
  // par des runs précédents (validation d'entreprise) — on crée donc notre propre
  // candidat pour que le scénario reste rejouable quelle que soit la base.
  const seeker = browser();
  await seeker.post('/register', { form: { nom: 'Candi', prenom: 'Seeker', email: `smoke.seeker.${freshId()}@example.com`, mot_de_passe: 'Secret123!', telephone: '+2438000002' } });
  await seeker.post('/competences', { form: {} });
  // Compétence alignée sur l'offre : garantit sa visibilité dans la liste
  // filtrée par compétences (fonctionnalité « offres adaptées au profil »).
  await seeker.post('/profil/competences', { form: { id_competence: String(skillNode), niveau_competence: 'Avancé' } });
  const seekerOfferPage = await seeker.get(`/offres/${myOffer.id_offre}`);
  const already = seekerOfferPage.text.includes('Envoyer ma candidature');
  step('Candidat : formulaire de candidature affiché', already);
  const apply = await seeker.post(`/offres/${myOffer.id_offre}/postuler`, { form: { lettre_motivation: 'Je suis très motivé.' } });
  const myApps = await seeker.get('/candidatures');
  step('Candidature enregistrée et affichée', apply.status === 302 && myApps.text.includes(offerTitle) && myApps.text.includes('En attente'));
  const dup = await seeker.post(`/offres/${myOffer.id_offre}/postuler`, { form: { lettre_motivation: 'encore' } });
  step('Double candidature bloquée (flash erreur)', dup.status === 302 && seeker.value('gc_flash')?.includes('danger'));

  // Le recruteur voit la candidature et la REFUSE (décision finale : aucun
  // état intermédiaire n'est plus positionnable — seul Accepter/Refuser).
  const received = await candidate.get('/candidatures');
  step('Recruteur : candidature reçue affichée', received.text.includes('Smoke') || received.text.includes('candidat'));
  const appsApi = await candidate.get('/api/candidatures/recues');
  const appRow = appsApi.json()?.data?.items?.find((a) => a.id_offre === myOffer.id_offre);
  const statusRejected = await candidate.post(`/candidatures/${appRow.id_candidature}/statut`, { form: { statut_candidature: 'Refusée' } });
  const seekerApps = await seeker.get('/candidatures');
  step('Refus enregistré et visible côté candidat', statusRejected.status === 302 && seekerApps.text.includes('Refusée'));
  const cancel = await seeker.post(`/candidatures/${appRow.id_candidature}/annuler`, { form: {} });
  step('Annulation impossible après décision finale (flash erreur)', seeker.value('gc_flash')?.includes('danger'));

  /* ---------- 8. Compteurs non lus (messages + notifications) ---------- */
  const notifCountApi = await seeker.get('/api/notifications/non-lues');
  step('API /api/notifications/non-lues', notifCountApi.status === 200 && notifCountApi.json()?.data?.total >= 1, `total=${notifCountApi.json()?.data?.total}`);
  const seekerNotifs = await seeker.get('/notifications');
  step('Badge notifications SSR > 0', !seekerNotifs.text.includes('count hidden" data-count="unread-notifications"'));
  const readAll = await seeker.post('/notifications/lire-toutes', { form: {} });
  const seekerNotifs2 = await seeker.get('/notifications');
  step('« Tout marquer lu » remet le badge à 0', readAll.status === 302 && seekerNotifs2.text.includes('count hidden" data-count="unread-notifications"'));

  // Message recruteur → candidat : le compteur monte puis redescend à la lecture
  const send = await candidate.post('/messages', { form: { id_destinataire: String(appRow.id_utilisateur), contenu: 'Bonjour, entretien demain 10h.' } });
  const unreadApi = await seeker.get('/api/messages/non-lus');
  step('Message non lu compté côté destinataire', send.status === 302 && unreadApi.json()?.data?.total >= 1, `total=${unreadApi.json()?.data?.total}`);
  const seekerMsgs = await seeker.get('/messages');
  step('Badge messages SSR > 0 (badge visible)', !seekerMsgs.text.includes('count hidden" data-count="unread-messages"'));
  const convsJson = (await (await fetch(`${BASE}/api/messages`, { headers: { cookie: `gc_token=${seeker.value('gc_token')}` } })).json())?.data?.items || [];
  // Lecture de chaque fil (le seed ajoute un message non lu d'un autre contact) :
  // après ouverture de toutes les conversations, plus aucun message non lu.
  let allOpened = convsJson.length > 0;
  for (const conv of convsJson) {
    const openThread = await seeker.get(`/messages?dest=${conv.id_utilisateur}`);
    allOpened = allOpened && openThread.status === 200;
  }
  const unreadAfter = await seeker.get('/api/messages/non-lus');
  step('Lecture des fils : compteur retombe à 0', allOpened && unreadAfter.json()?.data?.total === 0, `total=${unreadAfter.json()?.data?.total} fils=${convsJson.length}`);

  /* ---------- 9. Matching (cartes avec bouton de calcul par offre) ---------- */
  const matchPage = await seeker.get(`/matching`);
  step('Matching : grille de cartes + boutons de compatibilité', matchPage.status === 200 && matchPage.text.includes('data-match-grid') && matchPage.text.includes('Calculer la compatibilité') && matchPage.text.includes(myOffer.id_offre));
  const matchForbidden = await candidate.get('/matching');
  step('Matching interdit au recruteur (403 page)', matchForbidden.status === 403);

  /* ---------- 10. Déconnexion ---------- */
  const logout = await seeker.post('/logout', { form: {} });
  const afterLogout = await seeker.get('/dashboard');
  step('Déconnexion : cookie invalidé, /dashboard → /login', logout.status === 302 && !seeker.has('gc_token') && afterLogout.status === 302);

  /* ---------- 11. Erreurs serveur masquées ---------- */
  const badId = await candidate.get('/offres/abc');
  step('ID invalide → page 404 propre', badId.status === 404 && badId.text.includes('Page introuvable'));
  const unknownOffer = await candidate.get('/offres/999999');
  step('Offre inconnue → erreur conviviale', unknownOffer.status === 404 && !unknownOffer.text.includes('sql'));

  const failed = results.filter((r) => !r.ok);
  console.log(`\n==== ${results.length - failed.length}/${results.length} passed, ${failed.length} failed ====`);
  if (failed.length) { failed.forEach((f) => console.log('ÉCHEC :', f.name)); process.exit(1); }
};

run().catch((err) => { console.error('Erreur test :', err); process.exit(1); });
