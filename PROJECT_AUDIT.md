# PROJECT AUDIT — Gestion Carrières (API REST + Frontend)

Date de l'audit : 2026-08-06
Branche : `arena/019fd7a3-full-backend-tutore-project-ap`
Périmètre : inspection complète, audit des incohérences, réparation du workflow des offres d'emploi, vérification base de données, CRUD offres, workflow candidatures, compétences & matching, frontend, tests de bout en bout.

---

# PARTIE II — REFONTE du 2026-08-09 (EJS, sessions sécurisées, compteurs, paramètres)

> **État courant du projet = cette partie.** La Partie I (plus bas) est conservée comme
> historique de la première passe d'audit/réparation (2026-08-06).

Date : 2026-08-09 — Branche : `arena/019fe5ce-full-backend-tutore-project-ap`
Périmètre : migration des pages HTML statiques vers le rendu serveur **EJS**, sessions
persistantes sécurisées (cookie httpOnly, plus de jeton en `localStorage`), compteurs de
messages/notifications non lus calculés depuis la base, page de paramètres complète,
recruteur limité à **sa seule entreprise**, demande d'entreprise déplacée hors de la
navigation principale, UI/UX professionnelle avec icônes, gestion d'erreurs durcie,
migration SQL additive, tests de bout en bout.

## II.1 Résumé exécutif

| Suite | Résultat |
|---|---|
| `test/e2e-workflow.js` (API réelle + MySQL 5.7) | **60 / 60 PASS** |
| `test/frontend-smoke.js` (navigation HTTP réelle, jar à cookies, HTML rendu) | **54 / 54 PASS** |

Les 20 pages HTML statiques (`frontend/*.html`) et les 15 scripts SPA associés ont été
**supprimés** et remplacés par **21 vues EJS + 9 partials** rendues côté serveur par
`src/controllers/page.controller.js` via `src/routes/web.routes.js`, **sans dupliquer la
logique métier** : les formulaires web appellent les mêmes contrôleurs API
(`src/helpers/formPost.js`), avec le même format de réponse `{success, message, data|errors}`.
La navigation est désormais générée par rôle (`views/partials/sidebar.ejs`), les badges de
messages/notifications non lus proviennent de requêtes SQL (`loadNavCounts`), la session
vit dans un cookie **`gc_token` httpOnly / SameSite=Lax** posé à la connexion (transport
Bearer conservé pour les clients API), et l'ancien stockage `localStorage` du jeton a
disparu du code (les anciennes URLs `*.html` reçoivent une **redirection 301**).

## II.2 Changements majeurs par domaine

### Authentification / sessions
- Cookie **httpOnly** `gc_token` (SameSite=Lax, `secure` en production, durée 7 j) posé sur
  `POST /api/auth/login` et `POST /api/auth/register`, effacé sur `POST /api/auth/logout` ;
  le jeton JWT est le même qu'avant (un seul système d'authentification).
- `authenticate` accepte l'en-tête `Authorization: Bearer` **puis** le cookie ;
  `webAuthorize` rend une **page 403** stylée, `webAuth` redirige vers `/login?erreur=…`.
