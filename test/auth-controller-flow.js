/**
 * Flux du contrôleur d'authentification — aucune base ni réseau.
 *
 * `src/config/database` est remplacé dans `require.cache` par une fausse base
 * (`execute`, `getConnection` avec transaction) et `global.fetch` par un faux
 * client Brevo. On exerce `register`, `login`, `resendVerification` et
 * `verifyEmail` dans les trois modes de configuration :
 *   (a) Brevo non configuré  → comptes vérifiés d'office, aucun envoi ;
 *   (b) Brevo configuré, vérification informative ;
 *   (c) Brevo configuré, vérification obligatoire (aucune session).
 *
 * Exécution : node test/auth-controller-flow.js (npm run test:auth-flow)
 */
const assert = require('node:assert/strict');

/* ----------------------- Fausse base de données ------------------------- */
const state = {
  usersById: new Map(),
  usersByEmail: new Map(),
  inserts: [],
  tokenUpdates: [],
  fetchCalls: [],
  nextId: 200
};

const fakeExecute = async (sql, params = []) => {
  const statement = String(sql);

  if (/FROM domaine WHERE id_domaine/.test(statement)) {
    return [[{ id_domaine: Number(params[0]), nom_domaine: 'Informatique' }]];
  }
  if (/FROM utilisateur WHERE email\s*=\s*\?/.test(statement)) {
    const user = state.usersByEmail.get(String(params[0]));
    return [user ? [{ ...user }] : []];
  }
  if (/FROM utilisateur WHERE id_utilisateur\s*=\s*\?/.test(statement)) {
    const user = state.usersById.get(Number(params[0]));
    return [user ? [{ ...user }] : []];
  }
  if (/INSERT INTO utilisateur/.test(statement)) {
    const [nom, prenom, email, mot_de_passe, telephone, photo, photo_couverture, email_verifie] = params;
    const id = state.nextId++;
    const user = {
      id_utilisateur: id,
      nom,
      prenom,
      email,
      mot_de_passe,
      telephone,
      photo,
      photo_couverture,
      role: 'candidat',
      email_verifie: Number(email_verifie),
      date_inscription: new Date(),
      statut_compte: 'actif',
      email_verifie_le: Number(email_verifie) ? new Date() : null
    };
    state.usersById.set(id, user);
    state.usersByEmail.set(email, user);
    state.inserts.push({ sql: statement, params });
    return [{ insertId: id, affectedRows: 1 }];
  }
  if (/INSERT INTO profil_professionnel/.test(statement)) {
    return [{ affectedRows: 1 }];
  }
  if (/UPDATE utilisateur\s+SET email_verification_token_hash/.test(statement)) {
    state.tokenUpdates.push({ sql: statement, params });
    return [{ affectedRows: 1 }];
  }
  if (/UPDATE utilisateur\s+SET email_verifie = 1/.test(statement)) {
    return [{ affectedRows: 1 }];
  }
  throw new Error(`Requête SQL inattendue dans le test : ${statement}`);
};

const fakeConnection = {
  execute: fakeExecute,
  beginTransaction: async () => {},
  commit: async () => {},
  rollback: async () => {},
  release: () => {}
};

const fakeDb = {
  execute: fakeExecute,
  getConnection: async () => fakeConnection
};

// Remplacement AVANT tout chargement du contrôleur (et de ses dépendances).
const databasePath = require.resolve('../src/config/database');
require.cache[databasePath] = {
  id: databasePath,
  filename: databasePath,
  loaded: true,
  exports: fakeDb
};

const auth = require('../src/controllers/auth.controller');

/* --------------------------- Environnement ------------------------------ */
const ENV_KEYS = [
  'BREVO_API_KEY', 'MAIL_FROM_EMAIL', 'MAIL_FROM_NAME', 'APP_URL',
  'EMAIL_VERIFICATION_REQUIRED', 'EMAIL_VERIFICATION_TTL_HOURS'
];

