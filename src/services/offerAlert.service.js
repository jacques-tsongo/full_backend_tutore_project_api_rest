/**
 * Alerte « offre proche de l'expiration » (tâche planifiée légère).
 *
 * Le projet ne disposait d'aucun système cron : cette tâche utilise un simple
 * setInterval (aucune dépendance supplémentaire), démarré par src/server.js
 * après la connexion MySQL. Elle reste volontairement simple et lisible
 * (projet universitaire).
 *
 * À chaque passage (une fois par heure, premier passage peu après le
 * démarrage), la tâche :
 *   1. identifie les offres « Ouverte », non expirées, qui expirent dans les
 *      EXPIRY_WINDOW_DAYS prochains jours ;
 *   2. vérifie qu'elles ont AU MOINS une candidature active (≠ Annulée) et
 *      qu'aucune candidature n'a déjà été acceptée (offre non pourvue) ;
 *   3. notifie le recruteur propriétaire de l'entreprise, avec une référence
 *      OFFRE + id → la notification ouvre la page des candidatures de l'offre
 *      (les mieux classées en premier).
 *
 * ANTI-DOUBLON : avant chaque création, la table `notification` est
 * consultée — si une notification OFFRE_EXPIRE_BIENTOT existe déjà pour cette
 * offre depuis sa dernière date de modification de période (fenêtre
 * courante), rien n'est recréé. Une notification est donc envoyée UNE seule
 * fois par offre et par fenêtre d'expiration.
 */
const db = require('../config/database');
const notify = require('./notification.service');

const EXPIRY_WINDOW_DAYS = 3;            // « proche de l'expiration » = ≤ 3 jours.
const CHECK_INTERVAL_MS = 60 * 60 * 1000; // Vérification toutes les heures.

let timer = null;

/** Une passe de vérification (exportée pour les tests : aucune horloge requise). */
const runOnce = async () => {
  // Offres ouvertes qui expirent entre aujourd'hui et J+3, avec au moins une
  // candidature active et sans candidature acceptée (offre non pourvue).
  const [offers] = await db.execute(
    `SELECT o.id_offre, o.titre_offre, o.date_expiration, e.id_utilisateur AS id_recruteur,
            COUNT(c.id_candidature) AS nb_candidatures
     FROM offre_emploi o
     JOIN entreprise e ON e.id_entreprise = o.id_entreprise AND e.status = 'approved'
     JOIN candidature c ON c.id_offre = o.id_offre AND c.statut_candidature != 'Annulée'
     WHERE o.statut_offre = 'Ouverte'
       AND o.date_expiration >= CURDATE()
       AND o.date_expiration <= DATE_ADD(CURDATE(), INTERVAL ? DAY)
       AND e.id_utilisateur IS NOT NULL
       AND NOT EXISTS (
         SELECT 1 FROM candidature a
         WHERE a.id_offre = o.id_offre AND a.statut_candidature = 'Acceptée'
       )
     GROUP BY o.id_offre, o.titre_offre, o.date_expiration, e.id_utilisateur`,
    [EXPIRY_WINDOW_DAYS]
  );

  let created = 0;
  for (const offer of offers) {
    // Anti-doublon : une seule alerte par offre et par fenêtre d'expiration.
    // La fenêtre s'ouvre EXPIRY_WINDOW_DAYS jours avant la date d'expiration :
    // toute notification déjà émise depuis ce moment bloque la recréation
    // (y compris si elle a été lue — pas de renvoi en boucle).
    const [dup] = await db.execute(
      `SELECT id_notification FROM notification
       WHERE id_utilisateur = ? AND type_notification = 'OFFRE_EXPIRE_BIENTOT'
         AND type_reference = 'OFFRE' AND id_reference = ?
         AND date_notification >= DATE_SUB(?, INTERVAL ? DAY)`,
      [offer.id_recruteur, offer.id_offre, offer.date_expiration, EXPIRY_WINDOW_DAYS]
    );
    if (dup[0]) continue;

    await notify.create(
      offer.id_recruteur,
      `Votre offre « ${offer.titre_offre} » arrive bientôt à expiration `
        + `(${offer.nb_candidatures} candidature${Number(offer.nb_candidatures) > 1 ? 's' : ''}). `
        + 'Consultez les candidatures les plus compatibles.',
      { type: 'OFFRE_EXPIRE_BIENTOT', referenceType: 'OFFRE', referenceId: offer.id_offre }
    );
    created += 1;
  }
  return { checked: offers.length, created };
};

/** Démarre la vérification périodique (premier passage 15 s après le boot). */
const start = () => {
  if (timer) return timer;
  const safeRun = () => runOnce().catch((err) => {
    // La tâche ne doit jamais faire tomber le serveur.
    console.error('Alerte offres proches de l\'expiration :', err.message || err);
  });
  setTimeout(safeRun, 15 * 1000);
  timer = setInterval(safeRun, CHECK_INTERVAL_MS);
  // unref : le timer n'empêche pas l'arrêt propre du processus (tests, CLI).
  if (typeof timer.unref === 'function') timer.unref();
  return timer;
};

const stop = () => { if (timer) { clearInterval(timer); timer = null; } };

module.exports = { start, stop, runOnce, EXPIRY_WINDOW_DAYS, CHECK_INTERVAL_MS };
