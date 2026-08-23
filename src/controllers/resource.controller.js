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
    // Règle métier : une entreprise ne se crée que via le workflow « demande
    // candidat → validation administrateur ». Aucune création directe — même
    // par un administrateur — n'est autorisée (garde-fou en plus du routage).
    if (name === 'entreprises') return fail(res, 'La création d’entreprise passe obligatoirement par la demande candidat (workflow de validation).', [], 403);
    if (name === 'domaines' && !String(req.body.nom_domaine || '').trim()) return fail(res, 'Nom de domaine requis.', ['nom_domaine'], 422);
    const item = await Resource.create(name, req.body, ownerFor(name, req.user) || {});
    if (name === 'competences') {
      socket.emitAll('nouvelle_competence', { competence: item, id_competence: item.id_competence });
    }
    success(res, 'Ressource créée.', { item }, 201); });
exports.update = (name) => asyncHandler(async (req, res) => { 
    const row = await owns(name, req.params.id, req.user); 
    if (!row) return fail(res, 'Ressource introuvable ou accès refusé.', [], row === false ? 403 : 404); 
    if (name === 'domaines' && req.body.nom_domaine !== undefined && !String(req.body.nom_domaine || '').trim()) {
      return fail(res, 'Nom de domaine requis.', ['nom_domaine'], 422);
    }
    const item = await Resource.update(name, req.params.id, req.body);
    if (name === 'competences') {
      socket.emitAll('competence_modifiee', { competence: item, id_competence: Number(req.params.id) });
    }
    success(res, 'Ressource mise à jour.', { item }); });
exports.remove = (name) => asyncHandler(async (req, res) => { 
    const row = await owns(name, req.params.id, req.user); 
    if (!row) return fail(res, 'Ressource introuvable ou accès refusé.', [], row === false ? 403 : 404); 
    const d = Resource.schema[name]; 
    try {
      await db.execute(`DELETE FROM ${d.table} WHERE ${d.id} = ?`, [req.params.id]);
    } catch (error) {
      if (name === 'domaines' && error.code === 'ER_ROW_IS_REFERENCED_2') {
        return fail(res, 'Ce domaine est utilisé par un profil, une entreprise ou une offre et ne peut pas être supprimé.', [], 409);
      }
      throw error;
    }
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

/**
 * Enregistrement EN MASSE des compétences choisies (page « Ajouter vos
 * compétences » post-inscription). `req.body.competences` est un tableau
 * d'identifiants (champs cachés répétés du formulaire HTML).
 *
 * Règles appliquées :
 * - liste vide ou absente → succès sans effet (le bouton « Ignorer » de la
 *   page onbording emprunte le même chemin : aucune compétence n'est ajoutée) ;
 * - les identifiants sont contrôlés contre le catalogue `competence` (aucun
 *   ORM indirect ne peut injecter d'id inconnu) ;
 * - INSERT ... ON DUPLICATE KEY UPDATE : rejouer la page ne crée jamais de
 *   doublon (clé primaire id_utilisateur + id_competence), et le niveau déjà
 *   défini par l'utilisateur dans son profil n'est pas écrasé (niveau_competence
 *   reste inchangé si la compétence existait déjà).
 */
exports.addSkills = asyncHandler(async (req, res) => {
  // Bouton « Ignorer » de la page post-inscription : on poursuit vers le
  // tableau de bord SANS enregistrer quoi que ce soit (aucune compétence par
  // défaut, aucune association créée en base pour le nouvel utilisateur).
  if (req.body.action === 'ignorer') {
    return success(res, 'Étape ignorée — aucune compétence enregistrée.', { added: 0 });
  }

  const raw = req.body.competences;
  const ids = (Array.isArray(raw) ? raw : raw ? [raw] : [])
    .map((v) => Number(v))
    .filter((v) => Number.isInteger(v) && v > 0);
  const unique = Array.from(new Set(ids));
  if (!unique.length) return success(res, 'Aucune compétence sélectionnée.', { added: 0 });

  // Vérification d'existence dans le catalogue : les clés étrangères vers
  // `competence` interdiraient déjà les ids inconnus, mais un message clair
  // est plus utile qu'une erreur SQL générique (ER_NO_REFERENCED_ROW_2).
  const [known] = await db.execute(
    `SELECT id_competence FROM competence WHERE id_competence IN (${unique.map(() => '?').join(',')})`,
    unique
  );
  const knownIds = new Set(known.map((k) => Number(k.id_competence)));
  const valid = unique.filter((id) => knownIds.has(id));
  if (!valid.length) return fail(res, 'Les compétences sélectionnées sont introuvables.', [], 422);

  // Enregistrement en une seule requête (multi-lignes), sans écraser un
  // niveau déjà choisi par l'utilisateur : ON DUPLICATE KEY UPDATE met à jour
  // niveau_competence = niveau_competence (no-op).
  const values = valid.map((id) => [req.user.id_utilisateur, id, 'Débutant']);
  await db.execute(
    `INSERT INTO utilisateur_competence (id_utilisateur, id_competence, niveau_competence)
     VALUES ${valid.map(() => '(?, ?, ?)').join(',')}
     ON DUPLICATE KEY UPDATE niveau_competence = niveau_competence`,
    values.flat()
  );
  success(res, 'Compétences enregistrées.', { added: valid.length });
});
exports.removeSkill = asyncHandler(async (req, res) => { 
    await db.execute('DELETE FROM utilisateur_competence WHERE id_utilisateur = ? AND id_competence = ?', [req.user.id_utilisateur, req.params.id]); 
    success(res, 'Compétence retirée.'); });
