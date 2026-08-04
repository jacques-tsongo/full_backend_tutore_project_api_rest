const router = require('express').Router(); 
const c = require('../controllers/resource.controller'); 
const offer = require('../controllers/offer.controller'); 
const { authenticate, authorize } = require('../middlewares/auth.middleware'); 
const valid = require('../middlewares/validate.middleware'); 
const v = require('../validators/common.validator');

const crud = (path, name, roles = ['administrateur']) => {
    router.get(path, authenticate, c.list(name)); 
    router.get(`${path}/:id`, authenticate, v.id, valid, c.get(name)); 
    router.post(path, authenticate, authorize(...roles), c.create(name)); 
    router.put(`${path}/:id`, authenticate, authorize(...roles), v.id, valid, c.update(name)); 
    router.delete(`${path}/:id`, authenticate, authorize(...roles), v.id, valid, c.remove(name));
};

/**
 * @swagger
 * /api/competences:
 *   get:
 *     summary: Lister toutes les compétences
 *     tags: [Ressources - Compétences]
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Liste des compétences }
 *   post:
 *     summary: Créer une nouvelle compétence (Admin)
 *     tags: [Ressources - Compétences]
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema: { type: object, properties: { nom: { type: string, example: "Node.js" } } }
 *     responses:
 *       201: { description: Compétence créée }
 *       403: { description: Accès refusé (Admin uniquement) }
 *
 * /api/competences/{id}:
 *   get:
 *     summary: Obtenir une compétence par son ID
 *     tags: [Ressources - Compétences]
 *     security: [{ bearerAuth: [] }]
 *     parameters: [{ in: path, name: id, required: true, schema: { type: string } }]
 *     responses:
 *       200: { description: Détails de la compétence }
 *   put:
 *     summary: Modifier une compétence (Admin)
 *     tags: [Ressources - Compétences]
 *     security: [{ bearerAuth: [] }]
 *     parameters: [{ in: path, name: id, required: true, schema: { type: string } }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema: { type: object, properties: { nom: { type: string } } }
 *     responses:
 *       200: { description: Compétence mise à jour }
 *   delete:
 *     summary: Supprimer une compétence (Admin)
 *     tags: [Ressources - Compétences]
 *     security: [{ bearerAuth: [] }]
 *     parameters: [{ in: path, name: id, required: true, schema: { type: string } }]
 *     responses:
 *       200: { description: Compétence supprimée }
 */
crud('/competences', 'competences', ['administrateur']); 

/**
 * @swagger
 * /api/experiences:
 *   get:
 *     summary: Lister les expériences
 *     tags: [Ressources - Expériences]
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Liste des expériences }
 *   post:
 *     summary: Ajouter une expérience (Candidat)
 *     tags: [Ressources - Expériences]
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       201: { description: Expérience créée }
 *
 * /api/experiences/{id}:
 *   get:
 *     summary: Obtenir les détails d'une expérience
 *     tags: [Ressources - Expériences]
 *     security: [{ bearerAuth: [] }]
 *     parameters: [{ in: path, name: id, required: true, schema: { type: string } }]
 *     responses:
 *       200: { description: Détails de l'expérience }
 *   put:
 *     summary: Modifier une expérience (Candidat)
 *     tags: [Ressources - Expériences]
 *     security: [{ bearerAuth: [] }]
 *     parameters: [{ in: path, name: id, required: true, schema: { type: string } }]
 *     responses:
 *       200: { description: Expérience mise à jour }
 *   delete:
 *     summary: Supprimer une expérience (Candidat)
 *     tags: [Ressources - Expériences]
 *     security: [{ bearerAuth: [] }]
 *     parameters: [{ in: path, name: id, required: true, schema: { type: string } }]
 *     responses:
 *       200: { description: Expérience supprimée }
 */
crud('/experiences', 'experiences', ['candidat']); 

/**
 * @swagger
 * /api/diplomes:
 *   get:
 *     summary: Lister les diplômes
 *     tags: [Ressources - Diplômes]
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Liste des diplômes }
 *   post:
 *     summary: Ajouter un diplôme (Candidat)
 *     tags: [Ressources - Diplômes]
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       201: { description: Diplôme créé }
 *
 * /api/diplomes/{id}:
 *   get:
 *     summary: Obtenir les détails d'un diplôme
 *     tags: [Ressources - Diplômes]
 *     security: [{ bearerAuth: [] }]
 *     parameters: [{ in: path, name: id, required: true, schema: { type: string } }]
 *     responses:
 *       200: { description: Détails du diplôme }
 *   put:
 *     summary: Modifier un diplôme (Candidat)
 *     tags: [Ressources - Diplômes]
 *     security: [{ bearerAuth: [] }]
 *     parameters: [{ in: path, name: id, required: true, schema: { type: string } }]
 *     responses:
 *       200: { description: Diplôme mis à jour }
 *   delete:
 *     summary: Supprimer un diplôme (Candidat)
 *     tags: [Ressources - Diplômes]
 *     security: [{ bearerAuth: [] }]
 *     parameters: [{ in: path, name: id, required: true, schema: { type: string } }]
 *     responses:
 *       200: { description: Diplôme supprimé }
 */
