/**
 * Flux du contrôleur d'authentification — aucune base ni réseau.
 *
 * `src/config/database` est remplacé dans `require.cache` par une fausse base
 * en mémoire, DNS est simulé et `mailer.send` est remplacé par un capteur.
 * On vérifie le nouveau flux d'inscription en deux étapes :
 *   (a) `register` crée seulement une inscription en attente (202) ;
 *   (b) `registerVerify` crée le compte vérifié et ouvre la session (201) ;
 *   (c) `login` refuse les comptes historiques non vérifiés.
 *
 * Exécution : node test/auth-controller-flow.js (npm run test:auth-flow)
 */
const assert = require('node:assert/strict');
const bcrypt = require('bcrypt');
const dns = require('dns').promises;

/* ----------------------- Environnement de test ------------------------- */
process.env.NODE_ENV = 'test';
process.env.MAIL_DRIVER = 'outbox';
process.env.MAIL_OUTBOX_DIR = 'tmp/outbox-test';
delete process.env.SMTP_USER;
delete process.env.SMTP_PASS;
process.env.EMAIL_CODE_SECRET = 'secret-de-test-au-moins-32-caracteres!!';
process.env.EMAIL_CODE_TTL_SECONDS = '600';
process.env.EMAIL_CODE_RESEND_SECONDS = '60';
process.env.EMAIL_CODE_MAX_ATTEMPTS = '5';
process.env.EMAIL_CODE_MAX_RESENDS = '3';
process.env.JWT_SECRET = 'secret-de-test';
process.env.JWT_EXPIRES_IN = '1h';

/* ----------------------------- DNS simulé ------------------------------ */
const originalResolveMx = dns.resolveMx;
dns.resolveMx = async (domain) => [{ exchange: `mx.${domain}`, priority: 10 }];

/* ------------------------- Fausse base mémoire ------------------------- */
const state = {
  users: [],
  profiles: [],
  pending: [],
  nextUserId: 300
};

const resetState = () => {
  state.users = [];
  state.profiles = [];
  state.pending = [];
  state.nextUserId = 300;
};

const timing = (row, resendSeconds) => ({
  ...row,
  expire_dans: Math.floor((row.expire_at - Date.now()) / 1000),
  renvoi_dans: Math.max(0, Math.floor((row.dernier_envoi_at + resendSeconds * 1000 - Date.now()) / 1000))
});

