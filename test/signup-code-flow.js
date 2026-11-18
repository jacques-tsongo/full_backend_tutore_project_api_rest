/**
 * Inscription par code de vérification — aucune base réelle, aucun réseau.
 *
 * `src/config/database` est remplacé dans `require.cache` par une fausse base
 * en mémoire (transactions comprises), DNS est simulé et `mailer.send` est
 * remplacé par un capteur en mémoire. On vérifie notamment :
 *  - aucun compte n'est créé avant la validation du code ;
 *  - le code et le ticket ne sont stockés que sous forme d'empreinte ;
 *  - expiration, délai de renvoi et tentatives sont appliqués ;
 *  - le compte final est créé avec email_verifie = 1 et son profil.
 *
 * Exécution : node test/signup-code-flow.js (npm run test:signup)
 */
const assert = require('node:assert/strict');
const crypto = require('crypto');
const dns = require('dns').promises;

/* ----------------------- Environnement de test -------------------------- */
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
process.env.BLOCK_DISPOSABLE_EMAILS = 'true';

/* ----------------------------- DNS simulé ------------------------------- */
let mxMode = 'ok';
const originalDns = { resolveMx: dns.resolveMx, resolve4: dns.resolve4, resolve6: dns.resolve6 };
const missing = () => Object.assign(new Error('not found'), { code: 'ENOTFOUND' });
dns.resolveMx = async (domain) => {
  if (mxMode === 'fail') throw missing();
  return [{ exchange: `mx.${domain}`, priority: 10 }];
};
dns.resolve4 = async () => { if (mxMode === 'fail') throw missing(); return ['127.0.0.1']; };
dns.resolve6 = async () => { if (mxMode === 'fail') throw missing(); return ['::1']; };

/* ------------------------- Fausse base mémoire -------------------------- */
const DOMAINS = [
  { id_domaine: 1, nom_domaine: 'Informatique' },
  { id_domaine: 2, nom_domaine: 'Santé' }
];

let state = {
  users: [],
  profiles: [],
  pending: [],
  nextUserId: 100
};

const resetState = () => {
  state = { users: [], profiles: [], pending: [], nextUserId: 100 };
};

const nowSeconds = () => Math.floor(Date.now() / 1000);
const timing = (row, resendSeconds) => ({
  ...row,
  expire_dans: Math.floor((row.expire_at - Date.now()) / 1000),
  renvoi_dans: Math.max(0, Math.floor((row.dernier_envoi_at + resendSeconds * 1000 - Date.now()) / 1000))
});

