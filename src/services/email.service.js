/**
 * Envoi d'e-mails transactionnels via Nodemailer (SMTP Gmail).
 *
 * Drivers :
 *  - smtp    : envoi réel (Gmail, mot de passe d'application) ;
 *  - console : affiche l'e-mail (et le code éventuel) dans le terminal (dev) ;
 *  - outbox  : écrit chaque e-mail en JSON dans un dossier (tests).
 *
 * Règles : `console`/`outbox` refusés en production, `smtp` refusé en test.
 * Aucun vrai e-mail ne doit partir pendant les tests automatisés.
 */
const fs = require('fs');
const path = require('path');
const nodemailer = require('nodemailer');

const TIMEOUT_MS = 10000;

class MailNotConfiguredError extends Error {
  constructor(message = 'Le service d’envoi d’e-mails n’est pas configuré.', code = 'not_configured') {
    super(message);
    this.name = 'MailNotConfiguredError';
    this.code = code;
  }
}

class MailQuotaError extends Error {
  constructor(message = 'Le quota journalier d’envoi d’e-mails est atteint. Réessayez plus tard.') {
    super(message);
    this.name = 'MailQuotaError';
    this.code = 'quota_exceeded';
  }
}

class MailDeliveryError extends Error {
  constructor(message = 'Impossible d’envoyer l’e-mail.', { code = 'delivery_error', causeCode = null } = {}) {
    super(message);
    this.name = 'MailDeliveryError';
    this.code = code;
    this.causeCode = causeCode;
  }
}

const positiveNumber = (value, fallback) => {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : fallback;
};

const loadConfig = (env = process.env) => {
  const driver = String(env.MAIL_DRIVER || 'smtp').trim().toLowerCase();
  const smtpPass = String(env.SMTP_PASS || '').replace(/\s+/g, '');
  const smtpUser = String(env.SMTP_USER || '').trim();
  return {
    driver,
    smtpHost: String(env.SMTP_HOST || 'smtp.gmail.com').trim(),
    smtpPort: Number(env.SMTP_PORT || 465),
    smtpSecure: env.SMTP_SECURE === undefined || env.SMTP_SECURE === ''
      ? Number(env.SMTP_PORT || 465) === 465
      : /^(1|true|yes|oui)$/i.test(String(env.SMTP_SECURE).trim()),
    smtpUser,
    smtpPass,
    fromName: String(env.MAIL_FROM_NAME || 'LinkEmploi').trim() || 'LinkEmploi',
    fromEmail: String(env.MAIL_FROM_EMAIL || smtpUser || '').trim(),
    dailyLimit: positiveNumber(env.MAIL_DAILY_LIMIT, 450),
    outboxDir: String(env.MAIL_OUTBOX_DIR || 'tmp/outbox').trim() || 'tmp/outbox',
    nodeEnv: String(env.NODE_ENV || 'development').trim().toLowerCase()
  };
};

const assertDriverAllowed = (config = loadConfig()) => {
  if (config.nodeEnv === 'production' && (config.driver === 'console' || config.driver === 'outbox')) {
    throw new MailNotConfiguredError(
      `Le driver d'e-mail « ${config.driver} » est interdit en production.`,
      'driver_forbidden'
    );
  }
  if (config.nodeEnv === 'test' && config.driver === 'smtp') {
    throw new MailNotConfiguredError(
      'Le driver d\'e-mail « smtp » est interdit en mode test (utilisez « outbox »).',
      'driver_forbidden'
    );
  }
  return true;
};

const isConfigured = (config = loadConfig()) => {
  try {
    assertDriverAllowed(config);
  } catch (_) {
    return false;
  }
  if (config.driver === 'console' || config.driver === 'outbox') return true;
  if (config.driver === 'smtp') return Boolean(config.smtpUser && config.smtpPass);
  return false;
};