const fakeExecute = async (statement, params = []) => {
  const sql = String(statement).replace(/\s+/g, ' ').trim();

  if (/FROM domaine WHERE id_domaine = \?/.test(sql)) {
    return [[{ id_domaine: Number(params[0]), nom_domaine: 'Informatique' }]];
  }

  if (/FROM utilisateur WHERE email = \?/.test(sql)) {
    const user = state.users.find((u) => u.email === String(params[0]));
    return [user ? [{ ...user }] : []];
  }

  if (/FROM utilisateur WHERE id_utilisateur = \?/.test(sql)) {
    const user = state.users.find((u) => Number(u.id_utilisateur) === Number(params[0]));
    if (!user) return [[]];
    const publicUser = { ...user };
    delete publicUser.mot_de_passe;
    return [[publicUser]];
  }

  if (/INSERT INTO utilisateur/.test(sql)) {
    const [nom, prenom, email, mot_de_passe, telephone, role, photo, photo_couverture, email_verifie] = params;
    const id = state.nextUserId++;
    const verifie = Number(email_verifie) === 1;
    const user = {
      id_utilisateur: id,
      nom,
      prenom,
      email,
      mot_de_passe,
      telephone,
      role,
      photo,
      photo_couverture,
      email_verifie: verifie ? 1 : 0,
      email_verifie_le: verifie ? new Date() : null,
      date_inscription: new Date(),
      statut_compte: 'actif'
    };
    state.users.push(user);
    return [{ insertId: id, affectedRows: 1 }];
  }

  if (/INSERT INTO profil_professionnel/.test(sql)) {
    state.profiles.push({ id_utilisateur: Number(params[0]), id_domaine: Number(params[1]) });
    return [{ affectedRows: 1 }];
  }

  if (/INSERT INTO inscription_en_attente/.test(sql)) {
    const [id, email, nom, prenom, telephone, id_domaine, mot_de_passe, ticket_hash, code_hash, ttl] = params;
    const now = Date.now();
    state.pending.push({
      id_inscription: id,
      email,
      nom,
      prenom,
      telephone,
      id_domaine: Number(id_domaine),
      mot_de_passe,
      ticket_hash,
      code_hash,
      expire_at: now + Number(ttl) * 1000,
      tentatives: 0,
      envois: 1,
      dernier_envoi_at: now
    });
    return [{ affectedRows: 1 }];
  }

  if (/FROM inscription_en_attente WHERE id_inscription = \? FOR UPDATE/.test(sql)) {
    const row = state.pending.find((p) => p.id_inscription === params[0]);
    return [row ? [{ ...row }] : []];
  }

  if (/SELECT TIMESTAMPDIFF\(SECOND, NOW\(\), expire_at\) AS expire_dans FROM inscription_en_attente WHERE id_inscription = \?/.test(sql)) {
    const row = state.pending.find((p) => p.id_inscription === params[0]);
    if (!row) return [[]];
    return [[{ expire_dans: Math.floor((row.expire_at - Date.now()) / 1000) }]];
  }

  if (/^SELECT[\s\S]*FROM inscription_en_attente WHERE ticket_hash = \?/.test(sql)) {
    const resendSeconds = Number(params[0]) || 60;
    const row = state.pending.find((p) => p.ticket_hash === params[1]);
    return [row ? [timing(row, resendSeconds)] : []];
  }

  if (/UPDATE inscription_en_attente SET code_hash = \?/.test(sql)) {
    const [code_hash, ttl, id, ticket_hash] = params;
    const row = state.pending.find((p) => p.id_inscription === id && p.ticket_hash === ticket_hash);
    if (!row) return [{ affectedRows: 0 }];
    row.code_hash = code_hash;
    row.tentatives = 0;
    row.envois += 1;
    row.dernier_envoi_at = Date.now();
    row.expire_at = Date.now() + Number(ttl) * 1000;
    return [{ affectedRows: 1 }];
  }

  if (/UPDATE inscription_en_attente SET tentatives = \?/.test(sql)) {
    const row = state.pending.find((p) => p.id_inscription === params[1]);
    if (!row) return [{ affectedRows: 0 }];
    row.tentatives = Number(params[0]);
    return [{ affectedRows: 1 }];
  }

  if (/DELETE FROM inscription_en_attente WHERE expire_at < DATE_SUB\(NOW\(\), INTERVAL 1 HOUR\)/.test(sql)) {
    const limit = Date.now() - 60 * 60 * 1000;
    const before = state.pending.length;
    state.pending = state.pending.filter((p) => p.expire_at >= limit);
    return [{ affectedRows: before - state.pending.length }];
  }

  if (/DELETE FROM inscription_en_attente WHERE email = \?/.test(sql)) {
    const before = state.pending.length;
    state.pending = state.pending.filter((p) => p.email !== params[0]);
    return [{ affectedRows: before - state.pending.length }];
  }

  if (/DELETE FROM inscription_en_attente WHERE ticket_hash = \?/.test(sql)) {
    const before = state.pending.length;
    state.pending = state.pending.filter((p) => p.ticket_hash !== params[0]);
    return [{ affectedRows: before - state.pending.length }];
  }

  if (/DELETE FROM inscription_en_attente WHERE id_inscription = \?/.test(sql)) {
    const before = state.pending.length;
    state.pending = state.pending.filter((p) => p.id_inscription !== params[0]);
    return [{ affectedRows: before - state.pending.length }];
  }

  throw new Error(`Requête SQL inattendue dans le test : ${sql}`);
};

