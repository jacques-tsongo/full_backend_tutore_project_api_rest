-- Jeu de données de démonstration (développement / tests uniquement).
-- À exécuter après database/schema.sql :
--   mysql -u root -p gestion_carrieres < database/seed.sql
-- Comptes créés (mot de passe en clair indiqué pour la démo) :
--   admin@example.com     / Admin123!      (administrateur)
--   recruteur@example.com / Recruteur123!  (recruteur, entreprise approuvée)
--   candidat@example.com  / Candidat123!   (candidat)
-- Le script est idempotent : il peut être rejoué sans erreur.

SET NAMES utf8mb4;

-- --- Utilisateurs ---------------------------------------------------------
INSERT INTO utilisateur (nom, prenom, email, mot_de_passe, telephone, role)
SELECT 'Admin', 'Super', 'admin@example.com', '$2b$12$Wm6Avgv9zJZaOpp9DGWGRe4/KiQdsMZtN6DkPJFO4RcjMap7Z13Rm', '+243800000000', 'administrateur'
WHERE NOT EXISTS (SELECT 1 FROM utilisateur WHERE email = 'admin@example.com');

INSERT INTO utilisateur (nom, prenom, email, mot_de_passe, telephone, role)
SELECT 'Mukendi', 'Paul', 'recruteur@example.com', '$2b$12$5NIky9yk4dpmgNEiFlTDvevM29i/CShn1FzvbDWfrU7wF7I3qJ09u', '+243810000001', 'candidat'
WHERE NOT EXISTS (SELECT 1 FROM utilisateur WHERE email = 'recruteur@example.com');

INSERT INTO utilisateur (nom, prenom, email, mot_de_passe, telephone, role)
SELECT 'Ilunga', 'Sarah', 'candidat@example.com', '$2b$12$pzeLIdsDhNKr9PbVjsIRMu7UAWYe65ODwwn.jCt1/hILzq2Ff8I7C', '+243810000002', 'candidat'
WHERE NOT EXISTS (SELECT 1 FROM utilisateur WHERE email = 'candidat@example.com');

-- --- Profils --------------------------------------------------------------
INSERT INTO profil_professionnel (bio, adresse, id_utilisateur)
SELECT 'Développeuse fullstack passionnée par les architectures REST.', 'Kinshasa, RDC', id_utilisateur
FROM utilisateur WHERE email = 'candidat@example.com'
AND NOT EXISTS (SELECT 1 FROM profil_professionnel p JOIN utilisateur u ON u.id_utilisateur = p.id_utilisateur WHERE u.email = 'candidat@example.com');

-- --- Entreprise approuvée (recruteur) -------------------------------------
INSERT INTO entreprise (id_utilisateur, nom_entreprise, secteur_activite, adresse, ville, pays, telephone, email, site_web, description, numero_rccm, numero_fiscal, status, statut_validation)
SELECT u.id_utilisateur, 'Tech Solutions SARL', 'Informatique', '12 Av. du Commerce', 'Kinshasa', 'RDC', '+243810000001', 'contact@techsolutions.cd', 'https://techsolutions.cd', 'Entreprise de développement logiciel et d’intégration.', 'RCCM/CD/KIN/2024/1234', 'FISCAL-2024-001', 'approved', 'Validée'
FROM utilisateur u WHERE u.email = 'recruteur@example.com'
AND NOT EXISTS (SELECT 1 FROM entreprise WHERE nom_entreprise = 'Tech Solutions SARL');

-- Le propriétaire devient recruteur.
UPDATE utilisateur SET role = 'recruteur' WHERE email = 'recruteur@example.com'
AND EXISTS (SELECT 1 FROM entreprise WHERE nom_entreprise = 'Tech Solutions SARL' AND status = 'approved');

