const router = require('express').Router(); 
const c = require('../controllers/profile.controller'); 
const { authenticate, authorize } = require('../middlewares/auth.middleware'); 
const { photoUpload, cvUpload } = require('../middlewares/upload.middleware'); 

// Authentification et rôle candidat requis pour toutes les routes ci-dessous
router.use(authenticate, authorize('candidat')); 

/**
 * @swagger
 * /api/profile:
 *   get:
 *     summary: Obtenir le profil complet du candidat connecté
 *     tags: [Profil Candidat]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Profil récupéré avec succès
 *       401:
 *         description: Non authentifié
 *       403:
 *         description: Accès refusé (réservé aux candidats)
 *       404:
 *         description: Profil non encore créé
 * 
 *   put:
 *     summary: Créer ou mettre à jour les informations du profil candidat (Upsert)
 *     tags: [Profil Candidat]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               titreProfessionnel:
 *                 type: string
 *                 example: Développeur Fullstack Node.js
 *               bio:
 *                 type: string
 *                 example: Passionné par les architectures d'APIs REST et les microservices.
 *               telephone:
 *                 type: string
 *                 example: "+243810000000"
 *               adresse:
 *                 type: string
 *                 example: Kinshasa, RDC
 *               competences:
 *                 type: array
 *                 items:
 *                   type: string
 *                 example: ["JavaScript", "Express", "MongoDB", "Swagger"]
 *     responses:
 *       200:
 *         description: Profil mis à jour ou créé avec succès
 *       400:
 *         description: Données de profil invalides
 *       401:
 *         description: Non authentifié
 *       403:
 *         description: Accès refusé
 */
router.get('/', c.get); 
router.put('/', c.upsert); 

/**
 * @swagger
 * /api/profile/photo:
 *   post:
 *     summary: Uploader la photo de profil du candidat
 *     tags: [Profil Candidat]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             required:
 *               - photo
 *             properties:
 *               photo:
 *                 type: string
 *                 format: binary
 *                 description: Fichier image (JPG, PNG, WEBP)
 *     responses:
 *       200:
 *         description: Photo de profil téléversée avec succès
 *       400:
 *         description: Fichier manquant ou format d'image non supporté
 *       401:
 *         description: Non authentifié
 *       403:
 *         description: Accès refusé
 */
router.post('/photo', photoUpload, c.uploadPhoto); 

/**
 * @swagger
 * /api/profile/cv:
 *   post:
 *     summary: Uploader le CV du candidat (Format PDF/Doc)
 *     tags: [Profil Candidat]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             required:
 *               - cv
 *             properties:
 *               cv:
 *                 type: string
 *                 format: binary
 *                 description: Fichier document (PDF, DOCX)
 *     responses:
 *       200:
 *         description: Curriculum Vitae téléversé avec succès
 *       400:
 *         description: Fichier manquant ou format non valide 
 *       401:
 *         description: Non authentifié
 *       403:
 *         description: Accès refusé
 */
router.post('/cv', cvUpload, c.uploadCv); 

module.exports = router;