let snapshot = null;
const fakeConnection = {
  execute: fakeExecute,
  beginTransaction: async () => { snapshot = structuredClone(state); },
  commit: async () => { snapshot = null; },
  rollback: async () => { if (snapshot) Object.assign(state, structuredClone(snapshot)); snapshot = null; },
  release: () => {}
};

const fakeDb = { execute: fakeExecute, getConnection: async () => fakeConnection };

// Remplacement AVANT tout chargement du contrôleur (et de ses dépendances).
const databasePath = require.resolve('../src/config/database');
require.cache[databasePath] = {
  id: databasePath,
  filename: databasePath,
  loaded: true,
  exports: fakeDb
};

const mailer = require('../src/services/email.service');
const sent = [];
mailer.send = async (message) => { sent.push(message); };

const auth = require('../src/controllers/auth.controller');

/* ------------------------- Requête / réponse ---------------------------- */
const makeReq = ({ body = {}, params = {}, query = {}, headers = {} } = {}) => ({
  body, params, query, headers, cookies: {}, originalUrl: '/', baseUrl: '', path: '/',
  get: () => undefined
});

const makeRes = () => ({
  statusCode: 200,
  payload: null,
  cookies: [],
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
  telephone: '+243800000000',
  id_domaine: 1
});

const extractCode = (message) => {
  const match = String(message?.text || '').match(/^\d{6}$/m);
  if (!match) throw new Error('Code absent de l’e-mail capturé.');
  return match[0];
};

const lastCode = () => extractCode(sent[sent.length - 1]);

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

console.log('Flux du contrôleur d’authentification (base, DNS et e-mail simulés)');

