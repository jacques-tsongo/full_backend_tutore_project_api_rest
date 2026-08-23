const { body } = require('express-validator');
exports.register = [
  body('nom').trim().notEmpty(),
  body('prenom').trim().notEmpty(),
  body('email').isEmail().normalizeEmail(),
  body('mot_de_passe').isLength({ min: 8 }).withMessage('8 caractères minimum.'),
  body('id_domaine').isInt({ min: 1 }).withMessage('Le domaine professionnel est obligatoire.')
];
exports.login = [body('email').isEmail().normalizeEmail(), body('mot_de_passe').notEmpty()];
