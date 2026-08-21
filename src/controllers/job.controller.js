const db = require('../config/database');
const { success, fail } = require('../utils/apiResponse');
const asyncHandler = require('../utils/asyncHandler');
const matching = require('../services/matching.service');
const notify = require('../services/notification.service');
const socket = require('../socket');
const Company = require('../models/company.model');

const recruiterCompany = (userId) => Company.findApprovedByOwner(userId);

exports.setSkills = asyncHandler(async (req, res) => {
  const company = await recruiterCompany(req.user.id_utilisateur);
  if (!company || company.status !== 'approved') return fail(res, 'Entreprise approuvée et profil recruteur requis.', [], 403);
  const [offer] = await db.execute('SELECT id_offre FROM offre_emploi WHERE id_offre=? AND id_entreprise=?', [req.params.id, company.id_entreprise]);
  if (!offer[0]) return fail(res, 'Offre introuvable.', [], 404);
  await db.execute('DELETE FROM offre_competence WHERE id_offre = ?', [req.params.id]);
  for (const skill of req.body.competences || []) {
    await db.execute('INSERT INTO offre_competence (id_offre, id_competence, niveau_requis) VALUES (?, ?, ?)', [req.params.id, skill.id_competence, skill.niveau_requis]);
  }
  success(res, 'Compétences requises mises à jour.');
});

exports.apply = asyncHandler(async (req, res) => {
  const id = req.params.id;
  // Une offre « pourvue » (candidature déjà acceptée) ou expirée n'accepte
  // plus aucune candidature : le contrôle porte sur la base, pas sur l'affichage.
  const [offer] = await db.execute(
    `SELECT o.* FROM offre_emploi o
     WHERE o.id_offre=? AND o.statut_offre='Ouverte' AND o.date_expiration >= CURDATE()
       AND NOT EXISTS (SELECT 1 FROM candidature c WHERE c.id_offre = o.id_offre AND c.statut_candidature = 'Acceptée')`,
    [id]
  );
  if (!offer[0]) return fail(res, 'Offre indisponible.', [], 404);
  // Règle métier : une seule candidature par offre (la contrainte uq_candidature
  // reste le garde-fou d'intégrité ; ici un message métier explicite).
  const [existing] = await db.execute('SELECT id_candidature FROM candidature WHERE id_utilisateur = ? AND id_offre = ?', [req.user.id_utilisateur, id]);
  if (existing[0]) return fail(res, 'Vous avez déjà postulé à cette offre.', [], 409);
  const lettre = req.body.lettre_motivation ?? req.body.lettreMotivation ?? null;
  const [r] = await db.execute(
    'INSERT INTO candidature (id_utilisateur, id_offre, lettre_motivation) VALUES (?, ?, ?)',
    [req.user.id_utilisateur, id, lettre]
  );
  const score = await matching.calculate(req.user.id_utilisateur, id);
  const [recruiters] = await db.execute("SELECT id_utilisateur FROM entreprise WHERE id_entreprise = ? AND status = 'approved'", [offer[0].id_entreprise]);
  await Promise.all(recruiters.map((x) => notify.create(x.id_utilisateur, `Nouvelle candidature pour « ${offer[0].titre_offre} ».`)));
  // Temps réel : chaque recruteur de l'entreprise reçoit la candidature complète
  // (room privée user_x — jamais diffusée aux autres utilisateurs).
  const [application] = await db.execute(
    `SELECT c.*, u.nom, u.prenom, u.email, u.telephone, u.photo, p.cv, p.bio,
            o.titre_offre, o.localisation, m.score_compatibilite,
            (SELECT GROUP_CONCAT(CONCAT(comp.nom_competence, ' (', uc.niveau_competence, ')') SEPARATOR ', ')
             FROM utilisateur_competence uc JOIN competence comp ON comp.id_competence = uc.id_competence
             WHERE uc.id_utilisateur = c.id_utilisateur) AS competences
     FROM candidature c
     JOIN offre_emploi o ON o.id_offre = c.id_offre
     JOIN utilisateur u ON u.id_utilisateur = c.id_utilisateur
     LEFT JOIN profil_professionnel p ON p.id_utilisateur = c.id_utilisateur
     LEFT JOIN matching m ON m.id_utilisateur = c.id_utilisateur AND m.id_offre = c.id_offre
     WHERE c.id_candidature = ?`,
    [r.insertId]
  );
  if (application[0]) {
    recruiters.forEach((rec) => socket.emitToUser(rec.id_utilisateur, 'nouvelle_candidature', { candidature: application[0] }));
  }
  success(res, 'Candidature envoyée.', { id_candidature: r.insertId, matching: score }, 201);
});

