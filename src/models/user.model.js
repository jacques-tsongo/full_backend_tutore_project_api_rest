const db = require('../config/database');

const publicFields = 'id_utilisateur, nom, prenom, email, telephone, photo, role, date_inscription, statut_compte';
exports.publicFields = publicFields;
exports.findByEmail = async (email) => (await db.execute(`SELECT ${publicFields}, mot_de_passe FROM utilisateur WHERE email = ?`, [email]))[0][0];
exports.findById = async (id) => (await db.execute(`SELECT ${publicFields} FROM utilisateur WHERE id_utilisateur = ?`, [id]))[0][0];
exports.create = async ({ nom, prenom, email, password, telephone, role }) => {
  const [r] = await db.execute('INSERT INTO utilisateur (nom, prenom, email, mot_de_passe, telephone, role) VALUES (?, ?, ?, ?, ?, ?)', [nom, prenom, email, password, telephone || null, role]);
  return exports.findById(r.insertId);
};
exports.update = async (id, data) => {
  const allowed = ['nom', 'prenom', 'telephone', 'photo'];
  const fields = allowed.filter((k) => data[k] !== undefined);
  if (!fields.length) return exports.findById(id);
  await db.execute(`UPDATE utilisateur SET ${fields.map((f) => `${f} = ?`).join(', ')} WHERE id_utilisateur = ?`, [...fields.map((f) => data[f]), id]);
  return exports.findById(id);
};
