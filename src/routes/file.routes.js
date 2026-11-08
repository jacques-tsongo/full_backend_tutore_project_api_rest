const router = require('express').Router();
const c = require('../controllers/file.controller');
const { authenticate } = require('../middlewares/auth.middleware');

/**
 * @swagger
 * /files/{id}:
 *   get:
 *     summary: Télécharger ou consulter un fichier privé
 *     description: >
 *       Sert un fichier téléversé (photo, couverture, logo, CV ou justificatif)
 *       après contrôle des droits. Un fichier auquel l'utilisateur n'a pas droit
 *       renvoie 404, comme un fichier inexistant.
 *     tags: [Fichiers]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *         description: Identifiant du fichier (valeur renvoyée lors du téléversement)
 *     responses:
 *       200:
 *         description: Contenu binaire du fichier
 *         content:
 *           application/octet-stream:
 *             schema:
 *               type: string
 *               format: binary
 *       401:
 *         description: Authentification requise
 *       404:
 *         description: Fichier introuvable ou accès refusé
 */
router.get('/:id', authenticate, c.get);

module.exports = router;
