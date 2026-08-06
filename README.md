# Gestion Carrières — API REST

Backend Node.js/Express/MySQL d’une plateforme de gestion des carrières et offres d’emploi. Les réponses suivent toujours le format `{ success, message, data }` ou `{ success, message, errors }`.

## Installation

1. Créez la base avec [database/schema.sql](database/schema.sql) dans MySQL (le script force `SET NAMES utf8mb4` pour éviter tout problème d’encodage des valeurs accentuées).
2. Copiez `.env.example` vers `.env` et renseignez vos identifiants MySQL ainsi qu’un `JWT_SECRET` robuste.
3. Exécutez `npm install`, puis `npm run dev`.

L’API est accessible sur `http://localhost:5000/api`. Vérification : `GET /api/health`.
L’application web vanilla HTML/CSS/JavaScript est servie par Express depuis `frontend/` sur `http://localhost:5000`.
Documentation Swagger : `http://localhost:5000/api-docs`.

## Décisions de modélisation

Le diagramme physique associait aussi `competence` à un utilisateur, tout en ayant `utilisateur_competence`. Cela créait deux relations contradictoires. Le schéma conserve la relation N:N officielle via `utilisateur_competence`, avec le niveau de maîtrise.

Les utilisateurs ne choisissent jamais leur rôle à l’inscription : tout nouveau compte est `candidat`. Un candidat devient `recruteur` uniquement après soumission d’une entreprise et approbation administrateur. La table `recruteur` n’est plus nécessaire : la relation recruteur est représentée par `utilisateur.role = 'recruteur'` et une `entreprise.status = 'approved'` liée à `entreprise.id_utilisateur`.

## Workflow métier

1. Un candidat s’inscrit, complète son profil (bio, adresse, photo, CV) et ses compétences.
2. Il soumet une entreprise (`POST /api/entreprises/demande-recruteur`, fichiers multipart : `logo`, `supporting_documents` PDF).
3. L’administrateur approuve ou rejette la demande (`PUT /api/admin/companies/:id/approve` ou `/reject`). L’approbation promeut l’utilisateur au rôle `recruteur`.
4. Le recruteur crée des offres (`POST /api/offres`), gère leurs compétences requises (`PUT /api/offres/:id/competences`), modifie/supprime ses offres.
5. Les candidats consultent les offres ouvertes (recherche `q`, pagination `page`/`limit`), voient les détails (entreprise, compétences requises, score de matching) et postulent une seule fois (`POST /api/offres/:id/postuler`).
6. Le recruteur examine les candidatures reçues (`GET /api/candidatures/recues` : CV, contact, compétences, score) et change leur statut (`PATCH /api/candidatures/:id/statut` avec `statut_candidature` ou l’alias `statut`).
7. Candidat et recruteur reçoivent des notifications et peuvent échanger des messages.

## Endpoints principaux

- `POST /api/auth/register`, `POST /api/auth/login`, `GET|PUT /api/auth/me`, `POST /api/auth/logout`
- `GET|POST|PUT|DELETE /api/competences`, `/api/experiences`, `/api/diplomes`, `/api/entreprises`
- `GET /api/offres` (liste : `q`, `statut`, `mine=1` pour le recruteur, `page`, `limit`, `sort`, `order`), `GET|POST /api/offres`, `GET|PUT|DELETE /api/offres/:id`
- `PUT /api/offres/:id/competences`, `GET /api/offres/:id/matching`, `POST /api/offres/:id/postuler`
- `GET|POST|DELETE /api/mes-competences` (`GET /api/mes-competences/:id` en DELETE)
- `GET|PUT /api/profil`, `POST /api/profil/photo`, `POST /api/profil/cv`
- `GET /api/candidatures/me`, `PATCH /api/candidatures/:id/annuler`
- `GET /api/candidatures/recues`, `PATCH /api/candidatures/:id/statut`
- `POST|GET /api/messages`, `GET /api/messages/:userId`, `GET /api/messages/contacts`
- `GET /api/notifications`, `PATCH /api/notifications/:id/lire`, `PATCH /api/notifications/lire-toutes`
- `POST /api/entreprises/demande-recruteur`, `GET /api/recruteurs/me`, `PATCH /api/entreprises/:id/validation`
- `GET /api/admin/utilisateurs`, `PATCH /api/admin/utilisateurs/:id/statut`, `GET /api/admin/statistiques`
- `GET /api/admin/companies/pending`, `GET /api/admin/companies/:id`, `PUT /api/admin/companies/:id/approve|reject`

Les routes protégées attendent `Authorization: Bearer <token>`. Les listes acceptent `page`, `limit`, `q`, `sort` et `order`.

## Matching

Le score est la moyenne des niveaux de compétences du candidat, plafonnée par le niveau demandé pour chaque compétence de l’offre, exprimée en pourcentage. Il est sauvegardé dans `matching` à chaque calcul ou candidature.

## Compte administrateur initial

Aucun compte admin n’est créé par le schéma. Créez-le manuellement :

```sql
INSERT INTO utilisateur (nom, prenom, email, mot_de_passe, role) VALUES ('Admin', 'Super', 'admin@example.com', '<hash bcrypt du mot de passe>', 'administrateur');
```

Générez le hash avec `node hash-password.js` (ou `bcrypt.hash('VotreMotDePasse', 12)`).

## Jeu de données de démonstration

`database/seed.sql` crée un jeu de données complet et idempotent (à exécuter après `schema.sql`) :

- `admin@example.com` / `Admin123!` — administrateur
- `recruteur@example.com` / `Recruteur123!` — recruteur (entreprise « Tech Solutions SARL » approuvée)
- `candidat@example.com` / `Candidat123!` — candidat
- 5 compétences, 3 offres ouvertes avec compétences requises, 1 candidature + 1 matching
