const { fail } = require('../utils/apiResponse');

exports.notFound = (req, res) => {
  const wantsHtml = !req.path.startsWith('/api') && req.accepts(['html', 'json']) === 'html';
  if (wantsHtml && res.app.get('view engine')) {
    return res.status(404).render('404', { title: 'Page introuvable', user: res.locals.user || null });
  }
  return fail(res, `Route introuvable : ${req.method} ${req.originalUrl}`, [], 404);
};

/**
 * Gestion centralisée des erreurs.
 * - Les erreurs « attendues » (validation, auth, Multer, erreurs SQL connues)
 *   renvoient un message utile et un code cohérent.
 * - Toute erreur interne (5xx) est journalisée côté serveur UNIQUEMENT :
 *   le client reçoit un message générique (pas de stack trace, pas de SQL).
 * - Les requêtes de pages (Accept: text/html hors /api) reçoivent une vue
 *   d'erreur EJS plutôt qu'un JSON.
 */
exports.errorHandler = (err, req, res, next) => {
  console.error(err);
  let status = err.statusCode || err.status || 500;
  let message = err.message || 'Erreur interne du serveur.';

  if (err.code === 'ER_DUP_ENTRY') { status = 409; message = 'Cette ressource existe déjà.'; }
  else if (err.code === 'ER_NO_REFERENCED_ROW_2') { status = 400; message = 'Une ressource liée est introuvable.'; }
  else if (err.code === 'ER_ROW_IS_REFERENCED_2' || err.code === 'ER_ROW_IS_REFERENCED') { status = 409; message = 'Suppression impossible : des données sont encore rattachées à cette ressource.'; }
  else if (err.code === 'ER_DATA_TOO_LONG') { status = 422; message = 'Une donnée dépasse la taille autorisée.'; }
  else if (err.name === 'MulterError') { status = 400; }
  else if (err.type === 'entity.too.large') { status = 413; message = 'Contenu de requête trop volumineux.'; }
  else if (status >= 500) { message = 'Erreur interne du serveur.'; }

  const wantsHtml = !req.path.startsWith('/api') && req.accepts(['html', 'json']) === 'html';
  if (wantsHtml && res.app.get('view engine')) {
    res.status(status);
    return res.render('error', {
      title: status === 404 ? 'Page introuvable' : 'Une erreur est survenue',
      status,
      message,
      user: res.locals.user || null
    });
  }
  return fail(res, message, [], status);
};
