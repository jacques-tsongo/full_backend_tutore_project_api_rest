const Resource = require('../models/resource.model');
const { success, fail } = require('../utils/apiResponse');
const asyncHandler = require('../utils/asyncHandler');
const db = require('../config/database');
const socket = require('../socket');

/**
 * Diffusion temps réel du CATALOGUE de compétences (table `competence`) :
 * créé/modifié/supprimé uniquement par l'administrateur, visible par tous
 * les utilisateurs connectés (profils, offres, matching). Les autres
 * ressources (expériences, diplômes, etc.) restent privées → non diffusées.
 */
const broadcastSkill = (name, event, payload) => {
  if (name !== 'competences') return;
  socket.emitAll(event, payload);
};

const ownerFor = (name, user) => ['experiences', 'diplomes'].includes(name) ? { ownerField: 'id_utilisateur', ownerId: user.id_utilisateur } : null;
const owns = async (name, id, user) => { 
    const row = await Resource.get(name, id); if (!row) return null; 
    const o = ownerFor(name, user);
     return (!o || row[o.ownerField] === o.ownerId || user.role === 'administrateur') ? row : false; };

// Annuaire des entreprises : seuls les organismes approuvés sont visibles pour
// les non-administrateurs, et les justificatifs internes (RCCM/fiscal/documents)
// ne sont exposés qu'au propriétaire et à l'administrateur.
const visibleCompany = (row, user) => {
  if (!row) return row;
  if (user.role === 'administrateur' || row.id_utilisateur === user.id_utilisateur) return row;
  const { documents_justificatifs, numero_rccm, numero_fiscal, approved_by, ...rest } = row;
  return rest;
};

exports.list = (name) => asyncHandler(async (req, res) => {
  const extra = ownerFor(name, req.user) || {};
  if (name === 'entreprises' && req.user.role !== 'administrateur') extra.companyVisibility = 'approved';
  const result = await Resource.list(name, req.query, extra);
  if (name === 'entreprises') result.items = result.items.map((row) => visibleCompany(row, req.user));
  success(res, 'Liste récupérée.', result);
});
exports.get = (name) => asyncHandler(async (req, res) => { 
    let row = await Resource.get(name, req.params.id); 
    if (row && name === 'entreprises' && req.user.role !== 'administrateur' && row.status !== 'approved' && row.id_utilisateur !== req.user.id_utilisateur) row = null;
    if (row && name === 'entreprises') row = visibleCompany(row, req.user);
    return row ? success(res, 'Ressource récupérée.', { item: row }) : fail(res, 'Ressource introuvable.', [], 404); });
exports.create = (name) => asyncHandler(async (req, res) => { 
    const item = await Resource.create(name, req.body, ownerFor(name, req.user) || {});
    if (name === 'competences') {
      socket.emitAll('nouvelle_competence', { competence: item, id_competence: item.id_competence });
    }
    success(res, 'Ressource créée.', { item }, 201); });
exports.update = (name) => asyncHandler(async (req, res) => { 
    const row = await owns(name, req.params.id, req.user); 
    if (!row) return fail(res, 'Ressource introuvable ou accès refusé.', [], row === false ? 403 : 404); 
    const item = await Resource.update(name, req.params.id, req.body);
    if (name === 'competences') {
      socket.emitAll('competence_modifiee', { competence: item, id_competence: Number(req.params.id) });
    }
    success(res, 'Ressource mise à jour.', { item }); });
exports.remove = (name) => asyncHandler(async (req, res) => { 
    const row = await owns(name, req.params.id, req.user); 
    if (!row) return fail(res, 'Ressource introuvable ou accès refusé.', [], row === false ? 403 : 404); 
    const d = Resource.schema[name]; 
    await db.execute(`DELETE FROM ${d.table} WHERE ${d.id} = ?`, [req.params.id]); 
    if (name === 'competences') {
      socket.emitAll('competence_supprimee', { id_competence: Number(req.params.id) });
    }
    success(res, 'Ressource supprimée.'); });

exports.mySkills = asyncHandler(async (req, res) => { 
    const [rows] = await db.execute('SELECT c.*, uc.niveau_competence FROM utilisateur_competence uc JOIN competence c ON c.id_competence = uc.id_competence WHERE uc.id_utilisateur = ?', [req.user.id_utilisateur]); 
    success(res, 'Compétences du candidat.', { items: rows }); });
exports.addSkill = asyncHandler(async (req, res) => { 
    await db.execute('INSERT INTO utilisateur_competence (id_utilisateur, id_competence, niveau_competence) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE niveau_competence = VALUES(niveau_competence)', [req.user.id_utilisateur, req.body.id_competence, req.body.niveau_competence]); 
    success(res, 'Compétence associée.'); });
exports.removeSkill = asyncHandler(async (req, res) => { 
    await db.execute('DELETE FROM utilisateur_competence WHERE id_utilisateur = ? AND id_competence = ?', [req.user.id_utilisateur, req.params.id]); 
    success(res, 'Compétence retirée.'); });
