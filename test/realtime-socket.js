/* Tests temps réel (Socket.IO) — exécution contre un serveur démarré.
   Prérequis : serveur lancé (PORT .env) + base initialisée + compte admin
   (admin@example.com / Admin123! — configurables via ADMIN_EMAIL/ADMIN_PASS).

   Couvre : auth Socket.IO, rooms utilisateurs, messages privés + compteurs,
   notifications, offres (création/modification/suppression), candidatures
   (nouvelle + statut), compétences (création/suppression), sécurité.
*/
const { io } = require('socket.io-client');
const BASE = 'http://127.0.0.1:' + (process.env.PORT || 5100);
const results = [];
const step = (name, ok, detail = '') => {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  → ' + detail : ''}`);
};

const call = async (method, path, { token, body, form } = {}) => {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  let payload;
  if (form) payload = form;
  else { headers['Content-Type'] = 'application/json'; payload = body === undefined ? undefined : JSON.stringify(body); }
  const res = await fetch(`${BASE}/api${path}`, { method, headers, body: payload });
  let json = null;
  try { json = await res.json(); } catch (_) {}
  return { status: res.status, json };
};

const once = (socket, event, timeout = 5000) => new Promise((resolve, reject) => {
  const timer = setTimeout(() => { socket.off(event, handler); reject(new Error(`timeout ${event}`)); }, timeout);
  const handler = (payload) => { clearTimeout(timer); socket.off(event, handler); resolve(payload); };
  socket.once(event, handler);
});

const connect = (token) => new Promise((resolve, reject) => {
  const socket = io(BASE.replace('http', 'ws'), { auth: { token }, transports: ['websocket'], reconnection: false });
  socket.once('connect', () => resolve(socket));
  socket.once('connect_error', (err) => reject(err));
  setTimeout(() => reject(new Error('connect timeout')), 5000);
});

