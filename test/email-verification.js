/**
 * Tests de la vérification d'adresse e-mail — aucune base ni réseau.
 *
 * - configuration Brevo (clé, expéditeur, mode strict) ;
 * - composition et envoi du message (fetch simulé) ;
 * - jeton aléatoire, stocké uniquement sous forme d'empreinte SHA-256 ;
 * - usage unique, expiration déléguée à la requête SQL ;
 * - renvoi sans révéler l'existence du compte ;
 * - migration additive et idempotente.
 *
 * Exécution : node test/email-verification.js
 */
const assert = require('node:assert/strict');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const email = require('../src/services/email.service');
const verification = require('../src/services/emailVerification.service');

let checks = 0;
const test = async (name, fn) => {
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

const config = email.loadConfig({
  BREVO_API_KEY: 'xkeysib-test',
  MAIL_FROM_EMAIL: 'no-reply@linkemploi.test',
  MAIL_FROM_NAME: 'LinkEmploi Test',
  APP_URL: 'https://app.linkemploi.test/',
  EMAIL_VERIFICATION_REQUIRED: 'true',
  EMAIL_VERIFICATION_TTL_HOURS: '48',
  EMAIL_TIMEOUT_MS: '5000'
});

const user = {
  id_utilisateur: 42,
  nom: 'Mbala',
  prenom: 'Jean',
  email: 'jean.mbala@test.com',
  email_verifie: 0
};

console.log('Tests de la vérification d’adresse e-mail');

(async () => {
  await test('la configuration est normalisée (URL sans slash final, durée de vie)', () => {
    assert.equal(config.appUrl, 'https://app.linkemploi.test');
    assert.equal(config.verificationTtlHours, 48);
    assert.equal(config.timeoutMs, 5000);
    assert.equal(config.required, true);
    assert.equal(email.isConfigured(config), true);
    assert.equal(email.isVerificationRequired(config), true);

    const fallback = email.loadConfig({ EMAIL_VERIFICATION_TTL_HOURS: 'abc', EMAIL_TIMEOUT_MS: '0' });
    assert.equal(fallback.verificationTtlHours, 24);
    assert.equal(fallback.timeoutMs, 10000);
  });

  await test('le mode strict est ignoré sans clé ou expéditeur configuré', () => {
    assert.equal(email.isVerificationRequired({ required: true, apiKey: '', senderEmail: 'x@y.z' }), false);
    assert.equal(email.isVerificationRequired({ required: true, apiKey: 'k', senderEmail: '' }), false);
    assert.equal(email.isVerificationRequired({ required: false, apiKey: 'k', senderEmail: 'x@y.z' }), false);
  });

  await test('l’e-mail de vérification contient un lien absolu et échappe le prénom', () => {
    const message = email.buildVerificationEmail({
      prenom: '<script>alert(1)</script>',
      token: 'a'.repeat(64),
      config
    });
    assert.match(message.subject, /vérifiez votre adresse e-mail/i);
    assert.match(message.textContent, /https:\/\/app\.linkemploi\.test\/verify-email\?token=a{64}/);
    assert.match(message.htmlContent, /https:\/\/app\.linkemploi\.test\/verify-email\?token=a{64}/);
    assert.doesNotMatch(message.htmlContent, /<script>/);
    assert.match(message.htmlContent, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  });

  await test('Brevo reçoit la requête attendue (URL, clé API, expéditeur, destinataire)', async () => {
    let request = null;
    const fetchImpl = async (url, options) => {
      request = { url, options };
      return { ok: true, status: 201 };
    };
    const message = email.buildVerificationEmail({ prenom: 'Jean', token: 'b'.repeat(64), config });
    const result = await email.send({ to: user.email, ...message }, { config, fetchImpl });

    assert.equal(result.sent, true);
    assert.equal(request.url, email.BREVO_ENDPOINT);
    assert.equal(request.options.method, 'POST');
    assert.equal(request.options.headers['api-key'], 'xkeysib-test');
    const body = JSON.parse(request.options.body);
    assert.deepEqual(body.sender, { name: 'LinkEmploi Test', email: 'no-reply@linkemploi.test' });
    assert.deepEqual(body.to, [{ email: user.email }]);
  });

  await test('un refus Brevo est transformé en erreur maîtrisée', async () => {
    const fetchImpl = async () => ({ ok: false, status: 401 });
    await assert.rejects(
      () => email.send({ to: user.email, subject: 'x', htmlContent: 'x', textContent: 'x' }, { config, fetchImpl }),
      (error) => error instanceof email.EmailDeliveryError && error.code === 'brevo_http_error' && error.status === 401
    );
  });

  await test('un refus Brevo joint son code et son message à l’erreur', async () => {
    const fetchImpl = async () => ({
      ok: false,
      status: 401,
      text: async () => JSON.stringify({ code: 'unauthorized', message: 'Key not found' })
    });
    await assert.rejects(
      () => email.send({ to: user.email, subject: 'x', htmlContent: 'x', textContent: 'x' }, { config, fetchImpl }),
      (error) => error.status === 401
        && error.brevoCode === 'unauthorized'
        && error.brevoMessage === 'Key not found'
        && /Key not found/.test(error.message)
    );
  });

  await test('l’état de démarrage distingue les trois modes', () => {
    const disabled = email.describeVerificationState(email.loadConfig({}));
    assert.match(disabled, /DÉSACTIVÉE/);
    assert.match(disabled, /vérifiés automatiquement/);

    const informative = email.describeVerificationState(email.loadConfig({
      BREVO_API_KEY: 'k', MAIL_FROM_EMAIL: 'no-reply@test.tld', EMAIL_VERIFICATION_REQUIRED: 'false'
    }));
    assert.match(informative, /INFORMATIVE/);

    const required = email.describeVerificationState(email.loadConfig({
      BREVO_API_KEY: 'k', MAIL_FROM_EMAIL: 'no-reply@test.tld', EMAIL_VERIFICATION_REQUIRED: 'true'
    }));
    assert.match(required, /OBLIGATOIRE/);

    // REQUIRED=true sans Brevo reste DÉSACTIVÉE (aucun verrouillage possible).
    const requiredWithoutBrevo = email.describeVerificationState(email.loadConfig({
      EMAIL_VERIFICATION_REQUIRED: 'true'
    }));
    assert.match(requiredWithoutBrevo, /DÉSACTIVÉE/);
  });

  await test('un envoi sans configuration échoue explicitement', async () => {
    await assert.rejects(
      () => email.send({ to: user.email, subject: 'x', htmlContent: 'x', textContent: 'x' }, { config: email.loadConfig({}) }),
      (error) => error instanceof email.EmailDeliveryError && error.code === 'not_configured'
    );
  });

  await test('le jeton est aléatoire et seule son empreinte SHA-256 est stockée', async () => {
    let saved = null;
    let sent = null;
    const result = await verification.issue(user, {
      config,
      saveToken: async (id, hash, ttlSeconds) => { saved = { id, hash, ttlSeconds }; },
      sendVerification: async (recipient, token) => { sent = { recipient, token }; }
    });

    assert.equal(result.sent, true);
    assert.equal(saved.id, user.id_utilisateur);
    assert.match(saved.hash, /^[a-f0-9]{64}$/);
    assert.match(sent.token, /^[a-f0-9]{64}$/);
    assert.notEqual(saved.hash, sent.token);
    assert.equal(saved.hash, crypto.createHash('sha256').update(sent.token).digest('hex'));
    // La durée est transmise en secondes (48 h) : la date d'expiration est
    // calculée en SQL, pas en JavaScript.
    assert.equal(saved.ttlSeconds, 48 * 60 * 60);
    assert.ok(result.expiresAt instanceof Date);
  });

  await test('un TTL court reste cohérent : durée en secondes et expiration calculée en SQL', async () => {
    const shortConfig = email.loadConfig({
      BREVO_API_KEY: 'k', MAIL_FROM_EMAIL: 'no-reply@test.tld', EMAIL_VERIFICATION_TTL_HOURS: '2'
    });
    let ttlSeconds = null;
    await verification.issue(user, {
      config: shortConfig,
      saveToken: async (id, hash, seconds) => { ttlSeconds = seconds; },
      sendVerification: async () => {}
    });
    assert.equal(ttlSeconds, 2 * 60 * 60);

    // Le modèle calcule l'expiration côté MariaDB (même fuseau que NOW()).
    const modelSource = fs.readFileSync(path.join(process.cwd(), 'src', 'models', 'user.model.js'), 'utf8');
    assert.match(modelSource, /DATE_ADD\(NOW\(\), INTERVAL \? SECOND\)/);
    assert.match(modelSource, /email_verification_expire = DATE_ADD\(NOW\(\)/);
    assert.doesNotMatch(modelSource, /email_verification_expire = \?/);
  });

  await test('sans transport configuré, aucun jeton n’est créé', async () => {
    let touched = false;
    const result = await verification.issue(user, {
      config: email.loadConfig({}),
      saveToken: async () => { touched = true; },
      sendVerification: async () => { touched = true; }
    });
    assert.deepEqual(result, { sent: false, reason: 'not_configured' });
    assert.equal(touched, false);
  });

  await test('un échec d’envoi ne casse pas l’inscription', async () => {
    const logs = [];
    const result = await verification.issue(user, {
      config,
      saveToken: async () => {},
      sendVerification: async () => { throw new email.EmailDeliveryError('panne', { code: 'network_error' }); },
      logger: { error: (message) => logs.push(message) }
    });
    assert.deepEqual(result, { sent: false, reason: 'send_failed' });
    assert.equal(logs.length, 1);
    assert.doesNotMatch(logs[0], /[a-f0-9]{64}/);
  });

  await test('le log d’échec contient le statut HTTP et le message Brevo, jamais le jeton', async () => {
    const logs = [];
    const result = await verification.issue(user, {
      config,
      saveToken: async () => {},
      sendVerification: async () => {
        throw new email.EmailDeliveryError('Brevo a refusé l’envoi (HTTP 401) : Key not found.', {
          code: 'brevo_http_error', status: 401, brevoMessage: 'Key not found', brevoCode: 'unauthorized'
        });
      },
      logger: { error: (message) => logs.push(message) }
    });
    assert.deepEqual(result, { sent: false, reason: 'send_failed' });
    assert.equal(logs.length, 1);
    assert.match(logs[0], /brevo_http_error/);
    assert.match(logs[0], /HTTP 401/);
    assert.match(logs[0], /Key not found/);
    assert.doesNotMatch(logs[0], /[a-f0-9]{64}/);
    assert.doesNotMatch(logs[0], /xkeysib/);
  });

  await test('un jeton mal formé est refusé sans accès base', async () => {
    let called = false;
    const result = await verification.verify('pas-un-jeton', {
      markVerified: async () => { called = true; return 1; }
    });
    assert.deepEqual(result, { verified: false, reason: 'invalid' });
    assert.equal(called, false);
  });

  await test('la vérification consomme l’empreinte du jeton', async () => {
    const token = 'c'.repeat(64);
    let received = null;
    const result = await verification.verify(token, {
      markVerified: async (hash) => { received = hash; return 1; }
    });
    assert.equal(result.verified, true);
    assert.equal(received, crypto.createHash('sha256').update(token).digest('hex'));
  });

  await test('un jeton inconnu ou expiré est refusé', async () => {
    const result = await verification.verify('d'.repeat(64), { markVerified: async () => 0 });
    assert.deepEqual(result, { verified: false, reason: 'invalid_or_expired' });
  });

  await test('le renvoi ne fait rien pour un compte inconnu ou déjà vérifié', async () => {
    let issued = false;
    const deps = {
      config,
      saveToken: async () => { issued = true; },
      sendVerification: async () => { issued = true; },
      findByEmail: async () => null
    };
    assert.deepEqual(await verification.resend('inconnu@test.com', deps), { sent: false, reason: 'not_found' });
    deps.findByEmail = async () => ({ ...user, email_verifie: 1 });
    assert.deepEqual(await verification.resend(user.email, deps), { sent: false, reason: 'already_verified' });
    assert.equal(issued, false);
  });

  await test('le renvoi émet un nouveau jeton pour un compte non vérifié', async () => {
    let saved = false;
    let sent = false;
    const result = await verification.resend(user.email, {
      config,
      findByEmail: async () => user,
      saveToken: async () => { saved = true; },
      sendVerification: async () => { sent = true; }
    });
    assert.equal(result.sent, true);
    assert.equal(saved, true);
    assert.equal(sent, true);
  });

  await test('la migration est additive, idempotente et vérifie information_schema', () => {
    const migrationPath = path.join(process.cwd(), 'database', 'migrations', '20261107_03_email_verification.sql');
    const sql = fs.readFileSync(migrationPath, 'utf8');
    for (const column of ['email_verifie', 'email_verifie_le', 'email_verification_token_hash', 'email_verification_expire']) {
      assert.match(sql, new RegExp(`COLUMN_NAME = '${column}'`), `${column} : contrôle d’existence absent`);
      assert.match(sql, new RegExp(`ADD COLUMN ${column}`), `${column} : ajout absent`);
    }
    assert.match(sql, /ADD COLUMN email_verifie TINYINT\(1\) NOT NULL DEFAULT 1/);
    assert.match(sql, /MODIFY COLUMN email_verifie TINYINT\(1\) NOT NULL DEFAULT 0/);
    assert.match(sql, /uq_utilisateur_email_verification_token/);
    assert.doesNotMatch(sql, /\bDELETE\s+FROM\b/i);
    assert.doesNotMatch(sql, /\bTRUNCATE\b/i);
    assert.doesNotMatch(sql, /\bDROP\s+TABLE\b/i);
    assert.doesNotMatch(sql, /^\s*UPDATE\s+/im);
  });

  await test('les routes API et web exposent la vérification et le renvoi', () => {
    const api = fs.readFileSync(path.join(process.cwd(), 'src', 'routes', 'auth.routes.js'), 'utf8');
    const web = fs.readFileSync(path.join(process.cwd(), 'src', 'routes', 'web.routes.js'), 'utf8');
    assert.match(api, /router\.get\('\/verify-email\/:token'/);
    assert.match(api, /router\.post\('\/resend-verification'/);
    assert.match(web, /router\.get\('\/verify-email'/);
    assert.match(web, /router\.post\('\/verifier-email\/renvoyer'/);
  });

  if (process.exitCode) {
    console.error(`\n${checks} test(s) réussi(s), des erreurs subsistent.`);
  } else {
    console.log(`\n${checks} test(s) réussi(s).`);
  }
})();
