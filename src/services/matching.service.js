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

/**
 * SYNCHRONISATION EN LOT de la table `matching` (réparation du matching).
 *
 * Problème corrigé : la table `matching` n'était alimentée que lorsque le
 * candidat ouvrait lui-même le détail d'une offre ou postulait. Les
 * candidatures créées avant (ou dont les compétences/l'offre ont changé)
 * gardaient un score absent ou obsolète — le recruteur ne voyait donc plus
 * de score de compatibilité fiable.
 *
 * Cette fonction recalcule les scores de N couples (utilisateur, offre) en
 * UNE passe (3 requêtes de lecture, quel que soit le nombre de couples),
 * avec la MÊME formule `computeScore` (aucune seconde formule), puis ne
 * réécrit en base que les scores manquants ou différents.
 *
 * @param {Array<{id_utilisateur:number, id_offre:number}>} pairs
 * @returns {Map<string, {score:number, matched:number, required:number, matchedSkillIds:number[]}>}
 *          clé `${id_utilisateur}:${id_offre}`.
 */
exports.syncPairs = async (pairs) => {
  const results = new Map();
  const unique = new Map();
  (pairs || []).forEach((p) => {
    const u = Number(p.id_utilisateur);
    const o = Number(p.id_offre);
    if (Number.isInteger(u) && u > 0 && Number.isInteger(o) && o > 0) unique.set(`${u}:${o}`, { u, o });
  });
  if (!unique.size) return results;
  const offerIds = [...new Set([...unique.values()].map((p) => p.o))];
  const userIds = [...new Set([...unique.values()].map((p) => p.u))];

  const [reqs] = await db.execute(
    `SELECT id_offre, id_competence, niveau_requis FROM offre_competence
     WHERE id_offre IN (${offerIds.map(() => '?').join(',')})`,
    offerIds
  );
  const requiredByOffer = new Map();
  reqs.forEach((r) => {
    const list = requiredByOffer.get(Number(r.id_offre)) || [];
    list.push({ id_competence: Number(r.id_competence), niveau_requis: r.niveau_requis });
    requiredByOffer.set(Number(r.id_offre), list);
  });

  const [skills] = await db.execute(
    `SELECT id_utilisateur, id_competence, niveau_competence FROM utilisateur_competence
     WHERE id_utilisateur IN (${userIds.map(() => '?').join(',')})`,
    userIds
  );
  const skillsByUser = new Map();
  skills.forEach((s) => {
    const list = skillsByUser.get(Number(s.id_utilisateur)) || [];
    list.push({ id_competence: Number(s.id_competence), niveau_competence: s.niveau_competence });
    skillsByUser.set(Number(s.id_utilisateur), list);
  });

  const [existing] = await db.execute(
    `SELECT id_utilisateur, id_offre, score_compatibilite FROM matching
     WHERE id_offre IN (${offerIds.map(() => '?').join(',')})
       AND id_utilisateur IN (${userIds.map(() => '?').join(',')})`,
    [...offerIds, ...userIds]
  );
  const persisted = new Map(existing.map((m) => [`${Number(m.id_utilisateur)}:${Number(m.id_offre)}`, Number(m.score_compatibilite)]));

  for (const { u, o } of unique.values()) {
    const required = requiredByOffer.get(o) || [];
    const mySkills = skillsByUser.get(u) || [];
    const result = computeScore(required, mySkills);
    const requiredIds = new Set(required.map((r) => r.id_competence));
    result.matchedSkillIds = mySkills.map((s) => s.id_competence).filter((id) => requiredIds.has(id));
    results.set(`${u}:${o}`, result);
    const stored = persisted.get(`${u}:${o}`);
    if (stored === undefined || Math.abs(stored - result.score) >= 0.005) {
      await db.execute(
        `INSERT INTO matching (id_utilisateur, id_offre, score_compatibilite)
         VALUES (?, ?, ?)
         ON DUPLICATE KEY UPDATE score_compatibilite = VALUES(score_compatibilite), date_matching = CURRENT_TIMESTAMP`,
        [u, o, result.score]
      );
    }
  }
  return results;
};

