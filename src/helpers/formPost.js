const { flash, backUrl } = require('./flash');

/**
 * Réutilisation des contrôleurs API existants pour les formulaires HTML classiques.
 * Le contrôleur est exécuté avec une réponse « bouchon » qui capture le JSON ;
 * le résultat est converti en message flash + redirection (pattern PRG).
 * Les écritures de cookies (session httpOnly) sont déléguées à la vraie réponse :
 * AUCUNE logique métier n'est dupliquée, le même contrôleur sert l'API et les pages.
 */
const jsonStub = (realRes) => ({
  statusCode: 200,
  payload: null,
  status(code) { this.statusCode = code; return this; },
  json(payload) { this.payload = payload; return this; },
  cookie: (...args) => realRes.cookie(...args),
  clearCookie: (...args) => realRes.clearCookie(...args)
});

/** Exécute un contrôleur API et retourne { statusCode, payload } sans écrire la réponse. */
const invoke = async (controllerFn, req, res) => {
  const stub = jsonStub(res);
  await controllerFn(req, stub, (err) => { if (err) throw err; });
  return { statusCode: stub.statusCode, payload: stub.payload };
};

const describeErrors = (payload) => {
  if (!payload) return 'Une erreur est survenue.';
  let message = payload.message || 'Une erreur est survenue.';
  const details = Array.isArray(payload.errors)
    ? payload.errors.map((e) => (typeof e === 'string' ? e : e.msg || e.message)).filter(Boolean)
    : [];
  if (details.length) message += ` (${details.slice(0, 3).join(' ; ')})`;
  return message;
};

/**
 * Enveloppe : formulaire POST → contrôleur API → flash + redirect.
 * options.redirectTo : chaîne, fonction(req, payload) ou absent (→ page précédente).
 */
exports.formPost = (controllerFn, options = {}) => async (req, res, next) => {
  try {
    const result = await invoke(controllerFn, req, res);
    const payload = result.payload || {};
    if (payload.success === false || result.statusCode >= 400) {
      flash(res, 'danger', describeErrors(payload));
    } else {
      flash(res, 'success', payload.message || 'Opération réussie.');
    }
    const target = typeof options.redirectTo === 'function'
      ? options.redirectTo(req, payload)
      : options.redirectTo;
    return res.redirect(target || backUrl(req, '/dashboard'));
  } catch (err) {
    return next(err);
  }
};

/**
 * Variante « collecte » pour les pages : exécute un contrôleur API de lecture
 * et retourne les données `payload.data` pour un rendu EJS (évite toute
 * duplication de requêtes/mapping entre API et vues).
 */
exports.collect = async (controllerFn, req) => {
  const noopRes = { cookie: () => {}, clearCookie: () => {} };
  const { statusCode, payload } = await invoke(controllerFn, req, noopRes);
  if (!payload || payload.success === false) {
    const error = new Error(payload?.message || 'Erreur interne du serveur.');
    error.statusCode = statusCode >= 400 ? statusCode : 500;
    throw error;
  }
  return { statusCode, payload, data: payload.data || {} };
};
