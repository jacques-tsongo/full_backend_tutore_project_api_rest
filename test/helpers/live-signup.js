/**
 * Aides pour les tests « live » (serveur + base réels).
 *
 * Le nouveau flux d'inscription exige un code à 6 chiffres. Pour que ces tests
 * restent automatisables sans envoyer de vrais e-mails, le serveur doit être
 * lancé avec `MAIL_DRIVER=outbox` et `MAIL_OUTBOX_DIR=tmp/outbox` (valeur par
 * défaut). Le code est alors lu dans le dernier e-mail JSON écrit par le
 * serveur, puis validé via l'API ou le formulaire web.
 *
 * Aucune écriture en base ici : uniquement des appels HTTP et la lecture du
 * dossier outbox.
 */
const fs = require('fs');
const path = require('path');

const DEFAULT_OUTBOX = process.env.MAIL_OUTBOX_DIR || 'tmp/outbox';
const DEFAULT_TIMEOUT = 8000;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const normalizeEmail = (value) => String(value || '').trim().toLowerCase();

const outboxDirectory = (dir = DEFAULT_OUTBOX) => (
  path.isAbsolute(dir) ? dir : path.join(process.cwd(), dir)
);

const extractCode = (message) => {
  const match = String(message?.text || '').match(/^\s*(\d{6})\s*$/m);
  return match ? match[1] : null;
};

const readMessages = (dir) => {
  let files;
  try {
    files = fs.readdirSync(dir).filter((name) => name.endsWith('.json'));
  } catch (_) {
    return [];
  }
  return files
    .map((name) => {
      const full = path.join(dir, name);
      try {
        const stat = fs.statSync(full);
        const payload = JSON.parse(fs.readFileSync(full, 'utf8'));
        return { payload, mtimeMs: stat.mtimeMs };
      } catch (_) {
        return null;
      }
    })
    .filter(Boolean)
    .sort((a, b) => b.mtimeMs - a.mtimeMs);
};

/**
 * Attend le code reçu par `email` dans le dossier outbox.
 * @throws si aucun e-mail contenant un code n'est trouvé avant `timeout`.
 */
const waitForCode = async (email, { dir = DEFAULT_OUTBOX, timeout = DEFAULT_TIMEOUT } = {}) => {
  const target = normalizeEmail(email);
  const directory = outboxDirectory(dir);
  const deadline = Date.now() + timeout;

  do {
    const found = readMessages(directory).find(({ payload }) => (
      normalizeEmail(payload?.to) === target && extractCode(payload)
    ));
    if (found) return extractCode(found.payload);
    await sleep(100);
  } while (Date.now() < deadline);

  throw new Error(
    `Aucun e-mail avec code trouvé pour ${target} dans ${directory}. ` +
    'Lancez le serveur avec MAIL_DRIVER=outbox (interdit en production).'
  );
};

const withApiSuffix = (base) => {
  const clean = String(base || 'http://127.0.0.1:5000').replace(/\/+$/, '');
  return /\/api$/.test(clean) ? clean : `${clean}/api`;
};

const postJson = async (url, body) => {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  let json = null;
  try { json = await res.json(); } catch (_) {}
  return { status: res.status, json };
};

/**
 * Inscription API complète : `POST /auth/register` puis validation du code
 * lu dans l'outbox via `POST /auth/register/verify`.
 *
 * Retourne `{ register, verify, ticket, code, token, user }`.
 */
const registerVerified = async (payload, {
  base = process.env.API_BASE || 'http://127.0.0.1:5000',
  dir = DEFAULT_OUTBOX,
  timeout = DEFAULT_TIMEOUT
} = {}) => {
  const api = withApiSuffix(base);
  const register = await postJson(`${api}/auth/register`, payload);
  const ticket = register.json?.data?.ticket;
  if (register.status !== 202 || !ticket) {
    throw new Error(
      `Inscription refusée (${register.status}) : ${register.json?.message || 'réponse inattendue'}`
    );
  }

  const code = await waitForCode(payload.email, { dir, timeout });
  const verify = await postJson(`${api}/auth/register/verify`, { ticket, code });
  if (verify.status !== 201) {
    throw new Error(
      `Vérification refusée (${verify.status}) : ${verify.json?.message || 'réponse inattendue'}`
    );
  }

  return {
    register,
    verify,
    ticket,
    code,
    token: verify.json?.data?.token,
    user: verify.json?.data?.user
  };
};

/**
 * Inscription via les pages web : le navigateur de test conserve le cookie
 * httpOnly `gc_signup` entre les deux requêtes.
 *
 * Retourne `{ register, verify, code }`.
 */
const registerWeb = async (browser, form, {
  dir = DEFAULT_OUTBOX,
  timeout = DEFAULT_TIMEOUT
} = {}) => {
  const register = await browser.post('/register', { form });
  if (register.status !== 302 || !String(register.location || '').includes('/register/verification')) {
    throw new Error(
      `Inscription web refusée (${register.status}) : ${register.location || 'aucune redirection'}`
    );
  }

  const code = await waitForCode(form.email, { dir, timeout });
  const verify = await browser.post('/register/verification', { form: { code } });
  if (verify.status !== 302 || !String(verify.location || '').includes('/competences')) {
    throw new Error(
      `Vérification web refusée (${verify.status}) : ${verify.location || 'aucune redirection'}`
    );
  }

  return { register, verify, code };
};

module.exports = {
  DEFAULT_OUTBOX,
  extractCode,
  waitForCode,
  registerVerified,
  registerWeb
};