- Nouveau `PUT /api/auth/mot-de-passe` (validateur `passwordChange`, vérif bcrypt de
  l'ancien mot de passe) alimenté par le formulaire de `/parametres`.

### Compteurs non lus (base de données, pas seulement l'UI)
- Migration **`database/migrations/20260809_message_read_tracking.sql`** : `message.lu
  TINYINT(1) NOT NULL DEFAULT 0`, `message.date_lecture DATETIME NULL`, index
  `(id_destinataire, lu)` — ALTER **idempotents** gardés par `information_schema`,
  backfill des messages historiques en « lus » uniquement à la création de la colonne.
- `GET /api/messages/non-lus` → `{total}` ; lecture d'un fil = `UPDATE … lu=1, date_lecture=NOW()`
  sur les messages entrants ; la liste des conversations expose `non_lus` par contact.
- `GET /api/notifications/non-lues` → `{total}` (s'appuie sur `statut_notification` existant).
- Sidebar + topbar affichent les badges (cachés à 0), rafraîchis toutes les 60 s par
  `frontend/js/app.js` ; le seed ajoute une démo (1 message + 1 notification non lus pour
  `candidat@example.com`).

### Paramètres utilisateur (`/parametres`)
- Informations du compte, formulaire d'infos personnelles, changement de mot de passe,
  choix de **thème** clair/sombre (cookie `gc_theme` + `data-theme`, sans flash au chargement),
  déconnexion ; la **demande d'entreprise** (« Devenir recruteur ») n'existe que dans la
  section « Espace recruteur » de cette page — **retirée de la navigation principale**, avec
  états En attente / Approuvée / Rejetée et workflow d'approbation admin inchangé.

### Entreprises
- `GET /api/entreprises/mine` (recruteur → son entreprise approuvée) et `PUT
  /api/entreprises/:id` (recruteur : uniquement la sienne ; admin : toutes ; le **statut
  n'est jamais modifiable** via cette route — validateur `companyUpdate`).
- La route admin générique `PUT /api/entreprises/:id` (contournement du workflow
  d'approbation) est **retirée** (`skipPut` dans `resource.routes.js`).
- Annuaire `/entreprises` : un non-admin ne voit que les entreprises **approuvées** ;
  détail d'une entreprise en attente/rejetée → 404 hors propriétaire/admin ; champs
  sensibles (`documents_justificatifs`, `numero_rccm`, `numero_fiscal`, `approved_by`)
  masqués pour les tiers.

### Offres / candidatures / matching (conservés et revérifiés)
- Pré-contrôle « déjà postulé » → **409** explicite (la contrainte `uq_candidature` reste
  le garde-fou d'intégrité) ; formulaire de candidature SSR + état « Vous avez déjà postulé » ;
  gestion des offres du recruteur (création, édition, compétences requises, suppression)
  en formulaires serveur ; matching affiché côté candidat, **403 page** pour les autres rôles.

### Gestion d'erreurs
- Pages **`404.ejs` / `error.ejs`** stylées pour les requêtes HTML (JSON inchangé pour
  l'API) ; mapping `ER_DUP_ENTRY`→409, FK→400/409, `ER_DATA_TOO_LONG`→422, `MulterError`→400 ;
  les erreurs 5xx n'exposent plus les internes (« Erreur interne du serveur. »).

### UI/UX
- Design system CSS (`frontend/css/app.css`), layout sidebar + topbar responsive
  (off-canvas mobile), icônes **Lucide** (62 SVG en local dans `frontend/vendor/lucide/`,
  aucun emoji), flash messages PRG (`gc_flash`), confirmations `data-confirm`, zéro
  JavaScript critique inline (compatible CSP de `helmet`).

## II.3 Fichiers créés

- **Backend** : `src/routes/web.routes.js`, `src/controllers/page.controller.js`,
  `src/helpers/flash.js`, `src/helpers/formPost.js`, `database/migrations/20260809_message_read_tracking.sql`.
- **Vues** : `views/{index,about,contact,login,register,dashboard,profile,offers,offer-details,applications,applications-received,matching,messages,notifications,companies,company-details,company-manage,company-request,settings,404,error}.ejs` + `views/partials/{head,foot,flash,sidebar,topbar,public-nav,dashboard-candidat,dashboard-recruteur,dashboard-admin}.ejs`.
- **Frontend statique** : `frontend/js/app.js`, `frontend/css/app.css`,
  `frontend/vendor/lucide/*.svg` (62 icônes).

## II.4 Routes ajoutées (API)

| Route | Méthode | Rôle | Description |
|---|---|---|---|
| `/api/auth/mot-de-passe` | PUT | authentifié | Changement de mot de passe (ancien vérifié) |
| `/api/auth/logout` | POST | authentifié | Efface le cookie de session |
| `/api/messages/non-lus` | GET | authentifié | Total de messages non lus |
| `/api/notifications/non-lues` | GET | authentifié | Total de notifications non lues |
| `/api/entreprises/mine` | GET | recruteur/candidat | Son entreprise (approuvée) ou demande en cours |
| `/api/entreprises/:id` | PUT | recruteur (la sienne) / admin | Édition sans toucher au statut |

Plus ~45 routes **web** (GET pages + POST formulaires) dans `src/routes/web.routes.js`
(`/`, `/about`, `/contact`, `/login`, `/register`, `/dashboard`, `/profil`, `/offres`,
`/offres/:id`, `/candidatures`, `/matching`, `/messages`, `/notifications`, `/entreprises`,
`/entreprise`, `/entreprise/demande`, `/parametres`…) et redirections 301 des anciennes
URL `*.html`. `PUT /api/entreprises/:id` générique admin : **supprimée**.

## II.5 Changements de base de données

- **Une seule migration, additive et sans perte** :
  `database/migrations/20260809_message_read_tracking.sql` (ALTER TABLE `message` :
  `lu`, `date_lecture`, index ; idempotent, rejouable). Aucune autre table/colonne
  modifiée ; `schema.sql` inchangé.
- `database/seed.sql` : ajout d'un message + d'une notification non lus de démonstration
  (idempotent comme le reste du seed).
- Procédure : `mysql -u root -p gestion_carrieres < database/migrations/20260809_message_read_tracking.sql`
  (voir README § « Mise à jour »).

## II.6 Points restants (non bloquants)

1. Le compteur de messages non lus est recalculé au chargement des pages + polling 60 s ;
   pas de temps réel (SSE/WebSocket) — suffisant pour l'usage, extensible plus tard.
2. Les anciens liens profonds `*.html` sont redirigés (301) mais les ancres/params
   exotiques (`job-details.html?id=…` est géré ; les fragments `#` ne transitent pas par
   le serveur, comportement navigateur standard).
3. Limites héritées de la Partie I toujours valables : pas de table `entretien`, cascade
   de suppression d'offre, photo/CV liés au profil courant, CI recommandée.

## II.7 Preuve de fonctionnement

- `test/e2e-workflow.js` : **60/60 PASS** (cookie httpOnly vérifié, lecture message 1→0,
  `mine`, update entreprise propre, statut non modifiable, mot de passe…).
- `test/frontend-smoke.js` : **54/54 PASS** (pages publiques, redirections 301 et
  non-authentifié→login, nav par rôle, badges 0/cachés et non lus visibles, workflow
  complet demande d'entreprise→approbation→promotion→gestion, 403 sur l'entreprise d'un
  tiers, candidature→statut→annulation bloquée, compteurs SSR+API, 404 propres, pas de
  fuite SQL). Spot-checks manuels : 5 pages × 3 rôles (200), pages publiques (200),
  404 HTML stylée, redirects 301 par ancienne page.

---
---

## 1. Résumé exécutif

Le workflow complet fonctionne désormais de bout en bout, vérifié par deux suites de tests automatisées :

| Suite | Résultat |
|---|---|
| `test/e2e-workflow.js` (API réelle + MySQL) | **47 / 47 PASS** |
| `test/frontend-smoke.js` (jsdom, scripts réels servis par Express) | **21 / 21 PASS** |

Workflow vérifié intégralement : inscription candidat → profil → dépôt d'entreprise → approbation admin (promotion recruteur) → création d'offre → recherche → détail → candidature (une seule fois) → notification recruteur → revue candidature (CV, contact, score) → changement de statut → notification candidat → matching → messagerie.

---

## 2. Problèmes trouvés et corrigés

### 2.1 Base de données (critique)

| # | Problème | Correction |
|---|---|---|
| 1 | **Double encodage UTF-8** : en chargeant `database/schema.sql` avec un client en charset `latin1`, toutes les valeurs accentuées des ENUM (`Validée`, `Avancé`, `Présélectionnée`…) étaient stockées en mojibake (`ValidÃ©e`). Résultat : `INSERT` en `'Avancé'` échouait avec `Data truncated for column 'niveau_competence'`, et l'approbation d'entreprise (`statut_validation='Validée'`) renvoyait une erreur 500. | Ajout de `SET NAMES utf8mb4;` en tête de `database/schema.sql` pour garantir l'encodage quel que soit le client. Base recréée et vérifiée (`HEX(COLUMN_TYPE)` = `C3A9`, encodage unique correct). |
| 2 | Fichiers de test (`uploads/companies/*.png, *.pdf`) commités par accident. | `git rm --cached`, ajout du dossier `uploads/companies/` au `.gitignore` (avec `.gitkeep`), suppression physique. |
| 3 | `.env.example` référencé par le README mais absent et ignoré par git. | Création de `.env.example`, retrait de la ligne `.env.example` du `.gitignore`. |

### 2.2 Backend — Offres d'emploi (workflow central)

| # | Problème | Correction |
|---|---|---|
| 4 | `GET /api/offres` ne renvoyait pas le nom de l'entreprise (le candidat ne sait pas qui recrute). | `offer.list` : jointure `JOIN entreprise`, renvoie `nom_entreprise`, `logo_entreprise`, `ville_entreprise`, `pays_entreprise`, `id_recruteur`. |
| 5 | La liste publique montrait les offres fermées/suspendues/expirées aux candidats. | Règle métier : un candidat ne voit que `statut_offre='Ouverte'` **et** `date_expiration >= CURDATE()`. Recruteur : toutes ses offres (`?mine=1`) ou toutes (`?statut=`). |
| 6 | `GET /api/offres/:id` renvoyait l'offre brute sans entreprise ni compétences requises. | `offer.get` : détail complet (offre + entreprise + `competences[]` avec niveau requis) ; une offre fermée/expirée n'est visible d'un candidat que s'il y a déjà candidaté (sinon 404). |
| 7 | `date_expiration` acceptait des dates passées. | Validation serveur : la date d'expiration doit être dans le futur (création **et** mise à jour) → 422 sinon. Normalisation `YYYY-MM-DD` avant insertion. |
| 8 | Recherche limitée au titre/localisation. | La recherche `q` couvre aussi le nom de l'entreprise. Tri contrôlé (liste blanche), pagination `page`/`limit`, filtre `statut` validé. |
| 9 | Suppression d'offre silencieuse en cas d'offre inexistante. | 404 explicite si `id_offre`/`id_entreprise` ne correspondent pas. |

### 2.3 Backend — Candidatures

| # | Problème | Correction |
|---|---|---|
| 10 | `PATCH /api/candidatures/:id/statut` n'acceptait que `statut_candidature` alors que le README et Swagger documentaient `statut`. | Le validateur accepte `statut_candidature` **ou** l'alias `statut` (un des deux requis, valeurs françaises exactes de l'ENUM). |
| 11 | `POST /api/offres/:id/postuler` sans validation de la lettre de motivation. | Validateur `applicationLetter` (max 5000 caractères, accepte `lettre_motivation` et `lettreMotivation`). |
| 12 | Vue recruteur des candidatures sans contact/CV/compétences/score. | `companyApplications` enrichie : `telephone`, `photo`, `cv`, `bio`, `competences` (liste GROUP_CONCAT), `score_compatibilite`. |
| 13 | Vue candidat sans lien vers le recruteur. | `myApplications` renvoie `id_recruteur` (propriétaire de l'entreprise). |
| 14 | Annulation de candidature : comportement correct conservé (uniquement si « En attente »), erreur 400 explicite sinon. | Conservé + testé (200 puis 400). |
| 15 | Candidature multiple : bloquée par la contrainte `uq_candidature` (apply once). | Conservé + testé (409). |

### 2.4 Backend — Administration, entreprises, notifications, messages

| # | Problème | Correction |
|---|---|---|
| 16 | Approbation d'une entreprise déjà traitée possible (idempotence absente). | `approve`/`reject` refusent une demande non `pending` (409). |
| 17 | `PATCH /api/admin/utilisateurs/:id/statut` renvoyait 200 même si l'utilisateur n'existait pas. | 404 si `affectedRows === 0`. |
| 18 | Duplication de la logique approbation (admin.controller + company.controller.validate). | Facteur commun `Company.approve()` / `Company.reject()` (transaction + promotion du rôle) ; les deux contrôleurs l'utilisent. |
| 19 | Aucun moyen de lister les contacts légitimes pour la messagerie. | Nouveau `GET /api/messages/contacts` : candidat → recruteurs approuvés ; recruteur → candidats ayant postulé ; admin → utilisateurs actifs. |
| 20 | Pas de « tout marquer lu » pour les notifications. | Nouveau `PATCH /api/notifications/lire-toutes`. |
| 21 | `swagger-output.json` obsolète (Swagger 2.0, version ancienne de l'API). | Régénéré depuis les routes actuelles (38 chemins, OpenAPI 3). |

### 2.5 Frontend

| # | Problème | Correction |
|---|---|---|
| 22 | **Formulaire « Nouvelle offre » du dashboard recruteur inerte** : `jobs.js` ne s'activait que sur `jobs`/`job-details`, jamais sur `recruiter-dashboard`. | `jobs.js` gère désormais `recruiter-dashboard` : création d'offre liée, re-rendu des stats. |
| 23 | Champ de recherche de `jobs.html` sans écouteur d'événement. | Recherche debounce + filtre statut (recruteurs/admins) + pagination (précédent/suivant + compteur). |
| 24 | `job-details.html` affichait la **liste** des offres au lieu du détail. | Page reconstruite : `?id=`, détail complet, entreprise, salaire, compétences requises, badge statut, **formulaire de candidature avec lettre de motivation**, état « déjà postulé », score de matching, accès restreint si offre fermée. |
| 25 | Aucun lien « Détails » dans la liste des offres ; bouton « Postuler » visible pour les recruteurs. | Lien Détails systématique ; bouton Postuler réservé aux candidats sur offres ouvertes. |
| 26 | Aucune gestion des offres côté recruteur (mise à jour, suppression, compétences requises). | Section « Mes offres » sur le dashboard recruteur : modifier (tous champs + statut), supprimer (avec confirmation), ajout de compétences requises (`niveau_requis`) par offre. |
| 27 | Aucune interface de changement de statut des candidatures côté recruteur. | Page Candidatures recruteur : carte par candidature (contact, lettre, bio, compétences, CV téléchargeable, score matching), sélecteur de statut (En attente / Présélectionnée / Entretien / Acceptée / Refusée), bouton « Contacter ». |
| 28 | Candidat : pas d'annulation ni de contact. | Tableau candidat : statut, score, lien offre, bouton Annuler (si en attente), bouton Contacter le recruteur. |
| 29 | Page messagerie en lecture seule (impossible d'envoyer un message). | `messages.html` : liste des conversations + fil de discussion + formulaire d'envoi avec sélecteur de destinataires (`/messages/contacts`), ouverture directe via `?dest=`. |
| 30 | Page Matching : saisie manuelle d'un ID d'offre. | Sélecteur d'offres ouvertes (titre + entreprise), résultat avec score et compétences matchées. |
| 31 | Dashboard admin : routes existantes sans UI (utilisateurs, compétences). | Sections « Utilisateurs » (tableau + suspendre/réactiver) et « Compétences » (création via formulaire, liste, suppression) ; entreprises en attente avec lien vers les documents justificatifs et motif de rejet. |
| 32 | `profile.html` bloquait les recruteurs alors que l'API autorise `candidat`+`recruteur`. | `Auth.requireRole(['candidat', 'recruteur'])`. |
| 33 | `company-details.html` affichait la liste des entreprises. | Page détail réelle (`?id=`) : infos complètes, statut, logo. |
| 34 | `create-company.html` acceptait images pour les documents alors que l'API n'accepte que le PDF. | `accept=".pdf"` aligné sur le backend. |
| 35 | Formulaire de contact inerte (bouton sans action). | Soumission avec confirmation (toast), réinitialisation. |
| 36 | Accueil non adapté aux utilisateurs connectés. | Boutons « Connexion/Inscription » remplacés par « Mon dashboard » une fois authentifié. |
| 37 | Notifications : pas de « tout marquer lu ». | Bouton + appel `PATCH /notifications/lire-toutes`. |

---

## 3. Fichiers modifiés

### Backend
| Fichier | Nature |
|---|---|
| `src/controllers/offer.controller.js` | Réécrit : `list` (jointure entreprise, filtres rôles, recherche, pagination), `get` (détail + compétences), validation date, 404 ownership |
| `src/controllers/job.controller.js` | `apply` (alias lettre), vues candidatures enrichies, statut avec alias `statut`, notifications |
| `src/controllers/admin.controller.js` | 404 utilisateur, garde « déjà traitée » (409), réutilisation `Company.approve/reject` |
| `src/controllers/company.controller.js` | `validate` réutilise `Company.approve/reject`, imports nettoyés |
| `src/controllers/message.controller.js` | Ajout `contacts` (contacts légitimes par rôle) |
| `src/controllers/notification.controller.js` | Ajout `readAll` |
| `src/models/company.model.js` | Ajout `approve()` / `reject()` transactionnels |
| `src/routes/resource.routes.js` | `GET /offres` → `offer.list`, `GET /offres/:id` → `offer.get` |
| `src/routes/jobs.routes.js` | Validateur `applicationLetter` sur postuler ; doc Swagger du statut corrigée |
| `src/routes/message.routes.js` | Ajout `GET /messages/contacts` (avant `/:userId`) |
| `src/routes/notification.routes.js` | Ajout `PATCH /notifications/lire-toutes` |
| `src/validators/common.validator.js` | `application` accepte `statut_candidature`/`statut` ; ajout `applicationLetter` |
| `database/schema.sql` | `SET NAMES utf8mb4` (anti mojibake) |
| `swagger-output.json` | Régénéré (OpenAPI 3, 38 chemins) |
| `README.md` | Documenté : workflow métier, endpoints réels, création du compte admin, encodage |

### Frontend
| Fichier | Nature |
|---|---|
| `frontend/js/jobs.js` | Réécrit : liste + recherche/filtre/pagination, détails, candidature, gestion des offres recruteur |
| `frontend/js/applications.js` | Réécrit : suivi candidat (annuler/contacter) + revue recruteur (statuts, CV, contact) |
| `frontend/js/dashboard.js` | Stats enrichies par rôle, utilisateurs admin, compétences admin, entreprises en attente (documents + rejet motivé) |
| `frontend/js/messages.js` | Conversations + fil + envoi avec contacts |
| `frontend/js/matching.js` | Sélecteur d'offres + score |
| `frontend/js/companies.js` | Détail d'entreprise réel |
| `frontend/js/notifications.js` | Tout marquer lu |
| `frontend/js/profile.js` | Autorise les recruteurs |
| `frontend/js/auth.js` | Accueil adapté à la session |
| `frontend/job-details.html` | Page détail reconstruite |
| `frontend/jobs.html` | Barre d'outils recherche/filtre/pagination |
| `frontend/recruiter-dashboard.html` | Section « Mes offres » |
| `frontend/admin-dashboard.html` | Sections utilisateurs + compétences |
| `frontend/messages.html` | Formulaire d'envoi + fil |
| `frontend/matching.html` | Sélecteur d'offres |
| `frontend/notifications.html` | Bouton « Tout marquer lu » |
| `frontend/create-company.html` | Documents PDF uniquement |
| `frontend/contact.html` | Formulaire fonctionnel |
| `frontend/index.html` | CTA adaptés à la session |
| `.gitignore`, `.env.example`, `uploads/companies/.gitkeep` | Nettoyage et configuration |

### Tests ajoutés
| Fichier | Contenu |
|---|---|
| `test/e2e-workflow.js` | 47 assertions API de bout en bout (nécessite serveur + token admin + base fraîche ou seedée) |
| `test/frontend-smoke.js` | 21 assertions jsdom sur les pages réelles (comptes du seed, nécessite `npm i --no-save jsdom`) |
| `database/seed.sql` | Jeu de démonstration idempotent : admin/recruteur/candidat, entreprise approuvée, 5 compétences, 3 offres ouvertes avec compétences requises, candidature + matching |

---

## 4. Routes ajoutées

| Route | Méthode | Rôle | Description |
|---|---|---|---|
| `/api/messages/contacts` | GET | tous | Contacts légitimes pour la messagerie |
| `/api/notifications/lire-toutes` | PATCH | tous | Marquer toutes les notifications comme lues |

(Routes existantes corrigées : `GET /offres` et `GET /offres/:id` ont un comportement et un payload corrigés.)

---

## 5. Changements de base de données

- **Aucun changement structurel** : le schéma existant (`utilisateur`, `profil_professionnel`, `competence`, `utilisateur_competence`, `experience_professionnelle`, `diplome`, `entreprise`, `offre_emploi`, `offre_competence`, `candidature`, `matching`, `message`, `notification`) est conforme à la logique métier et a été conservé tel quel (contraintes FK, clés uniques `uq_candidature` et `uq_matching`, index de recherche déjà présents).
- Correction d'encodage dans `database/schema.sql` (`SET NAMES utf8mb4`).
- Vérification de l'intégrité : toutes les FK se résolvent, les ENUM sont correctement encodés, `candidature` et `matching` respectent l'unicité (candidature unique, matching unique).

---

## 6. Contrôleurs corrigés

`offer.controller.js`, `job.controller.js`, `admin.controller.js`, `company.controller.js`, `message.controller.js`, `notification.controller.js`, `resource.routes.js` (aiguillage), `company.model.js` (helpers), `common.validator.js`.

---

## 7. Logique métier corrigée

1. Un candidat ne voit que les offres **ouvertes et non expirées** ; une offre fermée n'est visible que si le candidat y a postulé.
2. Un recruteur ne gère que les offres de **ses entreprises approuvées** (vérification ownership systématique sur create/update/delete/skills).
3. L'approbation d'entreprise est **transactionnelle** et **idempotente** (409 si déjà traitée) ; elle promeut le propriétaire au rôle recruteur.
4. La date d'expiration d'une offre doit être **dans le futur**.
5. Le statut de candidature accepte `statut_candidature` ou `statut` (rétro-compatibilité README/Postman), valeurs de l'ENUM uniquement.
6. La candidature est **unique** (contrainte DB + 409) et annulable uniquement si « En attente ».
7. Notifications systématiques : nouvelle offre → tous les candidats actifs ; candidature → recruteur ; changement de statut → candidat ; approbation/rejet entreprise → demandeur ; message → destinataire.
8. Matching recalculé et persisté à chaque candidature et à chaque consultation.

---

## 8. Points restants (non bloquants)

1. **Pas de table « recruteur » séparée** — choix d'architecture assumé (README) : le rôle et l'entreprise approuvée suffisent. Un recruteur ne peut gérer qu'une entreprise approuvée à la fois (`findApprovedByOwner LIMIT 1`).
2. **`PATCH /api/entreprises/:id/validation`** (route générique) et `PUT /api/admin/companies/:id/approve|reject` coexistent volontairement (API documentée + API admin) mais partagent désormais la même logique.
3. **Aucun compte administrateur seedé** : volontaire (sécurité). La procédure de création est documentée dans le README.
4. **Pas de rappels automatiques** d'expiration d'offre (cron) — hors périmètre.
5. **Entretien** : le statut « Entretien » existe et est gérable ; la planification d'un créneau (date/salle) n'est pas modélisée en base.
6. La suppression d'une offre supprime ses candidatures (cascade) — comportement à confirmer métier si l'historique doit être conservé.
7. `test/frontend-smoke.js` nécessite `npm i --no-save jsdom` (non ajouté aux dépendances pour ne pas alourdir le projet).
8. La photo/CV d'un candidat ne sont pas copiés dans la candidature (le lien pointe vers le profil) — si le profil évolue, la candidature affiche la version courante.

---

## 9. Recommandations

1. **CI** : exécuter `test/e2e-workflow.js` dans GitHub Actions (services: mysql) à chaque push.
2. **Sécurité** : forcer `NODE_ENV=production` + `helmet` déjà actif ; limiter `CORS_ORIGIN` en production.
3. **`uploads`** : stocker les fichiers sur un bucket S3 à terme ; garder le dossier local pour le développement.
4. **Entretiens** : ajouter une table `entretien(id_candidature, date, lieu, lien)` si la planification devient un besoin réel.
5. **Accessibilité** : ajouter `aria-label` sur les boutons icônes et les sélecteurs de statut.
6. **Tests unitaires** : couvrir le service de matching avec des cas limites (aucune compétence requise, niveau supérieur au requis).
7. **Pagination** : exposer `X-Total-Count` en en-tête pour faciliter les clients HTTP autres que le frontend.

---

## 10. Preuve de fonctionnement

- `test/e2e-workflow.js` : **47/47 PASS** (API réelle, MySQL 11.5, base recréée depuis `database/schema.sql`).
- `test/frontend-smoke.js` : **21/21 PASS** (pages réelles servies par Express, scripts exécutés dans jsdom, y compris l'envoi d'une candidature depuis le formulaire du détail d'offre).
