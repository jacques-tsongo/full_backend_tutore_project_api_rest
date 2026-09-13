/**
 * Tests « matching, classement des candidatures, offres expirées,
 * notifications et autorisations » (améliorations 2026-09-13).
 *
 * Exécution : serveur démarré + base initialisée (schema + migrations).
 *   node test/matching-ranking.js
 *
 * Le script crée ses propres comptes jetables (suffixe horodaté). Les seules
 * écritures directes en base servent à FABRIQUER les états impossibles via
 * l'API (offre expirée, expériences datées) — aucune donnée existante n'est
 * modifiée ni supprimée.
 */
require('dotenv').config();
const mysql = require('mysql2/promise');

const BASE = `http://127.0.0.1:${process.env.PORT || 5000}/api`;
const WEB = `http://127.0.0.1:${process.env.PORT || 5000}`;
const results = [];
const step = (name, ok, detail = '') => {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  → ' + detail : ''}`);
};

async function call(method, path, { token, body, form } = {}) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  let payload;
  if (form) payload = form;
  else { headers['Content-Type'] = 'application/json'; payload = body === undefined ? undefined : JSON.stringify(body); }
  const res = await fetch(`${BASE}${path}`, { method, headers, body: payload });
  let json = null;
  try { json = await res.json(); } catch (_) {}
  return { status: res.status, json };
}