(async () => {
  try {
    await test('register : 202, inscription en attente, aucun compte, un code envoyé', async () => {
      resetState();
      sent.length = 0;
      const email = 'jean.dupont@example.com';

      const res = await call(auth.register, makeReq({ body: registerBody(email) }));

      assert.equal(res.statusCode, 202);
      assert.equal(res.payload.success, true);
      assert.ok(res.payload.data.ticket, 'ticket attendu');
      assert.equal(res.payload.data.email_masque, 'j***@example.com');
      assert.equal(state.users.length, 0, 'aucun compte ne doit être créé');
      assert.equal(state.pending.length, 1, 'inscription en attente attendue');
      assert.equal(state.pending[0].email, email);
      assert.equal(sent.length, 1, 'un seul code envoyé');
      assert.equal(extractCode(sent[0]).length, 6);
      assert.equal(res.cookies.length, 0, 'aucune session à l’étape 1');
    });

    await test('registerVerify : 201, compte vérifié, profil et session httpOnly', async () => {
      resetState();
      sent.length = 0;
      const email = 'verify@example.com';
      const register = await call(auth.register, makeReq({ body: registerBody(email) }));
      const { ticket } = register.payload.data;

      const res = await call(auth.registerVerify, makeReq({ body: { ticket, code: lastCode() } }));

      assert.equal(res.statusCode, 201);
      assert.equal(res.payload.success, true);
      assert.equal(res.payload.data.user.email, email);
      assert.equal(res.payload.data.user.email_verifie, 1);
      assert.ok(res.payload.data.token);
      assert.equal(state.users.length, 1);
      assert.equal(state.users[0].email_verifie, 1);
      assert.deepEqual(state.profiles, [{ id_utilisateur: state.users[0].id_utilisateur, id_domaine: 1 }]);
      assert.equal(state.pending.length, 0, 'demande supprimée après création');
      const cookie = res.cookies.find((c) => c.name === 'gc_token');
      assert.ok(cookie, 'cookie gc_token attendu');
      assert.equal(cookie.options.httpOnly, true);
    });

    await test('registerVerify : code incorrect (422) sans créer de compte ni ouvrir de session', async () => {
      resetState();
      sent.length = 0;
      const register = await call(auth.register, makeReq({ body: registerBody('wrong@example.com') }));
      const { ticket } = register.payload.data;

      const res = await call(auth.registerVerify, makeReq({ body: { ticket, code: '000000' } }));

      assert.equal(res.statusCode, 422);
      assert.equal(res.payload.success, false);
      assert.equal(state.users.length, 0);
      assert.equal(state.pending.length, 1);
      assert.equal(state.pending[0].tentatives, 1);
      assert.equal(res.cookies.length, 0);
    });

    await test('registerResend : délai respecté (429) puis nouveau code après 60 s', async () => {
      resetState();
      sent.length = 0;
      const register = await call(auth.register, makeReq({ body: registerBody('resend@example.com') }));
      const { ticket } = register.payload.data;

      let res = await call(auth.registerResend, makeReq({ body: { ticket } }));
      assert.equal(res.statusCode, 429);
      assert.equal(sent.length, 1, 'aucun nouvel envoi avant le délai');

      state.pending[0].dernier_envoi_at = Date.now() - 61000;
      res = await call(auth.registerResend, makeReq({ body: { ticket } }));
      assert.equal(res.statusCode, 200);
      assert.equal(sent.length, 2, 'nouveau code envoyé');
      assert.equal(state.pending[0].envois, 2);
    });

    await test('registerCancel : 200 et idempotent', async () => {
      resetState();
      sent.length = 0;
      const register = await call(auth.register, makeReq({ body: registerBody('cancel@example.com') }));
      const { ticket } = register.payload.data;

      let res = await call(auth.registerCancel, makeReq({ body: { ticket } }));
      assert.equal(res.statusCode, 200);
      assert.equal(state.pending.length, 0);

      res = await call(auth.registerCancel, makeReq({ body: { ticket } }));
      assert.equal(res.statusCode, 200);
    });

    await test('l’adresse est normalisée avant l’inscription en attente', async () => {
      resetState();
      sent.length = 0;
      await call(auth.register, makeReq({ body: registerBody('  JEAN.Dupont@Example.COM ') }));
      assert.equal(state.pending[0].email, 'jean.dupont@example.com');
      assert.equal(sent[0].to, 'jean.dupont@example.com');
    });

    await test('login : refusé (403) pour un compte historique non vérifié', async () => {
      resetState();
      const password = await bcrypt.hash('MotDePasse123!', 4);
      state.users.push({
        id_utilisateur: 900,
        nom: 'Ancien',
        prenom: 'Compte',
        email: 'legacy@example.com',
        mot_de_passe: password,
        email_verifie: 0,
        statut_compte: 'actif',
        role: 'candidat'
      });

      const res = await call(auth.login, makeReq({
        body: { email: 'legacy@example.com', mot_de_passe: 'MotDePasse123!' }
      }));

      assert.equal(res.statusCode, 403);
      assert.equal(res.payload.success, false);
      assert.match(res.payload.message, /non vérifié/i);
      assert.equal(res.cookies.length, 0);
    });

    await test('login : accepté pour un compte vérifié créé par le flux', async () => {
      resetState();
      sent.length = 0;
      const email = 'login@example.com';
      const register = await call(auth.register, makeReq({ body: registerBody(email) }));
      const { ticket } = register.payload.data;
      await call(auth.registerVerify, makeReq({ body: { ticket, code: lastCode() } }));

      const res = await call(auth.login, makeReq({
        body: { email, mot_de_passe: 'MotDePasse123!' }
      }));

      assert.equal(res.statusCode, 200);
      assert.ok(res.payload.data.token);
      assert.ok(res.cookies.some((c) => c.name === 'gc_token'));
    });
  } finally {
    dns.resolveMx = originalResolveMx;
  }

  if (process.exitCode) {
    console.error(`\n${checks} test(s) réussi(s), des erreurs subsistent.`);
  } else {
    console.log(`\n${checks} test(s) réussi(s).`);
  }
})();
