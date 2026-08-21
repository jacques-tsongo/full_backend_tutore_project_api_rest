/* LinkEmploi — nettoyage des fixtures E2E (jean.mbala@test.com /
   aline.kabila@test.com + dépendances). Permet de relancer
   `npm run test:e2e` proprement après un run interrompu. */
require('dotenv').config();
const mysql = require('mysql2/promise');

(async () => {
  const con = await mysql.createConnection({
    host: process.env.DB_HOST || '127.0.0.1',
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'gestion_carrieres'
  });
  const [ids] = await con.execute(
    "SELECT id_utilisateur FROM utilisateur WHERE email IN ('jean.mbala@test.com','aline.kabila@test.com')"
  );
  if (!ids.length) { console.log('RIEN_A_SUPPRIMER'); process.exit(0); }
  const list = ids.map((r) => r.id_utilisateur).join(',');
  const q = async (sql) => { const [r] = await con.execute(sql); console.log(sql.slice(0, 50), '->', r.affectedRows); };
  await q(`DELETE FROM message WHERE id_expediteur IN (${list}) OR id_destinataire IN (${list})`);
  await q(`DELETE FROM notification WHERE id_utilisateur IN (${list})`);
  await q(`DELETE FROM matching WHERE id_utilisateur IN (${list})`);
  await q(`DELETE FROM candidature WHERE id_utilisateur IN (${list})`);
  await q(`DELETE FROM utilisateur_competence WHERE id_utilisateur IN (${list})`);
  await q(`DELETE FROM experience_professionnelle WHERE id_utilisateur IN (${list})`);
  await q(`DELETE FROM diplome WHERE id_utilisateur IN (${list})`);
  await q(`DELETE FROM profil_professionnel WHERE id_utilisateur IN (${list})`);
  const [cos] = await con.execute(`SELECT id_entreprise AS id FROM entreprise WHERE id_utilisateur IN (${list})`);
  if (cos.length) {
    const c = cos.map((r) => r.id).join(',');
    const [offers] = await con.execute(`SELECT id_offre AS id FROM offre_emploi WHERE id_entreprise IN (${c})`);
    if (offers.length) {
      const o = offers.map((r) => r.id).join(',');
      await q(`DELETE FROM offre_competence WHERE id_offre IN (${o})`);
      await q(`DELETE FROM matching WHERE id_offre IN (${o})`);
      await q(`DELETE FROM candidature WHERE id_offre IN (${o})`);
      await q(`DELETE FROM offre_emploi WHERE id_offre IN (${o})`);
    }
    await q(`DELETE FROM entreprise WHERE id_entreprise IN (${c})`);
  }
  await q(`DELETE FROM utilisateur WHERE id_utilisateur IN (${list})`);
  await con.end();
})().catch((e) => { console.error(e.message); process.exit(1); });