const fakeExecute = async (statement, params = []) => {
  const sql = String(statement).replace(/\s+/g, ' ').trim();

  if (/FROM domaine WHERE id_domaine = \?/.test(sql)) {
    const domain = DOMAINS.find((d) => Number(d.id_domaine) === Number(params[0]));
    return [domain ? [{ ...domain }] : []];
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
    const verified = Number(email_verifie) === 1;
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
      email_verifie: verified ? 1 : 0,
      email_verifie_le: verified ? new Date() : null,
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
      dernier_envoi_at: now,
      created_at: now
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
const connection = {
  execute: fakeExecute,
  beginTransaction: async () => { snapshot = structuredClone(state); },
  commit: async () => { snapshot = null; },
  rollback: async () => { if (snapshot) state = structuredClone(snapshot); snapshot = null; },
  release: () => {}
};
const fakeDb = { execute: fakeExecute, getConnection: async () => connection };

const databasePath = require.resolve('../src/config/database');
require.cache[databasePath] = {
  id: databasePath,
  filename: databasePath,
  loaded: true,
  exports: fakeDb
};

/* ------------------------ E-mail capturé en mémoire --------------------- */
const sent = [];
const mailer = require('../src/services/email.service');
mailer.send = async (message) => {
  sent.push(message);
  return { sent: true, driver: 'outbox' };
};

const signup = require('../src/services/signup.service');

/* ------------------------------ Helpers -------------------------------- */
const body = (overrides = {}) => ({
  nom: 'Dupont',
  prenom: 'Jean',
  email: 'jean.dupont@example.com',
  mot_de_passe: 'MotDePasse123!',
  telephone: '+243800000000',
  id_domaine: 1,
  ...overrides
});

const extractCode = (message) => {
  const match = String(message?.text || '').match(/^\d{6}$/m);
  if (!match) throw new Error('Code absent de l’e-mail capturé.');
  return match[0];
};

const lastCode = () => extractCode(sent[sent.length - 1]);
const pendingFor = (email) => state.pending.find((p) => p.email === email);

const expectSignupError = async (fn, status, code = null) => {
  try {
    await fn();
  } catch (error) {
    assert.ok(error instanceof signup.SignupError, `SignupError attendu, reçu ${error.name}`);
    assert.equal(error.status, status);
    if (code) assert.equal(error.code, code);
    return error;
  }
  assert.fail(`Une erreur ${status} était attendue.`);
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

/* -------------------------------- Tests -------------------------------- */
console.log('Inscription par code de vérification (base, DNS et e-mail simulés)');

(async () => {
  await test('la configuration borne la durée et le délai de renvoi', () => {
    const high = signup.loadConfig({
      EMAIL_CODE_TTL_SECONDS: '900',
      EMAIL_CODE_RESEND_SECONDS: '999',
      EMAIL_CODE_SECRET: 'x'.repeat(32)
    });
    assert.equal(high.rawTtl, 900);
    assert.equal(high.ttlSeconds, 600);
    assert.equal(high.resendSeconds, 600);

    const fallback = signup.loadConfig({ EMAIL_CODE_TTL_SECONDS: 'abc', EMAIL_CODE_RESEND_SECONDS: '0' });
    assert.equal(fallback.ttlSeconds, 600);
    assert.equal(fallback.resendSeconds, 1);
  });

  await test('sans EMAIL_CODE_SECRET, l’inscription est bloquée (503)', async () => {
    resetState();
    const secret = process.env.EMAIL_CODE_SECRET;
    process.env.EMAIL_CODE_SECRET = '';
    const error = await expectSignupError(() => signup.start({ body: body() }), 503, 'signup_unavailable');
    assert.equal(error.data.reason, 'EMAIL_CODE_SECRET');
    process.env.EMAIL_CODE_SECRET = secret;
    assert.equal(state.pending.length, 0);
  });

  await test('l’état de démarrage distingue inactif et actif', () => {
    const secret = process.env.EMAIL_CODE_SECRET;
    const driver = process.env.MAIL_DRIVER;
    const nodeEnv = process.env.NODE_ENV;

    try {
      process.env.EMAIL_CODE_SECRET = '';
      assert.match(signup.describeState(), /INACTIVE/);
      assert.match(signup.describeState(), /EMAIL_CODE_SECRET/);

      process.env.EMAIL_CODE_SECRET = secret;
      process.env.NODE_ENV = 'development';
      process.env.MAIL_DRIVER = 'smtp';
      assert.match(signup.describeState(), /INACTIVE/);
      assert.match(signup.describeState(), /SMTP_USER/);

      process.env.NODE_ENV = 'test';
      process.env.MAIL_DRIVER = 'outbox';
      assert.match(signup.describeState(), /ACTIVE en mode OUTBOX/);
    } finally {
      process.env.EMAIL_CODE_SECRET = secret;
      process.env.MAIL_DRIVER = driver;
      process.env.NODE_ENV = nodeEnv;
    }
  });

  await test('start crée une inscription en attente, jamais un compte', async () => {
    resetState();
    sent.length = 0;
    const result = await signup.start({ body: body() });

    assert.equal(state.users.length, 0, 'aucun utilisateur ne doit être créé');
    assert.equal(state.pending.length, 1);
    assert.ok(result.ticket && result.ticket.length >= 20);
    assert.match(result.email_masque, /^j\*\*\*@example\.com$/);
    assert.ok(result.expire_dans > 0 && result.expire_dans <= 600);
    assert.ok(result.renvoi_dans > 0 && result.renvoi_dans <= 60);

    const pending = state.pending[0];
    assert.equal(pending.ticket_hash, signup.hashTicket(result.ticket));
    assert.notEqual(pending.ticket_hash, result.ticket, 'le ticket ne doit pas être stocké en clair');
    const code = lastCode();
    assert.equal(pending.code_hash, signup.codeHmac(pending.id_inscription, code, process.env.EMAIL_CODE_SECRET));
    assert.notEqual(pending.code_hash, code, 'le code ne doit pas être stocké en clair');
    assert.match(pending.mot_de_passe, /^\$2[aby]\$/, 'mot de passe haché avec bcrypt');
    assert.ok(!JSON.stringify(pending).includes('MotDePasse123!'), 'aucun mot de passe en clair');
    assert.equal(sent.length, 1);
    assert.match(sent[0].subject, /code de vérification/i);
    assert.match(sent[0].text, new RegExp(code));
  });

  await test('une nouvelle demande remplace l’inscription en attente existante', async () => {
    resetState();
    sent.length = 0;
    const first = await signup.start({ body: body() });
    const second = await signup.start({ body: body({ nom: 'Martin' }) });
    assert.equal(state.pending.length, 1);
    assert.equal(state.users.length, 0);
    assert.notEqual(first.ticket, second.ticket);
    assert.equal(state.pending[0].nom, 'Martin');
  });

  await test('une adresse déjà utilisée est refusée (409)', async () => {
    resetState();
    state.users.push({
      id_utilisateur: 1, nom: 'Existant', prenom: 'Compte', email: 'jean.dupont@example.com',
      mot_de_passe: 'hash', telephone: null, role: 'candidat', photo: null, photo_couverture: null,
      email_verifie: 1, statut_compte: 'actif', date_inscription: new Date()
    });
    await expectSignupError(() => signup.start({ body: body() }), 409, 'email_taken');
    assert.equal(state.pending.length, 0);
  });

  await test('les adresses jetables et les domaines sans MX sont refusés', async () => {
    resetState();
    await expectSignupError(
      () => signup.start({ body: body({ email: 'jean@yopmail.com' }) }),
      422,
      'disposable_email'
    );

    mxMode = 'fail';
    try {
      await expectSignupError(
        () => signup.start({ body: body({ email: 'jean@domaine-inexistant.test' }) }),
        422,
        'invalid_domain_mail'
      );
    } finally {
      mxMode = 'ok';
    }
  });

  await test('un code incorrect incrémente les tentatives sans supprimer la demande', async () => {
    resetState();
    sent.length = 0;
    const { ticket } = await signup.start({ body: body() });
    const correct = lastCode();
    const wrong = correct === '000000' ? '999999' : '000000';

    let error = await expectSignupError(() => signup.verify({ ticket, code: wrong }), 422, 'invalid_code');
    assert.equal(error.data.tentatives_restantes, 4);
    assert.equal(pendingFor('jean.dupont@example.com').tentatives, 1);

    error = await expectSignupError(() => signup.verify({ ticket, code: wrong }), 422, 'invalid_code');
    assert.equal(error.data.tentatives_restantes, 3);
    assert.equal(pendingFor('jean.dupont@example.com').tentatives, 2);
  });

  await test('un code expiré est refusé et la demande est supprimée', async () => {
    resetState();
    sent.length = 0;
    const { ticket } = await signup.start({ body: body() });
    const code = lastCode();
    pendingFor('jean.dupont@example.com').expire_at = Date.now() - 1000;
    await expectSignupError(() => signup.verify({ ticket, code }), 410, 'expired');
    assert.equal(state.pending.length, 0);
  });

  await test('le nombre maximal de tentatives invalide la demande', async () => {
    resetState();
    sent.length = 0;
    const { ticket } = await signup.start({ body: body() });
    const code = lastCode();
    pendingFor('jean.dupont@example.com').tentatives = 5;
    await expectSignupError(() => signup.verify({ ticket, code }), 429, 'too_many_attempts');
    assert.equal(state.pending.length, 0);
  });

  await test('verify crée un compte vérifié, son profil, puis supprime la demande', async () => {
    resetState();
    sent.length = 0;
    const payload = body({ email: '  JEAN.Dupont@Example.COM ' });
    const { ticket } = await signup.start({ body: payload });
    const code = lastCode();

    const result = await signup.verify({ ticket, code });
    const user = result.user;
    assert.equal(state.users.length, 1);
    assert.equal(state.pending.length, 0);
    assert.equal(state.profiles.length, 1);
    assert.equal(user.email, 'jean.dupont@example.com');
    assert.equal(Number(user.email_verifie), 1);
    assert.equal(user.role, 'candidat');
    assert.equal(user.photo, '/images/defaults/default-avatar.png');
    assert.equal(user.photo_couverture, '/images/defaults/default-cover.png');
    assert.equal(user.mot_de_passe, undefined, 'le mot de passe ne doit jamais être renvoyé');
    assert.equal(state.profiles[0].id_domaine, 1);
    assert.equal(state.profiles[0].id_utilisateur, user.id_utilisateur);

    // Le ticket est consommé : le même code ne peut pas recréer un compte.
    await expectSignupError(() => signup.verify({ ticket, code }), 410, 'not_found');
    assert.equal(state.users.length, 1);
  });

  await test('resend respecte le délai puis émet un nouveau code', async () => {
    resetState();
    sent.length = 0;
    const { ticket } = await signup.start({ body: body() });
    const oldCode = lastCode();
    const oldHash = pendingFor('jean.dupont@example.com').code_hash;

    const tooSoon = await expectSignupError(() => signup.resend({ ticket }), 429, 'too_soon');
    assert.ok(tooSoon.data.renvoi_dans > 0);

    pendingFor('jean.dupont@example.com').dernier_envoi_at = Date.now() - 61000;
    const resent = await signup.resend({ ticket });
    assert.ok(resent.expire_dans > 0);
    assert.ok(resent.renvoi_dans > 0);
    assert.equal(sent.length, 2);
    const newCode = lastCode();
    const pending = pendingFor('jean.dupont@example.com');
    assert.equal(pending.envois, 2);
    assert.notEqual(pending.code_hash, oldHash, 'un nouveau code doit être généré');
    assert.ok(pending.expire_at > Date.now() + 590 * 1000);

    // L'ancien code ne doit plus être accepté.
    if (newCode !== oldCode) {
      await expectSignupError(() => signup.verify({ ticket, code: oldCode }), 422, 'invalid_code');
    }
    const result = await signup.verify({ ticket, code: newCode });
    assert.equal(state.users.length, 1);
    assert.equal(Number(result.user.email_verifie), 1);
  });

  await test('resend refuse au-delà du nombre maximal de renvois', async () => {
    resetState();
    sent.length = 0;
    const { ticket } = await signup.start({ body: body() });
    pendingFor('jean.dupont@example.com').envois = 4;
    pendingFor('jean.dupont@example.com').dernier_envoi_at = Date.now() - 61000;
    await expectSignupError(() => signup.resend({ ticket }), 429, 'too_many_resends');
  });

  await test('cancel supprime la demande et reste idempotent', async () => {
    resetState();
    sent.length = 0;
    const { ticket } = await signup.start({ body: body() });
    assert.deepEqual(await signup.cancel({ ticket }), { cancelled: true });
    assert.equal(state.pending.length, 0);
    assert.deepEqual(await signup.cancel({ ticket }), { cancelled: false });
  });

  await test('purgeExpired supprime uniquement les demandes anciennes', async () => {
    resetState();
    sent.length = 0;
    await signup.start({ body: body({ email: 'ancien@example.com' }) });
    state.pending[0].expire_at = Date.now() - 2 * 60 * 60 * 1000;
    await signup.start({ body: body({ email: 'recent@example.com' }) });
    await signup.purgeExpired();
    assert.equal(state.pending.length, 1);
    assert.equal(state.pending[0].email, 'recent@example.com');
  });

  await test('l’e-mail échappe le prénom et contient le code', () => {
    const message = signup.buildCodeEmail({
      prenom: '<script>alert(1)</script>',
      code: '123456',
      minutes: 10
    });
    assert.match(message.html, /123456/);
    assert.match(message.html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
    assert.doesNotMatch(message.html, /<script>/);
    assert.match(message.text, /123456/);
  });

  // Restaure les fonctions DNS globales (utile si le fichier est requis).
  dns.resolveMx = originalDns.resolveMx;
  dns.resolve4 = originalDns.resolve4;
  dns.resolve6 = originalDns.resolve6;

  if (process.exitCode) {
    console.error(`\n${checks} test(s) réussi(s), des erreurs subsistent.`);
  } else {
    console.log(`\n${checks} test(s) réussi(s).`);
  }
})();
