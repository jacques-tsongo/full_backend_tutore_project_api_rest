/**
 * Règles d'accès aux fichiers privés.
 *
 * Un fichier n'est jamais servi parce qu'on connaît son identifiant : la route
 * GET /files/:id vérifie d'abord que l'utilisateur authentifié a le droit de le
 * consulter. Un refus est toujours renvoyé en 404 afin de ne pas révéler
 * l'existence d'un fichier appartenant à quelqu'un d'autre.
 *
 * Politique par catégorie :
 * - PHOTO / COUVERTURE : visibles par tout utilisateur authentifié (avatar et
 *   bannière affichés dans l'annuaire, les candidatures, la messagerie) ;
 * - LOGO : visible par tout utilisateur authentifié (annuaire des entreprises) ;
 * - CV : propriétaire, administrateur, et recruteur d'une entreprise approuvée
 *   à laquelle le candidat a réellement postulé ;
 * - JUSTIFICATIF : propriétaire et administrateur uniquement.
 */
const db = require('../config/database');

const VISIBLE_TO_AUTHENTICATED = new Set(['PHOTO', 'COUVERTURE', 'LOGO']);

const hasLegitimateApplication = async (candidateId, recruiterId) => {
  const [rows] = await db.execute(
    `SELECT 1
     FROM candidature c
     JOIN offre_emploi o ON o.id_offre = c.id_offre
     JOIN entreprise e ON e.id_entreprise = o.id_entreprise
     WHERE c.id_utilisateur = ? AND e.id_utilisateur = ? AND e.status = 'approved'
     LIMIT 1`,
    [candidateId, recruiterId]
  );
  return rows.length > 0;
};

/**
 * @param {{id_utilisateur:number,categorie:string}} file
 * @param {{id_utilisateur:number,role:string}} user
 * @param {{hasLegitimateApplication?:Function}} deps injection de test
 */
const canAccess = async (file, user, deps = {}) => {
  if (!file || !user) return false;
  if (Number(file.id_utilisateur) === Number(user.id_utilisateur)) return true;
  if (user.role === 'administrateur') return true;
  if (VISIBLE_TO_AUTHENTICATED.has(file.categorie)) return true;
  if (file.categorie === 'CV' && user.role === 'recruteur') {
    const check = deps.hasLegitimateApplication || hasLegitimateApplication;
    return Boolean(await check(file.id_utilisateur, user.id_utilisateur));
  }
  return false;
};

const findById = async (id) => {
  const [rows] = await db.execute(
    `SELECT id_fichier, id_utilisateur, categorie, chemin, nom_original, type_mime, taille, date_creation
     FROM fichier WHERE id_fichier = ?`,
    [id]
  );
  return rows[0] || null;
};

module.exports = {
  VISIBLE_TO_AUTHENTICATED,
  hasLegitimateApplication,
  canAccess,
  findById
};
