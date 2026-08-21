const db = require('../config/database');
const { pagination, listResult } = require('../utils/query');

const schema = {
  competences: { table: 'competence', id: 'id_competence', fields: ['nom_competence', 'description'], search: ['nom_competence'] },
  experiences: { table: 'experience_professionnelle', id: 'id_experience', fields: ['poste', 'entreprise', 'date_debut', 'date_fin', 'description'], owner: 'id_utilisateur', search: ['poste', 'entreprise'] },
  diplomes: { table: 'diplome', id: 'id_diplome', fields: ['intitule', 'etablissement', 'annee_obtention', 'date_debut', 'date_fin'], owner: 'id_utilisateur', search: ['intitule', 'etablissement'] },
  entreprises: { table: 'entreprise', id: 'id_entreprise', fields: ['nom_entreprise', 'secteur_activite', 'adresse', 'pays', 'ville', 'email', 'telephone', 'site_web', 'description', 'logo', 'numero_rccm', 'numero_fiscal', 'documents_justificatifs', 'status'], search: ['nom_entreprise'] },
  offres: { table: 'offre_emploi', id: 'id_offre', fields: ['titre_offre', 'description_offre', 'salaire', 'localisation', 'date_expiration', 'statut_offre'], owner: 'id_entreprise', search: ['titre_offre', 'localisation'] }
};
exports.schema = schema;
exports.list = async (name, query, extra = {}) => {
  const def = schema[name]; const { page, limit, offset } = pagination(query); const where = []; const values = [];
  if (extra.ownerField) { where.push(`${extra.ownerField} = ?`); values.push(extra.ownerId); }
  if (extra.companyVisibility) { where.push('status = ?'); values.push(extra.companyVisibility); }
  if (query.q && def.search) { where.push(`(${def.search.map((f) => `${f} LIKE ?`).join(' OR ')})`); values.push(...def.search.map(() => `%${query.q}%`)); }
  if (query.statut && name === 'offres') { where.push('statut_offre = ?'); values.push(query.statut); }
  const condition = where.length ? ` WHERE ${where.join(' AND ')}` : '';
  const order = def.fields.includes(query.sort) || query.sort === def.id ? query.sort : def.id;
  const direction = String(query.order).toUpperCase() === 'ASC' ? 'ASC' : 'DESC';
  const [rows] = await db.execute(`SELECT * FROM ${def.table}${condition} ORDER BY ${order} ${direction} LIMIT ? OFFSET ?`, [...values, limit, offset]);
  const [[{ total }]] = await db.execute(`SELECT COUNT(*) total FROM ${def.table}${condition}`, values);
  return listResult(rows, total, page, limit);
};
exports.get = async (name, id) => { const d = schema[name]; return (await db.execute(`SELECT * FROM ${d.table} WHERE ${d.id} = ?`, [id]))[0][0]; };
// Valeurs vides (« ») issues d'un formulaire → NULL : indispensable pour les
// champs optionnels (date_fin, annee_obtention, description…) afin d'éviter
// une erreur SQL « Incorrect date value » et de stocker des chaînes vides.
const fieldValue = (data, f) => (data[f] === '' ? null : data[f]);

exports.create = async (name, data, extra = {}) => { const d = schema[name]; const fields = d.fields.filter((f) => data[f] !== undefined); if (extra.ownerField) { fields.push(extra.ownerField); data[extra.ownerField] = extra.ownerId; } const [r] = await db.execute(`INSERT INTO ${d.table} (${fields.join(', ')}) VALUES (${fields.map(() => '?').join(', ')})`, fields.map((f) => fieldValue(data, f))); return exports.get(name, r.insertId); };
exports.update = async (name, id, data) => { const d = schema[name]; const fields = d.fields.filter((f) => data[f] !== undefined); if (!fields.length) return exports.get(name, id); await db.execute(`UPDATE ${d.table} SET ${fields.map((f) => `${f} = ?`).join(', ')} WHERE ${d.id} = ?`, [...fields.map((f) => fieldValue(data, f)), id]); return exports.get(name, id); };
exports.remove = async (name, id) => { const d = schema[name]; const [result] = await db.execute(`DELETE FROM ${d.table} WHERE ${d.id} = ?`, [id]); return result; };
