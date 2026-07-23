const Resource = require('../models/resource.model');
const { success, fail } = require('../utils/apiResponse');
const asyncHandler = require('../utils/asyncHandler');
const db = require('../config/database');

const ownerFor = (name, user) => ['experiences', 'diplomes'].includes(name) ? { ownerField: 'id_utilisateur', ownerId: user.id_utilisateur } : null;
const owns = async (name, id, user) => { const row = await Resource.get(name, id); if (!row) return null; const o = ownerFor(name, user); return (!o || row[o.ownerField] === o.ownerId || user.role === 'administrateur') ? row : false; };
exports.list = (name) => asyncHandler(async (req, res) => success(res, 'Liste récupérée.', await Resource.list(name, req.query, ownerFor(name, req.user) || {})));
exports.get = (name) => asyncHandler(async (req, res) => { const row = await Resource.get(name, req.params.id); return row ? success(res, 'Ressource récupérée.', { item: row }) : fail(res, 'Ressource introuvable.', [], 404); });
exports.create = (name) => asyncHandler(async (req, res) => success(res, 'Ressource créée.', { item: await Resource.create(name, req.body, ownerFor(name, req.user) || {}) }, 201));
exports.update = (name) => asyncHandler(async (req, res) => { const row = await owns(name, req.params.id, req.user); if (!row) return fail(res, 'Ressource introuvable ou accès refusé.', [], row === false ? 403 : 404); success(res, 'Ressource mise à jour.', { item: await Resource.update(name, req.params.id, req.body) }); });
exports.remove = (name) => asyncHandler(async (req, res) => { const row = await owns(name, req.params.id, req.user); if (!row) return fail(res, 'Ressource introuvable ou accès refusé.', [], row === false ? 403 : 404); const d = Resource.schema[name]; await db.execute(`DELETE FROM ${d.table} WHERE ${d.id} = ?`, [req.params.id]); success(res, 'Ressource supprimée.'); });

exports.mySkills = asyncHandler(async (req, res) => { const [rows] = await db.execute('SELECT c.*, uc.niveau_competence FROM utilisateur_competence uc JOIN competence c ON c.id_competence = uc.id_competence WHERE uc.id_utilisateur = ?', [req.user.id_utilisateur]); success(res, 'Compétences du candidat.', { items: rows }); });
exports.addSkill = asyncHandler(async (req, res) => { await db.execute('INSERT INTO utilisateur_competence (id_utilisateur, id_competence, niveau_competence) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE niveau_competence = VALUES(niveau_competence)', [req.user.id_utilisateur, req.body.id_competence, req.body.niveau_competence]); success(res, 'Compétence associée.'); });
exports.removeSkill = asyncHandler(async (req, res) => { await db.execute('DELETE FROM utilisateur_competence WHERE id_utilisateur = ? AND id_competence = ?', [req.user.id_utilisateur, req.params.id]); success(res, 'Compétence retirée.'); });
