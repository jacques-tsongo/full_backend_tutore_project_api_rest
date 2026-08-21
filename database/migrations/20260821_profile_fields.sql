-- ============================================================
-- Migration : enrichissement du profil professionnel
-- Date      : 2026-08-21
-- Base      : gestion_carrieres (créée par database/schema.sql)
-- Objet     :
--   1. Ajoute les champs d'identité / contact / présentation
--      (tous FACULTATIFS) à `profil_professionnel` : post_nom,
--      sexe, territoire, province, nationalite, etat_civil,
--      accroche. `date_naissance`, `lieu_naissance`, `adresse`
--      et `bio` existaient déjà (réutilisés, non dupliqués).
--   2. Étend `diplome` pour représenter un parcours scolaire /
--      formation sur une PÉRIODE (date_debut, date_fin) et rend
--      `annee_obtention` optionnel (formation en cours).
--   3. Crée les tables relationnelles `langue` (catalogue) et
--      `utilisateur_langue` (association N:N avec niveau contrôlé).
--
-- Additive et sans perte : aucune table/colonne n'est supprimée,
-- aucune donnée n'est modifiée ni réinitialisée. Les colonnes
-- ajoutées sont NULL tant que l'utilisateur ne les remplit pas.
--
-- Idempotent : chaque instruction vérifie information_schema (ou
-- utilise CREATE TABLE IF NOT EXISTS) et ne produit aucune erreur
-- en cas de rejeu. Compatible MySQL 5.7+ / MariaDB 10.3+.
--
-- Exécution : mysql -u root -p < database/migrations/20260821_profile_fields.sql
-- ============================================================

SET NAMES utf8mb4;
USE gestion_carrieres;

-- ------------------------------------------------------------
-- 1) Champs du profil professionnel (facultatifs)
-- ------------------------------------------------------------
-- post_nom : troisième élément du nom (usage administratif local).
SET @col := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'profil_professionnel' AND COLUMN_NAME = 'post_nom'
);
SET @sql := IF(@col = 0,
  'ALTER TABLE profil_professionnel ADD COLUMN post_nom VARCHAR(100) NULL AFTER bio',
  'SELECT ''profil_professionnel.post_nom déjà présente'' AS info'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- sexe : valeur contrôlée (ENUM).
SET @col := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'profil_professionnel' AND COLUMN_NAME = 'sexe'
);
SET @sql := IF(@col = 0,
  'ALTER TABLE profil_professionnel ADD COLUMN sexe ENUM(''Masculin'',''Féminin'',''Autre'') NULL AFTER post_nom',
  'SELECT ''profil_professionnel.sexe déjà présent'' AS info'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- territoire (subdivision administrative).
SET @col := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'profil_professionnel' AND COLUMN_NAME = 'territoire'
);
SET @sql := IF(@col = 0,
  'ALTER TABLE profil_professionnel ADD COLUMN territoire VARCHAR(100) NULL AFTER lieu_naissance',
  'SELECT ''profil_professionnel.territoire déjà présent'' AS info'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- province.
SET @col := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'profil_professionnel' AND COLUMN_NAME = 'province'
);
SET @sql := IF(@col = 0,
  'ALTER TABLE profil_professionnel ADD COLUMN province VARCHAR(100) NULL AFTER territoire',
  'SELECT ''profil_professionnel.province déjà présent'' AS info'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- nationalite.
SET @col := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'profil_professionnel' AND COLUMN_NAME = 'nationalite'
);
SET @sql := IF(@col = 0,
  'ALTER TABLE profil_professionnel ADD COLUMN nationalite VARCHAR(100) NULL AFTER province',
  'SELECT ''profil_professionnel.nationalite déjà présent'' AS info'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- etat_civil : valeur contrôlée (ENUM).
SET @col := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'profil_professionnel' AND COLUMN_NAME = 'etat_civil'
);
SET @sql := IF(@col = 0,
  'ALTER TABLE profil_professionnel ADD COLUMN etat_civil ENUM(''Célibataire'',''Marié(e)'',''Divorcé(e)'',''Veuf(ve)'',''Autre'') NULL AFTER nationalite',
  'SELECT ''profil_professionnel.etat_civil déjà présent'' AS info'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- accroche : présentation professionnelle courte (une ligne).
SET @col := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'profil_professionnel' AND COLUMN_NAME = 'accroche'
);
SET @sql := IF(@col = 0,
  'ALTER TABLE profil_professionnel ADD COLUMN accroche VARCHAR(255) NULL AFTER adresse',
  'SELECT ''profil_professionnel.accroche déjà présente'' AS info'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- ------------------------------------------------------------
-- 2) Période du parcours scolaire (table diplome)
-- ------------------------------------------------------------
SET @col := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'diplome' AND COLUMN_NAME = 'date_debut'
);
SET @sql := IF(@col = 0,
  'ALTER TABLE diplome ADD COLUMN date_debut DATE NULL AFTER etablissement',
  'SELECT ''diplome.date_debut déjà présent'' AS info'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @col := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'diplome' AND COLUMN_NAME = 'date_fin'
);
SET @sql := IF(@col = 0,
  'ALTER TABLE diplome ADD COLUMN date_fin DATE NULL AFTER date_debut',
  'SELECT ''diplome.date_fin déjà présent'' AS info'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- annee_obtention devient optionnelle : une formation « en cours » n'a pas
-- encore d'année d'obtention. Instruction idempotente (rejouable sans effet).
ALTER TABLE diplome MODIFY COLUMN annee_obtention YEAR NULL;

-- ------------------------------------------------------------
-- 3) Langues (catalogue + association N:N avec niveau contrôlé)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS langue (
  id_langue INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  nom_langue VARCHAR(80) NOT NULL UNIQUE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS utilisateur_langue (
  id_utilisateur INT UNSIGNED NOT NULL,
  id_langue INT UNSIGNED NOT NULL,
  niveau ENUM('Débutant','Élémentaire','Intermédiaire','Courant','Langue maternelle') NOT NULL DEFAULT 'Débutant',
  PRIMARY KEY (id_utilisateur, id_langue),
  CONSTRAINT fk_ul_utilisateur FOREIGN KEY (id_utilisateur) REFERENCES utilisateur(id_utilisateur) ON DELETE CASCADE,
  CONSTRAINT fk_ul_langue FOREIGN KEY (id_langue) REFERENCES langue(id_langue) ON DELETE CASCADE
) ENGINE=InnoDB;
