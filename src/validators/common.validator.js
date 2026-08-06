const { body, param } = require('express-validator');
exports.id = [param('id').isInt({ min: 1 })];
exports.skill = [body('id_competence').isInt({ min: 1 }), body('niveau_competence').isIn(['Débutant','Intermédiaire','Avancé','Expert'])];
exports.offerSkills = [
  body('competences').isArray({ min: 1 }),
  body('competences.*.id_competence').isInt({ min: 1 }),
  body('competences.*.niveau_requis').isIn(['Débutant','Intermédiaire','Avancé','Expert'])
];
exports.offerCreate = [
  body('titre_offre').trim().notEmpty(),
  body('description_offre').trim().notEmpty(),
  body('localisation').trim().notEmpty(),
  body('date_expiration').isISO8601().toDate(),
  body('salaire').optional({ nullable: true, checkFalsy: true }).isFloat({ min: 0 }),
  body('statut_offre').optional().isIn(['Ouverte','Fermée','Suspendue'])
];
exports.offerUpdate = [
  body('titre_offre').optional().trim().notEmpty(),
  body('description_offre').optional().trim().notEmpty(),
  body('localisation').optional().trim().notEmpty(),
  body('date_expiration').optional().isISO8601().toDate(),
  body('salaire').optional({ nullable: true, checkFalsy: true }).isFloat({ min: 0 }),
  body('statut_offre').optional().isIn(['Ouverte','Fermée','Suspendue'])
];
exports.application = [body('statut_candidature').isIn(['En attente','Présélectionnée','Entretien','Acceptée','Refusée'])];
exports.message = [body('id_destinataire').isInt({ min: 1 }), body('contenu').trim().notEmpty().isLength({ max: 5000 })];
exports.userId = [param('userId').isInt({ min: 1 })];
