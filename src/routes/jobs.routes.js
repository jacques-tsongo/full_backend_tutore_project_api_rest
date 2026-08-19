const router = require('express').Router(); 
const c = require('../controllers/job.controller'); 
const { authenticate, authorize } = require('../middlewares/auth.middleware'); 
const valid = require('../middlewares/validate.middleware'); 
const v = require('../validators/common.validator'); 

// Authentification requise pour toutes les routes ci-dessous
router.use(authenticate); 

/**
 * @swagger
 * /api/offres/{id}/competences:
 *   put:
 *     summary: Définir ou mettre à jour les compétences requises pour une offre (Recruteur)
 *     tags: [Offres & Candidatures]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: ID unique de l'offre d'emploi
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - competences
 *             properties:
 *               competences:
 *                 type: array
 *                 items:
 *                   type: string
 *                 example: ["JavaScript", "Node.js", "MongoDB"]
 *     responses:
 *       200:
 *         description: Compétences mises à jour avec succès
 *       400:
 *         description: ID invalide ou données manquantes
 *       401:
 *         description: Non authentifié
 *       403:
 *         description: Accès refusé (réservé aux recruteurs)
 *       404:
 *         description: Offre non trouvée
 */
router.put('/offres/:id/competences', authorize('recruteur'), v.id, v.offerSkills, valid, c.setSkills); 

/**
 * @swagger
 * /api/offres/{id}/postuler:
 *   post:
 *     summary: Postuler à une offre d'emploi (Candidat)
 *     tags: [Offres & Candidatures]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: ID unique de l'offre
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               lettreMotivation:
 *                 type: string
 *                 example: "Madame, Monsieur, je souhaite poser ma candidature..."
 *     responses:
 *       201:
 *         description: Candidature envoyée avec succès
 *       400:
 *         description: ID invalide ou candidature déjà existante
 *       401:
 *         description: Non authentifié
 *       403:
 *         description: Accès refusé (réservé aux candidats)
 *       404:
 *         description: Offre non trouvée
 */
router.post('/offres/:id/postuler', authorize('candidat'), v.id, v.applicationLetter, valid, c.apply); 

/**
 * @swagger
 * /api/candidatures/me:
 *   get:
 *     summary: Obtenir la liste de mes candidatures (Candidat)
 *     tags: [Offres & Candidatures]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Liste des candidatures du candidat connecté
 *       401:
 *         description: Non authentifié
 *       403:
 *         description: Accès refusé (réservé aux candidats)
 */
router.get('/candidatures/me', authorize('candidat'), c.myApplications); 

/**
 * @swagger
 * /api/candidatures/{id}/annuler:
 *   patch:
 *     summary: Annuler une candidature (Candidat)
 *     tags: [Offres & Candidatures]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: ID de la candidature
 *     responses:
 *       200:
 *         description: Candidature annulée avec succès
 *       400:
 *         description: ID invalide
 *       401:
 *         description: Non authentifié
 *       403:
 *         description: Accès refusé (réservé aux candidats)
 *       404:
 *         description: Candidature non trouvée
 */
router.patch('/candidatures/:id/annuler', authorize('candidat'), v.id, valid, c.cancel); 

/**
 * @swagger
 * /api/candidatures/recues:
 *   get:
 *     summary: Obtenir la liste des candidatures reçues pour mes offres (Recruteur)
 *     tags: [Offres & Candidatures]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Liste des candidatures reçues par l'entreprise
 *       401:
 *         description: Non authentifié
 *       403:
 *         description: Accès refusé (réservé aux recruteurs)
 */
router.get('/candidatures/recues', authorize('recruteur'), c.companyApplications); 

/**
 * @swagger
 * /api/candidatures/{id}/statut:
 *   patch:
 *     summary: Mettre à jour le statut d'une candidature (Recruteur)
 *     tags: [Offres & Candidatures]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: ID de la candidature
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - statut_candidature
 *             properties:
 *               statut_candidature:
 *                 type: string
 *                 enum: [Acceptée, Refusée]
 *                 example: Acceptée
 *               statut:
 *                 type: string
 *                 description: Alias accepté de statut_candidature
 *                 enum: [Acceptée, Refusée]
 *     responses:
 *       200:
 *         description: Statut de la candidature mis à jour
 *       400:
 *         description: Statut ou ID invalide
 *       401:
 *         description: Non authentifié
 *       403:
 *         description: Accès refusé (réservé aux recruteurs)
 *       404:
 *         description: Candidature non trouvée
 */
router.patch('/candidatures/:id/statut', authorize('recruteur'), v.id, v.application, valid, c.updateApplicationStatus); 

/**
 * @swagger
 * /api/offres/{id}/matching:
 *   get:
 *     summary: Calculer le score de correspondance entre mon profil et une offre (Candidat)
 *     tags: [Offres & Candidatures]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: ID de l'offre
 *     responses:
 *       200:
 *         description: Score de correspondance calculé (ex pourcentage ou détails de compatibilité)
 *       400:
 *         description: ID invalide
 *       401:
 *         description: Non authentifié
 *       403:
 *         description: Accès refusé (réservé aux candidats)
 *       404:
 *         description: Offre non trouvée
 */
router.get('/offres/:id/matching', authorize('candidat'), v.id, valid, c.matchOffer); 

module.exports = router;