-- --- Compétences ----------------------------------------------------------
INSERT INTO competence (nom_competence, description)
SELECT 'JavaScript', 'Langage de programmation web' FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM competence WHERE nom_competence = 'JavaScript');
INSERT INTO competence (nom_competence, description)
SELECT 'Node.js', 'Exécution JavaScript côté serveur' FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM competence WHERE nom_competence = 'Node.js');
INSERT INTO competence (nom_competence, description)
SELECT 'MySQL', 'Base de données relationnelle' FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM competence WHERE nom_competence = 'MySQL');
INSERT INTO competence (nom_competence, description)
SELECT 'React', 'Bibliothèque d’interface utilisateur' FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM competence WHERE nom_competence = 'React');
INSERT INTO competence (nom_competence, description)
SELECT 'Python', 'Langage de programmation généraliste' FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM competence WHERE nom_competence = 'Python');

-- --- Offres ---------------------------------------------------------------
INSERT INTO offre_emploi (titre_offre, description_offre, salaire, localisation, date_expiration, statut_offre, id_entreprise)
SELECT 'Développeur Backend Node.js', 'Conception et maintenance d’APIs REST Node.js/Express avec MySQL.', 1500.00, 'Kinshasa', DATE_ADD(CURDATE(), INTERVAL 90 DAY), 'Ouverte', id_entreprise
FROM entreprise WHERE nom_entreprise = 'Tech Solutions SARL'
AND NOT EXISTS (SELECT 1 FROM offre_emploi WHERE titre_offre = 'Développeur Backend Node.js');

INSERT INTO offre_emploi (titre_offre, description_offre, salaire, localisation, date_expiration, statut_offre, id_entreprise)
SELECT 'Développeur Frontend React', 'Création d’interfaces modernes avec React et intégration d’APIs REST.', 1200.00, 'Kinshasa', DATE_ADD(CURDATE(), INTERVAL 60 DAY), 'Ouverte', id_entreprise
FROM entreprise WHERE nom_entreprise = 'Tech Solutions SARL'
AND NOT EXISTS (SELECT 1 FROM offre_emploi WHERE titre_offre = 'Développeur Frontend React');

INSERT INTO offre_emploi (titre_offre, description_offre, salaire, localisation, date_expiration, statut_offre, id_entreprise)
SELECT 'Data Analyst Python', 'Analyse de données et reporting avec Python.', 1800.00, 'Lubumbashi', DATE_ADD(CURDATE(), INTERVAL 45 DAY), 'Ouverte', id_entreprise
FROM entreprise WHERE nom_entreprise = 'Tech Solutions SARL'
AND NOT EXISTS (SELECT 1 FROM offre_emploi WHERE titre_offre = 'Data Analyst Python');

-- --- Compétences requises par offre ---------------------------------------
INSERT INTO offre_competence (id_offre, id_competence, niveau_requis)
SELECT o.id_offre, c.id_competence, 'Avancé'
FROM offre_emploi o, competence c
WHERE o.titre_offre = 'Développeur Backend Node.js' AND c.nom_competence = 'Node.js'
AND NOT EXISTS (SELECT 1 FROM offre_competence oc WHERE oc.id_offre = o.id_offre AND oc.id_competence = c.id_competence);

INSERT INTO offre_competence (id_offre, id_competence, niveau_requis)
SELECT o.id_offre, c.id_competence, 'Intermédiaire'
FROM offre_emploi o, competence c
WHERE o.titre_offre = 'Développeur Backend Node.js' AND c.nom_competence = 'MySQL'
AND NOT EXISTS (SELECT 1 FROM offre_competence oc WHERE oc.id_offre = o.id_offre AND oc.id_competence = c.id_competence);

INSERT INTO offre_competence (id_offre, id_competence, niveau_requis)
SELECT o.id_offre, c.id_competence, 'Avancé'
FROM offre_emploi o, competence c
WHERE o.titre_offre = 'Développeur Frontend React' AND c.nom_competence = 'React'
AND NOT EXISTS (SELECT 1 FROM offre_competence oc WHERE oc.id_offre = o.id_offre AND oc.id_competence = c.id_competence);

