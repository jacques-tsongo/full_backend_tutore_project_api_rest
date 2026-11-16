/**
 * Limiteur de débit : discrimination API / page web — aucun MySQL.
 *
 * On monte un petit serveur Express avec deux limiteurs neufs (limite basse)
 * pour vérifier qu'un client API avec un en-tête Accept générique reçoit un
 * JSON 429, tandis qu'un formulaire web reçoit un flash + redirection /login.
 *
 * Exécution : node test/rate-limit-api.js (npm run test:rate-limit)
 */
const assert = require('node:assert/strict');
const http = require('http');
const express = require('express');
const { createVerificationLimiter } = require('../src/middlewares/rateLimit.middleware');

const request = (port, path, headers = {}) => new Promise((resolve, reject) => {
  const req = http.request({ host: '127.0.0.1', port, path, method: 'POST', headers }, (res) => {
    let body = '';
    res.setEncoding('utf8');
    res.on('data', (chunk) => { body += chunk; });
    res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body }));
  });
  req.on('error', reject);
  req.end();
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

console.log('Limiteur de débit : API vs page web');

(async () => {
  const app = express();
  const apiLimiter = createVerificationLimiter({ limit: 2, windowMs: 60 * 1000 });
  const webLimiter = createVerificationLimiter({ limit: 2, windowMs: 60 * 1000 });

  const apiRouter = express.Router();
  apiRouter.post('/resend-verification', apiLimiter, (req, res) => {
    res.status(200).json({ success: true, message: 'ok', data: {} });
  });
  app.use('/api/auth', apiRouter);

  app.post('/verifier-email/renvoyer', webLimiter, (req, res) => {
    res.status(200).send('formulaire accepté');
  });

  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();

  try {
    await test('client API avec Accept: */* → JSON 429 après dépassement', async () => {
      const headers = { accept: '*/*', 'content-type': 'application/json' };
      for (let i = 0; i < 2; i += 1) {
        const allowed = await request(port, '/api/auth/resend-verification', headers);
        assert.equal(allowed.status, 200);
      }
      const blocked = await request(port, '/api/auth/resend-verification', headers);
      assert.equal(blocked.status, 429);
      const payload = JSON.parse(blocked.body);
      assert.equal(payload.success, false);
      assert.match(payload.message, /Trop de demandes/);
    });

    await test('formulaire web → flash + redirection vers /login après dépassement', async () => {
      const headers = { accept: '*/*', 'content-type': 'application/x-www-form-urlencoded' };
      for (let i = 0; i < 2; i += 1) {
        const allowed = await request(port, '/verifier-email/renvoyer', headers);
        assert.equal(allowed.status, 200);
      }
      const blocked = await request(port, '/verifier-email/renvoyer', headers);
      assert.equal(blocked.status, 302);
      assert.equal(blocked.headers.location, '/login');
      assert.ok(String(blocked.headers['set-cookie'] || '').includes('gc_flash='));
    });
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }

  if (process.exitCode) {
    console.error(`\n${checks} test(s) réussi(s), des erreurs subsistent.`);
  } else {
    console.log(`\n${checks} test(s) réussi(s).`);
  }
})();
