-- Base officielle : gestion_carrieres
-- La relation recruteur est volontairement normalisée : un recruteur est un
-- utilisateur dont le role devient 'recruteur' après approbation de son entreprise.

-- Garantit l'encodage UTF-8 des valeurs accentuées (ENUM, textes) quel que
-- soit le charset du client qui exécute ce script (évite le double encodage).
SET NAMES utf8mb4;

CREATE DATABASE IF NOT EXISTS gestion_carrieres CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE gestion_carrieres;

CREATE TABLE utilisateur (
  id_utilisateur INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  nom VARCHAR(100) NOT NULL,
  prenom VARCHAR(100) NOT NULL,
  email VARCHAR(150) NOT NULL UNIQUE,
  mot_de_passe VARCHAR(255) NOT NULL,
  telephone VARCHAR(20) NULL,
  photo VARCHAR(255) NULL,
  role ENUM('candidat','recruteur','administrateur') NOT NULL DEFAULT 'candidat',
  date_inscription DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  statut_compte ENUM('actif','inactif','suspendu') NOT NULL DEFAULT 'actif',
  INDEX idx_utilisateur_role_statut (role, statut_compte)
) ENGINE=InnoDB;

CREATE TABLE domaine (
  id_domaine INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  nom_domaine VARCHAR(150) NOT NULL UNIQUE
) ENGINE=InnoDB;

