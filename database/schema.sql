-- Base officielle : gestion_carrieres
-- Correction MERISE : competence est un référentiel global. Son lien avec
-- utilisateur est uniquement utilisateur_competence (pas de id_utilisateur redondant).
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
  statut_compte ENUM('actif','inactif','suspendu') NOT NULL DEFAULT 'actif'
) ENGINE=InnoDB;

CREATE TABLE profil_professionnel (
  id_profil INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  bio TEXT NULL,
  adresse VARCHAR(255) NULL,
  date_naissance DATE NULL,
  lieu_naissance VARCHAR(150) NULL,
  cv VARCHAR(255) NULL,
  id_utilisateur INT UNSIGNED NOT NULL UNIQUE,
  CONSTRAINT fk_profil_utilisateur FOREIGN KEY (id_utilisateur) REFERENCES utilisateur(id_utilisateur) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE competence (
  id_competence INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  nom_competence VARCHAR(100) NOT NULL UNIQUE,
  description TEXT NULL
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
  CONSTRAINT fk_experience_utilisateur FOREIGN KEY (id_utilisateur) REFERENCES utilisateur(id_utilisateur) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE diplome (
  id_diplome INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  intitule VARCHAR(150) NOT NULL,
  etablissement VARCHAR(150) NOT NULL,
  annee_obtention YEAR NOT NULL,
  id_utilisateur INT UNSIGNED NOT NULL,
  CONSTRAINT fk_diplome_utilisateur FOREIGN KEY (id_utilisateur) REFERENCES utilisateur(id_utilisateur) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE entreprise (
  id_entreprise INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  nom_entreprise VARCHAR(150) NOT NULL,
  adresse VARCHAR(255) NULL,
  email VARCHAR(150) NULL,
  telephone VARCHAR(20) NULL,
  description TEXT NULL,
  statut_validation ENUM('En attente','Validée','Rejetée') NOT NULL DEFAULT 'En attente'
) ENGINE=InnoDB;

CREATE TABLE recruteur (
  id_recruteur INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  fonction VARCHAR(100) NULL,
  id_utilisateur INT UNSIGNED NOT NULL UNIQUE,
  id_entreprise INT UNSIGNED NOT NULL,
  CONSTRAINT fk_recruteur_utilisateur FOREIGN KEY (id_utilisateur) REFERENCES utilisateur(id_utilisateur) ON DELETE CASCADE,
  CONSTRAINT fk_recruteur_entreprise FOREIGN KEY (id_entreprise) REFERENCES entreprise(id_entreprise) ON DELETE RESTRICT
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
  CONSTRAINT fk_offre_entreprise FOREIGN KEY (id_entreprise) REFERENCES entreprise(id_entreprise) ON DELETE RESTRICT,
  INDEX idx_offre_recherche (statut_offre, localisation, date_expiration)
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
  CONSTRAINT fk_message_expediteur FOREIGN KEY (id_expediteur) REFERENCES utilisateur(id_utilisateur) ON DELETE CASCADE,
  CONSTRAINT fk_message_destinataire FOREIGN KEY (id_destinataire) REFERENCES utilisateur(id_utilisateur) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE notification (
  id_notification INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  contenu_notification TEXT NOT NULL,
  date_notification DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  statut_notification ENUM('Non lue','Lue') NOT NULL DEFAULT 'Non lue',
  id_utilisateur INT UNSIGNED NOT NULL,
  CONSTRAINT fk_notification_utilisateur FOREIGN KEY (id_utilisateur) REFERENCES utilisateur(id_utilisateur) ON DELETE CASCADE
) ENGINE=InnoDB;
