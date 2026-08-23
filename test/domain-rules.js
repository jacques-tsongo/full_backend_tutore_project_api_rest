/**
 * Tests des règles métier « domaines professionnels » (cas 1 à 14 du cahier
 * des charges). Exécution : serveur démarré + base contenant au moins les
 * domaines Informatique / Santé et des compétences classées.
 *
 *   node test/domain-rules.js
 *
 * Le script crée ses propres comptes jetables (suffixe horodaté) : il ne
 * modifie ni ne supprime aucune donnée existante.
 */
const BASE = `http://127.0.0.1:${process.env.PORT || 5000}/api`;
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

  /* -------- Contexte : domaines + admin -------- */
  const admin = await call('POST', '/auth/login', { body: { email: 'admin@test.local', mot_de_passe: 'Admin123!' } });
  const adminTok = admin.json?.data?.token;
  if (!adminTok) { console.error('Admin de test introuvable — préparez la base.'); process.exit(1); }

  const doms = await call('GET', '/domaines', { token: adminTok });
  const domainByName = Object.fromEntries((doms.json?.data?.items || []).map((d) => [d.nom_domaine, Number(d.id_domaine)]));
  const INFO = domainByName['Informatique'];
  const SANTE = domainByName['Santé'];
  if (!INFO || !SANTE) { console.error('Domaines Informatique/Santé requis.'); process.exit(1); }

  /* -------- CAS 1-3 : inscription avec domaine (sélection directe côté
     frontend, puis persistance à la soumission du formulaire) -------- */
  // CAS 2 : tant que le formulaire n'est pas soumis avec un id_domaine,
  // rien n'est enregistré → une inscription SANS domaine échoue.
  const noDomain = await call('POST', '/auth/register', {
    body: { nom: 'Sans', prenom: 'Domaine', email: `nodomain.${stamp}@test.local`, mot_de_passe: 'Secret123!' }
  });
  step('CAS 2 — sans id_domaine soumis, rien n\'est enregistré', noDomain.status === 422, `status=${noDomain.status}`);

  // CAS 1/3 : l'utilisateur sélectionne Informatique → domaine enregistré.
  const cand1 = await call('POST', '/auth/register', {
    body: { nom: 'Info', prenom: 'Cand', email: `info.${stamp}@test.local`, mot_de_passe: 'Secret123!', id_domaine: INFO }
  });
  const tokInfo = cand1.json?.data?.token;
  step('CAS 3 — sélection Informatique → domaine enregistré', cand1.status === 201 && !!tokInfo, `status=${cand1.status}`);
  const prof1 = await call('GET', '/profil', { token: tokInfo });
  step('CAS 3bis — le profil porte bien id_domaine Informatique', Number(prof1.json?.data?.profile?.id_domaine) === INFO);

  // Candidat Santé pour la suite.
  const cand2 = await call('POST', '/auth/register', {
    body: { nom: 'Sante', prenom: 'Cand', email: `sante.${stamp}@test.local`, mot_de_passe: 'Secret123!', id_domaine: SANTE }
  });
  const tokSante = cand2.json?.data?.token;

  /* -------- CAS 4 : changement de domaine refusé côté backend -------- */
  const change = await call('PUT', '/profil', { token: tokInfo, body: { id_domaine: SANTE } });
  step('CAS 4 — tentative de changer Informatique → Santé refusée (403)', change.status === 403, `status=${change.status} ${change.json?.message || ''}`);
  const prof1b = await call('GET', '/profil', { token: tokInfo });
  step('CAS 4bis — le domaine reste Informatique', Number(prof1b.json?.data?.profile?.id_domaine) === INFO);

  /* -------- CAS 5/6 : catalogue de compétences filtré par domaine -------- */
  // Vérification par id_domaine (les catalogues peuvent contenir d'autres
  // compétences du même domaine créées par des exécutions précédentes).
  const catInfo = await call('GET', '/competences?limit=200', { token: tokInfo });
  const infoItems = catInfo.json?.data?.items || [];
  const infoNames = infoItems.map((c) => c.nom_competence);
  step('CAS 5 — candidat Informatique : uniquement compétences Informatique',
    infoItems.length > 0 && infoItems.every((c) => Number(c.id_domaine) === INFO) && !infoNames.includes('Cardiologie'),
    infoNames.join(','));
  const catSante = await call('GET', '/competences?limit=200', { token: tokSante });
  const santeItems = catSante.json?.data?.items || [];
  const santeNames = santeItems.map((c) => c.nom_competence);
  step('CAS 6 — candidat Santé : uniquement compétences Santé',
    santeItems.length > 0 && santeItems.every((c) => Number(c.id_domaine) === SANTE) && !santeNames.includes('JavaScript'),
    santeNames.join(','));

  // Contrôle serveur : le candidat Santé ne peut pas s'attribuer JavaScript.
  const catalogAll = await call('GET', '/competences?limit=500', { token: adminTok });
  const allSkills = Object.fromEntries((catalogAll.json?.data?.items || []).map((c) => [c.nom_competence, Number(c.id_competence)]));
  const crossSkill = await call('POST', '/mes-competences', { token: tokSante, body: { id_competence: allSkills['JavaScript'], niveau_competence: 'Avancé' } });
  step('CAS 6bis — candidat Santé + compétence Informatique via API → refusé', crossSkill.status === 403, `status=${crossSkill.status}`);
  const okSkill = await call('POST', '/mes-competences', { token: tokSante, body: { id_competence: allSkills['Cardiologie'], niveau_competence: 'Avancé' } });
  step('CAS 6ter — candidat Santé + compétence Santé → accepté', okSkill.status === 200, `status=${okSkill.status}`);
  await call('POST', '/mes-competences', { token: tokInfo, body: { id_competence: allSkills['JavaScript'], niveau_competence: 'Avancé' } });

  /* -------- Entreprise Informatique (workflow existant) -------- */
  const fd = new FormData();
  fd.append('nom_entreprise', `Tech Domaines ${stamp}`);
  fd.append('id_domaine', String(INFO));
  fd.append('secteur_activite', 'Informatique');
  fd.append('adresse', '1 Av. Test');
  fd.append('ville', 'Kinshasa');
  fd.append('pays', 'RDC');
  fd.append('telephone', '+243800000009');
  fd.append('email', `techdom.${stamp}@test.local`);
  fd.append('description', 'Entreprise de test des règles de domaine');
  fd.append('numero_rccm', `RCCM/TEST/${stamp}`);
  fd.append('supporting_documents', new Blob(['%PDF-1.4 test'], { type: 'application/pdf' }), 'doc.pdf');
  const recruiterReg = await call('POST', '/auth/register', {
    body: { nom: 'Rec', prenom: 'Info', email: `rec.${stamp}@test.local`, mot_de_passe: 'Secret123!', id_domaine: INFO }
  });
  let tokRec = recruiterReg.json?.data?.token;
  const compReq = await call('POST', '/entreprises/demande-recruteur', { token: tokRec, form: fd });
  const pend = await call('GET', '/admin/companies/pending', { token: adminTok });
  const myCompany = (pend.json?.data?.items || []).find((c) => c.nom_entreprise === `Tech Domaines ${stamp}`);
  await call('PUT', `/admin/companies/${myCompany.id_entreprise}/approve`, { token: adminTok, body: {} });
  // Nouveau token avec rôle recruteur.
  const relog = await call('POST', '/auth/login', { body: { email: `rec.${stamp}@test.local`, mot_de_passe: 'Secret123!' } });
  tokRec = relog.json?.data?.token;
  step('Entreprise Informatique approuvée (contexte)', compReq.status === 201 && !!myCompany);

  /* -------- CAS 13/14 : domaine d'entreprise verrouillé -------- */
  const changeComp = await call('PUT', `/entreprises/${myCompany.id_entreprise}`, { token: tokRec, body: { id_domaine: SANTE } });
  step('CAS 13/14 — changement du domaine de l\'entreprise via API → refusé (403)', changeComp.status === 403, `status=${changeComp.status} ${changeComp.json?.message || ''}`);

  /* -------- CAS 7 : offre — compétences limitées au domaine de l'entreprise ---- */
  const badOffer = await call('POST', '/offres', {
    token: tokRec,
    body: {
      titre_offre: 'Offre invalide', description_offre: 'x', localisation: 'Kinshasa',
      date_expiration: '2027-01-01', competences: [allSkills['Cardiologie']]
    }
  });
  step('CAS 7 — offre avec compétence hors domaine (Cardiologie) → refusée', badOffer.status === 403, `status=${badOffer.status}`);
  const goodOffer = await call('POST', '/offres', {
    token: tokRec,
    body: {
      titre_offre: `Développeur Node.js ${stamp}`, description_offre: 'Offre de test', localisation: 'Kinshasa',
      date_expiration: '2027-01-01', competences: [allSkills['JavaScript']]
    }
  });
  const offerId = goodOffer.json?.data?.id_offre;
  step('CAS 7bis — offre avec compétence du domaine (JavaScript) → créée', goodOffer.status === 201 && !!offerId, `status=${goodOffer.status}`);

  // setSkills : hors domaine refusé également.
  const badSet = await call('PUT', `/offres/${offerId}/competences`, { token: tokRec, body: { competences: [{ id_competence: allSkills['Pédiatrie'], niveau_requis: 'Débutant' }] } });
  step('CAS 7ter — maj compétences d\'offre hors domaine → refusée', badSet.status === 403, `status=${badSet.status}`);

  /* -------- CAS 8 : liste des offres filtrée par domaine -------- */
  const listInfo = await call('GET', '/offres', { token: tokInfo });
  const infoSees = (listInfo.json?.data?.items || []).some((o) => Number(o.id_offre) === Number(offerId));
  step('CAS 10bis — candidat Informatique voit l\'offre Informatique', infoSees);
  const listSante = await call('GET', '/offres', { token: tokSante });
  const santeSees = (listSante.json?.data?.items || []).some((o) => Number(o.id_offre) === Number(offerId));
  step('CAS 8 — candidat Santé ne voit PAS l\'offre Informatique', !santeSees, `items=${listSante.json?.data?.items?.length}`);

  /* -------- CAS 9/10 : notifications filtrées par domaine -------- */
  const notifInfo = await call('GET', '/notifications', { token: tokInfo });
  const infoNotified = (notifInfo.json?.data?.items || []).some((n) => String(n.contenu_notification).includes(`Développeur Node.js ${stamp}`));
  step('CAS 10 — candidat Informatique (compatible) a reçu la notification', infoNotified);
  const notifSante = await call('GET', '/notifications', { token: tokSante });
  const santeNotified = (notifSante.json?.data?.items || []).some((n) => String(n.contenu_notification).includes(`Développeur Node.js ${stamp}`));
  step('CAS 9 — candidat Santé n\'a reçu AUCUNE notification', !santeNotified);

  /* -------- CAS 11 : accès direct à /offres/:id -------- */
  const directInfo = await call('GET', `/offres/${offerId}`, { token: tokInfo });
  step('CAS 11bis — accès direct autorisé pour le candidat Informatique', directInfo.status === 200, `status=${directInfo.status}`);
  const directSante = await call('GET', `/offres/${offerId}`, { token: tokSante });
  step('CAS 11 — accès direct refusé pour le candidat Santé', directSante.status === 403, `status=${directSante.status}`);

  /* -------- CAS 12 : candidature inter-domaines refusée -------- */
  const applySante = await call('POST', `/offres/${offerId}/postuler`, { token: tokSante, body: {} });
  step('CAS 12 — candidature du candidat Santé sur offre Informatique → refusée', applySante.status === 403, `status=${applySante.status}`);
  const applyInfo = await call('POST', `/offres/${offerId}/postuler`, { token: tokInfo, body: { lettre_motivation: 'Test' } });
  step('CAS 12bis — candidature du candidat Informatique → acceptée', applyInfo.status === 201, `status=${applyInfo.status}`);

  /* -------- Compétences : création admin sans domaine refusée -------- */
  const badSkill = await call('POST', '/competences', { token: adminTok, body: { nom_competence: `SansDomaine${stamp}` } });
  step('Création de compétence sans domaine (admin) → refusée (422)', badSkill.status === 422, `status=${badSkill.status}`);
  const goodSkill = await call('POST', '/competences', { token: adminTok, body: { nom_competence: `Express${stamp}`, id_domaine: INFO } });
  step('Création de compétence avec domaine (admin) → acceptée', goodSkill.status === 201, `status=${goodSkill.status}`);

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} tests OK`);
  process.exit(failed.length ? 1 : 0);
};

run().catch((e) => { console.error(e); process.exit(1); });