CREATE TABLE profil_professionnel (
  id_profil INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  id_domaine INT UNSIGNED NULL,
  bio TEXT NULL,
  adresse VARCHAR(255) NULL,
  date_naissance DATE NULL,
  lieu_naissance VARCHAR(150) NULL,
  cv VARCHAR(255) NULL,
  id_utilisateur INT UNSIGNED NOT NULL UNIQUE,
  INDEX idx_profil_domaine (id_domaine),
  CONSTRAINT fk_profil_domaine FOREIGN KEY (id_domaine) REFERENCES domaine(id_domaine) ON DELETE RESTRICT,
  CONSTRAINT fk_profil_utilisateur FOREIGN KEY (id_utilisateur) REFERENCES utilisateur(id_utilisateur) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE competence (
  id_competence INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  -- Relation DOMAINE (1,N) → COMPETENCE. NULLABLE pour préserver les
  -- compétences historiques ; l'application exige un domaine pour toute
  -- nouvelle compétence créée par l'administrateur.
  id_domaine INT UNSIGNED NULL,
  nom_competence VARCHAR(100) NOT NULL UNIQUE,
  description TEXT NULL,
  INDEX idx_competence_domaine (id_domaine),
  CONSTRAINT fk_competence_domaine FOREIGN KEY (id_domaine) REFERENCES domaine(id_domaine) ON DELETE RESTRICT
) ENGINE=InnoDB;

CREATE TABLE utilisateur_competence (
  id_utilisateur INT UNSIGNED NOT NULL,
  id_competence INT UNSIGNED NOT NULL,
  niveau_competence ENUM('Débutant','Intermédiaire','Avancé','Expert') NOT NULL DEFAULT 'Débutant',
  PRIMARY KEY (id_utilisateur, id_competence),
  CONSTRAINT fk_uc_utilisateur FOREIGN KEY (id_utilisateur) REFERENCES utilisateur(id_utilisateur) ON DELETE CASCADE,
  CONSTRAINT fk_uc_competence FOREIGN KEY (id_competence) REFERENCES competence(id_competence) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE experience_professionnelle (
  id_experience INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  poste VARCHAR(150) NOT NULL,
  entreprise VARCHAR(150) NOT NULL,
  date_debut DATE NOT NULL,
  date_fin DATE NULL,
  description TEXT NULL,
  id_utilisateur INT UNSIGNED NOT NULL,
  INDEX idx_experience_utilisateur (id_utilisateur),
  CONSTRAINT fk_experience_utilisateur FOREIGN KEY (id_utilisateur) REFERENCES utilisateur(id_utilisateur) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE diplome (
  id_diplome INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  intitule VARCHAR(150) NOT NULL,
  etablissement VARCHAR(150) NOT NULL,
  annee_obtention YEAR NOT NULL,
  id_utilisateur INT UNSIGNED NOT NULL,
  INDEX idx_diplome_utilisateur (id_utilisateur),
  CONSTRAINT fk_diplome_utilisateur FOREIGN KEY (id_utilisateur) REFERENCES utilisateur(id_utilisateur) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE entreprise (
  id_entreprise INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  id_utilisateur INT UNSIGNED NULL,
  id_domaine INT UNSIGNED NULL,
  nom_entreprise VARCHAR(150) NOT NULL,
  secteur_activite VARCHAR(150) NULL,
  adresse VARCHAR(255) NULL,
  ville VARCHAR(120) NULL,
  pays VARCHAR(120) NULL,
  telephone VARCHAR(20) NULL,
  email VARCHAR(150) NULL,
  site_web VARCHAR(255) NULL,
  description TEXT NULL,
  logo VARCHAR(255) NULL,
  numero_rccm VARCHAR(100) NULL,
  numero_fiscal VARCHAR(100) NULL,
  documents_justificatifs JSON NULL,
  status ENUM('pending','approved','rejected') NOT NULL DEFAULT 'pending',
  statut_validation ENUM('En attente','Validée','Rejetée') NOT NULL DEFAULT 'En attente',
  approved_by INT UNSIGNED NULL,
  approved_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_entreprise_owner_status (id_utilisateur, status),
  INDEX idx_entreprise_status (status),
  INDEX idx_entreprise_nom (nom_entreprise),
  INDEX idx_entreprise_domaine (id_domaine),
  CONSTRAINT fk_entreprise_domaine FOREIGN KEY (id_domaine) REFERENCES domaine(id_domaine) ON DELETE RESTRICT,
  CONSTRAINT fk_entreprise_owner FOREIGN KEY (id_utilisateur) REFERENCES utilisateur(id_utilisateur) ON DELETE SET NULL,
  CONSTRAINT fk_entreprise_approved_by FOREIGN KEY (approved_by) REFERENCES utilisateur(id_utilisateur) ON DELETE SET NULL
) ENGINE=InnoDB;

CREATE TABLE offre_emploi (
  id_offre INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  titre_offre VARCHAR(200) NOT NULL,
  description_offre TEXT NOT NULL,
  salaire DECIMAL(12,2) NULL,
  localisation VARCHAR(150) NOT NULL,
  date_publication DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  date_expiration DATE NOT NULL,
  statut_offre ENUM('Ouverte','Fermée','Suspendue') NOT NULL DEFAULT 'Ouverte',
  id_entreprise INT UNSIGNED NOT NULL,
  id_domaine INT UNSIGNED NULL,
  CONSTRAINT fk_offre_entreprise FOREIGN KEY (id_entreprise) REFERENCES entreprise(id_entreprise) ON DELETE RESTRICT,
  CONSTRAINT fk_offre_domaine FOREIGN KEY (id_domaine) REFERENCES domaine(id_domaine) ON DELETE RESTRICT,
  INDEX idx_offre_domaine (id_domaine, statut_offre, date_expiration),
  INDEX idx_offre_recherche (statut_offre, localisation, date_expiration),
  INDEX idx_offre_entreprise (id_entreprise)
) ENGINE=InnoDB;

CREATE TABLE offre_competence (
  id_offre INT UNSIGNED NOT NULL,
  id_competence INT UNSIGNED NOT NULL,
  niveau_requis ENUM('Débutant','Intermédiaire','Avancé','Expert') NOT NULL DEFAULT 'Débutant',
  PRIMARY KEY (id_offre, id_competence),
  CONSTRAINT fk_oc_offre FOREIGN KEY (id_offre) REFERENCES offre_emploi(id_offre) ON DELETE CASCADE,
  CONSTRAINT fk_oc_competence FOREIGN KEY (id_competence) REFERENCES competence(id_competence) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE candidature (
  id_candidature INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  date_candidature DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  statut_candidature ENUM('En attente','Présélectionnée','Entretien','Acceptée','Refusée','Annulée') NOT NULL DEFAULT 'En attente',
  lettre_motivation TEXT NULL,
  id_utilisateur INT UNSIGNED NOT NULL,
  id_offre INT UNSIGNED NOT NULL,
  UNIQUE KEY uq_candidature (id_utilisateur, id_offre),
  INDEX idx_candidature_offre_statut (id_offre, statut_candidature),
  CONSTRAINT fk_candidature_utilisateur FOREIGN KEY (id_utilisateur) REFERENCES utilisateur(id_utilisateur) ON DELETE CASCADE,
  CONSTRAINT fk_candidature_offre FOREIGN KEY (id_offre) REFERENCES offre_emploi(id_offre) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE matching (
  id_matching INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  score_compatibilite DECIMAL(5,2) NOT NULL,
  date_matching DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  id_utilisateur INT UNSIGNED NOT NULL,
  id_offre INT UNSIGNED NOT NULL,
  UNIQUE KEY uq_matching (id_utilisateur, id_offre),
  CONSTRAINT fk_matching_utilisateur FOREIGN KEY (id_utilisateur) REFERENCES utilisateur(id_utilisateur) ON DELETE CASCADE,
  CONSTRAINT fk_matching_offre FOREIGN KEY (id_offre) REFERENCES offre_emploi(id_offre) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE message (
  id_message INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  contenu TEXT NOT NULL,
  date_message DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  id_expediteur INT UNSIGNED NOT NULL,
  id_destinataire INT UNSIGNED NOT NULL,
  INDEX idx_message_conversation (id_expediteur, id_destinataire, date_message),
  CONSTRAINT fk_message_expediteur FOREIGN KEY (id_expediteur) REFERENCES utilisateur(id_utilisateur) ON DELETE CASCADE,
  CONSTRAINT fk_message_destinataire FOREIGN KEY (id_destinataire) REFERENCES utilisateur(id_utilisateur) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE notification (
  id_notification INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  contenu_notification TEXT NOT NULL,
  date_notification DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  statut_notification ENUM('Non lue','Lue') NOT NULL DEFAULT 'Non lue',
  id_utilisateur INT UNSIGNED NOT NULL,
  INDEX idx_notification_utilisateur (id_utilisateur, statut_notification, date_notification),
  CONSTRAINT fk_notification_utilisateur FOREIGN KEY (id_utilisateur) REFERENCES utilisateur(id_utilisateur) ON DELETE CASCADE
) ENGINE=InnoDB;