exports.myApplications = asyncHandler(async (req, res) => {
  const [rows] = await db.execute(
    `SELECT c.*, o.titre_offre, o.localisation, o.statut_offre, o.date_expiration,
            e.nom_entreprise, e.logo AS logo_entreprise, e.id_utilisateur AS id_recruteur, m.score_compatibilite
     FROM candidature c
     JOIN offre_emploi o ON o.id_offre = c.id_offre
     JOIN entreprise e ON e.id_entreprise = o.id_entreprise
     LEFT JOIN matching m ON m.id_utilisateur = c.id_utilisateur AND m.id_offre = c.id_offre
     WHERE c.id_utilisateur = ?
     ORDER BY c.date_candidature DESC`,
    [req.user.id_utilisateur]
  );
  success(res, 'Mes candidatures.', { items: rows });
});

exports.cancel = asyncHandler(async (req, res) => {
  const [r] = await db.execute(
    "UPDATE candidature SET statut_candidature='Annulée' WHERE id_candidature=? AND id_utilisateur=? AND statut_candidature='En attente'",
    [req.params.id, req.user.id_utilisateur]
  );
  if (!r.affectedRows) return fail(res, 'Candidature non annulable.', [], 400);
  success(res, 'Candidature annulée.');
});

exports.companyApplications = asyncHandler(async (req, res) => {
  const company = await recruiterCompany(req.user.id_utilisateur);
  if (!company || company.status !== 'approved') return fail(res, 'Entreprise approuvée et profil recruteur requis.', [], 403);
  const [rows] = await db.execute(
    `SELECT c.*, u.nom, u.prenom, u.email, u.telephone, u.photo, p.cv, p.bio,
            o.titre_offre, o.localisation, m.score_compatibilite,
            (SELECT GROUP_CONCAT(CONCAT(comp.nom_competence, ' (', uc.niveau_competence, ')') SEPARATOR ', ')
             FROM utilisateur_competence uc JOIN competence comp ON comp.id_competence = uc.id_competence
             WHERE uc.id_utilisateur = c.id_utilisateur) AS competences,
            (SELECT COUNT(*) FROM candidature a WHERE a.id_offre = c.id_offre AND a.statut_candidature = 'Acceptée') > 0 AS offre_pourvue
     FROM candidature c
     JOIN offre_emploi o ON o.id_offre = c.id_offre
     JOIN utilisateur u ON u.id_utilisateur = c.id_utilisateur
     LEFT JOIN profil_professionnel p ON p.id_utilisateur = c.id_utilisateur
     LEFT JOIN matching m ON m.id_utilisateur = c.id_utilisateur AND m.id_offre = c.id_offre
     WHERE o.id_entreprise = ? AND c.statut_candidature != 'Annulée'
     ORDER BY c.date_candidature DESC`,
    [company.id_entreprise]
  );
  // `offre_pourvue` sert au frontend pour désactiver les boutons d'acceptation
  // des AUTRES candidatures (le backend reste la source de vérité : verrou
  // transactionnel dans updateApplicationStatus).
  success(res, 'Candidatures reçues.', { items: rows });
});