const run = async () => {
  const suffix = Date.now().toString(36);
  const adminToken = process.env.ADMIN_TOKEN ||
    (await call('POST', '/auth/login', { body: { email: process.env.ADMIN_EMAIL || 'admin@example.com', mot_de_passe: process.env.ADMIN_PASS || 'Admin123!' } })).json?.data?.token;

  /* --- Création de 3 utilisateurs frais (candidats) --- */
  const reg = (tag) => call('POST', '/auth/register', { body: { nom: `Test${tag}`, prenom: `RT${suffix}`, email: `rt.${tag}.${suffix}@test.com`, mot_de_passe: 'Secret123!', telephone: '+243800000009' } });
  const [ra, rb, rc] = [await reg('a'), await reg('b'), await reg('c')];
  const tokA = ra.json?.data?.token, tokB = rb.json?.data?.token, tokC = rc.json?.data?.token;
  const idA = ra.json?.data?.user?.id_utilisateur, idB = rb.json?.data?.user?.id_utilisateur;
  step('3 candidats créés', [ra, rb, rc].every((r) => r.status === 201) && !!tokA && !!tokB && !!tokC);

  /* --- Auth Socket.IO --- */
  let authOk = false;
  try { await connect('token-invalide'); } catch (_) { authOk = true; }
  step('Socket sans jeton valide → refusé', authOk);

  const [sockA, sockB, sockC] = await Promise.all([connect(tokA), connect(tokB), connect(tokC)]);
  await new Promise((r) => setTimeout(r, 300)); // laisse les rooms se joindre
  step('3 sockets connectés et authentifiés', sockA.connected && sockB.connected && sockC.connected);

  /* --- Messagerie privée : A → B --- */
  let payload = null;
  const p1 = once(sockB, 'nouveau_message');
  const m1 = await call('POST', '/messages', { token: tokA, body: { id_destinataire: idB, contenu: 'Bonjour B (1)' } });
  payload = await p1;
  step('A → B : B reçoit nouveau_message', m1.status === 201 && payload?.message?.contenu === 'Bonjour B (1)' && Number(payload.message.id_destinataire) === idB);

  let cnt = await call('GET', '/messages/non-lus', { token: tokB });
  step('Compteur non lus de B = 1', cnt.json?.data?.total === 1, `total=${cnt.json?.data?.total}`);

  /* --- Plusieurs messages : compteur croissant --- */
  const p2 = once(sockB, 'nouveau_message');
  await call('POST', '/messages', { token: tokA, body: { id_destinataire: idB, contenu: 'Bonjour B (2)' } });
  await p2;
  cnt = await call('GET', '/messages/non-lus', { token: tokB });
  step('Compteur non lus de B = 2', cnt.json?.data?.total === 2, `total=${cnt.json?.data?.total}`);

  /* --- B lit la conversation → A informé (message_lu), compteur à 0 --- */
  const lu = once(sockA, 'message_lu');
  const conv = await call('GET', `/messages/${idA}`, { token: tokB });
  const luPayload = await lu;
  cnt = await call('GET', '/messages/non-lus', { token: tokB });
  step('B lit → message_lu reçu par A', conv.status === 200 && luPayload?.id_expediteur === idA && luPayload?.id_destinataire === idB, `non_lus=${cnt.json?.data?.total}`);
  step('Compteur non lus de B = 0', cnt.json?.data?.total === 0, `total=${cnt.json?.data?.total}`);

  /* --- Notifications : B a reçu une notification à chaque message --- */
  const notif1 = once(sockB, 'nouvelle_notification');
  await call('POST', '/messages', { token: tokA, body: { id_destinataire: idB, contenu: 'Avec notification' } });
  const notifPayload = await notif1;
  step('Notification temps réel chez B', notifPayload?.notification?.contenu_notification === 'Vous avez reçu un nouveau message.');
  const ncnt = await call('GET', '/notifications/non-lues', { token: tokB });
  step('Compteur notifications B = 3 (une par message)', ncnt.json?.data?.total === 3, `total=${ncnt.json?.data?.total}`);

  /* --- Sécurité : A → C ne doit JAMAIS arriver à B --- */
  let leak = false;
  const guard = () => { leak = true; };
  sockB.on('nouveau_message', guard);
  await call('POST', '/messages', { token: tokA, body: { id_destinataire: rc.json?.data?.user?.id_utilisateur, contenu: 'Privé pour C' } });
  await new Promise((r) => setTimeout(r, 800));
  sockB.off('nouveau_message', guard);
  step('A → C : B ne reçoit pas le message privé', !leak);

  /* --- Devenir recruteur : demande entreprise + approbation admin --- */
  const fd = new FormData();
  fd.append('nom_entreprise', `Temps Reel SARL ${suffix}`);
  fd.append('secteur_activite', 'Informatique');
  fd.append('adresse', '12 Av. du Commerce');
  fd.append('pays', 'RDC');
  fd.append('ville', 'Kinshasa');
  fd.append('telephone', '+243810000099');
  fd.append('email', `rt.company.${suffix}@test.com`);
  fd.append('description', 'Entreprise de test temps réel');
  fd.append('numero_rccm', `RCCM-RT-${suffix}`);
  fd.append('supporting_documents', new Blob(['%PDF-1.4 fake'], { type: 'application/pdf' }), 'rccm.pdf');
  const comp = await call('POST', '/entreprises/demande-recruteur', { token: tokA, form: fd });
  const pend = await call('GET', '/admin/companies/pending', { token: adminToken });
  const myComp = (pend.json?.data?.items || []).find((c) => c.id_utilisateur === idA);
  const appr = myComp ? await call('PUT', `/admin/companies/${myComp.id_entreprise}/approve`, { token: adminToken, body: {} }) : null;
  step('A devient recruteur (entreprise approuvée)', comp.status === 201 && !!appr && appr.status === 200, `comp=${comp.status} appr=${appr?.status}`);

  /* --- Offre créée → B (candidat) la reçoit --- */
  const offNov = once(sockB, 'nouvelle_offre');
  const off = await call('POST', '/offres', { token: tokA, body: { titre_offre: `Dev Temps Reel ${suffix}`, description_offre: 'Poste temps réel', salaire: 2000, localisation: 'Kinshasa', date_expiration: '2027-12-31', statut_offre: 'Ouverte' } });
  const offPayload = await offNov;
  const offId = off.json?.data?.id_offre;
  step('Offre créée → B reçoit nouvelle_offre', off.status === 201 && offPayload?.offer?.id_offre === offId && offPayload.offer.statut_offre === 'Ouverte');

  /* --- Offre modifiée → B reçoit offre_modifiee --- */
  const offMod = once(sockB, 'offre_modifiee');
  const up = await call('PUT', `/offres/${offId}`, { token: tokA, body: { salaire: 2500 } });
  const modPayload = await offMod;
  step('Offre modifiée → B reçoit offre_modifiee', up.status === 200 && Number(modPayload?.offer?.salaire) === 2500);

  /* --- Candidature → A (recruteur) reçoit nouvelle_candidature --- */
  const cand = once(sockA, 'nouvelle_candidature');
  const ap = await call('POST', `/offres/${offId}/postuler`, { token: tokB, body: { lettre_motivation: 'Je postule en temps réel' } });
  const candPayload = await cand;
  step('B postule → A reçoit nouvelle_candidature', ap.status === 201 && candPayload?.candidature?.id_utilisateur === idB && candPayload.candidature.statut_candidature === 'En attente', `ap=${ap.status}`);

  /* --- Statut modifié → B reçoit candidature_statut_modifie + notification --- */
  const stNotif = once(sockB, 'candidature_statut_modifie');
  const st = await call('PATCH', `/candidatures/${candPayload.candidature.id_candidature}/statut`, { token: tokA, body: { statut_candidature: 'Entretien' } });
  const stPayload = await stNotif;
  step('Statut Entretien → B reçoit candidature_statut_modifie', st.status === 200 && stPayload?.statut_candidature === 'Entretien' && stPayload?.id_candidature === candPayload.candidature.id_candidature);

  /* --- Compétence créée puis supprimée par l'admin → diffusée --- */
  const skNew = once(sockB, 'nouvelle_competence');
  const sk = await call('POST', '/competences', { token: adminToken, body: { nom_competence: `SkillRT ${suffix}`, description: 'créée en test' } });
  const skPayload = await skNew;
  step('Compétence créée → B reçoit nouvelle_competence', sk.status === 201 && skPayload?.competence?.nom_competence === `SkillRT ${suffix}`);
  const skDel = once(sockB, 'competence_supprimee');
  const del = await call('DELETE', `/competences/${skPayload.competence.id_competence}`, { token: adminToken });
  const skDelPayload = await skDel;
  step('Compétence supprimée → B reçoit competence_supprimee', del.status === 200 && Number(skDelPayload?.id_competence) === Number(skPayload.competence.id_competence));

  /* --- Offre supprimée → B reçoit offre_supprimee --- */
  const offSup = once(sockB, 'offre_supprimee');
  const delOff = await call('DELETE', `/offres/${offId}`, { token: tokA });
  const supPayload = await offSup;
  step('Offre supprimée → B reçoit offre_supprimee', delOff.status === 200 && Number(supPayload?.id_offre) === offId);

  sockA.close(); sockB.close(); sockC.close();

  const failed = results.filter((r) => !r.ok);
  console.log(`\n==== ${results.length - failed.length}/${results.length} passed, ${failed.length} failed ====`);
  process.exit(failed.length ? 1 : 0);
};

run().catch((e) => { console.error('TEST CRASH:', e); process.exit(1); });