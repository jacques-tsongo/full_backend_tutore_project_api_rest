const { fail } = require('../utils/apiResponse');

exports.notFound = (req, res) => fail(res, `Route introuvable : ${req.method} ${req.originalUrl}`, [], 404);

exports.errorHandler = (err, req, res, next) => {
  console.error(err);
  if (err.code === 'ER_DUP_ENTRY') return fail(res, 'Cette ressource existe déjà.', [], 409);
  if (err.code === 'ER_NO_REFERENCED_ROW_2') return fail(res, 'Une ressource liée est introuvable.', [], 400);
  if (err.name === 'MulterError') return fail(res, err.message, [], 400);
  return fail(res, err.message || 'Erreur interne du serveur.', [], err.statusCode || 500);
};
