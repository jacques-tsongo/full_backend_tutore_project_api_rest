-- ============================================================
-- Migration : vérification des adresses e-mail
-- Date      : 2026-11-07
-- Base      : gestion_carrieres
-- Objet     : stocker l'état de vérification d'un compte et le
--             jeton à usage unique envoyé par e-mail.
--
-- Additive et idempotente : chaque colonne et l'index unique sont
-- ajoutés seulement s'ils sont absents (information_schema).
--
-- Les comptes déjà présents sont considérés comme vérifiés : la
-- nouvelle colonne est créée avec DEFAULT 1 le temps de l'ajout,
-- puis son défaut repasse à 0 pour les nouvelles inscriptions.
-- Aucune ligne existante n'est supprimée ni réécrite.
--
-- Le jeton n'est jamais stocké en clair : l'application enregistre
-- uniquement son empreinte SHA-256 (64 caractères hexadécimaux).
--
-- Exécution : npm run migrate
-- ============================================================

SET NAMES utf8mb4;
USE gestion_carrieres;

-- ------------------------------------------------------------------
-- 1) email_verifie : les comptes historiques restent utilisables.
-- ------------------------------------------------------------------
SET @has_email_verifie := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'utilisateur'
    AND COLUMN_NAME = 'email_verifie'
);
SET @sql := IF(@has_email_verifie = 0,
  'ALTER TABLE utilisateur ADD COLUMN email_verifie TINYINT(1) NOT NULL DEFAULT 1',
  'SELECT ''email_verifie déjà présente'' AS info'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- Les nouvelles inscriptions doivent démarrer non vérifiées.
SET @sql := IF(@has_email_verifie = 0,
  'ALTER TABLE utilisateur MODIFY COLUMN email_verifie TINYINT(1) NOT NULL DEFAULT 0',
  'SELECT ''email_verifie déjà configurée'' AS info'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- ------------------------------------------------------------------
-- 2) Date de vérification (NULL tant que le compte n'est pas vérifié).
-- ------------------------------------------------------------------
SET @has_email_verifie_le := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'utilisateur'
    AND COLUMN_NAME = 'email_verifie_le'
);
SET @sql := IF(@has_email_verifie_le = 0,
  'ALTER TABLE utilisateur ADD COLUMN email_verifie_le DATETIME NULL',
  'SELECT ''email_verifie_le déjà présente'' AS info'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- ------------------------------------------------------------------
-- 3) Empreinte SHA-256 du jeton de vérification.
-- ------------------------------------------------------------------
SET @has_email_token := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'utilisateur'
    AND COLUMN_NAME = 'email_verification_token_hash'
);
SET @sql := IF(@has_email_token = 0,
  'ALTER TABLE utilisateur ADD COLUMN email_verification_token_hash CHAR(64) NULL',
  'SELECT ''email_verification_token_hash déjà présente'' AS info'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- ------------------------------------------------------------------
-- 4) Expiration du jeton.
-- ------------------------------------------------------------------
SET @has_email_expire := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'utilisateur'
    AND COLUMN_NAME = 'email_verification_expire'
);
SET @sql := IF(@has_email_expire = 0,
  'ALTER TABLE utilisateur ADD COLUMN email_verification_expire DATETIME NULL',
  'SELECT ''email_verification_expire déjà présente'' AS info'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- ------------------------------------------------------------------
-- 5) Index unique : un jeton ne peut être associé qu'à un seul compte.
--    Les valeurs NULL restent autorisées (comptes sans jeton en cours).
-- ------------------------------------------------------------------
SET @has_email_token_index := (
  SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'utilisateur'
    AND INDEX_NAME = 'uq_utilisateur_email_verification_token'
);
SET @sql := IF(@has_email_token_index = 0,
  'ALTER TABLE utilisateur ADD UNIQUE KEY uq_utilisateur_email_verification_token (email_verification_token_hash)',
  'SELECT ''uq_utilisateur_email_verification_token déjà présente'' AS info'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
