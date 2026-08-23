const db = require('../config/database');

const TYPES = Object.freeze({ DOMAIN: 'DOMAINE', SKILL: 'COMPETENCE' });
const STATUSES = Object.freeze({ PENDING: 'EN_ATTENTE', APPROVED: 'APPROUVEE', REJECTED: 'REFUSEE' });

exports.TYPES = TYPES;
exports.STATUSES = STATUSES;

/**
 * Forme de comparaison des noms proposés : Unicode NFKC, espaces de toute
 * nature réduits à un espace, trim, puis casse française abaissée.
 * Le libellé d'affichage reste, lui, conservé dans `nom_propose`.
 */
const cleanName = (value) => String(value ?? '').normalize('NFKC').replace(/\s+/gu, ' ').trim();
const normalizeName = (value) => cleanName(value).toLocaleLowerCase('fr-FR');
exports.cleanName = cleanName;
exports.normalizeName = normalizeName;

const detailedSelect = `
  SELECT ds.*,
         d.nom_domaine,
         u.nom, u.prenom, u.email, u.role,
         admin.nom AS admin_nom, admin.prenom AS admin_prenom
  FROM demande_suggestion ds
  JOIN utilisateur u ON u.id_utilisateur = ds.id_utilisateur
  LEFT JOIN domaine d ON d.id_domaine = ds.id_domaine
  LEFT JOIN utilisateur admin ON admin.id_utilisateur = ds.id_admin_traitement
`;

exports.findById = async (id, options = {}) => {
  const connection = options.connection || db;
  const where = ['ds.id_demande = ?'];
  const values = [id];
  if (options.ownerId) {
    where.push('ds.id_utilisateur = ?');
    values.push(options.ownerId);
  }
  const [rows] = await connection.execute(`${detailedSelect} WHERE ${where.join(' AND ')}`, values);
  return rows[0] || null;
};

/** Ligne métier verrouillée pendant une décision administrateur. */
exports.findForUpdate = async (id, connection) => {
  const [rows] = await connection.execute(
    'SELECT * FROM demande_suggestion WHERE id_demande = ? FOR UPDATE',
    [id]
  );
  return rows[0] || null;
};

exports.findCatalogItem = async (type, proposedName, connection = db) => {
  const normalized = normalizeName(proposedName);
  if (type === TYPES.DOMAIN) {
    const [rows] = await connection.execute('SELECT id_domaine, nom_domaine FROM domaine');
    return rows.find((row) => normalizeName(row.nom_domaine) === normalized) || null;
  }
  const [rows] = await connection.execute(
    'SELECT id_competence, nom_competence, id_domaine FROM competence'
  );
  return rows.find((row) => normalizeName(row.nom_competence) === normalized) || null;
};

/** Domaine imposé par le compte, jamais choisi arbitrairement dans la requête. */
exports.getUserSkillDomain = async (user, connection = db) => {
  if (user.role === 'candidat') {
    const [rows] = await connection.execute(
      `SELECT p.id_domaine, d.nom_domaine
       FROM profil_professionnel p
       JOIN domaine d ON d.id_domaine = p.id_domaine
       WHERE p.id_utilisateur = ?`,
      [user.id_utilisateur]
    );
    return rows[0] || null;
  }
  if (user.role === 'recruteur') {
    const [rows] = await connection.execute(
      `SELECT e.id_domaine, d.nom_domaine
       FROM entreprise e
       JOIN domaine d ON d.id_domaine = e.id_domaine
       WHERE e.id_utilisateur = ? AND e.status = 'approved'
       ORDER BY e.id_entreprise DESC LIMIT 1`,
      [user.id_utilisateur]
    );
    return rows[0] || null;
  }
  return null;
};

exports.findPendingDuplicate = async ({ userId, type, normalizedName, domainId }, connection = db) => {
  const [rows] = await connection.execute(
    `SELECT id_demande
     FROM demande_suggestion
     WHERE id_utilisateur = ? AND type_demande = ? AND nom_normalise = ?
       AND statut = 'EN_ATTENTE'
       AND ((id_domaine IS NULL AND ? IS NULL) OR id_domaine = ?)
     LIMIT 1 FOR UPDATE`,
    [userId, type, normalizedName, domainId, domainId]
  );
  return rows[0] || null;
};

exports.create = async (data, connection = db) => {
  const [result] = await connection.execute(
    `INSERT INTO demande_suggestion
       (id_utilisateur, type_demande, nom_propose, nom_normalise, id_domaine, description)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [data.userId, data.type, data.name, data.normalizedName, data.domainId || null, data.description || null]
  );
  return result.insertId;
};

exports.listMine = async (userId) => {
  const [rows] = await db.execute(
    `${detailedSelect}
     WHERE ds.id_utilisateur = ?
     ORDER BY ds.date_creation DESC, ds.id_demande DESC`,
    [userId]
  );
  return rows;
};

exports.listAdmin = async (query = {}) => {
  const where = [];
  const values = [];
  if (Object.values(STATUSES).includes(query.statut)) {
    where.push('ds.statut = ?');
    values.push(query.statut);
  }
  if (Object.values(TYPES).includes(query.type)) {
    where.push('ds.type_demande = ?');
    values.push(query.type);
  }
  const q = cleanName(query.q);
  if (q) {
    const like = `%${q}%`;
    where.push('(ds.nom_propose LIKE ? OR u.nom LIKE ? OR u.prenom LIKE ? OR u.email LIKE ? OR d.nom_domaine LIKE ?)');
    values.push(like, like, like, like, like);
  }
  const condition = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const [rows] = await db.execute(
    `${detailedSelect} ${condition}
     ORDER BY (ds.statut = 'EN_ATTENTE') DESC, ds.date_creation DESC, ds.id_demande DESC`,
    values
  );
  return rows;
};

exports.pendingCount = async () => {
  const [[row]] = await db.execute(
    "SELECT COUNT(*) AS total FROM demande_suggestion WHERE statut = 'EN_ATTENTE'"
  );
  return Number(row.total || 0);
};
