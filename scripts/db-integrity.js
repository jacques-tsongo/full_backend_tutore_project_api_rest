/**
 * Contrôle préalable des contraintes d'intégrité (lecture seule).
 *
 * La migration `20261107_02_contraintes.sql` ajoute des CHECK en base. Comme
 * MySQL refuse d'ajouter une contrainte si des lignes existantes la violent,
 * ce script affiche d'abord un rapport lisible : nombre de lignes à corriger
 * par règle, sans rien modifier ni supprimer.
 *
 * Exécution : npm run db:check
 * Sortie     : code 1 si au moins une violation est détectée.
 */
require('dotenv').config();
const mysql = require('mysql2/promise');

const CHECKS = [
  {
    name: 'chk_message_not_self',
    label: 'message : un message ne peut pas s’auto-adresser',
    sql: 'SELECT COUNT(*) AS violations FROM message WHERE id_expediteur = id_destinataire'
  },
  {
    name: 'chk_matching_score_range',
    label: 'matching : score de compatibilité hors de [0, 100]',
    sql: 'SELECT COUNT(*) AS violations FROM matching WHERE score_compatibilite < 0 OR score_compatibilite > 100'
  },
  {
    name: 'chk_experience_dates',
    label: 'expérience : date_fin antérieure à date_debut',
    sql: 'SELECT COUNT(*) AS violations FROM experience_professionnelle WHERE date_fin IS NOT NULL AND date_fin < date_debut'
  },
  {
    name: 'chk_diplome_dates',
    label: 'diplôme : date_fin antérieure à date_debut',
    sql: 'SELECT COUNT(*) AS violations FROM diplome WHERE date_debut IS NOT NULL AND date_fin IS NOT NULL AND date_fin < date_debut'
  },
  {
    name: 'chk_offre_dates',
    label: 'offre : expiration antérieure au jour de publication',
    sql: 'SELECT COUNT(*) AS violations FROM offre_emploi WHERE date_expiration < DATE(date_publication)'
  },
  {
    name: 'chk_offre_salaire',
    label: 'offre : salaire négatif',
    sql: 'SELECT COUNT(*) AS violations FROM offre_emploi WHERE salaire IS NOT NULL AND salaire < 0'
  },
  {
    name: 'chk_entreprise_status_coherent',
    label: 'entreprise : status et statut_validation incohérents',
    sql: `SELECT COUNT(*) AS violations FROM entreprise
          WHERE NOT (
            (status = 'pending' AND statut_validation = 'En attente')
            OR (status = 'approved' AND statut_validation = 'Validée')
            OR (status = 'rejected' AND statut_validation = 'Rejetée')
          )`
  },
  {
    name: 'chk_fichier_taille',
    label: 'fichier : taille nulle ou négative',
    sql: 'SELECT COUNT(*) AS violations FROM fichier WHERE taille <= 0'
  }
];

const run = async () => {
  const { DB_HOST: host, DB_USER: user, DB_PASSWORD: password, DB_NAME: database } = process.env;
  if (!host || !user || !database) {
    console.error('Variables DB_* manquantes dans .env (DB_HOST, DB_USER, DB_NAME).');
    process.exit(1);
  }

  const connection = await mysql.createConnection({
    host,
    port: Number(process.env.DB_PORT || 3306),
    user,
    password,
    database,
    connectTimeout: Number(process.env.DB_CONNECT_TIMEOUT || 10000)
  });

  let total = 0;
  let errors = 0;
  try {
    console.log(`Contrôle d'intégrité de la base « ${database} »`);
    for (const check of CHECKS) {
      try {
        const [[{ violations }]] = await connection.query(check.sql);
        const count = Number(violations) || 0;
        total += count;
        if (count === 0) console.log(`  OK    ${check.label}`);
        else console.log(`  ECHEC ${check.label} — ${count} ligne(s) à corriger`);
      } catch (error) {
        errors += 1;
        console.log(`  ERREUR ${check.label} — ${error.code || error.message}`);
      }
    }
  } finally {
    await connection.end();
  }

  if (errors || total) {
    console.error(`\n${total} violation(s), ${errors} erreur(s).`);
    console.error('Corrigez les données signalées, puis relancez : npm run migrate');
    process.exitCode = 1;
  } else {
    console.log('\nAucune violation : les contraintes peuvent être appliquées (npm run migrate).');
  }
};

module.exports = { CHECKS };

if (require.main === module) {
  run().catch((error) => {
    console.error('Échec du contrôle d’intégrité :', error.code || error.message || error);
    process.exit(1);
  });
}