/* ==================== Classement des candidatures ======================== */
/*
 * Le classement des candidatures d'une offre combine :
 *   A. le score de compatibilité des compétences (formule unique ci-dessus,
 *      persistée dans `matching.score_compatibilite`) ;
 *   B. l'expérience professionnelle du candidat (table
 *      `experience_professionnelle` existante), pondérée par sa pertinence
 *      vis-à-vis de l'offre (mots du titre de l'offre + noms des compétences
 *      requises retrouvés dans le poste / la description / l'entreprise).
 *
 * Formule du score de recommandation (calculé côté serveur, PAS de nouvelle
 * colonne — le score_compatibilite du matching n'est jamais remplacé) :
 *
 *   score_recommandation = 0.7 × score_compatibilite + 0.3 × score_experience
 *
 *   score_experience = min( (années_pertinentes + 0.5 × autres_années) / 5, 1 ) × 100
 *
 * Justification :
 * - les compétences restent le critère DOMINANT (70 %) : un débutant avec
 *   d'excellentes compétences n'est jamais pénalisé (son score reste 0.7 ×
 *   compatibilité, devant tout profil moins compétent ET moins expérimenté) ;
 * - l'expérience est un facteur COMPLÉMENTAIRE (30 %) : à compétences
 *   équivalentes, le candidat expérimenté passe devant ;
 * - l'expérience pertinente (liée au poste) compte double par rapport à une
 *   expérience hors sujet ; 5 années « effectives » suffisent pour atteindre
 *   le maximum (au-delà, plus aucun gain — évite d'écraser les compétences).
 */
const EXPERIENCE_CAP_YEARS = 5;
const RECO_SKILL_WEIGHT = 0.7;
const RECO_EXPERIENCE_WEIGHT = 0.3;

const stripAccents = (value) => String(value || '')
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .toLowerCase();

// Mots vides français/anglais fréquents dans les titres d'offres : exclus des
// mots-clés de pertinence (« développeur POUR notre équipe »...).
const STOPWORDS = new Set([
  'les', 'des', 'une', 'aux', 'pour', 'avec', 'dans', 'sur', 'par', 'chez',
  'the', 'and', 'for', 'his', 'her', 'notre', 'votre', 'nos', 'vos', 'ans'
]);

/**
 * Mots-clés de l'offre servant à mesurer la pertinence d'une expérience :
 * mots (≥ 3 lettres) du titre de l'offre + noms des compétences requises,
 * sans accents ni doublons.
 */
exports.offerKeywords = (offerTitle, requiredSkillNames = []) => {
  const source = [offerTitle, ...(requiredSkillNames || [])].join(' ');
  return [...new Set(
    stripAccents(source)
      .split(/[^a-z0-9+#]+/)
      .filter((w) => w.length >= 3 && !STOPWORDS.has(w))
  )];
};

/**
 * Score d'expérience 0..100 à partir des lignes réelles de la table
 * `experience_professionnelle` (poste, entreprise, dates, description).
 * Une expérience est « pertinente » si son texte contient au moins un
 * mot-clé de l'offre. Une expérience sans date de fin est considérée en cours
 * (jusqu'à aujourd'hui).
 */
exports.experienceScore = (experiences, keywords = []) => {
  const MS_YEAR = 365.25 * 24 * 3600 * 1000;
  let relevantYears = 0;
  let otherYears = 0;
  (experiences || []).forEach((xp) => {
    const start = xp.date_debut ? new Date(xp.date_debut) : null;
    if (!start || Number.isNaN(start.getTime())) return;
    const end = xp.date_fin ? new Date(xp.date_fin) : new Date();
    const years = Math.max(0, (end.getTime() - start.getTime()) / MS_YEAR);
    const text = stripAccents(`${xp.poste || ''} ${xp.description || ''} ${xp.entreprise || ''}`);
    const relevant = keywords.some((k) => text.includes(k));
    if (relevant) relevantYears += years; else otherYears += years;
  });
  const effective = relevantYears + 0.5 * otherYears;
  const score = Math.round(Math.min(effective / EXPERIENCE_CAP_YEARS, 1) * 10000) / 100;
  return {
    score,
    totalYears: Math.round((relevantYears + otherYears) * 10) / 10,
    relevantYears: Math.round(relevantYears * 10) / 10
  };
};

/** Score de recommandation 0..100 (voir la justification de la formule ci-dessus). */
exports.recommendationScore = (compatibilityScore, experienceScore) =>
  Math.round((RECO_SKILL_WEIGHT * (Number(compatibilityScore) || 0)
    + RECO_EXPERIENCE_WEIGHT * (Number(experienceScore) || 0)) * 100) / 100;

// Exports réutilisés ailleurs (filtrage en lot de la liste des offres).
exports.computeScore = computeScore;
exports.canAccess = canAccess;
exports.ACCESS_THRESHOLD = ACCESS_THRESHOLD;
exports.EXPERIENCE_CAP_YEARS = EXPERIENCE_CAP_YEARS;
