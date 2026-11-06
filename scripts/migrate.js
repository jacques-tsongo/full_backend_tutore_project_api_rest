/**
 * Application des migrations de base de données (une seule fois chacune).
 *
 * Pourquoi ce script existe :
 * - les migrations étaient appliquées « à la main » avec `mysql < fichier.sql`,
 *   sans aucun suivi : impossible de savoir ce qui avait déjà été exécuté, ni
 *   d'appliquer uniquement les nouvelles migrations lors d'un déploiement ;
 * - ce script enregistre chaque migration appliquée dans la table
 *   `schema_migrations` et ignore les fichiers déjà enregistrés.
 *
 * Fonctionnement :
 * - lit database/migrations/*.sql triés par ordre alphabétique (le préfixe
 *   date/heure garantit l'ordre chronologique) ;
 * - crée la table de suivi si elle n'existe pas (amorçage) ;
 * - applique uniquement les migrations non enregistrées, une par une ;
 * - s'arrête à la première erreur SANS enregistrer la migration fautive,
 *   afin qu'elle puisse être corrigée puis rejouée ;
 * - affiche un rapport final (appliquées, déjà présentes, orphelines).
 *
 * Options :
 *   --dry-run / --status : n'applique rien, affiche seulement l'état.
 *
 * Les fichiers restent exécutables manuellement, mais `npm run migrate` est
 * désormais la manière recommandée (et suivie).
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');

const MIGRATIONS_DIR = path.join(process.cwd(), 'database', 'migrations');
const TRACKING_TABLE = 'schema_migrations';

const args = new Set(process.argv.slice(2));
const DRY_RUN = args.has('--dry-run') || args.has('--status');

const log = (message) => console.log(message);

const listMigrationFiles = () => {
  if (!fs.existsSync(MIGRATIONS_DIR)) {
    throw new Error(`Dossier introuvable : ${MIGRATIONS_DIR}`);
  }
  return fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((name) => name.toLowerCase().endsWith('.sql'))
    .sort((a, b) => a.localeCompare(b, 'en'));
};

const ensureTrackingTable = async (connection) => {
  await connection.query(`
    CREATE TABLE IF NOT EXISTS ${TRACKING_TABLE} (
      nom VARCHAR(190) NOT NULL PRIMARY KEY,
      applique_le DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB
  `);
};

/**
 * Les fichiers contiennent `USE gestion_carrieres;` en dur. On le réécrit vers
 * la base réellement configurée pour éviter d'appliquer la migration ailleurs
 * que dans DB_NAME (le reste du fichier n'est pas modifié).
 */
const bindDatabaseName = (sql, database) =>
  sql.replace(/^[ \t]*USE[ \t]+`?gestion_carrieres`?[ \t]*;/gim, `USE \`${database}\`;`);

const run = async () => {
  const { DB_HOST: host, DB_USER: user, DB_PASSWORD: password, DB_NAME: database } = process.env;

  if (!host || !user || !database) {
    console.error('Variables DB_* manquantes dans .env (DB_HOST, DB_USER, DB_NAME).');
    process.exit(1);
  }
  if (!/^[A-Za-z0-9_]+$/.test(database)) {
    console.error(`Nom de base invalide : « ${database} ».`);
    process.exit(1);
  }

  const files = listMigrationFiles();

  const connection = await mysql.createConnection({
    host,
    port: Number(process.env.DB_PORT || 3306),
    user,
    password,
    database,
    multipleStatements: true, // chaque migration contient plusieurs instructions
    connectTimeout: Number(process.env.DB_CONNECT_TIMEOUT || 10000)
  });

  try {
    await ensureTrackingTable(connection);

    const [rows] = await connection.query(
      `SELECT nom, applique_le FROM ${TRACKING_TABLE} ORDER BY nom`
    );
    const applied = new Map(rows.map((row) => [row.nom, row.applique_le]));

    const pending = files.filter((name) => !applied.has(name));
    const orphaned = [...applied.keys()].filter((name) => !files.includes(name));

    log(`Base : ${database} — ${files.length} migration(s) sur disque, ${applied.size} enregistrée(s).`);

    if (orphaned.length > 0) {
      log('\nAttention : migrations enregistrées mais absentes du disque :');
      orphaned.forEach((name) => log(`  - ${name}`));
    }

    if (pending.length === 0) {
      log('Aucune migration en attente.');
    } else if (DRY_RUN) {
      log(`\n${pending.length} migration(s) en attente :`);
      pending.forEach((name) => log(`  - ${name}`));
      log('\nMode lecture seule : aucune migration appliquée.');
    } else {
      log(`\nApplication de ${pending.length} migration(s)...`);
      for (const name of pending) {
        const sqlPath = path.join(MIGRATIONS_DIR, name);
        const sql = bindDatabaseName(fs.readFileSync(sqlPath, 'utf8'), database);
        const startedAt = Date.now();
        try {
          await connection.query(sql);
          await connection.query(
            `INSERT INTO ${TRACKING_TABLE} (nom) VALUES (?)`,
            [name]
          );
          log(`  OK   ${name} (${Date.now() - startedAt} ms)`);
        } catch (error) {
          console.error(`  ECHEC ${name}`);
          console.error(`        ${error.code || ''} ${error.sqlMessage || error.message}`);
          console.error('        Migration non enregistrée : corrigez le fichier puis relancez.');
          process.exitCode = 1;
          return;
        }
      }
      log('\nToutes les migrations en attente ont été appliquées.');
    }

    if (rows.length > 0) {
      log('\nHistorique :');
      rows.forEach((row) => {
        const date = new Date(row.applique_le).toISOString().replace('T', ' ').slice(0, 19);
        log(`  ${date}  ${row.nom}`);
      });
    }
  } finally {
    await connection.end();
  }
};

module.exports = {
  MIGRATIONS_DIR,
  TRACKING_TABLE,
  listMigrationFiles,
  bindDatabaseName
};

if (require.main === module) {
  run().catch((error) => {
    if (error.code === 'ER_BAD_DB_ERROR') {
      console.error(
        `La base « ${process.env.DB_NAME} » n'existe pas. Créez-la d'abord avec database/schema.sql.`
      );
    } else {
      console.error('Échec des migrations :', error.code || error.message || error);
    }
    process.exit(1);
  });
}
