/* Smoke test frontend : charge chaque page dans jsdom (scripts réels servis par Express),
   injecte fetch/localStorage, attend le rendu, et vérifie les zones clés. */
const { JSDOM } = require('jsdom');

const BASE = 'http://127.0.0.1:5000';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Session candidate : se connecte via l'API réelle pour obtenir un token.
async function login(email, password) {
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, mot_de_passe: password })
  });
  const json = await res.json();
  return json.data || null;
}

async function loadPage(path, session) {
  const errors = [];
  const dom = await JSDOM.fromURL(`${BASE}${path}`, {
    runScripts: 'dangerously',
    resources: 'usable',
    pretendToBeVisual: true,
    beforeParse(window) {
      // Les pages utilisent des URL relatives (/api/...) : on les résout comme un navigateur.
      window.fetch = (input, init) => {
        const url = typeof input === 'string' ? new URL(input, `${BASE}/`).toString() : input;
        return fetch(url, init);
      };
      if (session) {
        window.localStorage.setItem('gc_token', session.token);
        window.localStorage.setItem('gc_user', JSON.stringify(session.user));
      }
      window.confirm = () => true;
      window.prompt = () => 'test';
      window.addEventListener('error', (e) => errors.push(e.message));
    }
  });
  // Laisse le temps aux scripts (DOMContentLoaded async) de s'exécuter.
  await sleep(1500);
  return { dom, errors };
}

