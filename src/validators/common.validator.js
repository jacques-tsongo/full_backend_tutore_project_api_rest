const { body, param } = require('express-validator');
exports.id = [param('id').isInt({ min: 1 })];
exports.skill = [body('id_competence').isInt({ min: 1 }), body('niveau_competence').isIn(['Débutant','Intermédiaire','Avancé','Expert'])];
exports.application = [body('statut_candidature').isIn(['En attente','Présélectionnée','Entretien','Acceptée','Refusée'])];
