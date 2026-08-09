const router=require('express').Router(); 
const c=require('../controllers/auth.controller'); 
const v=require('../validators/auth.validator'); 
const valid=require('../middlewares/validate.middleware'); 
const {authenticate}=require('../middlewares/auth.middleware');
const cv=require('../validators/common.validator');

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
 */
router.post('/login',v.login,valid,c.login); 
/**
 * @swagger
 * /api/auth/register:
 *   post:
 *     summary: Inscription d'un nouvel utilisateur
 *     tags: [Auth]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - nom
 *               - email
 *               - password
 *             properties:
 *               nom:
 *                 type: string
 *                 example: Jean Dupont
 *               email:
 *                 type: string
 *                 format: email
 *                 example: jean.dupont@example.com
 *               password:
 *                 type: string
 *                 format: password
 *                 example: Secret123!
 *     responses:
 *       201:
 *         description: Compte créé avec succès
 *       400:
 *         description: Données invalides ou email déjà utilisé
 */
router.post('/register',v.register,valid,c.register); 
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

