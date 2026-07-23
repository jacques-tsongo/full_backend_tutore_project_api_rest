const jwt = require('jsonwebtoken');
const User = require('../models/user.model');
const { fail } = require('../utils/apiResponse');
const asyncHandler = require('../utils/asyncHandler');

exports.authenticate = asyncHandler(async (req, res, next) => {
  const token = req.headers.authorization?.startsWith('Bearer ') && req.headers.authorization.slice(7);
  if (!token) return fail(res, 'Jeton d’authentification requis.', [], 401);
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findById(payload.id);
    if (!user || user.statut_compte !== 'actif') return fail(res, 'Compte indisponible.', [], 401);
    req.user = user;
    next();
  } catch (_) { return fail(res, 'Jeton invalide ou expiré.', [], 401); }
});

exports.authorize = (...roles) => (req, res, next) =>
  roles.includes(req.user.role) ? next() : fail(res, 'Accès non autorisé.', [], 403);
