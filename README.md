# Gestion Carrières — API REST

Backend Node.js/Express/MySQL d’une plateforme de gestion des carrières et offres d’emploi. Les réponses suivent toujours le format `{ success, message, data }` ou `{ success, message, errors }`.

## Installation

1. Créez la base avec [database/schema.sql](database/schema.sql) dans MySQL.
2. Copiez `.env.example` vers `.env` et renseignez vos identifiants MySQL ainsi qu’un `JWT_SECRET` robuste.
3. Exécutez `npm install`, puis `npm run dev`.

L’API est accessible sur `http://localhost:5000/api`. Vérification : `GET /api/health`.
L’application web vanilla HTML/CSS/JavaScript est servie par Express depuis `frontend/` sur `http://localhost:5000`.

## Décisions de modélisation

Le diagramme physique associait aussi `competence` à un utilisateur, tout en ayant `utilisateur_competence`. Cela créait deux relations contradictoires. Le schéma conserve la relation N:N officielle via `utilisateur_competence`, avec le niveau de maîtrise.

Les utilisateurs ne choisissent jamais leur rôle à l’inscription : tout nouveau compte est `candidat`. Un candidat devient `recruteur` uniquement après soumission d’une entreprise et approbation administrateur. La table `recruteur` n’est plus nécessaire : la relation recruteur est représentée par `utilisateur.role = 'recruteur'` et une `entreprise.status = 'approved'` liée à `entreprise.id_utilisateur`.

## Endpoints principaux

- `POST /api/auth/register`, `POST /api/auth/login`, `GET|PUT /api/auth/me`
- `GET|POST|PUT|DELETE /api/competences`, `/api/experiences`, `/api/diplomes`, `/api/entreprises`, `/api/offres`
- `GET|POST|DELETE /api/mes-competences`
- `GET|PUT /api/profil`, `POST /api/profil/photo`, `POST /api/profil/cv`
- `POST /api/offres/:id/postuler`, `GET /api/candidatures/me`, `PATCH /api/candidatures/:id/annuler`
- `PUT /api/offres/:id/competences`, `GET /api/candidatures/recues`, `PATCH /api/candidatures/:id/statut`
- `GET /api/offres/:id/matching`, `POST|GET /api/messages`, `GET /api/notifications`
- `GET /api/admin/utilisateurs`, `PATCH /api/admin/utilisateurs/:id/statut`, `GET /api/admin/statistiques`

Les routes protégées attendent `Authorization: Bearer <token>`. Les listes acceptent `page`, `limit`, `q`, `sort` et `order` ; les offres acceptent aussi `statut`.

## Matching

Le score est la moyenne des niveaux de compétences du candidat, plafonnée par le niveau demandé pour chaque compétence de l’offre, exprimée en pourcentage. Il est sauvegardé dans `matching` à chaque calcul ou candidature.
