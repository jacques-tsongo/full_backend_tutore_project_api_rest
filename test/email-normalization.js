/**
 * Normalisation de l'adresse e-mail — aucune base ni réseau.
 *
 * Vérifie que l'API, les validateurs et les pages web appliquent exactement la
 * même transformation, sans jamais supprimer les points d'une adresse Gmail.
 *
 * Exécution : node test/email-normalization.js (npm run test:email-normalization)
 */
const assert = require('node:assert/strict');
const { validationResult } = require('express-validator');
const { normalizeEmailAddress } = require('../src/utils/email');
const validators = require('../src/validators/auth.validator');
const { webValidate } = require('../src/middlewares/webValidate.middleware');

const runChain = async (chain, req) => {
  for (const middleware of chain) {
    await new Promise((resolve, reject) => middleware(req, {}, (error) => (error ? reject(error) : resolve())));
  }
};

let checks = 0;
const test = async (name, fn) => {
  try {
    await fn();
    checks += 1;
    console.log(`  OK   ${name}`);
  } catch (error) {
    console.error(`  ECHEC ${name}`);
    console.error(`        ${error.stack || error.message}`);
    process.exitCode = 1;
  }
};

console.log('Normalisation des adresses e-mail');

(async () => {
  await test('minuscules et espaces retirés, points conservés', () => {
    assert.equal(normalizeEmailAddress('JUAN.Dupont@Gmail.com '), 'juan.dupont@gmail.com');
    assert.equal(normalizeEmailAddress('  jean.dupont@gmail.com  '), 'jean.dupont@gmail.com');
  });

  await test('une valeur non textuelle ne provoque jamais d’exception', () => {
    for (const value of [null, undefined, 42, true, {}, [], ['a@b.c']]) {
      assert.equal(normalizeEmailAddress(value), '');
    }
  });

  await test('le validateur normalise avant de valider (API)', async () => {
    const req = { body: { email: '  JUAN.Dupont@Gmail.com ', mot_de_passe: 'MotDePasse123!' } };
    await runChain(validators.login, req);
    assert.equal(validationResult(req).isEmpty(), true);
    assert.equal(req.body.email, 'juan.dupont@gmail.com');
  });

  await test('API et page web produisent le même résultat pour la même saisie', async () => {
    const saisie = '  JUAN.Dupont@Gmail.com ';
    const apiReq = { body: { email: saisie, mot_de_passe: 'MotDePasse123!' } };
    await runChain(validators.login, apiReq);

    const webReq = { body: { email: saisie, mot_de_passe: 'MotDePasse123!' } };
    const cookies = [];
    const res = {
      cookie: (name, value) => { cookies.push({ name, value }); return res; },
      redirect: (url) => { res.redirectUrl = url; return res; }
    };
    const chain = webValidate(validators.login, { redirectTo: '/login' });
    for (const middleware of chain.slice(0, -1)) await runChain([middleware], webReq);
    let nextCalled = false;
    chain[chain.length - 1](webReq, res, () => { nextCalled = true; });

    assert.equal(nextCalled, true);
    assert.equal(res.redirectUrl, undefined);
    assert.equal(webReq.body.email, apiReq.body.email);
    assert.equal(webReq.body.email, 'juan.dupont@gmail.com');
    assert.equal(normalizeEmailAddress(saisie), webReq.body.email);
  });

  await test('une adresse invalide sur la page web est flashée puis redirigée', async () => {
    const req = { body: { email: 'pas-une-adresse', mot_de_passe: 'x' } };
    const cookies = [];
    const res = {
      cookie: (name, value) => { cookies.push({ name, value }); return res; },
      redirect: (url) => { res.redirectUrl = url; return res; }
    };
    const chain = webValidate(validators.login, { redirectTo: '/login' });
    for (const middleware of chain.slice(0, -1)) await runChain([middleware], req);
    let nextCalled = false;
    chain[chain.length - 1](req, res, () => { nextCalled = true; });

    assert.equal(nextCalled, false);
    assert.equal(res.redirectUrl, '/login');
    assert.equal(cookies.length, 1);
    assert.match(cookies[0].value, /Invalid value/);
  });

  if (process.exitCode) {
    console.error(`\n${checks} test(s) réussi(s), des erreurs subsistent.`);
  } else {
    console.log(`\n${checks} test(s) réussi(s).`);
  }
})();
