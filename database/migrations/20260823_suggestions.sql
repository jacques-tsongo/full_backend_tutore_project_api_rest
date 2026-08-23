-- ============================================================
-- Migration : suggestions de domaines et de compétences
-- Date      : 2026-08-23
-- Base      : gestion_carrieres
-- Objet     :
--   1. crée le workflow candidat/recruteur → administrateur pour proposer
--      un domaine ou une compétence absente du catalogue ;
--   2. enrichit le système de notifications EXISTANT avec un type et une
--      référence métier polymorphe (aucune seconde table de notifications).
--
-- Additive et sans perte : aucune donnée existante n'est supprimée ou
-- réinitialisée. CREATE TABLE IF NOT EXISTS et les contrôles
-- information_schema rendent la migration rejouable.
-- Compatible MySQL 5.7+ / MariaDB 10.3+.
--
-- Exécution : mysql -u root -p < database/migrations/20260823_suggestions.sql
-- ============================================================

SET NAMES utf8mb4;
USE gestion_carrieres;

-- Demandes soumises par un compte candidat ou recruteur. Le rôle n'est pas
-- dupliqué ici : il reste porté par utilisateur.role. `nom_normalise` sert
-- aux contrôles anti-doublons insensibles à la casse et aux espaces.
CREATE TABLE IF NOT EXISTS demande_suggestion (
  id_demande INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  id_utilisateur INT UNSIGNED NOT NULL,
  type_demande ENUM('DOMAINE','COMPETENCE') NOT NULL,
  nom_propose VARCHAR(150) NOT NULL,
  nom_normalise VARCHAR(150) NOT NULL,
  id_domaine INT UNSIGNED NULL,
  description TEXT NULL,
  statut ENUM('EN_ATTENTE','APPROUVEE','REFUSEE') NOT NULL DEFAULT 'EN_ATTENTE',
  date_creation DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  date_traitement DATETIME NULL,
  id_admin_traitement INT UNSIGNED NULL,
  commentaire_admin TEXT NULL,
  INDEX idx_demande_suggestion_statut_type (statut, type_demande, date_creation),
  INDEX idx_demande_suggestion_demandeur (id_utilisateur, date_creation),
  INDEX idx_demande_suggestion_normalisee (type_demande, nom_normalise, id_domaine),
  CONSTRAINT fk_demande_suggestion_utilisateur
    FOREIGN KEY (id_utilisateur) REFERENCES utilisateur(id_utilisateur) ON DELETE CASCADE,
  CONSTRAINT fk_demande_suggestion_domaine
    FOREIGN KEY (id_domaine) REFERENCES domaine(id_domaine) ON DELETE RESTRICT,
  CONSTRAINT fk_demande_suggestion_admin
    FOREIGN KEY (id_admin_traitement) REFERENCES utilisateur(id_utilisateur) ON DELETE SET NULL
) ENGINE=InnoDB;

-- Le système `notification` existant reste l'unique source des notifications.
-- La référence est polymorphe pour ne pas limiter les futurs workflows ; pour
-- cette fonctionnalité : type_reference='DEMANDE_SUGGESTION' et id_reference
-- pointe logiquement vers demande_suggestion.id_demande.
SET @col := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'notification' AND COLUMN_NAME = 'type_notification'
);
SET @sql := IF(@col = 0,
  'ALTER TABLE notification ADD COLUMN type_notification VARCHAR(50) NOT NULL DEFAULT ''GENERALE'' AFTER statut_notification',
  'SELECT ''notification.type_notification déjà présente'' AS info'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @col := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'notification' AND COLUMN_NAME = 'type_reference'
);
SET @sql := IF(@col = 0,
  'ALTER TABLE notification ADD COLUMN type_reference VARCHAR(50) NULL AFTER type_notification',
  'SELECT ''notification.type_reference déjà présente'' AS info'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @col := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'notification' AND COLUMN_NAME = 'id_reference'
);
SET @sql := IF(@col = 0,
  'ALTER TABLE notification ADD COLUMN id_reference INT UNSIGNED NULL AFTER type_reference',
  'SELECT ''notification.id_reference déjà présente'' AS info'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @idx := (
  SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'notification' AND INDEX_NAME = 'idx_notification_reference'
);
SET @sql := IF(@idx = 0,
  'ALTER TABLE notification ADD INDEX idx_notification_reference (type_reference, id_reference)',
  'SELECT ''idx_notification_reference déjà présent'' AS info'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
