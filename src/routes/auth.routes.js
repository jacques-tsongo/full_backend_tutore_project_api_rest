const router=require('express').Router(); 
const c=require('../controllers/auth.controller'); 
const v=require('../validators/auth.validator'); 
const valid=require('../middlewares/validate.middleware'); 
const {authenticate}=require('../middlewares/auth.middleware');
const cv=require('../validators/common.validator');
const {
  registerIpLimiter, registerEmailLimiter, verifyCodeLimiter, resendCodeLimiter
}=require('../middlewares/rateLimit.middleware');

// la configuration de la documentation Swagger se trouve dans le fichier swagger.js à la racine du projet. 
/**
 * @swagger
 * /api/auth/login:
 *   post:
 *     summary: Connexion de l'utilisateur
 *     tags: [Auth]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - email
 *               - password
 *             properties:
 *               email:
 *                 type: string
 *                 format: email
 *                 example: user@example.com
 *               password:
 *                 type: string
 *                 format: password
 *                 example: Secret123!
 *     responses:
 *       200:
 *         description: Connexion réussie (retourne le token et les infos utilisateur)
 *       400:
 *         description: Erreur de validation des données transmises
 *       401:
 *         description: Identifiants incorrects
 *       403:
 *         description: Compte inactif ou adresse e-mail non vérifiée
 */
router.post('/login',v.login,valid,c.login); 
/**
 * @swagger
 * /api/auth/register:
 *   post:
 *     summary: Démarrer une inscription (envoi d'un code à 6 chiffres)
 *     description: >
 *       Aucun compte n'est créé à cette étape. Les données sont stockées dans
 *       `inscription_en_attente` et un code à 6 chiffres est envoyé par e-mail.
 *       La réponse contient un `ticket` à transmettre à l'étape de vérification.
 *     tags: [Auth]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - nom
 *               - prenom
 *               - email
 *               - mot_de_passe
 *               - id_domaine
 *             properties:
 *               nom:
 *                 type: string
 *                 example: Dupont
 *               prenom:
 *                 type: string
 *                 example: Jean
 *               email:
 *                 type: string
 *                 format: email
 *                 example: jean.dupont@example.com
 *               mot_de_passe:
 *                 type: string
 *                 format: password
 *                 example: Secret123!
 *               telephone:
 *                 type: string
 *                 example: "+243800000000"
 *               id_domaine:
 *                 type: integer
 *                 example: 1
 *     responses:
 *       202:
 *         description: Code envoyé (ticket, email masqué, durées)
 *       409:
 *         description: Adresse e-mail déjà utilisée
 *       422:
 *         description: Données invalides, domaine inconnu ou e-mail jetable
 *       429:
 *         description: Trop de demandes
 *       503:
 *         description: Service d'envoi d'e-mails non configuré
 */
router.post('/register',registerIpLimiter,registerEmailLimiter,v.register,valid,c.register);
/**
 * @swagger
 * /api/auth/register/verify:
 *   post:
 *     summary: Valider le code et créer le compte
 *     description: >
 *       Consomme l'inscription en attente, crée le compte vérifié et son profil
 *       professionnel dans une transaction, puis ouvre la session.
 *     tags: [Auth]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - ticket
 *               - code
 *             properties:
 *               ticket:
 *                 type: string
 *                 description: Ticket opaque renvoyé par /api/auth/register
 *               code:
 *                 type: string
 *                 pattern: '^\d{6}$'
 *                 example: "123456"
 *     responses:
 *       201:
 *         description: Compte créé et session ouverte
 *       410:
 *         description: Inscription introuvable ou code expiré
 *       422:
 *         description: Code incorrect (tentatives restantes dans data)
 *       429:
 *         description: Trop de tentatives ou trop de demandes
 *       503:
 *         description: Service d'envoi d'e-mails non configuré
 */
router.post('/register/verify',verifyCodeLimiter,v.registerVerify,valid,c.registerVerify);
/**
 * @swagger
 * /api/auth/register/resend:
 *   post:
 *     summary: Renvoyer un nouveau code de vérification
 *     tags: [Auth]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - ticket
 *             properties:
 *               ticket:
 *                 type: string
 *     responses:
 *       200:
 *         description: Nouveau code envoyé (durées mises à jour)
 *       410:
 *         description: Inscription introuvable ou expirée
 *       429:
 *         description: Délai de renvoi, nombre maximal de renvois ou trop de demandes
 *       503:
 *         description: Service d'envoi d'e-mails non configuré
 */
router.post('/register/resend',resendCodeLimiter,v.registerResend,valid,c.registerResend);
/**
 * @swagger
 * /api/auth/register:
 *   delete:
 *     summary: Annuler une inscription en attente
 *     tags: [Auth]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - ticket
 *             properties:
 *               ticket:
 *                 type: string
 *     responses:
 *       200:
 *         description: Inscription annulée (idempotent)
 *       422:
 *         description: Ticket invalide
 */
router.delete('/register',v.registerCancel,valid,c.registerCancel);
// Variante POST pour les formulaires HTML (pas de méthode DELETE).
router.post('/register/cancel',v.registerCancel,valid,c.registerCancel);
/**
 * @swagger
 * /api/auth/me:
 *   get:
 *     summary: Récupérer le profil de l'utilisateur connecté
 *     tags: [Auth]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Profil de l'utilisateur connecté
 *       401:
 *         description: Non autorisé (token manquant ou invalide)
 *       403:
 *         description: Compte non vérifié
 */
router.get('/me',authenticate,c.me); 
/**
 * @swagger
 * /api/auth/me:
 *   put:
 *     summary: Mettre à jour le profil de l'utilisateur connecté
 *     tags: [Auth]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               nom:
 *                 type: string
 *               email:
 *                 type: string
 *                 format: email
 *     responses:
 *       200:
 *         description: Profil mis à jour avec succès
 *       400:
 *         description: Données de mise à jour invalides
 *       401:
 *         description: Non autorisé
 */
router.put('/me',authenticate,c.updateMe); 
/**
 * @swagger
 * /api/auth/mot-de-passe:
 *   put:
 *     summary: Changer son mot de passe (mot de passe actuel requis)
 *     tags: [Auth]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - mot_de_passe_actuel
 *               - nouveau_mot_de_passe
 *             properties:
 *               mot_de_passe_actuel:
 *                 type: string
 *                 format: password
 *               nouveau_mot_de_passe:
 *                 type: string
 *                 format: password
 *                 example: NouveauSecret123!
 *     responses:
 *       200:
 *         description: Mot de passe mis à jour
 *       401:
 *         description: Mot de passe actuel incorrect
 *       422:
 *         description: Données invalides
 */
router.put('/mot-de-passe',authenticate,cv.passwordChange,valid,c.changePassword);
/**
 * @swagger
 * /api/auth/logout:
 *   post:
 *     summary: Déconnexion de l'utilisateur (la session navigateur est invalidée)
 *     tags: [Auth]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Déconnexion réussie
 *       401:
 *         description: Non autorisé
 */
router.post('/logout',authenticate,c.logout); 
module.exports=router;