crud('/diplomes', 'diplomes', ['candidat']); 

/**
 * @swagger
 * /api/entreprises:
 *   get:
 *     summary: Lister les entreprises
 *     tags: [Ressources - Entreprises]
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Liste des entreprises }
 *   post:
 *     summary: Créer une entreprise (Recruteur / Admin)
 *     tags: [Ressources - Entreprises]
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       201: { description: Entreprise créée }
 *
 * /api/entreprises/{id}:
 *   get:
 *     summary: Obtenir les détails d'une entreprise
 *     tags: [Ressources - Entreprises]
 *     security: [{ bearerAuth: [] }]
 *     parameters: [{ in: path, name: id, required: true, schema: { type: string } }]
 *     responses:
 *       200: { description: Détails de l'entreprise }
 *   put:
 *     summary: Modifier une entreprise (Recruteur / Admin)
 *     tags: [Ressources - Entreprises]
 *     security: [{ bearerAuth: [] }]
 *     parameters: [{ in: path, name: id, required: true, schema: { type: string } }]
 *     responses:
 *       200: { description: Entreprise mise à jour }
 *   delete:
 *     summary: Supprimer une entreprise (Recruteur / Admin)
 *     tags: [Ressources - Entreprises]
 *     security: [{ bearerAuth: [] }]
 *     parameters: [{ in: path, name: id, required: true, schema: { type: string } }]
 *     responses:
 *       200: { description: Entreprise supprimée }
 */
crud('/entreprises', 'entreprises', ['recruteur', 'administrateur']);

/**
 * @swagger
 * /api/offres:
 *   get:
 *     summary: Obtenir la liste des offres d'emploi
 *     tags: [Offres d'Emploi]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Liste des offres d'emploi
 *   post:
 *     summary: Créer une nouvelle offre d'emploi (Recruteur)
 *     tags: [Offres d'Emploi]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - titre
 *               - description
 *             properties:
 *               titre:
 *                 type: string
 *                 example: Développeur Backend Node.js
 *               description:
 *                 type: string
 *                 example: Nous recherchons un développeur expérimenté...
 *               salaire:
 *                 type: number
 *                 example: 1500
 *               localisation:
 *                 type: string
 *                 example: Kinshasa
 *     responses:
 *       201:
 *         description: Offre créée avec succès
 *       403:
 *         description: Accès refusé (réservé aux recruteurs)
 */
router.get('/offres', authenticate, c.list('offres')); 
router.post('/offres', authenticate, authorize('recruteur'), offer.create); 

/**
 * @swagger
 * /api/offres/{id}:
 *   get:
 *     summary: Obtenir les détails d'une offre d'emploi
 *     tags: [Offres d'Emploi]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Détails de l'offre
 *       404:
 *         description: Offre non trouvée
 *   put:
 *     summary: Modifier une offre d'emploi (Recruteur)
 *     tags: [Offres d'Emploi]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *     responses:
 *       200:
 *         description: Offre mise à jour avec succès
 *       403:
 *         description: Accès refusé
 *   delete:
 *     summary: Supprimer une offre d'emploi (Recruteur)
 *     tags: [Offres d'Emploi]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Offre supprimée avec succès
 *       403:
 *         description: Accès refusé
 */
router.get('/offres/:id', authenticate, v.id, valid, c.get('offres')); 
router.put('/offres/:id', authenticate, authorize('recruteur'), v.id, valid, offer.update); 
router.delete('/offres/:id', authenticate, authorize('recruteur'), v.id, valid, offer.remove);

/**
 * @swagger
 * /api/mes-competences:
 *   get:
 *     summary: Lister mes compétences enregistrées (Candidat)
 *     tags: [Mes Compétences (Candidat)]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Liste des compétences de l'utilisateur
 *       403:
 *         description: Accès refusé (Candidat uniquement)
 *   post:
 *     summary: Ajouter une compétence à mon profil (Candidat)
 *     tags: [Mes Compétences (Candidat)]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - competenceId
 *             properties:
 *               competenceId:
 *                 type: string
 *                 example: "64f1a2b3c4d5e6f7a8b9c0d1"
 *               niveau:
 *                 type: string
 *                 enum: [debutant, intermediaire, avance, expert]
 *                 example: avance
 *     responses:
 *       201:
 *         description: Compétence ajoutée au profil
 *       400:
 *         description: Données invalides
 *       403:
 *         description: Accès refusé
 */
router.get('/mes-competences', authenticate, authorize('candidat'), c.mySkills); 
router.post('/mes-competences', authenticate, authorize('candidat'), v.skill, valid, c.addSkill); 

/**
 * @swagger
 * /api/mes-competences/{id}:
 *   delete:
 *     summary: Retirer une compétence de mon profil (Candidat)
 *     tags: [Mes Compétences (Candidat)]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: ID de la compétence associée
 *     responses:
 *       200:
 *         description: Compétence retirée du profil
 *       400:
 *         description: ID invalide
 *       403:
 *         description: Accès refusé
 */
router.delete('/mes-competences/:id', authenticate, authorize('candidat'), v.id, valid, c.removeSkill); 

module.exports = router;