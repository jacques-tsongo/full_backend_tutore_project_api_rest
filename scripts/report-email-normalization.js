/**
 * Rapport en LECTURE SEULE des adresses e-mail non normalisées.
 *
 * Liste les comptes dont la valeur stockée diffère de `LOWER(TRIM(email))`
 * (majuscules ou espaces parasites). La comparaison `BINARY` est volontaire :
 * la collation `utf8mb4_unicode_ci` est insensible à la casse et ne
 * distinguerait pas « Jean@… » de « jean@… ».
 *
 * Aucune donnée n'est modifiée, aucun e-mail n'est réécrit ici.
 *
 * Exécution : node scripts/report-email-normalization.js
 */
require('dotenv').config();
const db = require('../src/config/database');

(async () => {
  try {
    const [rows] = await db.execute(
      `SELECT id_utilisateur, email, LOWER(TRIM(email)) AS email_normalise
       FROM utilisateur
       WHERE BINARY email <> LOWER(TRIM(email))
       ORDER BY id_utilisateur`
    );

    if (!rows.length) {
      console.log('Aucune adresse e-mail à normaliser : toutes les valeurs sont déjà en minuscules sans espaces.');
      return;
    }

    console.log(`${rows.length} adresse(s) dont la valeur diffère de LOWER(TRIM(email)) :`);
    for (const row of rows) {
      console.log(`  #${row.id_utilisateur}  « ${row.email} »  →  « ${row.email_normalise} »`);
    }
    console.log('\nScript en LECTURE SEULE : aucune donnée n’a été modifiée.');
  } catch (error) {
    console.error('Impossible de lire la table utilisateur :', error.message || error.code || error);
    process.exitCode = 1;
  } finally {
    await db.end().catch(() => {});
  }
})();