const run = async () => {
  const stamp = Date.now();
  const db = await mysql.createConnection({
    host: process.env.DB_HOST || '127.0.0.1',
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'gestion_carrieres'
  });

  /* ---------------- Contexte : admin + domaine + compétences -------------- */
  const adminLogin = await call('POST', '/auth/login', { body: { email: 'admin@example.com', mot_de_passe: 'Admin123!' } });
  const adminTok = adminLogin.json?.data?.token;
  if (!adminTok) { console.error('Compte admin@example.com requis (seed).'); process.exit(1); }

  const domRes = await call('POST', '/domaines', { token: adminTok, body: { nom_domaine: `Test Matching ${stamp}` } });
  const DOM = domRes.json?.data?.item?.id_domaine;
  step('Contexte — domaine de test créé', !!DOM, `id=${DOM}`);

  const mkSkill = async (nom) => {
    const r = await call('POST', '/competences', { token: adminTok, body: { nom_competence: nom, id_domaine: DOM } });
    return r.json?.data?.item?.id_competence;
  };
  const NODE = await mkSkill(`NodeJS-${stamp}`);
  const EXPRESS = await mkSkill(`Express-${stamp}`);
  const SQL = await mkSkill(`MySQL-${stamp}`);
  step('Contexte — 3 compétences du domaine créées', !!NODE && !!EXPRESS && !!SQL);

  /* ---------------- Recruteur + entreprise approuvée ----------------------- */
  const reg = async (prefix) => {
    const r = await call('POST', '/auth/register', {
      body: { nom: prefix, prenom: 'Test', email: `${prefix.toLowerCase()}.${stamp}@test.local`, mot_de_passe: 'Secret123!', id_domaine: DOM }
    });
    return { token: r.json?.data?.token, id: r.json?.data?.user?.id_utilisateur };
  };
  let rec = await reg('Rec');
  const fd = new FormData();
  fd.append('nom_entreprise', `Matching Corp ${stamp}`);
  fd.append('id_domaine', String(DOM));
  fd.append('secteur_activite', 'Informatique');
  fd.append('adresse', '1 Av. Test');
  fd.append('ville', 'Kinshasa');
  fd.append('pays', 'RDC');
  fd.append('telephone', '+243800000010');
  fd.append('email', `corp.${stamp}@test.local`);
  fd.append('description', 'Entreprise de test matching');
  fd.append('numero_rccm', `RCCM/TEST/${stamp}`);
  fd.append('supporting_documents', new Blob(['%PDF-1.4 test'], { type: 'application/pdf' }), 'doc.pdf');
  const compReq = await call('POST', '/entreprises/demande-recruteur', { token: rec.token, form: fd });
  step('Recruteur — demande d\'entreprise soumise', compReq.status === 201, `status=${compReq.status}`);
  const companyId = compReq.json?.data?.company?.id_entreprise;

  /* ---- NOTIFICATION ADMIN : nouvelle demande de création d'entreprise ---- */
  const [adminNotifs] = await db.execute(
    `SELECT n.* FROM notification n JOIN utilisateur u ON u.id_utilisateur = n.id_utilisateur
     WHERE u.role = 'administrateur' AND n.type_notification = 'NOUVELLE_DEMANDE_ENTREPRISE' AND n.id_reference = ?`,
    [companyId]
  );
  step('NOTIF — admin notifié de la demande d\'entreprise', adminNotifs.length >= 1,
    adminNotifs[0]?.contenu_notification || 'aucune');
  step('NOTIF — référence ENTREPRISE portée par la notification',
    adminNotifs[0]?.type_reference === 'ENTREPRISE' && Number(adminNotifs[0]?.id_reference) === Number(companyId));
  step('NOTIF — statut initial Non lue', adminNotifs[0]?.statut_notification === 'Non lue');

  // Anti-doublon : une 2e demande du même utilisateur est bloquée (409) donc
  // pas de duplication possible par ce chemin — vérifie le compteur.
  const [beforeCount] = await db.execute(
    "SELECT COUNT(*) AS total FROM notification WHERE type_notification = 'NOUVELLE_DEMANDE_ENTREPRISE' AND id_reference = ?",
    [companyId]
  );
  step('NOTIF — pas de doublon pour la même demande', Number(beforeCount[0].total) === adminNotifs.length);

  await call('PUT', `/admin/companies/${companyId}/approve`, { token: adminTok, body: {} });
  const recLogin = await call('POST', '/auth/login', { body: { email: `rec.${stamp}@test.local`, mot_de_passe: 'Secret123!' } });
  rec.token = recLogin.json?.data?.token;
  step('Recruteur — entreprise approuvée, rôle recruteur', recLogin.json?.data?.user?.role === 'recruteur');

  /* ---------------- NOTIFICATION ADMIN : suggestions ----------------------- */
  const cand0 = await reg('Sugg');
  const sug = await call('POST', '/suggestions', {
    token: cand0.token,
    body: { type_demande: 'COMPETENCE', nom_propose: `CompSuggeree${stamp}` }
  });
  step('NOTIF — suggestion de compétence soumise', sug.status === 201, `status=${sug.status}`);
  const sugId = sug.json?.data?.item?.id_demande;
  const [sugNotifs] = await db.execute(
    `SELECT n.* FROM notification n JOIN utilisateur u ON u.id_utilisateur = n.id_utilisateur
     WHERE u.role = 'administrateur' AND n.type_reference = 'DEMANDE_SUGGESTION' AND n.id_reference = ?`,
    [sugId]
  );
  step('NOTIF — admin notifié de la suggestion (référence vers la demande)', sugNotifs.length >= 1,
    sugNotifs[0]?.contenu_notification || 'aucune');

  const sugDom = await call('POST', '/suggestions', {
    token: cand0.token,
    body: { type_demande: 'DOMAINE', nom_propose: `DomSuggere${stamp}` }
  });
  const sugDomId = sugDom.json?.data?.item?.id_demande;
  const [sugDomNotifs] = await db.execute(
    `SELECT n.* FROM notification n JOIN utilisateur u ON u.id_utilisateur = n.id_utilisateur
     WHERE u.role = 'administrateur' AND n.type_reference = 'DEMANDE_SUGGESTION' AND n.id_reference = ?`,
    [sugDomId]
  );
  step('NOTIF — admin notifié de la suggestion de domaine', sugDomNotifs.length >= 1);

  /* ---------------- Offre avec compétences requises ------------------------ */
  const in3days = new Date(Date.now() + 3 * 864e5).toISOString().slice(0, 10);
  const offRes = await call('POST', '/offres', {
    token: rec.token,
    body: {
      titre_offre: `Développeur Backend NodeJS ${stamp}`,
      description_offre: 'API REST Node.js/Express avec MySQL.',
      localisation: 'Kinshasa',
      date_expiration: in3days,
      competences: [
        { id_competence: NODE, niveau_requis: 'Intermédiaire' },
        { id_competence: EXPRESS, niveau_requis: 'Intermédiaire' },
        { id_competence: SQL, niveau_requis: 'Intermédiaire' }
      ]
    }
  });
  const OFFER = offRes.json?.data?.id_offre;
  step('Offre — créée avec 3 compétences requises', offRes.status === 201 && !!OFFER, `id=${OFFER}`);

  /* ---------------- Candidats aux profils différenciés --------------------- */
  // A : 3/3 compétences niveau requis, AUCUNE expérience.
  // B : 3/3 compétences niveau requis, 2 ans d'expérience backend pertinente.
  // C : 2/3 compétences, 4 ans d'expérience pertinente.
  // D : 1/3 compétence niveau faible, aucune expérience.
  // E : aucune compétence (sous le seuil → ne peut pas postuler).
  const A = await reg('CandA');
  const B = await reg('CandB');
  const C = await reg('CandC');
  const D = await reg('CandD');
  const E = await reg('CandE');

  const setSkill = (tok, id, lvl) => call('POST', '/mes-competences', { token: tok, body: { id_competence: id, niveau_competence: lvl } });
  for (const [tok, skills] of [
    [A.token, [[NODE, 'Intermédiaire'], [EXPRESS, 'Intermédiaire'], [SQL, 'Intermédiaire']]],
    [B.token, [[NODE, 'Intermédiaire'], [EXPRESS, 'Intermédiaire'], [SQL, 'Intermédiaire']]],
    [C.token, [[NODE, 'Intermédiaire'], [SQL, 'Intermédiaire']]],
    [D.token, [[NODE, 'Débutant']]]
  ]) {
    for (const [id, lvl] of skills) await setSkill(tok, id, lvl);
  }

  // Expériences réelles (API resource existante), datées via UPDATE ciblé.
  const addXp = async (tok, userId, poste, entreprise, yearsAgoStart, yearsAgoEnd, description = null) => {
    const start = new Date(Date.now() - yearsAgoStart * 365.25 * 864e5).toISOString().slice(0, 10);
    const end = yearsAgoEnd === null ? null : new Date(Date.now() - yearsAgoEnd * 365.25 * 864e5).toISOString().slice(0, 10);
    const r = await call('POST', '/experiences', { token: tok, body: { poste, entreprise, date_debut: start, date_fin: end, description } });
    return r.status === 201 || r.status === 200;
  };
  const okB = await addXp(B.token, B.id, 'Développeur Backend', 'Entreprise X', 2, 0, 'API Node.js et Express');
  const okC1 = await addXp(C.token, C.id, 'Développeur Backend NodeJS', 'Entreprise Y', 4, 2);
  const okC2 = await addXp(C.token, C.id, 'Développeur API', 'Entreprise Z', 2, 0, 'Backend MySQL');
  step('Contexte — expériences créées (B: 2 ans, C: 4 ans pertinentes)', okB && okC1 && okC2);

  /* ---------------- MATCHING : calcul, persistance, seuil ------------------ */
  const mA = await call('GET', `/offres/${OFFER}/matching`, { token: A.token });
  step('MATCHING — candidat complet : score 100 %', mA.status === 200 && Number(mA.json?.data?.matching?.score) === 100,
    `score=${mA.json?.data?.matching?.score}`);
  const mC = await call('GET', `/offres/${OFFER}/matching`, { token: C.token });
  step('MATCHING — candidat 2/3 compétences : score ≈ 66.67 %',
    mC.status === 200 && Math.abs(Number(mC.json?.data?.matching?.score) - 66.67) < 0.01,
    `score=${mC.json?.data?.matching?.score}`);
  const mD = await call('GET', `/offres/${OFFER}/matching`, { token: D.token });
  step('MATCHING — candidat 1/3 niveau faible : score partiel > 0',
    mD.status === 200 && Number(mD.json?.data?.matching?.score) > 0 && Number(mD.json?.data?.matching?.score) < 50,
    `score=${mD.json?.data?.matching?.score}`);
  const mE = await call('GET', `/offres/${OFFER}/matching`, { token: E.token });
  step('MATCHING — candidat sans compétence : score 0, non accessible',
    mE.status === 200 && Number(mE.json?.data?.matching?.score) === 0 && mE.json?.data?.matching?.accessible === false);

  const [persistedA] = await db.execute('SELECT score_compatibilite FROM matching WHERE id_utilisateur = ? AND id_offre = ?', [A.id, OFFER]);
  step('MATCHING — score persisté dans la table matching', Number(persistedA[0]?.score_compatibilite) === 100,
    `stocké=${persistedA[0]?.score_compatibilite}`);

  /* ---------------- Candidatures --------------------------------------------- */
  const apply = (tok) => call('POST', `/offres/${OFFER}/postuler`, { token: tok, body: { lettre_motivation: 'Motivé.' } });
  const aA = await apply(A.token); const aB = await apply(B.token);
  const aC = await apply(C.token); const aD = await apply(D.token);
  step('Candidatures — A, B, C, D acceptées à la soumission',
    [aA, aB, aC, aD].every((r) => r.status === 201));
  const aE = await apply(E.token);
  step('Candidature — E (score 0) refusée par le seuil (403)', aE.status === 403, `status=${aE.status}`);

  // Efface les scores de B et D pour simuler la panne historique (« scores
  // jamais enregistrés ») : la liste recruteur doit les RECALCULER.
  await db.execute('DELETE FROM matching WHERE id_offre = ? AND id_utilisateur IN (?, ?)', [OFFER, B.id, D.id]);

  /* ---------------- CLASSEMENT côté recruteur ------------------------------ */
  const recus = await call('GET', '/candidatures/recues', { token: rec.token });
  const items = (recus.json?.data?.items || []).filter((x) => Number(x.id_offre) === Number(OFFER));
  step('CLASSEMENT — 4 candidatures reçues', items.length === 4, `count=${items.length}`);

  const byUser = Object.fromEntries(items.map((x) => [Number(x.id_utilisateur), x]));
  step('RÉPARATION — score de B recalculé et réaffiché après effacement',
    Number(byUser[B.id]?.score_compatibilite) === 100, `B=${byUser[B.id]?.score_compatibilite}`);
  const [persistedB] = await db.execute('SELECT score_compatibilite FROM matching WHERE id_utilisateur = ? AND id_offre = ?', [B.id, OFFER]);
  step('RÉPARATION — score de B re-persisté dans la table matching',
    Number(persistedB[0]?.score_compatibilite) === 100, `stocké=${persistedB[0]?.score_compatibilite}`);

  const order = items.map((x) => Number(x.id_utilisateur));
  step('CLASSEMENT — B (100 % + 2 ans pertinents) devant A (100 % sans exp.)',
    order.indexOf(B.id) < order.indexOf(A.id), `ordre=${order.join(',')}`);
  // Règle métier (cas « Candidat C » du cahier des charges) : des compétences
  // légèrement moins nombreuses mais plusieurs années d'expérience directement
  // liées au poste rendent C compétitif face à A (sans jamais effondrer A).
  step('CLASSEMENT — C (66 % + 4 ans pertinents) compétitif face à A (100 % sans exp.)',
    Math.abs(Number(byUser[A.id]?.score_recommandation) - Number(byUser[C.id]?.score_recommandation)) <= 10,
    `recoA=${byUser[A.id]?.score_recommandation} recoC=${byUser[C.id]?.score_recommandation}`);
  step('CLASSEMENT — l\'ordre suit les scores de recommandation décroissants',
    items.every((x, i) => i === 0 || Number(items[i - 1].score_recommandation) >= Number(x.score_recommandation)));
  step('CLASSEMENT — C (66 % + expérience) devant D (8 % sans exp.)',
    order.indexOf(C.id) < order.indexOf(D.id));
  step('CLASSEMENT — le débutant A garde un bon score (recommandation ≥ 70)',
    Number(byUser[A.id]?.score_recommandation) >= 70, `recoA=${byUser[A.id]?.score_recommandation}`);
  step('CLASSEMENT — expérience pertinente exposée (B : 2 ans)',
    Math.abs(Number(byUser[B.id]?.experience_annees_pertinentes) - 2) <= 0.1,
    `B=${byUser[B.id]?.experience_annees_pertinentes} ans`);
  step('CLASSEMENT — compétences correspondantes listées',
    Array.isArray(byUser[A.id]?.competences_correspondantes) && byUser[A.id].competences_correspondantes.length === 3);

  /* ---------------- OFFRES EXPIRÉES ----------------------------------------- */
  // Quatre états d'offre : valide, ouverte mais expirée, fermée, suspendue.
  const mkOffer = async (titre, exp) => {
    const r = await call('POST', '/offres', {
      token: rec.token,
      body: { titre_offre: titre, description_offre: 'Test.', localisation: 'Kinshasa', date_expiration: exp, competences: [{ id_competence: NODE, niveau_requis: 'Débutant' }] }
    });
    return r.json?.data?.id_offre;
  };
  const in30 = new Date(Date.now() + 30 * 864e5).toISOString().slice(0, 10);
  const oValide = await mkOffer(`Offre valide ${stamp}`, in30);
  const oExpiree = await mkOffer(`Offre expirée ${stamp}`, in30);
  const oFermee = await mkOffer(`Offre fermée ${stamp}`, in30);
  // Une date passée est refusée par l'API : l'état « ouverte mais expirée »
  // est fabriqué en base (UPDATE ciblé sur l'offre de test uniquement).
  await db.execute("UPDATE offre_emploi SET date_expiration = DATE_SUB(CURDATE(), INTERVAL 2 DAY) WHERE id_offre = ?", [oExpiree]);
  await db.execute("UPDATE offre_emploi SET statut_offre = 'Fermée' WHERE id_offre = ?", [oFermee]);

  const list = await call('GET', '/offres?limit=100', { token: A.token });
  const visible = (list.json?.data?.items || []).map((o) => Number(o.id_offre));
  step('OFFRES — l\'offre valide est visible pour le candidat', visible.includes(Number(oValide)));
  step('OFFRES — l\'offre expirée est exclue de la liste candidat', !visible.includes(Number(oExpiree)));
  step('OFFRES — l\'offre fermée est exclue de la liste candidat', !visible.includes(Number(oFermee)));

  const getExpired = await call('GET', `/offres/${oExpiree}`, { token: A.token });
  step('OFFRES — détail d\'une offre expirée → 404 pour le candidat', getExpired.status === 404, `status=${getExpired.status}`);
  const applyExpired = await call('POST', `/offres/${oExpiree}/postuler`, { token: A.token, body: {} });
  step('OFFRES — candidature sur offre expirée bloquée (404)', applyExpired.status === 404, `status=${applyExpired.status}`);
  const matchExpired = await call('GET', `/offres/${oExpiree}/matching`, { token: A.token });
  step('OFFRES — matching sur offre expirée bloqué (404)', matchExpired.status === 404);
  const [still] = await db.execute('SELECT id_offre FROM offre_emploi WHERE id_offre = ?', [oExpiree]);
  step('OFFRES — l\'offre expirée reste en base (historique)', !!still[0]);

  // Page EJS de détail : une offre expirée ne propose plus le formulaire.
  const loginWeb = await fetch(`${WEB}/api/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: `rec.${stamp}@test.local`, mot_de_passe: 'Secret123!' })
  });
  const cookie = (loginWeb.headers.getSetCookie?.() || []).find((c) => c.startsWith('gc_token='))?.split(';')[0];
  const pageExpired = await fetch(`${WEB}/offres/${oExpiree}`, { headers: { cookie } });
  const htmlExpired = await pageExpired.text();
  step('OFFRES — page détail (recruteur) rendue pour offre expirée', pageExpired.status === 200);

  /* ---------------- ALERTE AVANT EXPIRATION -------------------------------- */
  const offerAlert = require('../src/services/offerAlert.service');
  const pass1 = await offerAlert.runOnce();
  const [alertNotifs] = await db.execute(
    "SELECT * FROM notification WHERE type_notification = 'OFFRE_EXPIRE_BIENTOT' AND id_reference = ? AND id_utilisateur = ?",
    [OFFER, rec.id]
  );
  step('ALERTE — recruteur notifié : offre expire dans 3 jours + candidatures',
    alertNotifs.length === 1, alertNotifs[0]?.contenu_notification || 'aucune');
  const pass2 = await offerAlert.runOnce();
  const [alertNotifs2] = await db.execute(
    "SELECT COUNT(*) AS total FROM notification WHERE type_notification = 'OFFRE_EXPIRE_BIENTOT' AND id_reference = ?",
    [OFFER]
  );
  step('ALERTE — aucun doublon au second passage', Number(alertNotifs2[0].total) === 1,
    `passe1=${JSON.stringify(pass1)} passe2=${JSON.stringify(pass2)}`);
  const [validOfferAlert] = await db.execute(
    "SELECT COUNT(*) AS total FROM notification WHERE type_notification = 'OFFRE_EXPIRE_BIENTOT' AND id_reference = ?",
    [oValide]
  );
  step('ALERTE — pas d\'alerte pour une offre lointaine (J+30)', Number(validOfferAlert[0].total) === 0);

  /* ---------------- AUTORISATIONS ------------------------------------------- */
  // Un second recruteur (autre entreprise) ne voit pas les candidatures du premier.
  let rec2 = await reg('Rec2');
  const fd2 = new FormData();
  fd2.append('nom_entreprise', `Autre Corp ${stamp}`);
  fd2.append('id_domaine', String(DOM));
  fd2.append('secteur_activite', 'Informatique');
  fd2.append('adresse', '2 Av. Test');
  fd2.append('ville', 'Kinshasa');
  fd2.append('pays', 'RDC');
  fd2.append('telephone', '+243800000011');
  fd2.append('email', `corp2.${stamp}@test.local`);
  fd2.append('description', 'Seconde entreprise de test');
  fd2.append('numero_rccm', `RCCM/TEST2/${stamp}`);
  fd2.append('supporting_documents', new Blob(['%PDF-1.4 test'], { type: 'application/pdf' }), 'doc.pdf');
  const compReq2 = await call('POST', '/entreprises/demande-recruteur', { token: rec2.token, form: fd2 });
  const companyId2 = compReq2.json?.data?.company?.id_entreprise;
  await call('PUT', `/admin/companies/${companyId2}/approve`, { token: adminTok, body: {} });
  const rec2Login = await call('POST', '/auth/login', { body: { email: `rec2.${stamp}@test.local`, mot_de_passe: 'Secret123!' } });
  rec2.token = rec2Login.json?.data?.token;

  const recues2 = await call('GET', '/candidatures/recues', { token: rec2.token });
  const foreign = (recues2.json?.data?.items || []).filter((x) => Number(x.id_offre) === Number(OFFER));
  step('AUTORISATION — recruteur 2 ne voit pas les candidatures de l\'entreprise 1', foreign.length === 0);
  const recues2Forced = await call('GET', `/candidatures/recues?offre=${OFFER}`, { token: rec2.token });
  const forced = (recues2Forced.json?.data?.items || []);
  step('AUTORISATION — filtre ?offre=ID d\'une autre entreprise → liste vide', forced.length === 0);
  const candidatureId = items[0]?.id_candidature;
  const statusForeign = await call('PATCH', `/candidatures/${candidatureId}/statut`, { token: rec2.token, body: { statut_candidature: 'Refusée' } });
  step('AUTORISATION — recruteur 2 ne peut pas traiter une candidature de l\'entreprise 1 (404)',
    statusForeign.status === 404, `status=${statusForeign.status}`);
  const recuesCandidat = await call('GET', '/candidatures/recues', { token: A.token });
  step('AUTORISATION — un candidat ne peut pas lister les candidatures reçues (403)', recuesCandidat.status === 403);

  /* ---------------- NOTIFICATIONS : compteur + ouverture -------------------- */
  const unread = await call('GET', '/notifications/non-lues', { token: adminTok });
  step('NOTIF — compteur admin > 0', Number(unread.json?.data?.total) > 0, `total=${unread.json?.data?.total}`);
  const notifList = await call('GET', '/notifications', { token: adminTok });
  const entNotif = (notifList.json?.data?.items || []).find((n) => n.type_reference === 'ENTREPRISE' && Number(n.id_reference) === Number(companyId));
  step('NOTIF — action_url calculée pour la demande d\'entreprise',
    entNotif?.action_url === `/dashboard#entreprise-${companyId}`, entNotif?.action_url || 'absente');
  const recNotifs = await call('GET', '/notifications', { token: rec.token });
  const alertN = (recNotifs.json?.data?.items || []).find((n) => n.type_notification === 'OFFRE_EXPIRE_BIENTOT');
  step('NOTIF — action_url de l\'alerte pointe vers les candidatures de l\'offre',
    alertN?.action_url === `/candidatures?offre=${OFFER}`, alertN?.action_url || 'absente');

  // Ouverture web : marque lue + redirection.
  const adminWeb = await fetch(`${WEB}/api/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'admin@example.com', mot_de_passe: 'Admin123!' })
  });
  const adminCookie = (adminWeb.headers.getSetCookie?.() || []).find((c) => c.startsWith('gc_token='))?.split(';')[0];
  const open = await fetch(`${WEB}/notifications/${entNotif.id_notification}/ouvrir`, { headers: { cookie: adminCookie }, redirect: 'manual' });
  step('NOTIF — ouverture → redirection vers la demande', open.status === 302 && open.headers.get('location') === `/dashboard#entreprise-${companyId}`,
    `${open.status} → ${open.headers.get('location')}`);
  const [read] = await db.execute('SELECT statut_notification FROM notification WHERE id_notification = ?', [entNotif.id_notification]);
  step('NOTIF — marquée Lue après ouverture', read[0]?.statut_notification === 'Lue');

  /* ---------------- Bilan ---------------------------------------------------- */
  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n==== ${results.length - failed}/${results.length} passed, ${failed} failed ====`);
  await db.end();
  process.exit(failed ? 1 : 0);
};

run().catch((err) => { console.error('TEST CRASH:', err); process.exit(1); });
