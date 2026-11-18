/**
 * Limitation des demandes sensibles liées à l'inscription et à la vérification
 * e-mail. En API la réponse reste un JSON 429 ; sur une page, l'utilisateur est
 * renvoyé vers la page concernée avec un message flash.
 */
const crypto = require('crypto');
const rateLimit = require('express-rate-limit');
const { flash } = require('../helpers/flash');
const { normalizeEmailAddress } = require('../utils/email');

const PAYLOAD = {
  success: false,
  message: 'Trop de demandes. Réessayez dans quelques minutes.',
  errors: []
};

/**
 * Détecte un appel API. `req.path` est relatif au routeur : on se base donc sur
 * l'URL d'origine, qui conserve le préfixe `/api/`.
 */
const isApiRequest = (req) => String(req.originalUrl || req.url || '').startsWith('/api/');

/** Fabrique un limiteur (sur-configurable dans les tests). */
const createLimiter = (overrides = {}, redirectTo = '/login') => rateLimit({
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: PAYLOAD,
  ...overrides,
  handler: overrides.handler || ((req, res, next, options) => {
    // Un client API (Accept: */* ou JSON) reçoit toujours un JSON 429.
    if (!isApiRequest(req) && req.accepts(['html', 'json']) === 'html') {
      flash(res, 'danger', PAYLOAD.message);
      return res.redirect(redirectTo);
    }
    return res.status(options.statusCode).json(options.message);
  })
});

/** Ancien limiteur de renvoi de lien (conservé pour les tests unitaires). */
const createVerificationLimiter = (overrides = {}) => createLimiter({
  windowMs: 15 * 60 * 1000,
  limit: 5,
  ...overrides
}, '/login');

const verificationLimiter = createVerificationLimiter();

/** Étape 1 — 10 demandes par heure et par adresse IP. */
const createRegisterIpLimiter = (overrides = {}) => createLimiter({
  windowMs: 60 * 60 * 1000,
  limit: 10,
  ...overrides
}, '/register');

/** Étape 1 — 5 demandes par heure et par adresse e-mail (hachée). */
const createRegisterEmailLimiter = (overrides = {}) => createLimiter({
  windowMs: 60 * 60 * 1000,
  limit: 5,
  keyGenerator: (req) => {
    const email = normalizeEmailAddress(req.body?.email);
    if (!email) return `ip:${req.ip || req.socket?.remoteAddress || 'inconnue'}`;
    return crypto.createHash('sha256').update(email).digest('hex');
  },
  ...overrides
}, '/register');

/** Étape 2 — 30 essais de code par quart d'heure et par IP. */
const createVerifyCodeLimiter = (overrides = {}) => createLimiter({
  windowMs: 15 * 60 * 1000,
  limit: 30,
  ...overrides
}, '/register/verification');

/** Renvoi de code — 20 demandes par heure et par IP. */
const createResendCodeLimiter = (overrides = {}) => createLimiter({
  windowMs: 60 * 60 * 1000,
  limit: 20,
  ...overrides
}, '/register/verification');

module.exports = {
  verificationLimiter,
  createVerificationLimiter,
  registerIpLimiter: createRegisterIpLimiter(),
  registerEmailLimiter: createRegisterEmailLimiter(),
  verifyCodeLimiter: createVerifyCodeLimiter(),
  resendCodeLimiter: createResendCodeLimiter(),
  createRegisterIpLimiter,
  createRegisterEmailLimiter,
  createVerifyCodeLimiter,
  createResendCodeLimiter,
  isApiRequest,
  PAYLOAD
};
