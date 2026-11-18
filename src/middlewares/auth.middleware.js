const jwt = require('jsonwebtoken');
const User = require('../models/user.model');
const { fail } = require('../utils/apiResponse');
const asyncHandler = require('../utils/asyncHandler');

const COOKIE_NAME = 'gc_token';

/**
 * Résout le jeton JWT de la requête.
 * Un seul mécanisme d'authentification (JWT), deux transports :
 *  1. en-tête `Authorization: Bearer <token>` (clients API, Postman, tests) ;
 *  2. cookie httpOnly `gc_token` (navigateur, pages EJS — jamais accessible au JS).
 */
const tokenFrom = (req) => {
  if (req.headers.authorization?.startsWith('Bearer ')) return req.headers.authorization.slice(7);
  return req.cookies?.[COOKIE_NAME] || null;
};

const UNVERIFIED_MESSAGE = 'Compte non vérifié. Contacte l’administrateur.';

/**
 * Résout l'utilisateur d'un jeton. Retourne `{ user }` ou `{ error }` :
 *  - `unavailable` : compte absent ou inactif ;
 *  - `unverified`  : compte historique dont l'adresse e-mail n'est pas validée.
 */
const verify = async (token) => {
  const payload = jwt.verify(token, process.env.JWT_SECRET);
  const user = await User.findById(payload.id);
  if (!user || user.statut_compte !== 'actif') return { error: 'unavailable' };
  // Une session existante ne contourne jamais l'absence de vérification.
  if (Number(user.email_verifie) !== 1) return { error: 'unverified' };
  return { user };
};

/** Garde API : l'utilisateur DOIT être authentifié sinon 401 JSON. */
exports.authenticate = asyncHandler(async (req, res, next) => {
  const token = tokenFrom(req);
  if (!token) return fail(res, 'Jeton d’authentification requis.', [], 401);
  try {
    const result = await verify(token);
    if (!result.user) {
      if (result.error === 'unverified') return fail(res, UNVERIFIED_MESSAGE, ['email_verifie'], 403);
      return fail(res, 'Compte indisponible.', [], 401);
    }
    req.user = result.user;
    next();
  } catch (_) { return fail(res, 'Jeton invalide ou expiré.', [], 401); }
});

/**
 * Garde des pages EJS : l'utilisateur authentifié via le cookie est exposé
 * dans `res.locals.user`. Sans session valide, redirection vers /login
 * (et le cookie éventuellement expiré est nettoyé).
 */
const noCacheHeaders = (res) => {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.set('Pragma', 'no-cache');
  res.set('Expires', '0');
  res.set('Surrogate-Control', 'no-store');
};

exports.webAuth = asyncHandler(async (req, res, next) => {
  const token = req.cookies?.[COOKIE_NAME];
  let user = null;
  let reason = 'invalid';
  if (token) {
    try {
      const result = await verify(token);
      user = result.user || null;
      reason = result.error || 'invalid';
    } catch (_) { user = null; }
    if (!user) res.clearCookie(COOKIE_NAME, { path: '/' });
  }
  req.user = user;
  res.locals.user = user;
  if (!user) {
    noCacheHeaders(res);
    const message = reason === 'unverified'
      ? UNVERIFIED_MESSAGE
      : 'Veuillez vous connecter pour continuer.';
    return res.redirect(`/login?erreur=${encodeURIComponent(message)}`);
  }
  noCacheHeaders(res);
  next();
});

/**
 * Variante « souple » des pages publiques : expose simplement `res.locals.user`
 * si la session existe, sans rediriger.
 */
exports.webOptionalAuth = asyncHandler(async (req, res, next) => {
  const token = req.cookies?.[COOKIE_NAME];
  let user = null;
  if (token) {
    try {
      const result = await verify(token);
      user = result.user || null;
    } catch (_) { user = null; }
    if (!user) res.clearCookie(COOKIE_NAME, { path: '/' });
  }
  req.user = user;
  res.locals.user = user;
  if (user) noCacheHeaders(res);
  next();
});

exports.authorize = (...roles) => (req, res, next) =>
  roles.includes(req.user.role) ? next() : fail(res, 'Accès non autorisé.', [], 403);

/** Variante web : renvoie vers la page d'erreur 403 plutôt qu'un JSON. */
exports.webAuthorize = (...roles) => (req, res, next) => {
  if (roles.includes(req.user.role)) return next();
  res.status(403);
  return res.render('error', {
    title: 'Accès refusé',
    status: 403,
    message: 'Vous n’avez pas les droits nécessaires pour consulter cette page.',
    user: res.locals.user || req.user
  });
};

exports.COOKIE_NAME = COOKIE_NAME;