/**
 * Décision de candidature par le recruteur — UNIQUEMENT « Acceptée » ou
 * « Refusée » (plus d'états intermédiaires modifiables arbitrairement).
 *
 * Garde-fous techniques (anti-course, exécuté dans une transaction) :
 * 1. la ligne de l'OFFRE est verrouillée en écriture (SELECT ... FOR UPDATE) :
 *    deux recruteurs/requêtes concurrents ne peuvent pas accepter deux
 *    candidatures différentes pour la même offre — le second voit l'offre
 *    déjà pourvue et reçoit un 409 ;
 * 2. une candidature déjà traitée (Acceptée/Refusée/Annulée) ne peut pas
 *    changer d'état ;
 * 3. à l'acceptation : toutes les AUTRES candidatures « En attente » de
 *    l'offre passent automatiquement « Refusée », leurs candidats sont
 *    notifiés (« offre attribuée à un autre candidat »), et l'offre est
 *    fermée (statut_offre = 'Fermée') : plus aucune nouvelle candidature
 *    possible, y compris directement via l'endpoint POST /offres/:id/postuler
 *    (double garde : statut + EXISTS 'Acceptée' dans apply).
 */
exports.updateApplicationStatus = asyncHandler(async (req, res) => {
  const company = await recruiterCompany(req.user.id_utilisateur);
  const statut = req.body.statut_candidature ?? req.body.statut;
  if (!company || company.status !== 'approved') return fail(res, 'Entreprise approuvée et profil recruteur requis.', [], 403);
  if (!['Acceptée', 'Refusée'].includes(statut)) {
    return fail(res, "Statut invalide : le recruteur ne peut qu'accepter ou refuser une candidature.", [], 422);
  }

  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();

    // 1) VERROUILLE la ligne de l'offre (SELECT ... FOR UPDATE) : tout
    //    traitement concurrent d'une candidature de CETTE offre est
    //    sérialisé ici (deux recruteurs ne peuvent pas accepter chacun leur
    //    candidat — le second verra l'offre déjà pourvue et recevra un 409).
    const [offers] = await connection.execute(
      `SELECT o.id_offre, o.titre_offre FROM offre_emploi o
       JOIN candidature c ON c.id_offre = o.id_offre
       WHERE c.id_candidature = ? AND o.id_entreprise = ?`,
      [req.params.id, company.id_entreprise]
    );
    if (!offers[0]) { await connection.rollback(); return fail(res, 'Candidature introuvable.', [], 404); }
    await connection.execute('SELECT id_offre FROM offre_emploi WHERE id_offre = ? FOR UPDATE', [offers[0].id_offre]);

    // 2) Re-lit la candidature (le verrou de l'offre garantit la fraîcheur).
    const [rows] = await connection.execute(
      `SELECT c.id_candidature, c.id_utilisateur, c.statut_candidature AS statut_actuel,
              c.id_offre, o.titre_offre
       FROM candidature c
       JOIN offre_emploi o ON o.id_offre = c.id_offre
       WHERE c.id_candidature = ? AND o.id_entreprise = ?`,
      [req.params.id, company.id_entreprise]
    );
    if (!rows[0]) { await connection.rollback(); return fail(res, 'Candidature introuvable.', [], 404); }
    const row = rows[0];

    // 2) Une candidature déjà traitée est finale.
    if (['Acceptée', 'Refusée', 'Annulée'].includes(row.statut_actuel)) {
      await connection.rollback();
      return fail(res, 'Cette candidature a déjà été traitée.', [], 409);
    }

    if (statut === 'Acceptée') {
      // 3) Vérifie (sous le verrou) qu'aucune autre candidature de l'offre
      //    n'a déjà été acceptée → blocage d'une seconde acceptation.
      const [pourvue] = await connection.execute(
        "SELECT id_candidature FROM candidature WHERE id_offre = ? AND statut_candidature = 'Acceptée' AND id_candidature != ?",
        [row.id_offre, row.id_candidature]
      );
      if (pourvue[0]) {
        await connection.rollback();
        return fail(res, 'Cette offre a déjà été attribuée à un autre candidat.', [], 409);
      }

      // 4) Accepte la candidature choisie.
      await connection.execute("UPDATE candidature SET statut_candidature = 'Acceptée' WHERE id_candidature = ?", [row.id_candidature]);

      // 5) Refuse automatiquement toutes les autres candidatures « En attente ».
      const [others] = await connection.execute(
        "SELECT id_candidature, id_utilisateur FROM candidature WHERE id_offre = ? AND id_candidature != ? AND statut_candidature = 'En attente'",
        [row.id_offre, row.id_candidature]
      );
      if (others.length) {
        await connection.execute(
          "UPDATE candidature SET statut_candidature = 'Refusée' WHERE id_offre = ? AND id_candidature != ? AND statut_candidature = 'En attente'",
          [row.id_offre, row.id_candidature]
        );
      }

      // 6) Clôture l'offre : plus aucune candidature possible (visibilité
      //    « candidate » coupée, endpoint de candidature bloqué).
      await connection.execute("UPDATE offre_emploi SET statut_offre = 'Fermée' WHERE id_offre = ?", [row.id_offre]);
      await connection.commit();

      // 7) Notifications (après commit, hors transaction).
      await notify.create(row.id_utilisateur, `Félicitations ! Votre candidature pour « ${row.titre_offre} » a été acceptée.`);
      for (const other of others) {
        await notify.create(other.id_utilisateur, `Votre candidature pour « ${row.titre_offre} » n'a pas été retenue : l'offre a été attribuée à un autre candidat.`);
        socket.emitToUser(other.id_utilisateur, 'candidature_statut_modifie', {
          id_candidature: Number(other.id_candidature),
          id_offre: Number(row.id_offre),
          statut_candidature: 'Refusée',
          titre_offre: row.titre_offre
        });
      }
      socket.emitToUser(row.id_utilisateur, 'candidature_statut_modifie', {
        id_candidature: Number(row.id_candidature),
        id_offre: Number(row.id_offre),
        statut_candidature: 'Acceptée',
        titre_offre: row.titre_offre
      });
      // Les clients affichant l'offre (recruteurs) doivent désactiver les
      // autres boutons d'acceptation : diffusion de l'état « Fermée ».
      socket.emitToRole('recruteur', 'offre_pourvue', { id_offre: Number(row.id_offre), titre_offre: row.titre_offre });
      return success(res, 'Candidature acceptée ; l\'offre est désormais pourvue.', { id_offre: Number(row.id_offre) });
    }

    // --- Refus simple : la candidature est marquée refusée, le candidat notifié.
    await connection.execute("UPDATE candidature SET statut_candidature = 'Refusée' WHERE id_candidature = ?", [row.id_candidature]);
    await connection.commit();
    await notify.create(row.id_utilisateur, `Votre candidature pour « ${row.titre_offre} » a été refusée.`);
    socket.emitToUser(row.id_utilisateur, 'candidature_statut_modifie', {
      id_candidature: Number(row.id_candidature),
      id_offre: Number(row.id_offre),
      statut_candidature: 'Refusée',
      titre_offre: row.titre_offre
    });
    return success(res, 'Candidature refusée.');
  } catch (error) {
    await connection.rollback().catch(() => {});
    throw error;
  } finally {
    connection.release();
  }
});

exports.matchOffer = asyncHandler(async (req, res) => {
  // Cohérence avec la visibilité : le score d'une offre expirée ou fermée
  // n'est plus calculé (l'offre n'est pas accessible aux candidats).
  const [offer] = await db.execute(
    "SELECT id_offre FROM offre_emploi WHERE id_offre=? AND statut_offre='Ouverte' AND date_expiration >= CURDATE()",
    [req.params.id]
  );
  if (!offer[0]) return fail(res, 'Offre indisponible (expirée ou fermée).', [], 404);
  success(res, 'Score de compatibilité calculé.', { matching: await matching.calculate(req.user.id_utilisateur, req.params.id) });
});
