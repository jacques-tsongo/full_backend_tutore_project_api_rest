/**
 * Politique de messagerie (règle serveur unique).
 *
 * Les listes de contacts ne suffisent pas : une requête directe sur
 * `POST /api/messages` ou `GET /api/messages/:userId` pourrait viser n'importe
 * quel identifiant. Ce service centralise donc la décision d'autorisation,
 * utilisée à la fois pour envoyer un message et pour ouvrir un fil.
 *
 * Règles :
 * - l'administrateur peut écrire à tout utilisateur actif ;
 * - une relation professionnelle existante autorise l'échange :
 *   - candidat → recruteur d'une entreprise approuvée ;
 *   - recruteur → candidat ayant postulé à l'une de ses offres ;
 * - une conversation déjà engagée autorise toujours la réponse (y compris
 *   lorsqu'un administrateur a écrit le premier ou que la relation a évolué) ;
 * - tout le reste est refusé : candidat ↔ candidat, recruteur ↔ recruteur,
 *   utilisateur → administrateur sans conversation préalable.
 *
 * Un utilisateur inactif ou inexistant n'est jamais joignable.
 */
const db = require('../config/database');

const findActiveUser = async (id) => {
  const [rows] = await db.execute(
    `SELECT id_utilisateur, role, statut_compte
     FROM utilisateur
     WHERE id_utilisateur = ? AND statut_compte = 'actif'`,
    [id]
  );
  return rows[0] || null;
};

const hasConversation = async (userId, otherId) => {
  const [rows] = await db.execute(
    `SELECT 1 FROM message
     WHERE (id_expediteur = ? AND id_destinataire = ?)
        OR (id_expediteur = ? AND id_destinataire = ?)
     LIMIT 1`,
    [userId, otherId, otherId, userId]
  );
  return rows.length > 0;
};

/** Un candidat peut contacter le propriétaire d'une entreprise approuvée. */
const candidateMayContactRecruiter = async (candidateId, recruiterId) => {
  const [rows] = await db.execute(
    `SELECT 1 FROM entreprise
     WHERE id_utilisateur = ? AND status = 'approved'
     LIMIT 1`,
    [recruiterId]
  );
  return rows.length > 0;
};

/** Un recruteur peut contacter un candidat qui a postulé à l'une de ses offres. */
const recruiterMayContactCandidate = async (recruiterId, candidateId) => {
  const [rows] = await db.execute(
    `SELECT 1
     FROM candidature c
     JOIN offre_emploi o ON o.id_offre = c.id_offre
     JOIN entreprise e ON e.id_entreprise = o.id_entreprise
     WHERE e.id_utilisateur = ? AND c.id_utilisateur = ?
     LIMIT 1`,
    [recruiterId, candidateId]
  );
  return rows.length > 0;
};

const defaultDeps = {
  findActiveUser,
  hasConversation,
  candidateMayContactRecruiter,
  recruiterMayContactCandidate
};

/**
 * Décide si `actor` peut joindre `targetId`.
 * @returns {Promise<{allowed:boolean, reason:string}>}
 *   reason ∈ ok | not_found | self | forbidden
 */
const evaluate = async (actor, targetId, deps = {}) => {
  const d = { ...defaultDeps, ...deps };
  if (!actor) return { allowed: false, reason: 'not_found' };

  const target = await d.findActiveUser(targetId);
  if (!target) return { allowed: false, reason: 'not_found' };

  if (Number(target.id_utilisateur) === Number(actor.id_utilisateur)) {
    return { allowed: false, reason: 'self' };
  }
  if (actor.role === 'administrateur') return { allowed: true, reason: 'ok' };

  if (await d.hasConversation(actor.id_utilisateur, target.id_utilisateur)) {
    return { allowed: true, reason: 'ok' };
  }
  if (actor.role === 'candidat' && target.role === 'recruteur') {
    const ok = await d.candidateMayContactRecruiter(actor.id_utilisateur, target.id_utilisateur);
    return ok ? { allowed: true, reason: 'ok' } : { allowed: false, reason: 'forbidden' };
  }
  if (actor.role === 'recruteur' && target.role === 'candidat') {
    const ok = await d.recruiterMayContactCandidate(actor.id_utilisateur, target.id_utilisateur);
    return ok ? { allowed: true, reason: 'ok' } : { allowed: false, reason: 'forbidden' };
  }
  return { allowed: false, reason: 'forbidden' };
};

const canMessage = async (actor, targetId, deps = {}) => (await evaluate(actor, targetId, deps)).allowed;

module.exports = {
  findActiveUser,
  hasConversation,
  candidateMayContactRecruiter,
  recruiterMayContactCandidate,
  evaluate,
  canMessage
};
