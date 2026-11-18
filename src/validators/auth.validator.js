const { body } = require('express-validator');
const { normalizeEmailAddress } = require('../utils/email');

// La normalisation (trim + minuscules) précède la validation : les points des
// adresses Gmail sont conservés, l'adresse stockée et recherchée est la même.
exports.register = [
  body('nom').isString().trim().notEmpty().withMessage('Le nom est obligatoire.'),
  body('prenom').isString().trim().notEmpty().withMessage('Le prénom est obligatoire.'),
  body('email').customSanitizer(normalizeEmailAddress).isEmail().withMessage('Adresse e-mail invalide.'),
  body('mot_de_passe').isString().isLength({ min: 8, max: 72 })
    .withMessage('Le mot de passe doit contenir entre 8 et 72 caractères.'),
  body('telephone').optional({ nullable: true }).isString().trim().isLength({ max: 20 })
    .withMessage('Le téléphone ne doit pas dépasser 20 caractères.'),
  body('id_domaine').isInt({ min: 1 }).withMessage('Le domaine professionnel est obligatoire.')
];
exports.registerVerify = [
  body('ticket').isString().trim().isLength({ min: 20, max: 200 })
    .withMessage('Demande d’inscription invalide.'),
  body('code').isString().trim().matches(/^\d{6}$/)
    .withMessage('Le code doit contenir 6 chiffres.')
];
exports.registerResend = [
  body('ticket').isString().trim().isLength({ min: 20, max: 200 })
    .withMessage('Demande d’inscription invalide.')
];
exports.registerCancel = [
  body('ticket').isString().trim().isLength({ min: 20, max: 200 })
    .withMessage('Demande d’inscription invalide.')
];
exports.login = [body('email').customSanitizer(normalizeEmailAddress).isEmail(), body('mot_de_passe').notEmpty()];