const setEnv = ({ configured, required }) => {
  for (const key of ENV_KEYS) delete process.env[key];
  process.env.JWT_SECRET = 'secret-de-test';
  process.env.JWT_EXPIRES_IN = '1h';
  if (configured) {
    process.env.BREVO_API_KEY = 'xkeysib-test';
    process.env.MAIL_FROM_EMAIL = 'no-reply@linkemploi.test';
    process.env.MAIL_FROM_NAME = 'LinkEmploi Test';
    process.env.APP_URL = 'http://localhost:5000';
  }
  process.env.EMAIL_VERIFICATION_REQUIRED = required ? 'true' : 'false';
  process.env.EMAIL_VERIFICATION_TTL_HOURS = '24';
};

const resetState = () => {
  state.usersById.clear();
  state.usersByEmail.clear();
  state.inserts = [];
  state.tokenUpdates = [];
  state.fetchCalls = [];
  state.nextId = 200;
};

const okFetch = async (url, options) => {
  state.fetchCalls.push({ url, options });
  return { ok: true, status: 201, text: async () => '' };
};

const failingFetch = async (url, options) => {
  state.fetchCalls.push({ url, options });
  return {
    ok: false,
    status: 401,
    text: async () => JSON.stringify({ code: 'unauthorized', message: 'Key not found' })
  };
};

/* ------------------------- Requête / réponse ---------------------------- */
const makeReq = ({ body = {}, params = {}, query = {}, headers = {} } = {}) => ({
  body, params, query, headers, cookies: {}, originalUrl: '/', baseUrl: '', path: '/',
  get: () => undefined
});

const makeRes = () => ({
  statusCode: 200,
  payload: null,
  cookies: [],
  redirectUrl: null,
  status(code) { this.statusCode = code; return this; },
  json(payload) { this.payload = payload; return this; },
  cookie(name, value, options) { this.cookies.push({ name, value, options }); return this; },
  clearCookie() { return this; },
  redirect(url) { this.redirectUrl = url; return this; },
  set() { return this; }
});

const call = async (controller, req) => {
  const res = makeRes();
  let caught = null;
  const next = (error) => { if (error) caught = error; };
  await controller(req, res, next);
  if (caught) throw caught;
  return res;
};

const registerBody = (email) => ({
  nom: 'Dupont',
  prenom: 'Jean',
  email,
  mot_de_passe: 'MotDePasse123!',
  id_domaine: 1
});

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

console.log('Flux du contrôleur d’authentification (base et Brevo simulés)');

