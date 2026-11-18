/**
 * Validation des formulaires HTML avec les MÊMES validateurs que l'API.
 *
 * Les routes web ne renvoient pas de JSON : en cas d'erreur, le premier
 * message est flashé puis l'utilisateur est redirigé (pattern PRG). Les
 * validateurs `express-validator` s'exécutent avant le contrôleur, comme sur
 * les routes API, ce qui garantit un comportement identique (notamment la
 * normalisation de l'adresse e-mail).
 */
const { validationResult } = require('express-validator');
const { flash } = require('../helpers/flash');

/**
 * Retourne un tableau de middlewares : les validateurs puis le contrôle des
 * résultats. À placer avant `formPost(...)`.
 *
 * @param {Array} validateurs chaînes express-validator
 * @param {{ redirectTo?: string }} options page de retour en cas d'erreur
 */
const webValidate = (validateurs = [], { redirectTo = '/login' } = {}) => [
  ...validateurs,
  (req, res, next) => {
    const result = validationResult(req);
    if (result.isEmpty()) return next();
    const [first] = result.array();
    flash(res, 'danger', first?.msg || 'Données de formulaire invalides.');
    return res.redirect(redirectTo);
  }
];

module.exports = { webValidate };
