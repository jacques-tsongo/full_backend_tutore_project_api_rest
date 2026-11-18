const db = require('../config/database');

const publicFields = 'id_utilisateur, nom, prenom, email, telephone, photo, photo_couverture, role, date_inscription, statut_compte, email_verifie';
exports.publicFields = publicFields;
exports.findByEmail = async (email) => (await db.execute(`SELECT ${publicFields}, mot_de_passe FROM utilisateur WHERE email = ?`, [email]))[0][0];
exports.findById = async (id, connection = db) => (await connection.execute(`SELECT ${publicFields} FROM utilisateur WHERE id_utilisateur = ?`, [id]))[0][0];

/**
 * Création d'un compte.
 *
 * Réservé à `signup.service#createVerifiedUser` (après validation du code) et
 * aux scripts d'administration hors application. Aucune route ne doit appeler
 * cette fonction directement : un compte ne peut pas exister sans que son
 * adresse e-mail ait été vérifiée par code.
 */
exports.create = async ({
  nom, prenom, email, password, telephone, role = 'candidat',
  photo = null, photoCouverture = null, emailVerifie = 1, connection = db
}) => {
  const verifie = Number(emailVerifie) === 1 ? 1 : 0;
  const [r] = await connection.execute(
    `INSERT INTO utilisateur
       (nom, prenom, email, mot_de_passe, telephone, role, photo, photo_couverture, email_verifie, email_verifie_le)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, IF(?, NOW(), NULL))`,
    [nom, prenom, email, password, telephone || null, role, photo, photoCouverture, verifie, verifie]
  );
  return exports.findById(r.insertId, connection);
};
exports.updateRole = async (id, role, connection = db) => {
  await connection.execute('UPDATE utilisateur SET role = ? WHERE id_utilisateur = ?', [role, id]);
  return exports.findById(id);
};
exports.updatePassword = async (id, hashedPassword) => {
  await db.execute('UPDATE utilisateur SET mot_de_passe = ? WHERE id_utilisateur = ?', [hashedPassword, id]);
  return exports.findById(id);
};

exports.update = async (id, data) => {
  const allowed = ['nom', 'prenom', 'telephone'];
  const fields = allowed.filter((k) => data[k] !== undefined);
  if (!fields.length) return exports.findById(id);
  await db.execute(`UPDATE utilisateur SET ${fields.map((f) => `${f} = ?`).join(', ')} WHERE id_utilisateur = ?`, [...fields.map((f) => data[f]), id]);
  return exports.findById(id);
};
// Les fichiers d'apparence ne sont modifiables que par les contrôleurs de
// téléversement, avec une URL générée côté serveur (`/files/:id`). Le corps
// d'une requête client ne peut donc jamais les définir.
exports.updateAppearance = async (id, data) => {
  const allowed = ['photo', 'photo_couverture'];
  const fields = allowed.filter((k) => data[k] !== undefined);
  if (!fields.length) return exports.findById(id);
  await db.execute(`UPDATE utilisateur SET ${fields.map((f) => `${f} = ?`).join(', ')} WHERE id_utilisateur = ?`, [...fields.map((f) => data[f]), id]);
  return exports.findById(id);
};
