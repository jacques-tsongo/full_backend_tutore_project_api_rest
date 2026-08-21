const db = require('../config/database');

const levels = { Débutant: 1, Intermédiaire: 2, Avancé: 3, Expert: 4 };

/**
 * Compatibilité STRICTE candidat / offre :
 * un candidat est compatible UNIQUEMENT s'il possède TOUTES les compétences
 * requises par l'offre. Une correspondance partielle n'est PAS suffisante
 * (règle métier « toutes les compétences obligatoires présentes »).
 *
 * Une offre sans compétence requise est compatible pour tout candidat
 * (aucune compétence obligatoire ne peut manquer).
 */
exports.hasAllRequired = async (userId, offerId) => {
  const [required] = await db.execute(
    'SELECT id_competence FROM offre_competence WHERE id_offre = ?',
    [offerId]
  );
  if (!required.length) return true;
  const [skills] = await db.execute(
    'SELECT id_competence FROM utilisateur_competence WHERE id_utilisateur = ?',
    [userId]
  );
  const owned = new Set(skills.map((s) => s.id_competence));
  return required.every((r) => owned.has(r.id_competence));
};

/**
 * Score de correspondance (pourcentage pondéré par les niveaux) persisté dans
 * la table `matching`. Le score reste informatif ; la compatibilité réelle
 * (autorisation de consulter/postuler) est le booléen `compatible` retourné
 * ci-dessous, fondé sur `hasAllRequired`.
 */
exports.calculate = async (userId, offerId) => {
  const [required] = await db.execute('SELECT id_competence, niveau_requis FROM offre_competence WHERE id_offre = ?', [offerId]);
  if (!required.length) {
    // Aucune compétence requise : score 0, mais le candidat est compatible.
    await db.execute(
      'INSERT INTO matching (id_utilisateur, id_offre, score_compatibilite) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE score_compatibilite = VALUES(score_compatibilite), date_matching=CURRENT_TIMESTAMP',
      [userId, offerId, 0]
    );
    return { score: 0, matched: 0, required: 0, compatible: true };
  }
  const [skills] = await db.execute('SELECT id_competence, niveau_competence FROM utilisateur_competence WHERE id_utilisateur = ?', [userId]);
  const index = new Map(skills.map((s) => [s.id_competence, levels[s.niveau_competence] || 0]));
  const points = required.reduce((sum, r) => sum + Math.min((index.get(r.id_competence) || 0) / (levels[r.niveau_requis] || 4), 1), 0);
  const score = Math.round((points / required.length) * 10000) / 100;
  const matched = skills.filter((s) => required.some((r) => r.id_competence === s.id_competence)).length;
  // Compatibilité stricte : toutes les compétences requises sont présentes.
  const compatible = required.every((r) => index.has(r.id_competence));
  await db.execute(
    'INSERT INTO matching (id_utilisateur, id_offre, score_compatibilite) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE score_compatibilite = VALUES(score_compatibilite), date_matching=CURRENT_TIMESTAMP',
    [userId, offerId, score]
  );
  return { score, matched, required: required.length, compatible };
};