const checks = [];
const check = (name, ok, detail = '') => { checks.push({ name, ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  → ' + detail : ''}`); };

const api = async (method, path, { token, body } = {}) => {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body) headers['Content-Type'] = 'application/json';
  const res = await fetch(`${BASE}/api${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
  return res.json();
};

(async () => {
  // Utilisateurs créés par le test E2E précédent (candidat = aline, recruteur = jean).
  const candidate = await login('aline.kabila@test.com', 'Secret123!');
  const recruiter = await login('jean.mbala@test.com', 'Secret123!');
  const admin = await login('admin@test.com', 'Admin123!');
  check('Sessions obtenues', !!(candidate && recruiter && admin), `${!!candidate} ${!!recruiter} ${!!admin}`);

  // Seed : deux offres ouvertes (une déjà pourvue de candidature, une vierge).
  const future = new Date(Date.now() + 90 * 86400000).toISOString().slice(0, 10);
  const o1 = await api('POST', '/offres', { token: recruiter.token, body: { titre_offre: 'Developpeur Frontend Vue.js', description_offre: 'Poste frontend', salaire: 1200, localisation: 'Kinshasa', date_expiration: future, statut_offre: 'Ouverte' } });
  const o2 = await api('POST', '/offres', { token: recruiter.token, body: { titre_offre: 'Developpeur Backend Node.js', description_offre: 'Poste backend', salaire: 1500, localisation: 'Lubumbashi', date_expiration: future, statut_offre: 'Ouverte' } });
  const skills = await api('GET', '/competences', { token: candidate.token });
  const skillId = skills.data.items[0]?.id_competence;
  if (skillId) await api('PUT', `/offres/${o1.data.id_offre}/competences`, { token: recruiter.token, body: { competences: [{ id_competence: skillId, niveau_requis: 'Intermédiaire' }] } });
  await api('POST', `/offres/${o1.data.id_offre}/postuler`, { token: candidate.token, body: { lettre_motivation: 'Candidature de référence' } });
  check('Seed : offres + candidature créées', !!(o1.data?.id_offre && o2.data?.id_offre));

  // Page publique
  let r = await loadPage('/');
  check('index.html charge', r.dom.window.document.querySelector('h1')?.textContent.includes('Gestion'), r.errors.join(';'));
  check('index sans erreurs JS', r.errors.length === 0, r.errors.join(';'));

  // Login/register (non connecté)
  r = await loadPage('/login.html', null);
  check('login.html : formulaire présent', !!r.dom.window.document.getElementById('loginForm'));

  // Jobs (candidat connecté)
  r = await loadPage('/jobs.html', candidate);
  const jobsList = r.dom.window.document.getElementById('jobsList');
  check('jobs.html : liste d\'offres rendue', jobsList?.innerHTML.includes('Developpeur Frontend'), jobsList?.innerHTML.slice(0, 120));
  check('jobs.html sans erreurs JS', r.errors.length === 0, r.errors.join(';'));

  // Détail d'offre (candidat — déjà postulé sur l'offre 1)
  r = await loadPage(`/job-details.html?id=${o1.data.id_offre}`, candidate);
  const jobDetails = r.dom.window.document.getElementById('jobDetails');
  check('job-details.html : détail rendu', jobDetails?.innerHTML.includes('Developpeur Frontend') && jobDetails?.innerHTML.includes('applyZone'), jobDetails?.innerHTML.slice(0, 100));
  check('job-details : état "déjà postulé" affiché', jobDetails?.innerHTML.includes('déjà postulé'));

  // Matching (candidat)
  r = await loadPage('/matching.html', candidate);
  const offerSelect = r.dom.window.document.getElementById('offerSelect');
  check('matching.html : sélecteur d\'offres rempli', offerSelect?.innerHTML.includes('<option value="'));

  // Applications (candidat)
  r = await loadPage('/applications.html', candidate);
  const appsList = r.dom.window.document.getElementById('applicationsList');
  check('applications.html (candidat) rendu', appsList?.innerHTML.includes('table-wrap') || appsList?.innerHTML.includes('Aucune candidature') || appsList?.innerHTML.includes('pas encore postulé'), appsList?.innerHTML.slice(0, 100));

  // Messages (candidat)
  r = await loadPage('/messages.html', candidate);
  check('messages.html : destinataires chargés', r.dom.window.document.getElementById('composeRecipient')?.innerHTML.includes('Mbala'));

  // Dashboard recruteur
  r = await loadPage('/recruiter-dashboard.html', recruiter);
  const myOffers = r.dom.window.document.getElementById('myOffers');
  check('recruiter-dashboard : mes offres rendues', myOffers?.innerHTML.includes('Developpeur Frontend') && myOffers?.innerHTML.includes('data-skills-form'), myOffers?.innerHTML.slice(0, 120));
  check('recruiter-dashboard : formulaire offre lié', !!r.dom.window.document.getElementById('jobForm'));
  check('recruiter-dashboard sans erreurs JS', r.errors.length === 0, r.errors.join(';'));

  // Applications recruteur
  r = await loadPage('/applications.html', recruiter);
  const recApps = r.dom.window.document.getElementById('applicationsList');
  check('applications.html (recruteur) : statuts + contact', recApps?.innerHTML.includes('data-status-update') && recApps?.innerHTML.includes('Contacter') && recApps?.innerHTML.includes('Candidature de référence'), recApps?.innerHTML.slice(0, 140));

  // Admin dashboard
  r = await loadPage('/admin-dashboard.html', admin);
  const adminUsers = r.dom.window.document.getElementById('adminUsers');
  const adminSkills = r.dom.window.document.getElementById('adminSkills');
  check('admin-dashboard : utilisateurs rendus', adminUsers?.innerHTML.includes('table-wrap'), adminUsers?.innerHTML.slice(0, 80));
  check('admin-dashboard : compétences rendues', adminSkills?.innerHTML.includes('JavaScript') || adminSkills?.innerHTML.includes('Aucune compétence'));
  check('admin-dashboard : formulaire compétence', !!r.dom.window.document.getElementById('newSkillForm'));

  // Notifications (candidat)
  r = await loadPage('/notifications.html', candidate);
  check('notifications.html rendu', r.dom.window.document.getElementById('notificationsList')?.innerHTML.length > 0);

  // Vérification du workflow : le candidat postule via le formulaire du détail (offre vierge)
  r = await loadPage(`/job-details.html?id=${o2.data.id_offre}`, candidate);
  const applyBtn = r.dom.window.document.getElementById('applyBtn');
  if (applyBtn) {
    const letter = r.dom.window.document.getElementById('applyLetter');
    if (letter) letter.value = 'Candidature via smoke test frontend';
    applyBtn.click();
    await sleep(1200);
    const mine = await (await fetch(`${BASE}/api/candidatures/me`, { headers: { Authorization: `Bearer ${candidate.token}` } })).json();
    check('Candidature envoyée depuis le formulaire frontend', mine.data.items.some((a) => String(a.id_offre) === String(o2.data.id_offre) && a.lettre_motivation === 'Candidature via smoke test frontend'));
  } else {
    check('Candidature envoyée depuis le formulaire frontend', false, 'bouton absent');
  }

  const failed = checks.filter((c) => !c.ok);
  console.log(`\n==== ${checks.length - failed.length}/${checks.length} passed, ${failed.length} failed ====`);
  process.exit(failed.length ? 1 : 0);
})().catch((e) => { console.error('SMOKE CRASH:', e); process.exit(1); });
