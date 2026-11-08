/**
 * Tests anti-IDOR sur les ressources personnelles — aucune base MySQL nécessaire.
 *
 * Une expérience ou un diplôme d'autrui doit être traité exactement comme une
 * ressource inexistante : même 404, même message. Aucun identifiant deviné ne
 * doit permettre la lecture, la modification ou la suppression.
 *
 * Exécution : node test/idor-resources.js
 */
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { owns } = require('../src/controllers/resource.controller');

let checks = 0;
const run = async (name, fn) => {
  try {
    await fn();
    checks += 1;
    console.log(`  OK   ${name}`);
  } catch (error) {
    console.error(`  ECHEC ${name}`);
    console.error(`        ${error.message}`);
    process.exitCode = 1;
  }
};

const stubbed = (row) => ({ get: async () => row });
const user = (id, role = 'candidat') => ({ id_utilisateur: id, role });

(async () => {
  console.log('Tests anti-IDOR (expériences et diplômes)');

  await run('une ressource inexistante renvoie null', async () => {
    const row = await owns('experiences', 99, user(1), stubbed(undefined));
    assert.equal(row, null);
  });

  await run('le propriétaire lit son expérience', async () => {
    const experience = { id_experience: 5, id_utilisateur: 1, poste: 'Dev' };
    const row = await owns('experiences', 5, user(1), stubbed(experience));
    assert.equal(row, experience);
  });

  await run('un candidat ne lit pas l’expérience d’un autre', async () => {
    const row = await owns('experiences', 5, user(2), stubbed({ id_experience: 5, id_utilisateur: 1 }));
    assert.equal(row, false);
  });

  await run('un candidat ne lit pas le diplôme d’un autre', async () => {
    const row = await owns('diplomes', 7, user(2), stubbed({ id_diplome: 7, id_utilisateur: 1 }));
    assert.equal(row, false);
  });

  await run('la comparaison fonctionne aussi avec des identifiants textuels', async () => {
    const experience = { id_experience: 5, id_utilisateur: '1' };
    const row = await owns('experiences', 5, user('1'), stubbed(experience));
    assert.equal(row, experience);
  });

  await run('l’administrateur peut consulter une ressource personnelle', async () => {
    const experience = { id_experience: 5, id_utilisateur: 1 };
    const row = await owns('experiences', 5, user(9, 'administrateur'), stubbed(experience));
    assert.equal(row, experience);
  });

  await run('une ressource globale reste lisible par tous', async () => {
    const competence = { id_competence: 3, nom_competence: 'Node.js' };
    const row = await owns('competences', 3, user(1), stubbed(competence));
    assert.equal(row, competence);
  });

  await run('get, update et remove passent par le contrôle d’appartenance', async () => {
    const source = fs.readFileSync(path.join(process.cwd(), 'src', 'controllers', 'resource.controller.js'), 'utf8');
    assert.match(source, /exports\.get =[\s\S]*owns\(name, req\.params\.id, req\.user\)/);
    const updateAndRemove = source.match(/exports\.update =[\s\S]*exports\.remove =[\s\S]*?success\(res, 'Ressource supprimée\.'\);/);
    assert.ok(updateAndRemove, 'contrôleurs update/remove introuvables');
    assert.equal((updateAndRemove[0].match(/owns\(name, req\.params\.id, req\.user\)/g) || []).length, 2);
    assert.doesNotMatch(updateAndRemove[0], /\[\], 403\)/);
    assert.doesNotMatch(updateAndRemove[0], /accès refusé/);
    assert.equal((updateAndRemove[0].match(/Ressource introuvable\./g) || []).length, 2);
  });

  if (process.exitCode) {
    console.error(`\n${checks} test(s) réussi(s), des erreurs subsistent.`);
  } else {
    console.log(`\n${checks} test(s) réussi(s).`);
  }
})();
