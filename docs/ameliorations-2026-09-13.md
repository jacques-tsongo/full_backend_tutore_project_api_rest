# Améliorations du 2026-09-13 — Matching, classement des candidatures, notifications

Branche : `arena/01a09b2c-full-backend-tutore-project-ap`

## 1. Pourquoi le matching ne fonctionnait plus

L'inspection complète (service, contrôleurs, routes, vues, requêtes SQL, table
`matching`) a identifié trois causes réelles :

1. **Bug de comparaison de dates (`String(Date)`)** — dans
   `offer.controller.js` (diffusion temps réel) et `page.controller.js`
   (page de détail d'offre), l'expiration était testée avec
   `String(date_expiration).slice(0, 10) >= 'AAAA-MM-JJ'`. Or mysql2 renvoie un
   **objet `Date`**, et `String(Date)` produit `"Sun Jan 05 2020…"` — jamais une
   date ISO. La comparaison lexicale était donc systématiquement fausse :
   des offres expirées étaient considérées « ouvertes » (et réciproquement),
   ce qui cassait la visibilité candidat et les diffusions liées au matching.
2. **Scores jamais enregistrés pour une partie des candidatures** — la table
   `matching` n'était alimentée que lorsque le candidat ouvrait lui-même le
   détail d'une offre (`matching.calculate`) ou postulait. Toute candidature
   dont le score n'avait pas été persisté à ce moment-là (ou dont les
   compétences/l'offre avaient changé ensuite) apparaissait **sans score**
   côté recruteur (`LEFT JOIN matching` → NULL), sans jamais être recalculée.
3. **Chaîne de domaines incomplète** — le matching est verrouillé par le
   domaine (candidat ↔ offre). Les données historiques sans
   `profil_professionnel.id_domaine` / `entreprise.id_domaine` /
   `offre_emploi.id_domaine` court-circuitaient tout le parcours matching
   (liste vide, 403 sur `/api/offres/:id/matching`). C'est un état de données,
   pas un bug de code : l'interface existante (choix du domaine, classement
   des compétences par l'admin) permet de compléter ces données.

## 2. Réparation (sans second système)

- La **formule unique** `computeScore` du service existant est conservée telle
  quelle (moyenne pondérée de la couverture de chaque compétence requise,
  niveaux Débutant=1 … Expert=4, plafonnée à 100 %).
- Nouvelles comparaisons de dates ISO sûres (`dateOnly`) dans
  `offer.controller.js`, `page.controller.js`, `views/offer-details.ejs` et
  `frontend/js/pages/offers.js`.
- Nouvelle fonction **`matching.syncPairs(pairs)`** : recalcul en lot des
  couples (utilisateur, offre) — 3 requêtes de lecture quelle que soit la
  taille — puis persistance **uniquement** des scores manquants ou différents
  (`INSERT … ON DUPLICATE KEY UPDATE`). Elle est appelée par
  `GET /api/candidatures/recues` : le recruteur voit désormais toujours un
  score réel, y compris pour les candidatures historiques.

## 3. Classement intelligent des candidatures

Score de recommandation **calculé côté serveur, aucune colonne ajoutée** :

```
score_recommandation = 0.7 × score_compatibilite + 0.3 × score_experience
score_experience     = min((années_pertinentes + 0.5 × autres_années) / 5, 1) × 100
```

- une expérience est « pertinente » si son texte (poste, description,
  entreprise) contient un mot-clé de l'offre (mots du titre + noms des
  compétences requises, sans accents, mots vides exclus) ;
- 5 années effectives suffisent au maximum (l'expérience ne peut pas écraser
  les compétences) ; une expérience hors sujet compte moitié ;
- les débutants ne sont pas pénalisés : un profil 100 % compatible sans
  expérience garde une recommandation de 70 — devant tout profil moins
  compétent ET moins expérimenté.

Tri : `score_recommandation` desc, puis `score_compatibilite` desc, puis date
de candidature. La page recruteur affiche une zone « Meilleures candidatures »
(top 3, résumé + ancre) et « Toutes les candidatures » (rien n'est caché).

## 4. Offres expirées côté candidat

Règle serveur inchangée et vérifiée : `statut_offre = 'Ouverte' AND
date_expiration >= CURDATE()` (jour d'expiration inclus, `date_expiration` est
une colonne `DATE`) dans la liste, le détail, la candidature, le matching et
les notifications. Les correctifs de dates (ci-dessus) alignent désormais les
vues EJS et le temps réel sur cette règle. Les offres expirées **restent en
base** (historique) et restent visibles pour recruteurs/admins.

## 5. Notifications

- **Demande de création d'entreprise** → notification à chaque administrateur
  actif (`NOUVELLE_DEMANDE_ENTREPRISE`, référence `ENTREPRISE` + id), avec
  anti-doublon (pas de recréation si une notification non lue existe pour la
  même demande). L'ouverture (`/notifications/:id/ouvrir`) marque lue et
  redirige vers `/dashboard#entreprise-ID` (ancre sur la demande).
- **Suggestions de domaine/compétence** → notifications admin déjà présentes
  (réutilisées) ; libellé harmonisé « Nouvelle suggestion de … à examiner ».
- **Offre proche de l'expiration** → nouveau service
  `src/services/offerAlert.service.js` (aucune dépendance, `setInterval`
  horaire démarré par `server.js`) : offres « Ouverte », expirant sous 3
  jours, avec ≥ 1 candidature active et non pourvues → notification du
  recruteur (`OFFRE_EXPIRE_BIENTOT`, référence `OFFRE` + id → ouvre
  `/candidatures?offre=ID`). Anti-doublon : une seule alerte par offre et par
  fenêtre d'expiration.

## 6. Autorisations

`GET /api/candidatures/recues` reste borné à l'entreprise approuvée du
recruteur connecté ; le nouveau filtre `?offre=ID` est combiné en `AND` avec
`id_entreprise` (un id d'une autre entreprise → liste vide, jamais de fuite).
Vérifié par tests (recruteur 2 ↛ candidatures de l'entreprise 1, PATCH statut
d'une candidature étrangère → 404, candidat → 403).

## 7. Tests

`npm run test:matching` (nouveau, `test/matching-ranking.js`) : 50 vérifications
(matching calcul/persistance/seuil, réparation des scores effacés, classement
avec expérience, offres expirées, alerte expiration + anti-doublon,
notifications admin + compteurs + ouverture, autorisations).

Régression complète : e2e 70/70, smoke 57/57, sql 489/489, realtime 19/19 et
17/17, domain-rules 24/24.

Aucune modification SQL : ni table, ni colonne, ni index ajoutés ou modifiés.
