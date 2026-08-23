const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const User = require('../models/user.model');
const db = require('../config/database');
const domaine = require('../services/domain.service');
const { success, fail } = require('../utils/apiResponse');
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

exports.register = asyncHandler(async (req, res) => {
  const { nom, prenom, email, mot_de_passe, telephone } = req.body;
  if (!nom || !prenom || !email || !mot_de_passe || String(mot_de_passe).length < 8) {
    return fail(res, 'Informations d’inscription invalides.', [], 422);
  }
  const selectedDomain = await domaine.findById(req.body.id_domaine);
  if (!selectedDomain) return fail(res, 'Veuillez sélectionner un domaine professionnel valide.', ['id_domaine'], 422);
  if (await User.findByEmail(email)) return fail(res, 'Cette adresse e-mail est déjà utilisée.', [], 409);

  // Inscription + profil professionnel dans une transaction : le domaine est
  // obligatoire et rattaché à profil_professionnel, jamais stocké dans une
  // structure parallèle. Aucun profil incomplet n'est créé si une étape échoue.
  const DEFAULT_AVATAR = 'uploads/photos/default-avatar.png';
  const DEFAULT_COVER = 'uploads/covers/default-cover.png';
  const connection = await db.getConnection();
  let userId;
  try {
    await connection.beginTransaction();
    const [created] = await connection.execute(
      `INSERT INTO utilisateur (nom, prenom, email, mot_de_passe, telephone, role, photo, photo_couverture)
       VALUES (?, ?, ?, ?, ?, 'candidat', ?, ?)`,
      [nom, prenom, email, await bcrypt.hash(mot_de_passe, 12), telephone || null, DEFAULT_AVATAR, DEFAULT_COVER]
    );
    userId = created.insertId;
    await connection.execute(
      'INSERT INTO profil_professionnel (id_utilisateur, id_domaine) VALUES (?, ?)',
      [userId, selectedDomain.id_domaine]
    );
    await connection.commit();
  } catch (error) {
    await connection.rollback().catch(() => {});
    throw error;
  } finally {
    connection.release();
  }

  const fresh = await User.findById(userId);
  const token = tokenFor(fresh);
  persistSession(res, token);
  return success(res, 'Compte créé avec succès.', { user: fresh, token }, 201);
});
exports.login = asyncHandler(async (req, res) => {
  const user = await User.findByEmail(req.body.email);
  if (!user || !(await bcrypt.compare(req.body.mot_de_passe, user.mot_de_passe))) return fail(res, 'Identifiants invalides.', [], 401);
  if (user.statut_compte !== 'actif') return fail(res, 'Compte non actif.', [], 403);
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
