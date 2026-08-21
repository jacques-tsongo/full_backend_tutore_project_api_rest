/* E2E test of the complete workflow — run with ADMIN_TOKEN env var. */
const BASE = `http://127.0.0.1:${process.env.PORT || 5000}/api`;
const results = [];
const step = (name, ok, detail = '') => { results.push({ name, ok, detail }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  → ' + detail : ''}`); };

async function call(method, path, { token, body, form } = {}) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  let payload;
  if (form) { payload = form; }
  else { headers['Content-Type'] = 'application/json'; payload = body === undefined ? undefined : JSON.stringify(body); }
  const res = await fetch(`${BASE}${path}`, { method, headers, body: payload });
  let json = null;
  try { json = await res.json(); } catch (_) {}
  return { status: res.status, json };
}

/** Appel brut exposant les en-têtes Set-Cookie (tests de session navigateur). */
const raw = async (method, path, body, { cookie, headers = {} } = {}) => {
  const opts = { method, headers: { ...headers } };
  if (cookie) opts.headers.cookie = cookie;
  if (body !== undefined && body !== null) { opts.headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(body); }
  const res = await fetch(`${BASE}${path}`, opts);
  let json = null;
  try { json = await res.json(); } catch (_) {}
  return { status: res.status, json, cookies: typeof res.headers.getSetCookie === 'function' ? res.headers.getSetCookie() : [] };
};

const run = async () => {
  const health = await call('GET', '/health');
  step('GET /health', health.status === 200);

  const u1 = { nom: 'Mbala', prenom: 'Jean', email: 'jean.mbala@test.com', mot_de_passe: 'Secret123!', telephone: '+243800000001' };
  const u2 = { nom: 'Kabila', prenom: 'Aline', email: 'aline.kabila@test.com', mot_de_passe: 'Secret123!', telephone: '+243800000002' };
  const r1 = await call('POST', '/auth/register', { body: u1 });
  const r2 = await call('POST', '/auth/register', { body: u2 });
  const tok1 = r1.json?.data?.token, tok2 = r2.json?.data?.token;
  const id1 = r1.json?.data?.user?.id_utilisateur, id2 = r2.json?.data?.user?.id_utilisateur;
  step('Register both candidates', r1.status === 201 && r2.status === 201 && !!tok1 && !!tok2);

  const p1 = await call('PUT', '/profil', { token: tok1, body: { bio: 'Developpeur fullstack', adresse: 'Kinshasa', date_naissance: '1995-04-12', lieu_naissance: 'Kinshasa' } });
  step('PUT /profil (recruteur à venir)', p1.status === 200);
  const p2 = await call('PUT', '/profil', { token: tok2, body: { bio: 'Dev junior Node.js', adresse: 'Lubumbashi' } });
  step('PUT /profil (candidat)', p2.status === 200);

  // CV upload
  const cv = new FormData();
  cv.append('cv', new Blob(['fake cv pdf'], { type: 'application/pdf' }), 'cv.pdf');
  const cvUp = await call('POST', '/profil/cv', { token: tok2, form: cv });
  step('POST /profil/cv', cvUp.status === 200, `status=${cvUp.status} ${cvUp.json?.message || ''}`);

  const fd = new FormData();
  fd.append('nom_entreprise', 'Tech Solutions SARL');
  fd.append('secteur_activite', 'Informatique');
  fd.append('adresse', '12 Av. du Commerce');
  fd.append('ville', 'Kinshasa');
  fd.append('pays', 'RDC');
  fd.append('telephone', '+243810000000');
  fd.append('email', 'contact@techsolutions.cd');
  fd.append('site_web', 'https://techsolutions.cd');
  fd.append('numero_rccm', 'RCCM/CD/KIN/2024/1234');
  fd.append('numero_fiscal', 'FISCAL-2024-001');
  fd.append('description', 'Entreprise de developpement logiciel');
  fd.append('supporting_documents', new Blob(['%PDF-1.4 fake'], { type: 'application/pdf' }), 'rccm.pdf');
  const c1 = await call('POST', '/entreprises/demande-recruteur', { token: tok1, form: fd });
  step('POST /entreprises/demande-recruteur', c1.status === 201, `status=${c1.status} ${c1.json?.message || ''}`);

  const adminToken = process.env.ADMIN_TOKEN;
  const pend = await call('GET', '/admin/companies/pending', { token: adminToken });
  // La file d'attente peut contenir d'autres dossiers laissés par des runs
  // précédents : on cible la demande de CETTE exécution (robuste aux reruns).
  const comp = (pend.json?.data?.items || []).find((c) => Number(c.id_utilisateur) === id1);
  step('GET /admin/companies/pending (notre demande présente)', !!comp, `count=${pend.json?.data?.items?.length}`);
  const appr = await call('PUT', `/admin/companies/${comp.id_entreprise}/approve`, { token: adminToken, body: {} });
  step('PUT /admin/companies/:id/approve', appr.status === 200, `status=${appr.status} ${appr.json?.message || ''}`);
  const apprAgain = await call('PUT', `/admin/companies/${comp.id_entreprise}/approve`, { token: adminToken, body: {} });
  step('Approve already-approved → 409', apprAgain.status === 409, `status=${apprAgain.status}`);
  const me1 = await call('GET', '/auth/me', { token: tok1 });
  step('User promoted to recruteur', me1.json?.data?.user?.role === 'recruteur');

  const suffix = Date.now().toString(36);
  for (const skill of [`JS-${suffix}`, `Node-${suffix}`, `SQL-${suffix}`]) {
    await call('POST', '/competences', { token: adminToken, body: { nom_competence: skill, description: '' } });
  }
  const skills = await call('GET', '/competences', { token: tok2 });
  const freshSkills = (skills.json?.data?.items || []).filter((s) => String(s.nom_competence).endsWith(suffix));
  const [skJs, skNode] = freshSkills;
  step('GET /competences (3 nouvelles)', freshSkills.length === 3, `count=${freshSkills.length}`);

  // Offer creation — past date must be rejected
  const past = await call('POST', '/offres', { token: tok1, body: { titre_offre: 'X', description_offre: 'Y', localisation: 'Kinshasa', date_expiration: '2020-01-01' } });
  step('Offer with past expiration → 422', past.status === 422, `status=${past.status}`);

  const off = { titre_offre: `Developpeur Backend ${suffix}`, description_offre: 'Nous recrutons un dev backend', salaire: 1500, localisation: 'Kinshasa', date_expiration: '2026-12-31', statut_offre: 'Ouverte' };
  const o1 = await call('POST', '/offres', { token: tok1, body: off });
  const offId = o1.json?.data?.id_offre;
  step('POST /offres (recruteur)', o1.status === 201 && !!offId, `status=${o1.status}`);
  const oForbid = await call('POST', '/offres', { token: tok2, body: off });
  step('POST /offres (candidat) → 403', oForbid.status === 403);

  const list = await call('GET', '/offres', { token: tok2 });
  step('GET /offres includes company name', list.json?.data?.items?.[0]?.nom_entreprise === 'Tech Solutions SARL', `keys=${Object.keys(list.json?.data?.items?.[0] || {}).join(',')}`);

  const det = await call('GET', `/offres/${offId}`, { token: tok2 });
  step('GET /offres/:id details', det.status === 200 && !!det.json?.data?.item?.nom_entreprise, `status=${det.status}`);

  const sk = await call('PUT', `/offres/${offId}/competences`, { token: tok1, body: { competences: [{ id_competence: skJs.id_competence, niveau_requis: 'Avancé' }, { id_competence: skNode.id_competence, niveau_requis: 'Intermédiaire' }] } });
  step('PUT /offres/:id/competences', sk.status === 200, `status=${sk.status} ${sk.json?.message || ''}`);
  const det2 = await call('GET', `/offres/${offId}`, { token: tok2 });
  step('Offer details include skills', det2.json?.data?.item?.competences?.length === 2, `skills=${det2.json?.data?.item?.competences?.length}`);

  const search = await call('GET', `/offres?q=${suffix}`, { token: tok2 });
  step('GET /offres?q=<titre unique>', search.status === 200 && search.json?.data?.items?.length === 1, `count=${search.json?.data?.items?.length}`);

  const addSkill = await call('POST', '/mes-competences', { token: tok2, body: { id_competence: skJs.id_competence, niveau_competence: 'Avancé' } });
  step('POST /mes-competences (Avancé)', addSkill.status === 200, `status=${addSkill.status} ${addSkill.json?.message || ''}`);

  const m = await call('GET', `/offres/${offId}/matching`, { token: tok2 });
  step('GET /offres/:id/matching', m.status === 200 && m.json?.data?.matching?.score === 50, `score=${m.json?.data?.matching?.score}`);

  const ap = await call('POST', `/offres/${offId}/postuler`, { token: tok2, body: { lettre_motivation: 'Je postule avec enthousiasme' } });
  step('POST /offres/:id/postuler', ap.status === 201, `status=${ap.status} ${ap.json?.message || ''}`);
  const apDup = await call('POST', `/offres/${offId}/postuler`, { token: tok2, body: {} });
  step('Apply twice → 409', apDup.status === 409);

  const mine = await call('GET', '/candidatures/me', { token: tok2 });
  step('GET /candidatures/me', mine.json?.data?.items?.length === 1 && !!mine.json?.data?.items?.[0]?.nom_entreprise);
  const candId = mine.json?.data?.items?.[0]?.id_candidature;

  // Cancel while pending → OK ; then re-apply on a fresh offer to keep the flow
  const cancelPending = await call('PATCH', `/candidatures/${candId}/annuler`, { token: tok2 });
  step('PATCH annuler (pending) → 200', cancelPending.status === 200, `status=${cancelPending.status}`);
  const cancelAgain = await call('PATCH', `/candidatures/${candId}/annuler`, { token: tok2 });
  step('Cancel non-pending → 400', cancelAgain.status === 400);

  // Décision de recrutement : seuls Accepter/Refuser existent désormais (les
  // états intermédiaires comme « Entretien » ne sont plus positionnables).
  // Nouvelle offre pour tester le flux complet (l'ancienne est annulée).
  const off2 = await call('POST', '/offres', { token: tok1, body: { ...off, titre_offre: 'Offre decision', date_expiration: '2026-12-31', statut_offre: 'Ouverte' } });
  const off2Id = off2.json?.data?.id_offre;
  step('POST /offres (offre de décision)', off2.status === 201, `status=${off2.status}`);
  const ap2 = await call('POST', `/offres/${off2Id}/postuler`, { token: tok2, body: { lettre_motivation: 'Pour la décision' } });
  step('POST /offres/:id/postuler (offre de décision)', ap2.status === 201, `status=${ap2.status} ${ap2.json?.message || ''}`);
  const cand2Id = ap2.json?.data?.id_candidature;

  const rec = await call('GET', '/candidatures/recues', { token: tok1 });
  const recRow = rec.json?.data?.items?.[0];
  step('GET /candidatures/recues (annulée masquée, 1 en attente)', rec.json?.data?.items?.length === 1, `count=${rec.json?.data?.items?.length}`);
  step('Recruiter view has CV/contact/score', !!recRow?.cv && !!recRow?.telephone && recRow?.score_compatibilite !== undefined && !!recRow?.competences, `cv=${recRow?.cv} tel=${recRow?.telephone} score=${recRow?.score_compatibilite} skills=${recRow?.competences}`);
  step('offre_pourvue exposé (false avant décision)', recRow?.offre_pourvue === 0 || recRow?.offre_pourvue === false, `offre_pourvue=${recRow?.offre_pourvue}`);

  const stInter = await call('PATCH', `/candidatures/${cand2Id}/statut`, { token: tok1, body: { statut_candidature: 'Entretien' } });
  step('PATCH statut intermédiaire → 422 (bloqué)', stInter.status === 422, `status=${stInter.status}`);
  const stBad = await call('PATCH', `/candidatures/${cand2Id}/statut`, { token: tok1, body: { statut: 'inconnu' } });
  step('PATCH statut invalid → 422', stBad.status === 422);
  const stAcc = await call('PATCH', `/candidatures/${cand2Id}/statut`, { token: tok1, body: { statut: 'Acceptée' } });
  step('PATCH statut Acceptée → 200', stAcc.status === 200, `status=${stAcc.status} ${stAcc.json?.message || ''}`);
  const stAgain = await call('PATCH', `/candidatures/${cand2Id}/statut`, { token: tok1, body: { statut: 'Refusée' } });
  step('Décision définitive → re-traiter → 409', stAgain.status === 409, `status=${stAgain.status} ${stAgain.json?.message || ''}`);

  const notif = await call('GET', '/notifications', { token: tok2 });
  step('Candidate notified of status', notif.json?.data?.items?.some((n) => /accept/i.test(n.contenu_notification || '')), `contenus=${JSON.stringify((notif.json?.data?.items || []).slice(0, 3).map((n) => n.contenu_notification))}`);
  const notifRec = await call('GET', '/notifications', { token: tok1 });
  step('Recruiter notified of application', notifRec.json?.data?.items?.some((n) => n.contenu_notification.includes('Nouvelle candidature')));
  const readAll = await call('PATCH', '/notifications/lire-toutes', { token: tok2 });
  step('PATCH /notifications/lire-toutes', readAll.status === 200);

  // Offre attribuée → fermée : le candidat qui a postulé peut toujours
  // consulter sa fiche (suivi), mais AUCUNE nouvelle candidature n'entre.
  const closedAfter = await call('GET', `/offres/${off2Id}`, { token: tok2 });
  step('Offre pourvue consultable par l\'ayant postulé (200)', closedAfter.status === 200, `status=${closedAfter.status}`);
  const postClosed = await call('POST', `/offres/${off2Id}/postuler`, { token: tok2, body: { lettre_motivation: 'trop tard' } });
  step('Candidature sur offre pourvue bloquée (404)', postClosed.status === 404, `status=${postClosed.status}`);
  const finalRec = await call('GET', '/candidatures/recues', { token: tok1 });
  step('offre_pourvue exposé (true après acceptation)', finalRec.json?.data?.items?.[0]?.offre_pourvue === 1 || finalRec.json?.data?.items?.[0]?.offre_pourvue === true, `offre_pourvue=${finalRec.json?.data?.items?.[0]?.offre_pourvue}`);

  // Closed offer invisible to candidate who didn't apply
  const o2 = await call('POST', '/offres', { token: tok1, body: { ...off, titre_offre: 'Offre fermee', date_expiration: '2026-12-31', statut_offre: 'Fermée' } });
  const closedId = o2.json?.data?.id_offre;
  const closedList = await call('GET', '/offres', { token: tok2 });
  step('Candidate list hides closed offer', !closedList.json?.data?.items?.some((i) => i.id_offre === closedId));
  const closedDet = await call('GET', `/offres/${closedId}`, { token: tok2 });
  step('Candidate cannot open closed offer (404)', closedDet.status === 404, `status=${closedDet.status}`);
  const recList = await call('GET', '/offres?mine=1', { token: tok1 });
  step('Recruiter ?mine=1 lists own offers', recList.json?.data?.items?.length === 3, `count=${recList.json?.data?.items?.length}`);

  // Offre expirée : création refusée (date passée) et score de matching bloqué
  const expired = await call('POST', '/offres', { token: tok1, body: { ...off, titre_offre: 'Offre expiree', date_expiration: '2020-01-01', statut_offre: 'Ouverte' } });
  step('POST /offres avec date passée → 422', expired.status === 422, `status=${expired.status} ${expired.json?.message || ''}`);
  const matchExpired = await call('GET', `/offres/${expired.json?.data?.id_offre || 999999}/matching`, { token: tok2 });
  step('Score de matching refusé si offre indisponible (404)', matchExpired.status === 404, `status=${matchExpired.status} ${matchExpired.json?.message || ''}`);

  const up = await call('PUT', `/offres/${offId}`, { token: tok1, body: { salaire: 1800 } });
  step('PUT /offres/:id', up.status === 200);

  // Candidate re-applies (after cancel) for the rest of the flow
  const reapply = await call('POST', `/offres/${offId}/postuler`, { token: tok2, body: { lettre_motivation: 'Nouvelle candidature' } });
  step('Re-apply after cancel → 409 (apply once)', reapply.status === 409, `status=${reapply.status} ${reapply.json?.message || ''}`);

  // Contacts + messaging
  const contacts = await call('GET', '/messages/contacts', { token: tok2 });
  step('GET /messages/contacts (candidat → recruteur)', contacts.status === 200 && contacts.json?.data?.items?.some((u) => u.id_utilisateur === id1), `contacts=${contacts.json?.data?.items?.length}`);
  const msg = await call('POST', '/messages', { token: tok2, body: { id_destinataire: id1, contenu: 'Bonjour, votre offre est interessante' } });
  step('POST /messages', msg.status === 201);
  const conv = await call('GET', `/messages/${id1}`, { token: tok2 });
  step('GET /messages/:userId', conv.json?.data?.items?.length === 1);

  // Suivi de lecture des messages : le destinataire (recruteur tok1) a 1 non lu,
  // puis 0 après avoir ouvert le fil.
  const unread1 = await call('GET', '/messages/non-lus', { token: tok1 });
  step('GET /messages/non-lus (1 non lu côté destinataire)', unread1.json?.data?.total >= 1, `total=${unread1.json?.data?.total}`);
  await call('GET', `/messages/${id2}`, { token: tok1 });
  const unread0 = await call('GET', '/messages/non-lus', { token: tok1 });
  step('Lecture du fil → 0 non lu', unread0.json?.data?.total === 0, `total=${unread0.json?.data?.total}`);
  const notifUnread = await call('GET', '/notifications/non-lues', { token: tok1 });
  step('GET /notifications/non-lues', notifUnread.status === 200 && typeof notifUnread.json?.data?.total === 'number', `total=${notifUnread.json?.data?.total}`);

  // Authentification par cookie httpOnly (transport navigateur du même JWT)
  const loginCookie = await raw('POST', '/auth/login', { email: 'admin@example.com', mot_de_passe: 'Admin123!' });
  step('Login API pose un cookie gc_token httpOnly', loginCookie.cookies.some((c) => c.startsWith('gc_token=') && /HttpOnly/i.test(c)), JSON.stringify(loginCookie.cookies));
  const cookieToken = (loginCookie.cookies.find((c) => c.startsWith('gc_token=')) || '').split(';')[0].slice('gc_token='.length);
  const meViaCookie = await raw('GET', '/auth/me', null, { cookie: `gc_token=${cookieToken}` });
  step('GET /api/auth/me via cookie httpOnly', meViaCookie.status === 200);
  const logoutCookie = await raw('POST', '/auth/logout', null, { cookie: `gc_token=${cookieToken}`, headers: { Authorization: `Bearer ${adminToken}` } });
  step('Logout API supprime le cookie', logoutCookie.cookies.some((c) => c.startsWith('gc_token=;') || /^gc_token=;/.test(c)), logoutCookie.status);

  // Changement de mot de passe (validation du mot de passe actuel)
  const wrongPass = await call('PUT', '/auth/mot-de-passe', { token: tok2, body: { mot_de_passe_actuel: 'FAUX', nouveau_mot_de_passe: 'Nouveau123!' } });
  step('PUT /auth/mot-de-passe mauvais actuel → 401', wrongPass.status === 401, `status=${wrongPass.status}`);
  const shortPass = await call('PUT', '/auth/mot-de-passe', { token: tok2, body: { mot_de_passe_actuel: 'Secret123!', nouveau_mot_de_passe: '123' } });
  step('PUT /auth/mot-de-passe trop court → 422', shortPass.status === 422);
  const okPass = await call('PUT', '/auth/mot-de-passe', { token: tok2, body: { mot_de_passe_actuel: 'Secret123!', nouveau_mot_de_passe: 'Nouveau123!' } });
  const relogin = await call('POST', '/auth/login', { body: { email: 'aline.kabila@test.com', mot_de_passe: 'Nouveau123!' } });
  step('Mot de passe changé puis re-connexion', okPass.status === 200 && relogin.status === 200);

  // Gestion d'entreprise par le recruteur propriétaire (et blocage sur celle d'autrui)
  const recrCompany = await call('GET', '/entreprises/mine', { token: tok1 });
  const recrCompId = recrCompany.json?.data?.items?.find((c) => c.status === 'approved')?.id_entreprise;
  step('GET /api/entreprises/mine (recruteur)', recrCompany.status === 200 && !!recrCompId, `id=${recrCompId}`);
  const updComp = await call('PUT', `/entreprises/${recrCompId}`, { token: tok1, body: { description: 'Description recruteur mise a jour', telephone: '+243000000' } });
  step('PUT /entreprises/:id propriétaire', updComp.status === 200 && updComp.json?.data?.company?.description === 'Description recruteur mise a jour');
  const updStatus = await call('PUT', `/entreprises/${recrCompId}`, { token: tok1, body: { status: 'pending' } });
  step('Statut entreprise NON modifiable via update', updStatus.status === 200 && updStatus.json?.data?.company?.status === 'approved');
  const noCompany = await call('GET', '/entreprises/mine', { token: tok2 });
  step('GET /api/entreprises/mine (candidat → vide)', noCompany.status === 200 && (noCompany.json?.data?.items || []).length === 0);

  const stats = await call('GET', '/admin/statistiques', { token: adminToken });
  step('GET /admin/statistiques', stats.status === 200);
  const forb = await call('GET', '/admin/statistiques', { token: tok2 });
  step('Candidate blocked from admin (403)', forb.status === 403);

  // Offer delete + user status 404
  const del = await call('DELETE', `/offres/${offId}`, { token: tok1 });
  step('DELETE /offres/:id', del.status === 200);
  const del2 = await call('DELETE', `/offres/${offId}`, { token: tok1 });
  step('DELETE non-owned/unknown → 404', del2.status === 404);
  const us404 = await call('PATCH', '/admin/utilisateurs/99999/statut', { token: adminToken, body: { statut_compte: 'suspendu' } });
  step('User status unknown → 404', us404.status === 404, `status=${us404.status}`);

  const failed = results.filter((r) => !r.ok);
  console.log(`\n==== ${results.length - failed.length}/${results.length} passed, ${failed.length} failed ====`);
  process.exit(failed.length ? 1 : 0);
};

run().catch((e) => { console.error('TEST CRASH:', e); process.exit(1); });