/** Échappe le texte inséré dans le HTML (noms/prénoms). */
const escapeHtml = (value) => String(value ?? '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#39;');

/** Supprime les retours à la ligne des en-têtes. */
const sanitizeHeader = (value) => String(value ?? '').replace(/[\r\n]+/g, ' ').trim();

/** Masque une adresse e-mail pour les logs. */
const maskEmail = (email) => {
  const value = String(email || '').trim();
  const [local = '', domain = ''] = value.split('@');
  if (!domain) return '***';
  const head = local.slice(0, 1) || '*';
  return `${head}***@${domain}`;
};

let cachedTransport = null;
let cachedKey = null;
let quotaState = { date: null, count: 0 };

const resetQuota = () => { quotaState = { date: null, count: 0 }; };

const todayKey = () => new Date().toISOString().slice(0, 10);

const consumeQuota = (config = loadConfig()) => {
  const today = todayKey();
  if (quotaState.date !== today) quotaState = { date: today, count: 0 };
  if (quotaState.count >= config.dailyLimit) {
    throw new MailQuotaError();
  }
  quotaState.count += 1;
};

const transportKey = (config) => [
  config.driver, config.smtpHost, config.smtpPort, config.smtpSecure,
  config.smtpUser, config.smtpPass, config.outboxDir
].join('|');

const ensureOutboxDir = (dir) => {
  fs.mkdirSync(dir, { recursive: true });
};

const createTransport = (config = loadConfig(), deps = {}) => {
  if (deps.transport) return deps.transport;
  if (config.driver === 'console') {
    return { __driver: 'console' };
  }
  if (config.driver === 'outbox') {
    const dir = path.isAbsolute(config.outboxDir)
      ? config.outboxDir
      : path.join(process.cwd(), config.outboxDir);
    ensureOutboxDir(dir);
    return { __driver: 'outbox', __dir: dir };
  }
  return nodemailer.createTransport({
    host: config.smtpHost,
    port: config.smtpPort,
    secure: config.smtpSecure,
    auth: { user: config.smtpUser, pass: config.smtpPass },
    pool: true,
    maxConnections: 2,
    maxMessages: 50,
    connectionTimeout: TIMEOUT_MS,
    greetingTimeout: TIMEOUT_MS,
    socketTimeout: TIMEOUT_MS
  });
};

const getTransport = (config = loadConfig(), deps = {}) => {
  if (deps.transport) return deps.transport;
  const key = transportKey(config);
  if (!cachedTransport || cachedKey !== key) {
    cachedTransport = createTransport(config, deps);
    cachedKey = key;
  }
  return cachedTransport;
};

const resetTransport = () => { cachedTransport = null; cachedKey = null; };

const writeOutbox = (dir, payload) => {
  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const safeTo = String(payload.to || 'destinataire').replace(/[^a-z0-9@._-]+/gi, '_');
  const file = path.join(dir, `${stamp}-${safeTo}.json`);
  fs.writeFileSync(file, JSON.stringify(payload, null, 2), 'utf8');
  return file;
};

/**
 * Envoie un e-mail. Interface unique : { to, subject, html, text }.
 * `htmlContent`/`textContent` acceptés pour compatibilité interne.
 */
