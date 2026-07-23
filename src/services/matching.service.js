const db = require('../config/database');

const levels = { Débutant: 1, Intermédiaire: 2, Avancé: 3, Expert: 4 };
exports.calculate = async (userId, offerId) => {
  const [required] = await db.execute('SELECT id_competence, niveau_requis FROM offre_competence WHERE id_offre = ?', [offerId]);
  if (!required.length) return { score: 0, matched: 0, required: 0 };
  const [skills] = await db.execute('SELECT id_competence, niveau_competence FROM utilisateur_competence WHERE id_utilisateur = ?', [userId]);
  const index = new Map(skills.map((s) => [s.id_competence, levels[s.niveau_competence] || 0]));
  const points = required.reduce((sum, r) => sum + Math.min((index.get(r.id_competence) || 0) / (levels[r.niveau_requis] || 4), 1), 0);
  const score = Math.round((points / required.length) * 10000) / 100;
  await db.execute('INSERT INTO matching (id_utilisateur, id_offre, score_compatibilite) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE score_compatibilite = VALUES(score_compatibilite), date_matching=CURRENT_TIMESTAMP', [userId, offerId, score]);
  return { score, matched: skills.filter((s) => required.some((r) => r.id_competence === s.id_competence)).length, required: required.length };
};
