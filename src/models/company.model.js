const db = require('../config/database');

const selectCompany = `
  SELECT e.*, u.nom, u.prenom, u.email AS email_utilisateur, u.role
  FROM entreprise e
  LEFT JOIN utilisateur u ON u.id_utilisateur = e.id_utilisateur
`;

const frenchStatus = {
  pending: 'En attente',
  approved: 'Validée',
  rejected: 'Rejetée'
};

const normalizePayload = (body, files = {}) => {
  const documents = [
    ...(files.documents || []),
    ...(files.supporting_documents || [])
  ].map((file) => `/uploads/companies/${file.filename}`);

  return {
    nom_entreprise: body.nom_entreprise || body.company_name || body.name,
    secteur_activite: body.secteur_activite || body.business_sector || body.sector,
    adresse: body.adresse || body.address,
    pays: body.pays || body.country,
    ville: body.ville || body.city,
    telephone: body.telephone || body.phone,
    email: body.email,
    site_web: body.site_web || body.website,
    description: body.description || body.company_description,
    logo: files.logo?.[0] ? `/uploads/companies/${files.logo[0].filename}` : body.logo,
    numero_rccm: body.numero_rccm || body.registration_number || body.rccm,
    numero_fiscal: body.numero_fiscal || body.tax_number,
    documents_justificatifs: documents.length ? JSON.stringify(documents) : body.documents_justificatifs
  };
};

exports.normalizePayload = normalizePayload;

exports.hasOpenRequest = async (userId) => {
  const [rows] = await db.execute(
    "SELECT id_entreprise, status FROM entreprise WHERE id_utilisateur = ? AND status IN ('pending', 'approved') LIMIT 1",
    [userId]
  );
  return rows[0];
};

exports.createPending = async (userId, data) => {
  const fields = [
    'nom_entreprise',
    'secteur_activite',
    'adresse',
    'pays',
    'ville',
    'telephone',
    'email',
    'site_web',
    'description',
    'logo',
    'numero_rccm',
    'numero_fiscal',
    'documents_justificatifs',
    'id_utilisateur',
    'status',
    'statut_validation'
  ];
  const values = [
    data.nom_entreprise,
    data.secteur_activite,
    data.adresse,
    data.pays,
    data.ville,
    data.telephone,
    data.email,
    data.site_web || null,
    data.description,
    data.logo || null,
    data.numero_rccm,
    data.numero_fiscal || null,
    data.documents_justificatifs || null,
    userId,
    'pending',
    frenchStatus.pending
  ];
  const [result] = await db.execute(
    `INSERT INTO entreprise (${fields.join(', ')}) VALUES (${fields.map(() => '?').join(', ')})`,
    values
  );
  return exports.findById(result.insertId);
};

exports.findPending = async () => {
  const [rows] = await db.execute(`${selectCompany} WHERE e.status = 'pending' ORDER BY e.id_entreprise DESC`);
  return rows;
};

exports.findApprovedByOwner = async (userId) => {
  const [rows] = await db.execute(`${selectCompany} WHERE e.id_utilisateur = ? AND e.status = 'approved' LIMIT 1`, [userId]);
  return rows[0];
};

exports.findByOwner = async (userId) => {
  const [rows] = await db.execute(`${selectCompany} WHERE e.id_utilisateur = ? ORDER BY e.id_entreprise DESC`, [userId]);
  return rows;
};

exports.findById = async (id) => {
  const [rows] = await db.execute(`${selectCompany} WHERE e.id_entreprise = ?`, [id]);
  return rows[0];
};

/**
 * Champs qu'un propriétaire (recruteur) ou un administrateur peut modifier.
 * Le statut de validation reste exclusif au workflow admin (approve/reject).
 */
const EDITABLE_FIELDS = [
  'nom_entreprise',
  'secteur_activite',
  'adresse',
  'ville',
  'pays',
  'telephone',
  'email',
  'site_web',
  'description',
  'logo',
  'numero_rccm',
  'numero_fiscal'
];

exports.EDITABLE_FIELDS = EDITABLE_FIELDS;

/**
 * Met à jour les informations de l'entreprise (jamais son statut de validation).
 */
exports.updateOwn = async (id, data) => {
  const fields = EDITABLE_FIELDS.filter((f) => data[f] !== undefined);
  if (!fields.length) return exports.findById(id);
  await db.execute(
    `UPDATE entreprise SET ${fields.map((f) => `${f} = ?`).join(', ')} WHERE id_entreprise = ?`,
    [...fields.map((f) => data[f]), id]
  );
  return exports.findById(id);
};

exports.setStatus = async (id, status, adminId = null, connection = db) => {
  const approvedAt = status === 'approved' ? new Date() : null;
  const approvedBy = status === 'approved' ? adminId : null;
  await connection.execute(
    'UPDATE entreprise SET status = ?, statut_validation = ?, approved_by = ?, approved_at = ? WHERE id_entreprise = ?',
    [status, frenchStatus[status], approvedBy, approvedAt, id]
  );
};

/**
 * Approuve une entreprise et promeut son propriétaire au rôle recruteur,
 * dans une transaction. Retourne l'entreprise mise à jour.
 */
exports.approve = async (id, adminId) => {
  const company = await exports.findById(id);
  if (!company) return null;
  if (!company.id_utilisateur) throw new Error('Cette entreprise n’est liée à aucun utilisateur candidat.');
  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();
    await exports.setStatus(id, 'approved', adminId, connection);
    await connection.execute('UPDATE utilisateur SET role = ? WHERE id_utilisateur = ?', ['recruteur', company.id_utilisateur]);
    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
  return exports.findById(id);
};

/**
 * Rejette une entreprise (le propriétaire reste candidat).
 */
exports.reject = async (id, adminId = null) => {
  const company = await exports.findById(id);
  if (!company) return null;
  await exports.setStatus(id, 'rejected', adminId);
  return exports.findById(id);
};
