/**
 * Tests de la politique de messagerie — aucune base MySQL nécessaire.
 *
 * La décision est centralisée dans `messaging.service.evaluate()` et doit être
 * appliquée à l'envoi comme à l'ouverture d'un fil. Ces tests couvrent la
 * matrice des rôles, la relation métier et la conversation déjà engagée.
 *
 * Exécution : node test/messaging-policy.js
 */
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { evaluate, canMessage } = require('../src/services/messaging.service');

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

const actor = (role, id = 1) => ({ id_utilisateur: id, role });
const target = (role, id = 2) => ({ id_utilisateur: id, role, statut_compte: 'actif' });
const deps = ({ user = null, conversation = false, candidateLegit = false, recruiterLegit = false } = {}) => ({
  findActiveUser: async (id) => (user && Number(user.id_utilisateur) === Number(id) ? user : null),
  hasConversation: async () => conversation,
  candidateMayContactRecruiter: async () => candidateLegit,
  recruiterMayContactCandidate: async () => recruiterLegit
});

console.log('Tests de la politique de messagerie');

(async () => {
  await run('un destinataire inexistant ou inactif est refusé', async () => {
    const d = await evaluate(actor('candidat'), 2, deps());
    assert.equal(d.allowed, false);
    assert.equal(d.reason, 'not_found');
  });

  await run('on ne peut pas s’écrire à soi-même', async () => {
    const d = await evaluate(actor('candidat', 2), 2, deps({ user: target('candidat', 2) }));
    assert.equal(d.allowed, false);
    assert.equal(d.reason, 'self');
  });

  await run('l’administrateur peut joindre tout utilisateur actif', async () => {
    for (const role of ['candidat', 'recruteur', 'administrateur']) {
      const d = await evaluate(actor('administrateur'), 2, deps({ user: target(role) }));
      assert.equal(d.allowed, true, role);
    }
  });

  await run('un candidat ne peut pas écrire à un autre candidat', async () => {
    const d = await evaluate(actor('candidat'), 2, deps({ user: target('candidat') }));
    assert.equal(d.allowed, false);
    assert.equal(d.reason, 'forbidden');
  });

  await run('un recruteur ne peut pas écrire à un autre recruteur', async () => {
    const d = await evaluate(actor('recruteur'), 2, deps({ user: target('recruteur') }));
    assert.equal(d.allowed, false);
    assert.equal(d.reason, 'forbidden');
  });

  await run('un candidat peut écrire au recruteur d’une entreprise approuvée', async () => {
    const d = await evaluate(actor('candidat'), 2, deps({ user: target('recruteur'), candidateLegit: true }));
    assert.equal(d.allowed, true);
  });

  await run('un candidat ne peut pas écrire à un recruteur sans entreprise approuvée', async () => {
    const d = await evaluate(actor('candidat'), 2, deps({ user: target('recruteur') }));
    assert.equal(d.allowed, false);
    assert.equal(d.reason, 'forbidden');
  });

  await run('un recruteur peut écrire à un candidat ayant postulé', async () => {
    const d = await evaluate(actor('recruteur'), 2, deps({ user: target('candidat'), recruiterLegit: true }));
    assert.equal(d.allowed, true);
  });

  await run('un recruteur ne peut pas écrire à un candidat sans candidature', async () => {
    const d = await evaluate(actor('recruteur'), 2, deps({ user: target('candidat') }));
    assert.equal(d.allowed, false);
    assert.equal(d.reason, 'forbidden');
  });

  await run('un utilisateur ne peut pas écrire à un administrateur sans conversation', async () => {
    const d = await evaluate(actor('candidat'), 2, deps({ user: target('administrateur') }));
    assert.equal(d.allowed, false);
    assert.equal(d.reason, 'forbidden');
  });

  await run('une conversation existante autorise toujours la réponse', async () => {
    const d = await evaluate(actor('candidat'), 2, deps({ user: target('administrateur'), conversation: true }));
    assert.equal(d.allowed, true);
  });

  await run('une relation professionnelle suffit sans conversation préalable', async () => {
    const ok = await canMessage(actor('candidat'), 2, deps({ user: target('recruteur'), candidateLegit: true }));
    assert.equal(ok, true);
  });

  await run('canMessage reflète un refus', async () => {
    const ok = await canMessage(actor('candidat'), 2, deps({ user: target('candidat') }));
    assert.equal(ok, false);
  });

  await run('send et conversation appliquent la politique centralisée', async () => {
    const source = fs.readFileSync(path.join(process.cwd(), 'src', 'controllers', 'message.controller.js'), 'utf8');
    assert.match(source, /exports\.send =[\s\S]*messaging\.evaluate\(req\.user, destId\)/);
    assert.match(source, /exports\.conversation =[\s\S]*messaging\.evaluate\(req\.user, id\)/);
    assert.doesNotMatch(source, /SELECT id_utilisateur FROM utilisateur WHERE id_utilisateur=\? AND statut_compte='actif'/);
  });

  if (process.exitCode) {
    console.error(`\n${checks} test(s) réussi(s), des erreurs subsistent.`);
  } else {
    console.log(`\n${checks} test(s) réussi(s).`);
  }
})();
