const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const User = require('../models/user.model');
const { success, fail } = require('../utils/apiResponse');
const asyncHandler = require('../utils/asyncHandler');

const tokenFor = (user) => jwt.sign({ id: user.id_utilisateur, role: user.role }, process.env.JWT_SECRET, { expiresIn: process.env.JWT_EXPIRES_IN || '7d' });
exports.register = asyncHandler(async (req, res) => {
  const { nom, prenom, email, mot_de_passe, telephone, role = 'candidat' } = req.body;
  if (!['candidat', 'recruteur','administrateur'].includes(role)) return fail(res, 'Rôle d’inscription invalide.', [], 422);
  if (await User.findByEmail(email)) return fail(res, 'Cette adresse e-mail est déjà utilisée.', [], 409);
  const user = await User.create({ nom, prenom, email, telephone, role, password: await bcrypt.hash(mot_de_passe, 12) });
  return success(res, 'Compte créé avec succès.', { user, token: tokenFor(user) }, 201);
});
exports.login = asyncHandler(async (req, res) => {
  const user = await User.findByEmail(req.body.email);
  if (!user || !(await bcrypt.compare(req.body.mot_de_passe, user.mot_de_passe))) return fail(res, 'Identifiants invalides.', [], 401);
  if (user.statut_compte !== 'actif') return fail(res, 'Compte non actif.', [], 403);
  delete user.mot_de_passe;
  return success(res, 'Connexion réussie.', { user, token: tokenFor(user) });
});
exports.me = asyncHandler(async (req, res) => success(res, 'Profil utilisateur.', { user: req.user }));
exports.updateMe = asyncHandler(async (req, res) => success(res, 'Profil mis à jour.', { user: await User.update(req.user.id_utilisateur, req.body) }));
exports.logout = (req, res) => success(res, 'Déconnexion réussie. Supprimez le jeton côté client.');