const send = async (message = {}, deps = {}) => {
  const config = deps.config || loadConfig();
  assertDriverAllowed(config);
  if (!isConfigured(config)) {
    throw new MailNotConfiguredError();
  }

  const to = sanitizeHeader(message.to);
  const subject = sanitizeHeader(message.subject || '');
  const html = String(message.html || message.htmlContent || '');
  const text = String(message.text || message.textContent || '');
  const from = `"${sanitizeHeader(config.fromName).replace(/"/g, '')}" <${sanitizeHeader(config.fromEmail)}>`;

  if (config.driver === 'smtp') consumeQuota(config);

  const transport = getTransport(config, deps);
  const payload = {
    from,
    to,
    subject,
    html,
    text,
    date: new Date().toISOString(),
    driver: config.driver
  };

  try {
    if (transport && transport.__driver === 'console') {
      const output = [
        '--- E-MAIL (driver console) ---',
        `À      : ${to}`,
        `Sujet  : ${subject}`,
        `Texte  : ${text || '(vide)'}`,
        '--- FIN E-MAIL ---'
      ].join('\n');
      (deps.logger || console).log(output);
      return { sent: true, driver: 'console' };
    }
    if (transport && transport.__driver === 'outbox') {
      const file = writeOutbox(transport.__dir, payload);
      return { sent: true, driver: 'outbox', file };
    }
    const info = await transport.sendMail({ from, to, subject, html, text });
    return { sent: true, driver: 'smtp', messageId: info && info.messageId ? info.messageId : null };
  } catch (error) {
    if (error instanceof MailQuotaError || error instanceof MailNotConfiguredError) throw error;
    const causeCode = error && (error.responseCode || error.code) ? String(error.responseCode || error.code) : null;
    throw new MailDeliveryError('Impossible d’envoyer l’e-mail pour le moment.', {
      code: 'delivery_error',
      causeCode
    });
  }
};

/** Vérifie la connexion SMTP (driver smtp uniquement). */
const verifyConnection = async (deps = {}) => {
  const config = deps.config || loadConfig();
  assertDriverAllowed(config);
  if (config.driver !== 'smtp') {
    return { ok: true, driver: config.driver, message: `Driver « ${config.driver} » : aucune vérification SMTP nécessaire.` };
  }
  if (!isConfigured(config)) throw new MailNotConfiguredError();
  const transport = getTransport(config, deps);
  await transport.verify();
  return { ok: true, driver: 'smtp' };
};

const describeSignupState = (config = loadConfig()) => {
  try {
    assertDriverAllowed(config);
  } catch (error) {
    const detail = error.code === 'driver_forbidden' ? error.message : 'configuration invalide';
    return `Inscription par code e-mail : INACTIVE — LES INSCRIPTIONS SONT BLOQUÉES (${detail})`;
  }
  if (!isConfigured(config)) {
    const missing = [];
    if (!config.smtpUser) missing.push('SMTP_USER');
    if (!config.smtpPass) missing.push('SMTP_PASS');
    return `Inscription par code e-mail : INACTIVE — LES INSCRIPTIONS SONT BLOQUÉES (variable manquante : ${missing.join(', ') || 'configuration incomplète'})`;
  }
  if (config.driver === 'console') {
    return 'Inscription par code e-mail : ACTIVE en mode CONSOLE (développement : le code s\'affiche dans ce terminal)';
  }
  if (config.driver === 'outbox') {
    return 'Inscription par code e-mail : ACTIVE en mode OUTBOX (tests : les e-mails sont écrits dans le dossier outbox)';
  }
  return 'Inscription par code e-mail : ACTIVE (SMTP Gmail, code valable 10 min)';
};

/** État détaillé pour les diagnostics (scripts). */
const getStatus = (config = loadConfig()) => {
  let allowed = true;
  let reason = null;
  try { assertDriverAllowed(config); } catch (e) { allowed = false; reason = e.message; }
  return {
    driver: config.driver,
    configured: allowed && isConfigured(config),
    allowed,
    reason,
    signupState: describeSignupState(config),
    from: config.fromEmail ? `${config.fromName} <${maskEmail(config.fromEmail)}>` : null
  };
};

module.exports = {
  TIMEOUT_MS,
  MailNotConfiguredError,
  MailQuotaError,
  MailDeliveryError,
  loadConfig,
  assertDriverAllowed,
  isConfigured,
  send,
  verifyConnection,
  describeSignupState,
  getStatus,
  escapeHtml,
  sanitizeHeader,
  maskEmail,
  getTransport,
  resetTransport,
  resetQuota,
  createTransport
};
