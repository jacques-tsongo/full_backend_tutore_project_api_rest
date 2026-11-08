const router = require('express').Router(); 
const c = require('../controllers/message.controller'); 
const { authenticate } = require('../middlewares/auth.middleware'); 
const valid = require('../middlewares/validate.middleware');
const v = require('../validators/common.validator');

// Authentification requise pour l'ensemble des routes de messagerie
router.use(authenticate); 

/**
 * @swagger
 * /api/messages:
 *   post:
 *     summary: Envoyer un message à un utilisateur
 *     tags: [Messagerie]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - id_destinataire
 *               - contenu
 *             properties:
 *               id_destinataire:
 *                 type: integer
 *                 example: 42
 *                 description: Identifiant du destinataire (contact légitime uniquement)
 *               contenu:
 *                 type: string
 *                 example: "Bonjour, je souhaite en savoir plus sur votre offre."
 *                 description: Contenu textuel du message (5000 caractères max)
 *     responses:
 *       201:
 *         description: Message envoyé avec succès
 *       400:
 *         description: Destinataire ou contenu manquant / invalide
 *       401:
 *         description: Non authentifié (token manquant ou invalide)
 *       403:
 *         description: >
 *           Aucune relation professionnelle ni conversation existante avec ce
 *           destinataire (politique de messagerie)
 *       404:
 *         description: Destinataire introuvable ou inactif
 * 
 *   get:
 *     summary: Récupérer toutes les conversations actives de l'utilisateur
 *     tags: [Messagerie]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Liste des conversations et derniers messages échangés
 *       401:
 *         description: Non authentifié
 */
router.post('/', v.message, valid, c.send); 
router.get('/', c.conversations); 

/**
 * @swagger
 * /api/messages/non-lus:
 *   get:
 *     summary: Nombre de messages non lus de l'utilisateur connecté
 *     tags: [Messagerie]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Compteur de messages non lus
 *       401:
 *         description: Non authentifié
 */
router.get('/non-lus', c.unreadCount);

/**
 * @swagger
 * /api/messages/contacts:
 *   get:
 *     summary: Lister les utilisateurs que je peux contacter (relation métier)
 *     tags: [Messagerie]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Liste des contacts légitimes
 *       401:
 *         description: Non authentifié
 */
router.get('/contacts', c.contacts);

/**
 * @swagger
 * /api/messages/{userId}:
 *   get:
 *     summary: Récupérer le fil de discussion avec un utilisateur spécifique
 *     tags: [Messagerie]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: userId
 *         required: true
 *         schema:
 *           type: string
 *         description: ID unique de l'interlocuteur
 *     responses:
 *       200:
 *         description: Liste chronologique des messages échangés avec cet utilisateur
 *       400:
 *         description: ID d'utilisateur invalide
 *       401:
 *         description: Non authentifié
 *       404:
 *         description: >
 *           Utilisateur introuvable, inactif, ou hors politique de messagerie
 */
router.get('/:userId', v.userId, valid, c.conversation); 

module.exports = router;
