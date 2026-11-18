const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const User = require('../models/user.model');
const signup = require('../services/signup.service');
const { success, fail } = require('../utils/apiResponse');
const { normalizeEmailAddress } = require('../utils/email');
const asyncHandler = require('../utils/asyncHandler');
const { COOKIE_NAME } = require('../middlewares/auth.middleware');

/** Durée de vie du cookie calée sur l'expiration JWT (défaut : 7 jours). */
const COOKIE_MAX_AGE = 7 * 24 * 60 * 60 * 1000;

const cookieOptions = () => ({
  httpOnly: true,                       // jamais lisible depuis le JavaScript du navigateur
  sameSite: 'lax',
  secure: process.env.NODE_ENV === 'production',
  path: '/',
  maxAge: COOKIE_MAX_AGE
});

const tokenFor = (user) => jwt.sign({ id: user.id_utilisateur, role: user.role }, process.env.JWT_SECRET, { expiresIn: process.env.JWT_EXPIRES_IN || '7d' });

/** Persiste la session côté navigateur via un cookie httpOnly (le JWT reste le même que pour l'API). */
const persistSession = (res, token) => res.cookie(COOKIE_NAME, token, cookieOptions());

/**
 * Convertit une erreur métier d'inscription en réponse JSON.
 * Les erreurs inattendues remontent au gestionnaire global.
 */
const signupFailure = (res, error) => {
  if (error instanceof signup.SignupError) {
    return res.status(error.status || 400).json({
      success: false,
      message: error.message,
      errors: [],
      data: error.data || {}
    });
  }
  throw error;
};

/**
 * Étape 1 : aucune ligne `utilisateur` n'est créée. Une inscription en attente
 * est enregistrée et un code à 6 chiffres est envoyé par e-mail.
 */
exports.register = asyncHandler(async (req, res) => {
  try {
    const data = await signup.start({ body: req.body });
    return success(res, 'Un code de vérification a été envoyé à votre adresse e-mail.', data, 202);
  } catch (error) {
    return signupFailure(res, error);
  }
});

/**
 * Étape 2 : valide le code et crée le compte. En cas de succès, la session est
 * ouverte immédiatement (cookie httpOnly + jeton API).
 */
exports.registerVerify = asyncHandler(async (req, res) => {
  try {
    const { user } = await signup.verify({ ticket: req.body.ticket, code: req.body.code });
    const token = tokenFor(user);
    persistSession(res, token);
    return success(res, 'Compte créé. Bienvenue sur LinkEmploi !', { user, token }, 201);
  } catch (error) {
    return signupFailure(res, error);
  }
});

exports.registerResend = asyncHandler(async (req, res) => {
  try {
    const data = await signup.resend({ ticket: req.body.ticket });
    return success(res, 'Un nouveau code de vérification a été envoyé.', data);
  } catch (error) {
    return signupFailure(res, error);
  }
});

exports.registerCancel = asyncHandler(async (req, res) => {
  try {
    await signup.cancel({ ticket: req.body.ticket });
    return success(res, 'Inscription annulée.');
  } catch (error) {
    return signupFailure(res, error);
  }
});

exports.login = asyncHandler(async (req, res) => {
  const email = normalizeEmailAddress(req.body.email);
  const user = await User.findByEmail(email);
  if (!user || !(await bcrypt.compare(req.body.mot_de_passe, user.mot_de_passe))) return fail(res, 'Identifiants invalides.', [], 401);
  if (user.statut_compte !== 'actif') return fail(res, 'Compte non actif.', [], 403);
  // Garde-fou pour les comptes historiques : le flux normal ne crée que des
  // comptes vérifiés, mais une ligne `email_verifie = 0` ne doit jamais ouvrir
  // de session.
  if (Number(user.email_verifie) !== 1) {
    return fail(res, 'Compte non vérifié. Contacte l’administrateur.', ['email_verifie'], 403);
  }
  delete user.mot_de_passe;
  const token = tokenFor(user);
  persistSession(res, token);
  return success(res, 'Connexion réussie.', { user, token });
});

exports.me = asyncHandler(async (req, res) => success(res, 'Profil utilisateur.', { user: req.user }));

exports.updateMe = asyncHandler(async (req, res) => success(res, 'Profil mis à jour.', { user: await User.update(req.user.id_utilisateur, req.body) }));

/** Changement de mot de passe : vérification du mot de passe actuel obligatoire. */
exports.changePassword = asyncHandler(async (req, res) => {
  const { mot_de_passe_actuel, nouveau_mot_de_passe } = req.body;
  const full = await User.findByEmail(req.user.email);
  if (!full || !(await bcrypt.compare(mot_de_passe_actuel, full.mot_de_passe))) {
    return fail(res, 'Mot de passe actuel incorrect.', ['mot_de_passe_actuel'], 401);
  }
  await User.updatePassword(req.user.id_utilisateur, await bcrypt.hash(nouveau_mot_de_passe, 12));
  return success(res, 'Mot de passe mis à jour.');
});

exports.logout = (req, res) => {
  // Invalidation de la session navigateur : suppression du cookie httpOnly.
  res.clearCookie(COOKIE_NAME, { path: '/' });
  return success(res, 'Déconnexion réussie.');
};
