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
exports.application = [
  // Depuis la refonte des décisions de recrutement, le recruteur ne peut
  // qu'accepter ou refuser une candidature (plus d'états intermédiaires
  // modifiables arbitrairement : En attente / Présélectionnée / Entretien
  // restent des états d'affichage historiques, jamais positionnables ici).
  body('statut_candidature').optional().isIn(['Acceptée', 'Refusée']),
  body('statut').optional().isIn(['Acceptée', 'Refusée'])
    .withMessage('Statut de candidature invalide.'),
  body().custom((value) => {
    const statut = value.statut_candidature ?? value.statut;
    if (!statut) throw new Error('Le statut de candidature est requis.');
    return true;
  })
];
exports.applicationLetter = [body('lettre_motivation').optional({ nullable: true }).isString().isLength({ max: 5000 }), body('lettreMotivation').optional({ nullable: true }).isString().isLength({ max: 5000 })];
exports.message = [body('id_destinataire').isInt({ min: 1 }), body('contenu').trim().notEmpty().isLength({ max: 5000 })];
exports.userId = [param('userId').isInt({ min: 1 })];
exports.passwordChange = [
  body('mot_de_passe_actuel').notEmpty().withMessage('Mot de passe actuel requis.'),
  body('nouveau_mot_de_passe').isLength({ min: 8 }).withMessage('Le nouveau mot de passe doit contenir au moins 8 caractères.')
];
// Mise à jour d'une entreprise par son propriétaire (recruteur) ou un administrateur.
// Le statut de validation n'est JAMAIS modifiable ici (workflow admin uniquement).
exports.companyUpdate = [
  body('nom_entreprise').optional().trim().notEmpty(),
  body('secteur_activite').optional().trim().notEmpty(),
  body('adresse').optional().trim().notEmpty(),
  body('ville').optional().trim().notEmpty(),
  body('pays').optional().trim().notEmpty(),
  body('telephone').optional().trim().notEmpty(),
  body('email').optional().isEmail().normalizeEmail(),
  body('site_web').optional({ nullable: true, checkFalsy: true }).trim(),
  body('description').optional().trim().notEmpty(),
  body('numero_rccm').optional().trim().notEmpty(),
  body('numero_fiscal').optional({ nullable: true, checkFalsy: true }).trim()
];