(async () => {
  global.fetch = okFetch;

  await test('(a) Brevo non configuré : inscription vérifiée d’office, sans envoi ni session obligatoire', async () => {
    resetState();
    setEnv({ configured: false, required: false });
    const email = 'mode-a@example.com';

    const res = await call(auth.register, makeReq({ body: registerBody(email) }));

    assert.equal(res.statusCode, 201);
    assert.equal(res.payload.success, true);
    assert.equal(res.payload.data.verification_required, false);
    assert.ok(res.payload.data.token);
    assert.equal(state.fetchCalls.length, 0, 'aucun appel Brevo attendu');

    const insert = state.inserts.find((entry) => entry.params[2] === email);
    assert.ok(insert, 'insertion du compte attendue');
    assert.equal(Number(insert.params[7]), 1, 'compte vérifié automatiquement');
    assert.equal(state.usersByEmail.get(email).email_verifie, 1);
    assert.ok(res.cookies.some((cookie) => cookie.name === 'gc_token'), 'session créée');
  });

  await test('(b) Brevo configuré, vérification informative : compte non vérifié, session + un envoi', async () => {
    resetState();
    setEnv({ configured: true, required: false });
    const email = 'mode-b@example.com';

    const res = await call(auth.register, makeReq({ body: registerBody(email) }));

    assert.equal(res.statusCode, 201);
    assert.equal(res.payload.data.verification_required, false);
    assert.equal(res.payload.data.email_verification_sent, true);
    assert.ok(res.payload.data.token);
    assert.equal(state.fetchCalls.length, 1, 'un seul appel Brevo attendu');

    const insert = state.inserts.find((entry) => entry.params[2] === email);
    assert.equal(Number(insert.params[7]), 0, 'compte non vérifié');
    assert.ok(res.cookies.some((cookie) => cookie.name === 'gc_token'), 'session créée');
  });

  await test('(c) Brevo configuré, vérification obligatoire : compte non vérifié, aucune session', async () => {
    resetState();
    setEnv({ configured: true, required: true });
    const email = 'mode-c@example.com';

    const res = await call(auth.register, makeReq({ body: registerBody(email) }));

    assert.equal(res.statusCode, 201);
    assert.equal(res.payload.data.verification_required, true);
    assert.equal(res.payload.data.email_verification_sent, true);
    assert.equal(res.payload.data.token, undefined, 'aucun jeton de session');
    assert.equal(res.cookies.length, 0, 'aucune session');
    assert.equal(state.fetchCalls.length, 1, 'un seul appel Brevo attendu');

    const insert = state.inserts.find((entry) => entry.params[2] === email);
    assert.equal(Number(insert.params[7]), 0, 'compte non vérifié');
  });

  await test('connexion : refusée (403) si non vérifié en mode (c), acceptée en (a) et (b)', async () => {
    // (a) : le compte créé est vérifié d'office.
    resetState();
    setEnv({ configured: false, required: false });
    let body = registerBody('login-a@example.com');
    await call(auth.register, makeReq({ body }));
    let res = await call(auth.login, makeReq({ body: { email: body.email, mot_de_passe: body.mot_de_passe } }));
    assert.equal(res.statusCode, 200);
    assert.ok(res.payload.data.token);

    // (b) : comtpe non vérifié mais mode informatif.
    resetState();
    setEnv({ configured: true, required: false });
    body = registerBody('login-b@example.com');
    await call(auth.register, makeReq({ body }));
    res = await call(auth.login, makeReq({ body: { email: body.email, mot_de_passe: body.mot_de_passe } }));
    assert.equal(res.statusCode, 200);

    // (c) : compte non vérifié, mode strict.
    resetState();
    setEnv({ configured: true, required: true });
    body = registerBody('login-c@example.com');
    await call(auth.register, makeReq({ body }));
    res = await call(auth.login, makeReq({ body: { email: body.email, mot_de_passe: body.mot_de_passe } }));
    assert.equal(res.statusCode, 403);
    assert.equal(res.payload.success, false);
  });

  await test('renvoi : 503 sans Brevo, envoi effectif en mode informatif et obligatoire', async () => {
    resetState();
    setEnv({ configured: false, required: false });
    let res = await call(auth.resendVerification, makeReq({ body: { email: 'inconnu@example.com' } }));
    assert.equal(res.statusCode, 503);

    for (const required of [false, true]) {
      resetState();
      setEnv({ configured: true, required });
      const body = registerBody(`renvoi-${required ? 'strict' : 'info'}@example.com`);
      await call(auth.register, makeReq({ body }));
      const before = state.fetchCalls.length;
      res = await call(auth.resendVerification, makeReq({ body: { email: `  ${body.email.toUpperCase()} ` } }));
      assert.equal(res.statusCode, 200);
      assert.equal(state.fetchCalls.length, before + 1, 'un envoi de renvoi attendu');
    }
  });

  await test('vérification d’un jeton bien formé : succès', async () => {
    resetState();
    setEnv({ configured: true, required: true });
    const res = await call(auth.verifyEmail, makeReq({ params: { token: 'a'.repeat(64) } }));
    assert.equal(res.statusCode, 200);
    assert.equal(res.payload.success, true);
  });

  await test('un refus Brevo (HTTP 401) n’empêche pas l’inscription', async () => {
    resetState();
    setEnv({ configured: true, required: false });
    global.fetch = failingFetch;
    const res = await call(auth.register, makeReq({ body: registerBody('brevo-401@example.com') }));
    global.fetch = okFetch;

    assert.equal(res.statusCode, 201);
    assert.equal(res.payload.data.email_verification_sent, false);
  });

  // Vérifie que les e-mails de test sont bien normalisés (minuscules).
  await test('l’adresse est normalisée avant insertion (casse et espaces ignorés)', async () => {
    resetState();
    setEnv({ configured: false, required: false });
    const res = await call(auth.register, makeReq({ body: registerBody('  JEAN.Dupont@Example.COM ') }));
    assert.equal(res.statusCode, 201);
    assert.equal(res.payload.data.user.email, 'jean.dupont@example.com');
    assert.ok(state.usersByEmail.has('jean.dupont@example.com'));
  });

  if (process.exitCode) {
    console.error(`\n${checks} test(s) réussi(s), des erreurs subsistent.`);
  } else {
    console.log(`\n${checks} test(s) réussi(s).`);
  }
})();
