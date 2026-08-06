const router = require('express').Router(); 
const c = require('../controllers/notification.controller'); 
const { authenticate } = require('../middlewares/auth.middleware'); 
const valid = require('../middlewares/validate.middleware');
const v = require('../validators/common.validator');

// Authentification requise pour l'ensemble des routes de notifications
router.use(authenticate); 

/**
 * @swagger
 * /api/notifications:
 *   get:
 *     summary: Obtenir la liste des notifications de l'utilisateur connecté
 *     tags: [Notifications]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Liste des notifications récupérée avec succès
 *       401:
 *         description: Non authentifié (token manquant ou invalide)
 */
router.get('/', c.list); 

/**
 * @swagger
 * /api/notifications/{id}/lire:
 *   patch:
 *     summary: Marquer une notification spécifique comme lue
 *     tags: [Notifications]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: ID unique de la notification
 *     responses:
 *       200:
 *         description: Notification marquée comme lue avec succès
 *       400:
 *         description: ID de notification invalide
 *       401:
 *         description: Non authentifié
 *       404:
 *         description: Notification non trouvée
 */
router.patch('/:id/lire', v.id, valid, c.read); 

module.exports = router;
