const db = require('../config/database');

const toPositiveInt = (value) => {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
};

exports.toPositiveInt = toPositiveInt;

exports.findById = async (value, connection = db) => {
  const id = toPositiveInt(value);
  if (!id) return null;
  const [rows] = await connection.execute('SELECT id_domaine, nom_domaine FROM domaine WHERE id_domaine = ?', [id]);
  return rows[0] || null;
};

exports.list = async () => {
  const [rows] = await db.execute('SELECT id_domaine, nom_domaine FROM domaine ORDER BY nom_domaine');
  return rows;
};

exports.getCandidateDomainId = async (userId, connection = db) => {
  const [rows] = await connection.execute(
    `SELECT p.id_domaine
     FROM profil_professionnel p
     JOIN domaine d ON d.id_domaine = p.id_domaine
     WHERE p.id_utilisateur = ?`,
    [userId]
  );
  return rows[0]?.id_domaine ? Number(rows[0].id_domaine) : null;
};

exports.getOfferDomainId = async (offerId, connection = db) => {
  const [rows] = await connection.execute(
    `SELECT COALESCE(o.id_domaine, e.id_domaine) AS id_domaine
     FROM offre_emploi o
     JOIN entreprise e ON e.id_entreprise = o.id_entreprise
     WHERE o.id_offre = ?`,
    [offerId]
  );
  return rows[0]?.id_domaine ? Number(rows[0].id_domaine) : null;
};

/**
 * Catalogue des compétences d'UN domaine (relation DOMAINE 1,N COMPETENCE).
 * Seules les compétences rattachées à ce domaine sont proposées : les
 * compétences historiques non classées (id_domaine NULL) n'apparaissent pas
 * dans les sélecteurs tant que l'administrateur ne les a pas classées.
 */
exports.listSkillsByDomain = async (domainId, connection = db) => {
  const id = toPositiveInt(domainId);
  if (!id) return [];
  const [rows] = await connection.execute(
    'SELECT id_competence, nom_competence, description FROM competence WHERE id_domaine = ? ORDER BY nom_competence',
    [id]
  );
  return rows;
};

/**
 * Vérifie qu'aucune des compétences fournies n'appartient à un AUTRE domaine
 * que `domainId`. Règle appliquée côté serveur (profil candidat et offres) :
 *  - compétence du même domaine  → acceptée ;
 *  - compétence d'un autre domaine → refusée (retournée dans `invalid`) ;
 *  - compétence historique sans domaine (NULL) → tolérée pour ne pas casser
 *    les données existantes (elle n'est simplement plus proposée à la
 *    sélection tant qu'elle n'est pas classée par l'administrateur).
 */
exports.checkSkillsAgainstDomain = async (skillIds, domainId, connection = db) => {
  const ids = [...new Set((skillIds || []).map(toPositiveInt).filter(Boolean))];
  if (!ids.length) return { ok: true, invalid: [] };
  const [rows] = await connection.execute(
    `SELECT id_competence, nom_competence, id_domaine FROM competence WHERE id_competence IN (${ids.map(() => '?').join(',')})`,
    ids
  );
  const domain = toPositiveInt(domainId);
  const invalid = rows.filter((r) => r.id_domaine !== null && Number(r.id_domaine) !== domain);
  return { ok: invalid.length === 0, invalid };
};

exports.ensureCandidateCanAccessOffer = async (userId, offerId, connection = db) => {
  const [rows] = await connection.execute(
    `SELECT p.id_domaine AS candidat_id_domaine,
            COALESCE(o.id_domaine, e.id_domaine) AS offre_id_domaine
     FROM offre_emploi o
     JOIN entreprise e ON e.id_entreprise = o.id_entreprise
     LEFT JOIN profil_professionnel p ON p.id_utilisateur = ?
     WHERE o.id_offre = ?`,
    [userId, offerId]
  );
  if (!rows[0]) return { ok: false, reason: 'offer_not_found' };
  const candidat = rows[0].candidat_id_domaine ? Number(rows[0].candidat_id_domaine) : null;
  const offre = rows[0].offre_id_domaine ? Number(rows[0].offre_id_domaine) : null;
  if (!candidat) return { ok: false, reason: 'candidate_domain_missing' };
  if (!offre) return { ok: false, reason: 'offer_domain_missing' };
  if (candidat !== offre) return { ok: false, reason: 'domain_mismatch', candidat, offre };
  return { ok: true, candidat, offre };
};
