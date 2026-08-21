/**
 * Seed EXPLICITE de la base (développement / tests uniquement).
 *
 * Pourquoi ce script existe :
 * - l'insertion automatique de données au démarrage du serveur a été proscrite ;
 * - les données de démonstration restent utiles pour tester, mais elles ne
 *   doivent être injectées que sur action volontaire :
 *       npm run seed
 *   (jamais exécuté par `npm start` / `npm run dev` — voir src/server.js).
 *
 * Fonctionnement :
 * - lit database/seed.sql (jeu de données idempotent : INSERT ... WHERE NOT
 *   EXISTS, il peut être rejoué sans doublon ni erreur) ;
 * - l'exécute dans la base configurée par .env via le pool mysql2 existant ;
 * - n'utilise aucun fichier temporaire : les requêtes sont transmises telles
 *   quelles au serveur MySQL (multi-statements).
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');

const run = async () => {
  const [host, user, password, database] = [
    process.env.DB_HOST,
    process.env.DB_USER,
    process.env.DB_PASSWORD,
    process.env.DB_NAME
  ];

  if (!host || !user || !database) {
    console.error('Variables DB_* manquantes dans .env (DB_HOST, DB_USER, DB_NAME).');
    process.exit(1);
  }

  const sqlPath = path.join(process.cwd(), 'database', 'seed.sql');
  if (!fs.existsSync(sqlPath)) {
    console.error(`Fichier introuvable : ${sqlPath}`);
    process.exit(1);
  }

  const connection = await mysql.createConnection({
    host,
    port: Number(process.env.DB_PORT || 3306),
    user,
    password,
    database,
    multipleStatements: true, // le fichier seed.sql contient plusieurs instructions
    connectTimeout: Number(process.env.DB_CONNECT_TIMEOUT || 10000)
  });

  try {
    const sql = fs.readFileSync(sqlPath, 'utf8');
    await connection.query(sql);
    console.log(`Seed appliqué avec succès sur la base « ${database} ».`);
    console.log('Comptes de démonstration : admin@example.com / Admin123!,');
    console.log('recruteur@example.com / Recruteur123!, candidat@example.com / Candidat123!.');
  } finally {
    await connection.end();
  }
};

run().catch((err) => {
  console.error('Échec du seed :', err.code || err.message || err);
  process.exit(1);
});