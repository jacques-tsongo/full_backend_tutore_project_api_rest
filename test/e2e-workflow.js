/* E2E test of the complete workflow — run with ADMIN_TOKEN env var. */
const BASE = 'http://127.0.0.1:5000/api';
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
  step('GET /admin/companies/pending', pend.status === 200 && pend.json?.data?.items?.length === 1);
  const comp = pend.json?.data?.items?.[0];
  const appr = await call('PUT', `/admin/companies/${comp.id_entreprise}/approve`, { token: adminToken, body: {} });
  step('PUT /admin/companies/:id/approve', appr.status === 200, `status=${appr.status} ${appr.json?.message || ''}`);
  const apprAgain = await call('PUT', `/admin/companies/${comp.id_entreprise}/approve`, { token: adminToken, body: {} });
  step('Approve already-approved → 409', apprAgain.status === 409, `status=${apprAgain.status}`);
  const me1 = await call('GET', '/auth/me', { token: tok1 });
  step('User promoted to recruteur', me1.json?.data?.user?.role === 'recruteur');

  for (const skill of ['JavaScript', 'Node.js', 'MySQL']) {
    await call('POST', '/competences', { token: adminToken, body: { nom_competence: skill, description: '' } });
  }
  const skills = await call('GET', '/competences', { token: tok2 });
  const [skJs, skNode, skMysql] = skills.json?.data?.items || [];
  step('GET /competences (3)', skills.json?.data?.items?.length === 3);

  // Offer creation — past date must be rejected
  const past = await call('POST', '/offres', { token: tok1, body: { titre_offre: 'X', description_offre: 'Y', localisation: 'Kinshasa', date_expiration: '2020-01-01' } });
  step('Offer with past expiration → 422', past.status === 422, `status=${past.status}`);

  const off = { titre_offre: 'Developpeur Backend Node.js', description_offre: 'Nous recrutons un dev backend', salaire: 1500, localisation: 'Kinshasa', date_expiration: '2026-12-31', statut_offre: 'Ouverte' };
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

  const search = await call('GET', '/offres?q=Backend', { token: tok2 });
  step('GET /offres?q=Backend', search.status === 200 && search.json?.data?.items?.length === 1);

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

  const rec = await call('GET', '/candidatures/recues', { token: tok1 });
  const recRow = rec.json?.data?.items?.[0];
  step('GET /candidatures/recues (1)', rec.json?.data?.items?.length === 1);
  step('Recruiter view has CV/contact/score', !!recRow?.cv && !!recRow?.telephone && recRow?.score_compatibilite !== undefined && !!recRow?.competences, `cv=${recRow?.cv} tel=${recRow?.telephone} score=${recRow?.score_compatibilite} skills=${recRow?.competences}`);

  const st = await call('PATCH', `/candidatures/${candId}/statut`, { token: tok1, body: { statut_candidature: 'Entretien' } });
  step('PATCH statut (statut_candidature)', st.status === 200);
  const st2 = await call('PATCH', `/candidatures/${candId}/statut`, { token: tok1, body: { statut: 'Acceptée' } });
  step('PATCH statut (alias `statut`)', st2.status === 200, `status=${st2.status} ${st2.json?.message || ''}`);
  const stBad = await call('PATCH', `/candidatures/${candId}/statut`, { token: tok1, body: { statut: 'inconnu' } });
  step('PATCH statut invalid → 422', stBad.status === 422);

  const notif = await call('GET', '/notifications', { token: tok2 });
  step('Candidate notified of status', notif.json?.data?.items?.some((n) => n.contenu_notification.includes('Acceptée')));
  const notifRec = await call('GET', '/notifications', { token: tok1 });
  step('Recruiter notified of application', notifRec.json?.data?.items?.some((n) => n.contenu_notification.includes('Nouvelle candidature')));
  const readAll = await call('PATCH', '/notifications/lire-toutes', { token: tok2 });
  step('PATCH /notifications/lire-toutes', readAll.status === 200);

  // Closed offer invisible to candidate who didn't apply
  const o2 = await call('POST', '/offres', { token: tok1, body: { ...off, titre_offre: 'Offre fermee', date_expiration: '2026-12-31', statut_offre: 'Fermée' } });
  const closedId = o2.json?.data?.id_offre;
  const closedList = await call('GET', '/offres', { token: tok2 });
  step('Candidate list hides closed offer', !closedList.json?.data?.items?.some((i) => i.id_offre === closedId));
  const closedDet = await call('GET', `/offres/${closedId}`, { token: tok2 });
  step('Candidate cannot open closed offer (404)', closedDet.status === 404, `status=${closedDet.status}`);
  const recList = await call('GET', '/offres?mine=1', { token: tok1 });
  step('Recruiter ?mine=1 lists own offers', recList.json?.data?.items?.length === 2, `count=${recList.json?.data?.items?.length}`);

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
