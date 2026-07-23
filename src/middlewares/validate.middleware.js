const { validationResult } = require('express-validator');
const { fail } = require('../utils/apiResponse');

module.exports = (req, res, next) => {
  const result = validationResult(req);
  if (!result.isEmpty()) return fail(res, 'Données de requête invalides.', result.array(), 422);
  next();
};
