/**
 * Tests unitaires du moteur de matching — aucune base MySQL nécessaire.
 *
 * Les tests utilisent le vrai service et un faux pool mémoire : ils vérifient
 * la formule, les cas limites et l'upsert de la table matching sans toucher à
 * une base existante.
 *
 * Exécution : node test/matching-unit.js
 */
const assert = require('node:assert/strict');
const db = require('../src/config/database');
const matching = require('../src/services/matching.service');

const required = [
  { id_offre: 101, id_competence: 1, niveau_requis: 'Intermédiaire' },
  { id_offre: 101, id_competence: 2, niveau_requis: 'Avancé' },
  { id_offre: 101, id_competence: 3, niveau_requis: 'Expert' }
];
const skills = [
  { id_utilisateur: 1, id_competence: 1, niveau_competence: 'Intermédiaire' },
  { id_utilisateur: 1, id_competence: 2, niveau_competence: 'Avancé' },
  { id_utilisateur: 1, id_competence: 3, niveau_competence: 'Expert' },
  { id_utilisateur: 2, id_competence: 1, niveau_competence: 'Intermédiaire' },
  { id_utilisateur: 2, id_competence: 2, niveau_competence: 'Avancé' },
  { id_utilisateur: 3, id_competence: 9, niveau_competence: 'Expert' }
];
const applications = [
  { id_utilisateur: 1, id_offre: 101 },
  { id_utilisateur: 2, id_offre: 101 },
  { id_utilisateur: 3, id_offre: 101 }
];
// Ligne historique volontairement fausse : syncOffer/syncUser doit la corriger.
const matchingRows = [{ id_utilisateur: 1, id_offre: 101, score_compatibilite: 0 }];
const calls = [];

const idsIn = (params, values) => values.some((value) => params.includes(value));

// Faux pool strictement limité aux requêtes utilisées par matching.service.js.
db.execute = async (sql, params = []) => {
  calls.push({ sql, params });

  if (/SELECT id_utilisateur, id_offre FROM matching/i.test(sql)) {
    const offerId = params[0];
    const userId = params[0];
    const rows = /id_offre = \?/i.test(sql)
      ? matchingRows.filter((row) => Number(row.id_offre) === Number(offerId))
      : matchingRows.filter((row) => Number(row.id_utilisateur) === Number(userId));
    const fromApplications = /FROM candidature/i.test(sql)
      ? applications.filter((row) => /id_offre = \?/i.test(sql)
        ? Number(row.id_offre) === Number(params[1])
        : Number(row.id_utilisateur) === Number(params[1]))
      : [];
    return [[...rows, ...fromApplications].map(({ id_utilisateur, id_offre }) => ({ id_utilisateur, id_offre })), []];
  }

  if (/SELECT id_offre, id_competence, niveau_requis FROM offre_competence/i.test(sql)) {
    return [required.filter((row) => idsIn(params, [row.id_offre])), []];
  }
  if (/SELECT id_competence, niveau_requis FROM offre_competence/i.test(sql)) {
    return [required.filter((row) => Number(row.id_offre) === Number(params[0]))
      .map(({ id_competence, niveau_requis }) => ({ id_competence, niveau_requis })), []];
  }
  if (/SELECT (?:id_competence, niveau_competence|id_utilisateur, id_competence, niveau_competence) FROM utilisateur_competence/i.test(sql)) {
    return [skills.filter((row) => idsIn(params, [row.id_utilisateur])), []];
  }
  if (/SELECT id_utilisateur, id_offre, score_compatibilite FROM matching/i.test(sql)) {
    return [matchingRows.filter((row) =>
      params.includes(row.id_offre) && params.includes(row.id_utilisateur)
    ), []];
  }
  if (/INSERT INTO matching/i.test(sql)) {
    const [id_utilisateur, id_offre, score_compatibilite] = params;
    const row = matchingRows.find((item) => item.id_utilisateur === id_utilisateur && item.id_offre === id_offre);
    if (row) row.score_compatibilite = score_compatibilite;
    else matchingRows.push({ id_utilisateur, id_offre, score_compatibilite });
    return [{ affectedRows: 1 }, []];
  }

  throw new Error(`Requête inattendue dans le faux pool : ${sql}`);
};

const run = async () => {
  const all = matching.computeScore(required.map(({ id_offre, ...row }) => row), skills.filter((row) => row.id_utilisateur === 1));
  assert.equal(all.score, 100, 'A — toutes les compétences requises : 100 %');
  assert.equal(all.matched, 3);

  const partial = matching.computeScore(required.map(({ id_offre, ...row }) => row), skills.filter((row) => row.id_utilisateur === 2));
  assert.equal(partial.score, 66.67, 'B — deux compétences sur trois : 66,67 %');
  assert.equal(partial.matched, 2);

  const none = matching.computeScore(required.map(({ id_offre, ...row }) => row), skills.filter((row) => row.id_utilisateur === 3));
  assert.equal(none.score, 0, 'C — aucune compétence correspondante : 0 %');
  assert.equal(matching.canAccess(none), false);

  // D/E — l'expérience n'est pas injectée dans score_compatibilite : absence
  // ou présence d'expérience ne change pas le calcul des compétences.
  assert.equal(matching.computeScore([], []).score, 0, 'D — candidat sans expérience/compétence, offre sans prérequis : score numérique 0');
  assert.equal(matching.canAccess({ score: 0, required: 0 }), true, 'G — offre sans compétence : accessible');
  assert.equal(matching.experienceScore([], []).score, 0, 'D — candidat sans expérience : expérience complémentaire à 0');
  assert.equal(matching.experienceScore([{ date_debut: '2020-01-01', date_fin: '2021-01-01', poste: 'Développeur', entreprise: 'X' }], ['developpeur']).score > 0, true, 'E — expérience présente : score d’expérience complémentaire');
  const calculated = await matching.calculate(1, 101);
  assert.equal(calculated.score, 100, 'calcul/persistance — score renvoyé sur 100');
  assert.equal(matchingRows.find((row) => row.id_utilisateur === 1).score_compatibilite, 100, 'calcul/persistance — score écrit dans matching');

  // H/I/J — recalcul avec et sans ligne existante, plusieurs candidatures,
  // puis lecture de la projection en mémoire sans doublon.
  const synced = await matching.syncPairs([
    { id_utilisateur: 1, id_offre: 101 },
    { id_utilisateur: 2, id_offre: 101 },
    { id_utilisateur: 2, id_offre: 101 },
    { id_utilisateur: 3, id_offre: 101 }
  ]);
  assert.equal(synced.size, 3, 'J — trois couples uniques pour plusieurs candidatures');
  assert.equal(synced.get('1:101').score, 100);
  assert.equal(synced.get('2:101').score, 66.67);
  assert.equal(synced.get('3:101').score, 0);
  assert.equal(matchingRows.filter((row) => row.id_offre === 101).length, 3, 'H/I — upsert sans doublon, ligne créée si absente');
  assert.equal(matchingRows.find((row) => row.id_utilisateur === 2).score_compatibilite, 66.67);

  await matching.syncUser(2);
  await matching.syncOffer(101);
  assert.equal(matchingRows.length, 3, 'recalcul utilisateur/offre ciblé : aucune ligne supplémentaire');
  assert.equal(calls.some((call) => /LIMIT|OFFSET/i.test(call.sql)), false, 'pagination absente du calcul matching');

  console.log(`PASS matching-unit — ${calls.length} requêtes simulées, cas A à J couverts.`);
};

run().catch((error) => {
  console.error('FAIL matching-unit:', error.message);
  process.exitCode = 1;
});
