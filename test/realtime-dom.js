/**
 * Tests DOM temps réel : les pages EJS réelles sont chargées dans jsdom,
 * les scripts (realtime.js + script de page) sont exécutés, puis les
 * événements Socket.IO sont simulés via des CustomEvent — exactement comme
 * les enverrait le serveur. Vérifie : ajout sans doublon, mise à jour en
 * place, retrait, compteurs, SANS aucun rechargement de page.
 *
 * Prérequis : serveur démarré (PORT .env) — exécution : node test/realtime-dom.js
 */
const { JSDOM } = require('jsdom');
const fs = require('fs');
const path = require('path');

const BASE = 'http://127.0.0.1:' + (process.env.PORT || 5100);
const results = [];
const step = (name, ok, detail = '') => {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  → ' + detail : ''}`);
};

const read = (p) => fs.readFileSync(path.join(__dirname, '..', 'frontend', 'js', p), 'utf8');

const run = async () => {
  const cookieJar = new Map();
  const login = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: process.env.CAND_EMAIL === undefined ? 'candidat@example.com' : process.env.CAND_EMAIL, mot_de_passe: 'Candidat123!' })
  });
  let cookie = '';
  for (const sc of login.headers.getSetCookie?.() || []) {
    const [pair] = sc.split(';');
    cookieJar.set(pair.split('=')[0], pair.split('=')[1]);
  }
  cookie = Array.from(cookieJar, ([k, v]) => `${k}=${v}`).join('; ');
  step('Login candidat (cookie session)', login.status === 200 && !!cookie);

  const getPage = async (p) => {
    const res = await fetch(`${BASE}${p}`, { headers: { cookie } });
    return { status: res.status, html: await res.text() };
  };

  const load = (html, scripts, extraApi = {}) => {
    const dom = new JSDOM(html, { url: `${BASE}/`, runScripts: 'outside-only', pretendToBeVisual: true });
    const win = dom.window;
    // fetch polyfill : les compteurs relus depuis l'API passent par la même session.
    win.fetch = (url, opts = {}) => fetch(url, { ...opts, headers: { ...(opts.headers || {}), cookie } });
    win.io = () => ({ on() {}, once() {} }); // connexion simulée par CustomEvent
    Object.entries(extraApi).forEach(([k, v]) => { win[k] = v; });
    scripts.forEach((s) => win.eval(s));
    return dom;
  };

  const fire = (win, event, detail) => win.document.dispatchEvent(new win.CustomEvent(event, { detail }));
  const count = (dom, sel) => dom.window.document.querySelectorAll(sel).length;

  const RT = read('realtime.js');

  /* ====================== PAGE /offres (liste) ====================== */
  const offersPage = await getPage('/offres');
  step('GET /offres rendue (candidat)', offersPage.status === 200);
  const ofDom = load(offersPage.html, [RT, read('pages/offers.js')]);
  const ofWin = ofDom.window;
  const before = count(ofDom, '.offer-item');
  const fakeOffer = { id_offre: 999001, titre_offre: 'Offre temps réel', localisation: 'Kinshasa', nom_entreprise: 'Entreprise RT', salaire: 3500, date_expiration: '2027-12-31', statut_offre: 'Ouverte', date_publication: new Date().toISOString() };
  fire(ofWin, 'gc:offre-nouvelle', { offer: fakeOffer });
  step('Offre reçue → carte ajoutée', count(ofDom, '.offer-item') === before + 1);
  fire(ofWin, 'gc:offre-nouvelle', { offer: fakeOffer });
  step('Même offre reçue 2× → AUCUN doublon', count(ofDom, '.offer-item') === before + 1);
  fire(ofWin, 'gc:offre-modifiee', { offer: { ...fakeOffer, salaire: 4000, statut_offre: 'Ouverte' } });
  const card = ofWin.document.querySelector(`.offer-item[data-offer-id="999001"]`);
  const salaire = card.querySelector('.offer-main .muted-note').textContent;
  step('Offre modifiée → carte mise à jour', salaire.includes('4000'));
  fire(ofWin, 'gc:offre-supprimee', { id_offre: 999001 });
  step('Offre supprimée → carte retirée', count(ofDom, '.offer-item') === before);
  step('Offre fermée NON ajoutée pour un candidat', (() => {
    const closed = { ...fakeOffer, id_offre: 999002, statut_offre: 'Fermée' };
    fire(ofWin, 'gc:offre-nouvelle', { offer: closed });
    return count(ofDom, '.offer-item') === before;
  })());

  /* ====================== PAGE /messages :deuxième utilisateur ====================== */
  const userId = Number(ofWin.document.body.dataset.userId);
  const convPage = await getPage(`/messages?dest=${userId === 999999 ? 1 : 2}`);
  // Récupère une vraie conversation existante du compte de test ; sinon en crée une.
  let dest = 2;
  const convs = await fetch(`${BASE}/api/messages`, { headers: { cookie } }).then((r) => r.json());
  if ((convs.data?.items || []).length) dest = Number(convs.data.items[0].id_utilisateur);
  const msPage = await getPage(`/messages?dest=${dest}`);
  step('GET /messages?dest rendue', msPage.status === 200);
  const msDom = load(msPage.html, [RT, read('pages/messages.js')]);
  const msWin = msDom.window;
  const threadBefore = count(msDom, '.thread-list .thread-msg');
  const newMsg = { message: { id_message: 9001, contenu: 'Message instantané reçu', date_message: new Date().toISOString(), id_expediteur: dest, id_destinataire: userId, lu: 0 }, expediteur: { nom: 'Test', prenom: 'Alice' } };
  fire(msWin, 'gc:message', newMsg);
  const inThread = !!msWin.document.querySelector(`.thread-msg[data-id="9001"]`);
  fire(msWin, 'gc:message', newMsg);
  const noDup = count(msDom, '.thread-msg[data-id="9001"]') === 1;
  step('Message reçu → affiché dans la conversation (sans doublon)', inThread && noDup);
  const previewUpdated = msWin.document.querySelector(`.conversation-item[data-user-id="${dest}"]`)?.querySelector('.conversation-meta p').textContent.includes('Message instantané');
  step('Conversation mise à jour (aperçu)', !!previewUpdated);

  // Nouvelle conversation (expéditeur inconnu) → créée en tête de liste.
  const unknown = { message: { id_message: 9002, contenu: 'hello depuis un nouveau contact', date_message: new Date().toISOString(), id_expediteur: 424242, id_destinataire: userId, lu: 0 }, expediteur: { nom: 'Nouveau', prenom: 'Nadia' } };
  fire(msWin, 'gc:message', unknown);
  step('Nouveau contact → conversation créée', count(msDom, '.conversation-item[data-user-id="424242"]') === 1);

  /* ====================== PAGE Notifications ====================== */
  const notifPage = await getPage('/notifications');
  const nDom = load(notifPage.html, [RT, read('pages/notifications.js')]);
  const nWin = nDom.window;
  const notifsBefore = count(nDom, '.notification-item');
  fire(nWin, 'gc:notification', { notification: { id_notification: 7001, contenu_notification: 'Nouvelle alerte test', date_notification: new Date().toISOString(), statut_notification: 'Non lue', id_utilisateur: userId } });
  fire(nWin, 'gc:notification', { notification: { id_notification: 7001, contenu_notification: 'Nouvelle alerte test', date_notification: new Date().toISOString(), statut_notification: 'Non lue', id_utilisateur: userId } });
  step('Notification reçue → ajoutée (sans doublon)', count(nDom, '.notification-item') === notifsBefore + 1);
  step('Action « Tout marquer lu » affichée', count(nDom, 'form[action="/notifications/lire-toutes"]') === 1);

  /* ====================== PAGE Candidatures reçues (recruteur) ====================== */
  const recr = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: process.env.RECR_EMAIL === undefined ? 'recruteur@example.com' : process.env.RECR_EMAIL, mot_de_passe: 'Recruteur123!' })
  }).then(async (r) => {
    let c = '';
    for (const sc of r.headers.getSetCookie?.() || []) { const [p] = sc.split(';'); c = `${c}; ${p}`; }
    return c;
  });
  const appPage = await fetch(`${BASE}/candidatures`, { headers: { cookie: recr } });
  const appHtml = await appPage.text();
  const hasCands = appHtml.includes('data-applications-list');
  let appStep = 'Candidatures reçues (recruteur) : page rendue';
  step(appStep, appPage.status === 200);
  if (hasCands) {
    const aDom = load(appHtml, [RT, read('pages/applications-received.js')]);
    const aWin = aDom.window;
    const beforeCards = count(aDom, '.application-card');
    fire(aWin, 'gc:candidature-nouvelle', { candidature: { id_candidature: 6001, id_utilisateur: 555, id_offre: 511, nom: 'Zola', prenom: 'Emma', email: 'z@t.fr', telephone: '+243', photo: null, cv: null, bio: 'Bio', competences: 'SQL (Avancé)', statut_candidature: 'En attente', date_candidature: new Date().toISOString(), titre_offre: 'Dev Backend', localisation: 'Kinshasa', score_compatibilite: 80, lettre_motivation: 'Bonjour' } });
    fire(aWin, 'gc:candidature-nouvelle', { candidature: { id_candidature: 6001, id_utilisateur: 555, id_offre: 511, nom: 'Zola', prenom: 'Emma', email: 'z@t.fr', telephone: '+243', photo: null, cv: null, bio: 'Bio', competences: 'SQL (Avancé)', statut_candidature: 'En attente', date_candidature: new Date().toISOString(), titre_offre: 'Dev Backend', localisation: 'Kinshasa', score_compatibilite: 80, lettre_motivation: 'Bonjour' } });
    step('Candidature reçue → carte ajoutée (sans doublon)', count(aDom, '.application-card') === beforeCards + 1);
    step('Badge « Candidatures reçues » incrémenté', (aWin.document.querySelector('[data-count="unread-applications"]')?.textContent || '') === String(beforeCards > 0 ? Number(beforeCards) + 1 : 1) && count(aDom, '.application-card') === beforeCards + 1);
  }

  /* ====================== Reload interdit ====================== */
  const allClientJs = [RT, read('pages/messages.js'), read('pages/offers.js'), read('pages/applications.js'), read('pages/applications-received.js'), read('pages/notifications.js'), read('pages/admin-skills.js')].join('\n');
  // Retire commentaires et littéraux pour ne vérifier que le CODE réel.
  const codeOnly = allClientJs.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
  const hasPageReload = codeOnly.includes('location.reload()');
  step('Aucun window.location.reload() dans le code temps réel', !hasPageReload);

  const failed = results.filter((r) => !r.ok);
  console.log(`\n==== ${results.length - failed.length}/${results.length} passed, ${failed.length} failed ====`);
  process.exit(failed.length ? 1 : 0);
};

run().catch((e) => { console.error('TEST CRASH:', e); process.exit(1); });