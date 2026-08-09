const router = require('express').Router(); 
const c = require('../controllers/company.controller'); 
const { authenticate, authorize } = require('../middlewares/auth.middleware'); 
const { companyUpload } = require('../middlewares/upload.middleware');
const valid = require('../middlewares/validate.middleware');
const v = require('../validators/common.validator');

/**
 * @swagger
 * /api/recruteurs:
 *   post:
 *     summary: Soumettre une entreprise pour devenir recruteur
 *     tags: [Entreprises & Recruteurs]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - nomEntreprise
 *             properties:
 *               nomEntreprise:
 *                 type: string
 *                 example: Tech Solutions SARL
 *               post:
 *                 type: string
 *                 example: Responsable RH
 *               telephone:
 *                 type: string
 *                 example: "+243810000000"
 *     responses:
 *       201:
 *         description: Profil recruteur créé avec succès
 *       400:
 *         description: Données invalides
 *       401:
 *         description: Non authentifié
 *       403:
 *         description: Accès refusé (réservé aux recruteurs)
 */
router.post('/recruteurs', authenticate, authorize('candidat'), companyUpload, c.createRecruiter); 
router.post('/entreprises/demande-recruteur', authenticate, authorize('candidat'), companyUpload, c.createRecruiter);

/**
 * @swagger
 * /api/recruteurs/me:
 *   get:
 *     summary: Obtenir le profil du recruteur connecté
 *     tags: [Entreprises & Recruteurs]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Informations du recruteur connecté récupérées
 *       401:
 *         description: Non authentifié
 *       403:
 *         description: Accès refusé (réservé aux recruteurs)
 *       404:
 *         description: Profil recruteur non trouvé
 */
router.get('/recruteurs/me', authenticate, authorize('recruteur'), c.myRecruiter); 

/**
 * @swagger
 * /api/entreprises/mine:
 *   get:
 *     summary: Lister les entreprises appartenant à l'utilisateur connecté (tous statuts)
 *     tags: [Entreprises & Recruteurs]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Entreprises de l'utilisateur connecté
 *       401:
 *         description: Non authentifié
 */
router.get('/entreprises/mine', authenticate, c.mine);

/**
 * @swagger
 * /api/entreprises/{id}:
 *   put:
 *     summary: Modifier une entreprise (recruteur propriétaire de SON entreprise approuvée, ou administrateur)
 *     description: Le statut de validation n'est jamais modifiable via cette route (workflow administrateur uniquement).
 *     tags: [Entreprises & Recruteurs]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               nom_entreprise: { type: string }
 *               secteur_activite: { type: string }
 *               adresse: { type: string }
 *               ville: { type: string }
 *               pays: { type: string }
 *               telephone: { type: string }
 *               email: { type: string, format: email }
 *               site_web: { type: string }
 *               description: { type: string }
 *               numero_rccm: { type: string }
 *               numero_fiscal: { type: string }
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             properties:
 *               logo:
 *                 type: string
 *                 format: binary
 *     responses:
 *       200:
 *         description: Entreprise mise à jour
 *       403:
 *         description: Vous ne pouvez modifier que votre propre entreprise
 *       404:
 *         description: Entreprise introuvable
 */
router.put('/entreprises/:id', authenticate, authorize('recruteur', 'administrateur'), companyUpload, v.id, v.companyUpdate, valid, c.updateOwn);

/**
 * @swagger
 * /api/entreprises/{id}/validation:
 *   patch:
 *     summary: Valider ou rejeter une entreprise (Admin)
 *     tags: [Entreprises & Recruteurs]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: ID unique de l'entreprise
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - estValide
 *             properties:
 *               estValide:
 *                 type: boolean
 *                 example: true
 *               commentaire:
 *                 type: string
 *                 example: Dossier complet et vérifié
 *     responses:
 *       200:
 *         description: Statut de validation de l'entreprise mis à jour
 *       400:
 *         description: Données invalides
 *       401:
 *         description: Non authentifié
 *       403:
 *         description: Accès refusé (réservé aux administrateurs)
 *       404:
 *         description: Entreprise non trouvée
 */
router.patch('/entreprises/:id/validation', authenticate, authorize('administrateur'), c.validate); 

module.exports = router;
