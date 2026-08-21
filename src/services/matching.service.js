const db = require('../config/database');

const levels = { Débutant: 1, Intermédiaire: 2, Avancé: 3, Expert: 4 };

/**
 * SEUIL DE VISIBILITÉ (règle métier).
 *
 * Un candidat ne peut ni consulter, ni postuler à une offre dont le score de
 * compatibilité est STRICTEMENT inférieur à ce seuil (exprimé en pourcentage).
 * Ce seuil est LA source de vérité pour :
 *   - le filtrage de la liste des offres (offer.controller.list) ;
 *   - l'accès au détail d'une offre (offer.controller.get) ;
 *   - la candidature (job.controller.apply) ;
 *   - l'envoi des notifications de nouvelle offre (offer.controller.create).
 *
 * Cas particulier : une offre SANS compétence requise n'impose aucune
 * contrainte → elle reste accessible à tous les candidats (aucun prérequis à
 * satisfaire), même si son score numérique est 0.
 */
const ACCESS_THRESHOLD = 10;

/**
 * Calcul PUR du score de correspondance, à partir de listes en mémoire
 * (aucune requête SQL, aucune écriture). C'est l'unique formule de calcul du
 * projet : chaque autre usage (liste, détail, candidature, notifications,
 * page matching) s'appuie sur ce même résultat.
 *
 * @param {Array<{id_competence:number, niveau_requis:string}>} required
 *   Compétences requises par l'offre.
 * @param {Array<{id_competence:number, niveau_competence:string}>} skills
 *   Compétences détenues par le candidat.
 * @returns {{score:number, matched:number, required:number}}
 *   - score    : 0..100 (moyenne pondérée de la couverture de chaque
 *                compétence requise, plafonnée à 100 % par compétence) ;
 *   - matched  : nombre de compétences requises couvertes (au moins partiel.) ;
 *   - required : nombre de compétences requises.
 */
const computeScore = (required, skills) => {
  if (!required.length) {
    return { score: 0, matched: 0, required: 0 };
  }
  const index = new Map(skills.map((s) => [s.id_competence, levels[s.niveau_competence] || 0]));
  const points = required.reduce(
    (sum, r) => sum + Math.min((index.get(r.id_competence) || 0) / (levels[r.niveau_requis] || 4), 1),
    0
  );
  const score = Math.round((points / required.length) * 10000) / 100;
  const matched = skills.filter((s) => required.some((r) => r.id_competence === s.id_competence)).length;
  return { score, matched, required: required.length };
};

/**
 * Règle d'accès : un candidat peut consulter/postuler si l'offre n'a aucune
 * compétence requise OU si son score atteint le seuil (>= 10 %).
 */
const canAccess = (result) => result.required === 0 || result.score >= ACCESS_THRESHOLD;

/**
 * Charge les compétences requises + celles du candidat puis applique la
 * formule unique `computeScore` (lecture seule, aucune persistance).
 * Utilisé par les contrôles d'accès backend (offre, candidature) et par le
 * filtrage de la liste d'offres.
 */
exports.evaluate = async (userId, offerId) => {
  const [required] = await db.execute(
    'SELECT id_competence, niveau_requis FROM offre_competence WHERE id_offre = ?',
    [offerId]
  );
  const [skills] = await db.execute(
    'SELECT id_competence, niveau_competence FROM utilisateur_competence WHERE id_utilisateur = ?',
    [userId]
  );
  return computeScore(required, skills);
};

/**
 * Calcule le score, le PERSISTE dans `matching` (clé unique
 * utilisateur/offre), puis renvoie le résultat enrichi de la décision
 * d'accès (`accessible`). C'est le point d'entrée utilisé par les pages
 * (détail d'offre, matching) qui affichent le score.
 */
exports.calculate = async (userId, offerId) => {
  const result = await exports.evaluate(userId, offerId);
  await db.execute(
    `INSERT INTO matching (id_utilisateur, id_offre, score_compatibilite)
     VALUES (?, ?, ?)
     ON DUPLICATE KEY UPDATE score_compatibilite = VALUES(score_compatibilite), date_matching = CURRENT_TIMESTAMP`,
    [userId, offerId, result.score]
  );
  return { ...result, accessible: canAccess(result) };
};

// Exports réutilisés ailleurs (filtrage en lot de la liste des offres).
exports.computeScore = computeScore;
exports.canAccess = canAccess;
exports.ACCESS_THRESHOLD = ACCESS_THRESHOLD;
