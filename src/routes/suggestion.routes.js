const router = require('express').Router();
const c = require('../controllers/suggestion.controller');
const { authenticate, authorize } = require('../middlewares/auth.middleware');
const valid = require('../middlewares/validate.middleware');
const v = require('../validators/common.validator');

// Un administrateur traite les demandes via /api/admin/suggestions ; cette API
// est exclusivement celle des demandeurs candidats/recruteurs.
router.use(authenticate, authorize('candidat', 'recruteur'));

/**
 * @swagger
 * /suggestions:
 *   post:
 *     summary: Proposer un domaine ou une compétence absente
 *     tags: [Suggestions]
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [type_demande, nom_propose]
 *             properties:
 *               type_demande: { type: string, enum: [DOMAINE, COMPETENCE] }
 *               nom_propose: { type: string, example: Deno }
 *               description: { type: string, nullable: true }
 *     responses:
 *       201: { description: Suggestion créée et administrateurs notifiés }
 *       403: { description: Réservé aux candidats et recruteurs }
 *       409: { description: Élément existant ou suggestion identique en attente }
 * /suggestions/mine:
 *   get:
 *     summary: Lister les suggestions du compte connecté
 *     tags: [Suggestions]
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Suggestions du demandeur }
 * /suggestions/{id}:
 *   get:
 *     summary: Consulter une de ses propres suggestions
 *     tags: [Suggestions]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: integer }
 *     responses:
 *       200: { description: Détail de la suggestion }
 *       404: { description: Suggestion absente ou appartenant à un autre compte }
 */
router.get('/mine', c.mine);
router.post('/', c.create);
router.get('/:id', v.id, valid, c.myGet);

module.exports = router;