INSERT INTO offre_competence (id_offre, id_competence, niveau_requis)
SELECT o.id_offre, c.id_competence, 'Intermédiaire'
FROM offre_emploi o, competence c
WHERE o.titre_offre = 'Data Analyst Python' AND c.nom_competence = 'Python'
AND NOT EXISTS (SELECT 1 FROM offre_competence oc WHERE oc.id_offre = o.id_offre AND oc.id_competence = c.id_competence);

-- --- Compétences du candidat + matching -----------------------------------
INSERT INTO utilisateur_competence (id_utilisateur, id_competence, niveau_competence)
SELECT u.id_utilisateur, c.id_competence, 'Avancé'
FROM utilisateur u, competence c
WHERE u.email = 'candidat@example.com' AND c.nom_competence = 'JavaScript'
AND NOT EXISTS (SELECT 1 FROM utilisateur_competence uc WHERE uc.id_utilisateur = u.id_utilisateur AND uc.id_competence = c.id_competence);

INSERT INTO utilisateur_competence (id_utilisateur, id_competence, niveau_competence)
SELECT u.id_utilisateur, c.id_competence, 'Intermédiaire'
FROM utilisateur u, competence c
WHERE u.email = 'candidat@example.com' AND c.nom_competence = 'Node.js'
AND NOT EXISTS (SELECT 1 FROM utilisateur_competence uc WHERE uc.id_utilisateur = u.id_utilisateur AND uc.id_competence = c.id_competence);

INSERT INTO matching (id_utilisateur, id_offre, score_compatibilite)
SELECT u.id_utilisateur, o.id_offre, 50.00
FROM utilisateur u, offre_emploi o
WHERE u.email = 'candidat@example.com' AND o.titre_offre = 'Développeur Backend Node.js'
AND NOT EXISTS (SELECT 1 FROM matching m WHERE m.id_utilisateur = u.id_utilisateur AND m.id_offre = o.id_offre);

-- --- Candidature de démonstration -----------------------------------------
INSERT INTO candidature (id_utilisateur, id_offre, lettre_motivation, statut_candidature)
SELECT u.id_utilisateur, o.id_offre, 'Je suis motivée à rejoindre votre équipe technique.', 'En attente'
FROM utilisateur u, offre_emploi o
WHERE u.email = 'candidat@example.com' AND o.titre_offre = 'Développeur Backend Node.js'
AND NOT EXISTS (SELECT 1 FROM candidature c WHERE c.id_utilisateur = u.id_utilisateur AND c.id_offre = o.id_offre);

-- --- Message non lu + notification non lue (démo des compteurs) -----------
-- La colonne `lu` (migration 20260809_message_read_tracking.sql) vaut 0 par
-- défaut : ce message apparaît donc comme non lu pour le candidat.
INSERT INTO message (contenu, id_expediteur, id_destinataire)
SELECT 'Bonjour Sarah, votre profil correspond à notre offre Backend Node.js. Pouvons-nous échanger ?',
       r.id_utilisateur, c.id_utilisateur
FROM utilisateur r, utilisateur c
WHERE r.email = 'recruteur@example.com' AND c.email = 'candidat@example.com'
AND NOT EXISTS (
  SELECT 1 FROM message m
  WHERE m.id_expediteur = r.id_utilisateur AND m.id_destinataire = c.id_utilisateur
    AND m.contenu LIKE 'Bonjour Sarah, votre profil correspond%'
);

INSERT INTO notification (contenu_notification, id_utilisateur)
SELECT 'Nouveau message de Paul Mukendi (Tech Solutions SARL).', c.id_utilisateur
FROM utilisateur c
WHERE c.email = 'candidat@example.com'
AND NOT EXISTS (
  SELECT 1 FROM notification n
  WHERE n.id_utilisateur = c.id_utilisateur
    AND n.contenu_notification LIKE 'Nouveau message de Paul Mukendi%'
);
