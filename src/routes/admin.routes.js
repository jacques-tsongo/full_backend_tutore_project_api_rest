const router = require('express').Router(); 
const c = require('../controllers/admin.controller'); 
const { authenticate, authorize } = require('../middlewares/auth.middleware'); 
const valid = require('../middlewares/validate.middleware');
const v = require('../validators/common.validator');

// Applique l'authentification et la vérification du rôle administrateur à toutes les routes ci-dessous
router.use(authenticate, authorize('administrateur')); 

/**
 * @swagger
 * /api/admin/utilisateurs:
 *   get:
 *     summary: "Obtenir la liste complète de tous les utilisateurs"
 *     tags: [Administration]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Liste des utilisateurs récupérée avec succès
 *       401:
 *         description: Non authentifié (token absent ou invalide)
 *       403:
 *         description: Accès refusé (réservé aux administrateurs)
 */
router.get('/utilisateurs', c.users); 

/**
 * @swagger
 * /api/admin/utilisateurs/{id}/statut:
 *   patch:
 *     summary: "Modifier le statut d'un utilisateur (ex: activer/suspendre)"
 *     tags: [Administration]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: ID unique de l'utilisateur à modifier
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - statut
 *             properties:
 *               statut:
 *                 type: string
 *                 enum: [actif, inactif, suspendu]
 *                 example: suspendu
 *     responses:
 *       200:
 *         description: Statut de l'utilisateur mis à jour
 *       400:
 *         description: Statut fourni invalide
 *       401:
 *         description: Non authentifié
 *       403:
 *         description: Accès refusé
 *       404:
 *         description: Utilisateur non trouvé
 */
router.patch('/utilisateurs/:id/statut', c.userStatus); 

/**
 * @swagger
 * /api/admin/statistiques:
 *   get:
 *     summary: "Récupérer les statistiques globales de la plateforme"
 *     tags: [Administration]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Statistiques récupérées
 *       401:
 *         description: Non authentifié
 *       403:
 *         description: Accès refusé
 */
router.get('/statistiques', c.stats); 

router.get('/companies/pending', c.pendingCompanies);
router.get('/companies/:id', v.id, valid, c.company);
router.put('/companies/:id/approve', v.id, valid, c.approveCompany);
router.put('/companies/:id/reject', v.id, valid, c.rejectCompany);

module.exports = router;
