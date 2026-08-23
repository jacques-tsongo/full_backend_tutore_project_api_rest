# LinkEmploi — API REST + application web (EJS)

Plateforme de gestion des carrières et offres d'emploi :

- **API REST** Node.js/Express/MySQL (format de réponse `{ success, message, data }` ou `{ success, message, errors }`) ;
- **Application web rendue côté serveur (EJS)** servie par le même Express : pages dynamiques par rôle, navigation à badges temps réel, formulaires sécurisés.

## Installation

1. Créez la base avec [database/schema.sql](database/schema.sql) dans MySQL (le script force `SET NAMES utf8mb4` pour éviter tout problème d'encodage des valeurs accentuées).
2. Appliquez les migrations dans l'ordre : `database/migrations/*.sql` (idempotentes — elles ajoutent notamment le suivi de lecture des messages `lu` / `date_lecture`).
3. Copiez `.env.example` vers `.env` et renseignez vos identifiants MySQL ainsi qu'un `JWT_SECRET` robuste.
4. Exécutez `npm install`, puis `npm run dev`.

- Application web : `http://localhost:5000/` (pages EJS).
- API : `http://localhost:5000/api` — vérification : `GET /api/health`.
- Documentation Swagger : `http://localhost:5000/api-docs`.
- Comptes de démonstration : `database/seed.sql` (`admin@example.com` / `Admin123!`, `recruteur@example.com` / `Recruteur123!`, `candidat@example.com` / `Candidat123!`).

## Architecture

```
src/
  app.js                 Express : sécurité, EJS, helpers de vues, API, pages, erreurs
  server.js              Connexion DB puis écoute
  config/database.js     Pool mysql2
  controllers/           Contrôleurs métier (partagés API + pages)
    page.controller.js   Rendu des pages EJS (agrégation des données)
  helpers/
    flash.js             Messages flash par cookie (pattern PRG)
    formPost.js          Enveloppe : formulaire HTML → contrôleur API → flash + redirect
  middlewares/           auth (JWT Bearer + cookie httpOnly), upload, validation, erreurs
  models/  routes/  services/  utils/  validators/
views/                   Gabarits EJS (pages + partials : navbar, sidebar, flash…)
frontend/                Assets statiques (CSS, JS client léger, icônes Lucide locales)
database/                schema.sql, seed.sql, migrations/
```

## Authentification (un seul mécanisme, deux transports)

Le JWT signé `JWT_SECRET` est l'unique système d'authentification :

1. **API** : `Authorization: Bearer <token>` (Postman, scripts, tests) — inchangé.
2. **Navigateur** : à la connexion (`POST /login` ou `POST /api/auth/login`), le serveur pose un cookie **httpOnly** `gc_token` contenant le même JWT (jamais accessible au JavaScript, `SameSite=Lax`, `Secure` en production). Les pages EJS et les appels `fetch` same-origin s'authentifient via ce cookie.
3. **Déconnexion** : `POST /logout` (page) ou `POST /api/auth/logout` efface le cookie — l'état d'authentification du navigateur est invalidé.
4. **Mot de passe** : `PUT /api/auth/mot-de-passe` (`mot_de_passe_actuel` + `nouveau_mot_de_passe`) ou le formulaire Paramètres.

Aucun mot de passe ni jeton n'est exposé au navigateur (pas de token en `localStorage`).

## Pages (routes EJS)

| Page | Route GET | Rôle |
|---|---|---|
| Accueil, contact, à propos | `/`, `/contact`, `/about` | public |
| Connexion / inscription | `/login`, `/register` | public (redirigé vers `/dashboard` si déjà connecté) |
| Tableau de bord (adapté au rôle) | `/dashboard` | tous |
| Profil + CV + photo + compétences + expériences + diplômes | `/profil` | candidat, recruteur |
| Offres (recherche, filtre, pagination) / détail + candidature | `/offres`, `/offres/:id` | tous |
| Candidatures (suivi / reçues) | `/candidatures` | candidat / recruteur |
| Matching | `/matching` | candidat |
| Messages (compteur non lus, fil marqué lu à l'ouverture) | `/messages` | tous |
| Notifications (badge, marquage lu) | `/notifications` | tous |
| Mes suggestions (domaines / compétences) | `/suggestions` | candidat, recruteur |
| Traitement des suggestions | `/admin/suggestions` | administrateur |
| Annuaire entreprises (approuvées uniquement) | `/entreprises`, `/entreprises/:id` | tous |
| Gestion de SON entreprise | `/entreprise` | recruteur |
| Demande de création d'entreprise | `/entreprise/demande` | candidat |
| Paramètres (compte, mot de passe, thème, espace recruteur, déconnexion) | `/parametres` | tous |

Les anciennes URLs `*.html` redirigent en 301 vers les nouvelles routes.

## Workflow métier

1. Un candidat s'inscrit (tout nouveau compte est `candidat` — jamais de choix de rôle à l'inscription), complète son profil (bio, adresse, photo, CV) et ses compétences.
2. Il soumet une entreprise depuis **Paramètres → Espace recruteur** (`POST /api/entreprises/demande-recruteur` ou le formulaire `/entreprise/demande`, multipart : `logo`, `supporting_documents` PDF).
3. L'administrateur approuve ou rejette (`PUT /api/admin/companies/:id/approve|reject` ou le dashboard admin) — **l'approbation promeut le rôle `recruteur`** ; elle n'est jamais contournable (la modification d'entreprise, `PUT /api/entreprises/:id`, ne permet pas de changer le statut).
4. Le recruteur gère SA société (`/entreprise`), crée des offres, définit leurs compétences requises, publie/modifie/supprime ses offres.
5. Les candidats consultent les offres ouvertes (les offres fermées/expirées sont invisibles sauf s'ils y ont postulé), voient le détail avec score de matching, postulent **une seule fois** (message métier explicite en cas de doublon + contrainte `uq_candidature`).
6. Le recruteur examine les candidatures (CV, contact, compétences, score), change leur statut → le candidat est notifié.
7. Un candidat ou recruteur peut proposer un domaine absent ou une compétence de son propre domaine. Tous les administrateurs sont notifiés ; l'approbation/refus est transactionnel et notifie le compte demandeur.
8. Messagerie et notifications avec **compteurs de non lus** servis par la base (`GET /api/messages/non-lus`, `GET /api/notifications/non-lues`, badges rendus côté serveur) : ouvrir un fil marque les messages reçus comme lus.

## Endpoints principaux (API)

- `POST /api/auth/register`, `POST /api/auth/login`, `GET|PUT /api/auth/me`, `PUT /api/auth/mot-de-passe`, `POST /api/auth/logout`
- `GET|POST|PUT|DELETE /api/competences`, `/api/experiences`, `/api/diplomes`
- `GET /api/offres` (`q`, `statut`, `mine=1`, `page`, `limit`, `sort`, `order`), `GET|POST /api/offres`, `GET|PUT|DELETE /api/offres/:id`
- `PUT /api/offres/:id/competences`, `GET /api/offres/:id/matching`, `POST /api/offres/:id/postuler`
- `GET|POST|DELETE /api/mes-competences`
- `GET|PUT /api/profil`, `POST /api/profil/photo`, `POST /api/profil/couverture`, `POST /api/profil/cv`
- `GET|POST /api/profil/langues`, `PATCH|DELETE /api/profil/langues/:id`
- `GET /api/candidatures/me`, `PATCH /api/candidatures/:id/annuler`, `GET /api/candidatures/recues`, `PATCH /api/candidatures/:id/statut`
- `POST|GET /api/messages`, `GET /api/messages/:userId`, `GET /api/messages/contacts`, `GET /api/messages/non-lus`
- `GET /api/notifications`, `PATCH /api/notifications/:id/lire`, `PATCH /api/notifications/lire-toutes`, `GET /api/notifications/non-lues`
- `POST /api/suggestions`, `GET /api/suggestions/mine`, `GET /api/suggestions/:id`
- `GET /api/admin/suggestions`, `GET /api/admin/suggestions/:id`, `PATCH /api/admin/suggestions/:id/approuver|refuser`
- `POST /api/entreprises/demande-recruteur`, `GET /api/recruteurs/me`, `GET /api/entreprises/mine`, `PUT /api/entreprises/:id`, `PATCH /api/entreprises/:id/validation`
- `GET /api/admin/utilisateurs`, `PATCH /api/admin/utilisateurs/:id/statut`, `GET /api/admin/statistiques`
- `GET /api/admin/companies/pending`, `GET /api/admin/companies/:id`, `PUT /api/admin/companies/:id/approve|reject`

## Migrations de base de données

Le schéma d'origine est conservé. Les migrations sont additives et idempotentes,
à appliquer dans l'ordre :

```bash
mysql -u root -p < database/migrations/20260809_message_read_tracking.sql
mysql -u root -p < database/migrations/20260817_entreprise_geolocalisation.sql
mysql -u root -p < database/migrations/20260820_photo_couverture.sql
mysql -u root -p < database/migrations/20260821_profile_fields.sql
mysql -u root -p < database/migrations/20260823_add_domain.sql
mysql -u root -p < database/migrations/20260823_competence_domaine.sql
mysql -u root -p < database/migrations/20260823_suggestions.sql
```

- `20260809` : `message.lu` + `message.date_lecture` + index (compteurs non lus).
- `20260817` : `entreprise.latitude` + `entreprise.longitude` (géolocalisation).
- `20260820` : `utilisateur.photo_couverture` (bannière de profil).
- `20260821` : champs du profil professionnel (`post_nom`, `sexe`, `territoire`,
  `province`, `nationalite`, `etat_civil`, `accroche`), période de formation
  (`diplome.date_debut` / `date_fin`, `annee_obtention` optionnel) et tables
  relationnelles `langue` + `utilisateur_langue`.
- `20260823_add_domain` : table `domaine` + `id_domaine` sur
  `profil_professionnel`, `entreprise` et `offre_emploi`.
- `20260823_competence_domaine` : `competence.id_domaine` (relation
  DOMAINE 1,N → COMPÉTENCE). Colonne **nullable** : les compétences
  historiques restent intactes ; elles ne sont plus proposées à la sélection
  tant que l'administrateur ne les a pas classées depuis la page
  « Compétences » (aucune attribution automatique de domaine).
- `20260823_suggestions` : table `demande_suggestion` et ajout de
  `type_notification`, `type_reference`, `id_reference` à la table
  `notification` existante. Aucune donnée ou notification historique n'est supprimée.

## Domaines professionnels (règles métier)

- Le domaine est choisi **une seule fois** (candidat au moment de
  l'inscription ou du profil ; entreprise lors de la demande recruteur ou de
  la première configuration). Après confirmation (modal dédiée), le choix est
  **définitif** : le backend refuse toute modification (403), même via l'API.
- Les compétences proposées (profil candidat, onboarding, création d'offre)
  sont **filtrées par domaine** côté serveur.
- L'offre hérite automatiquement du domaine de son entreprise ; le candidat
  ne voit / ne reçoit / ne postule qu'aux offres de **son** domaine (liste,
  accès direct `/offres/:id`, candidature et notifications vérifiés côté
  backend).
- Tests dédiés : `node test/domain-rules.js` (14 cas du cahier des charges).

## Règle de visibilité des offres (matching)

Le score de compatibilité candidat ⇄ offre est calculé par un unique service
(`src/services/matching.service.js`). Un candidat ne voit, ne consulte et ne
postule qu'aux offres ouvertes/non expirées dont le score est **supérieur ou
égal à 10 %** (une offre sans compétence requise est toujours accessible). La
règle est appliquée côté serveur (liste, détail, candidature, notifications) —
le frontend n'est pas la seule protection.

## Tests

```bash
# Serveur démarré + base seedée
ADMIN_TOKEN=$(curl -s -X POST http://localhost:5000/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"admin@example.com","mot_de_passe":"Admin123!"}' | jq -r .data.token) \
  npm run test:e2e     # 60 assertions API de bout en bout
npm run test:pages     # 54 assertions sur les pages EJS (HTTP réel)
```

## Compte administrateur initial

Aucun compte admin n'est créé par le schéma (hors seed). Créez-le manuellement :

```sql
INSERT INTO utilisateur (nom, prenom, email, mot_de_passe, role) VALUES ('Admin', 'Super', 'admin@example.com', '<hash bcrypt du mot de passe>', 'administrateur');
```

Générez le hash avec `node hash-password.js`.

## Décisions de modélisation

- Relation N:N officielle `utilisateur_competence` (avec niveau) — pas de lien direct compétence→utilisateur.
- Pas de table `recruteur` : `utilisateur.role = 'recruteur'` + `entreprise.status = 'approved'` liée à `entreprise.id_utilisateur`.
- Suivi de lecture des messages : colones `lu` / `date_lecture` (migration `20260809`).
