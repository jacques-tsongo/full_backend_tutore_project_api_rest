-- ============================================================
-- Migration : suivi de lecture des messages (compteurs non lus)
-- Date      : 2026-08-09
-- Base      : gestion_carrieres (créée par database/schema.sql)
-- Objet     : ajoute la traçabilité de lecture à la table `message`
--             afin de calculer les compteurs de messages non lus
--             côté serveur (EJS + API) pour l'utilisateur connecté.
--
-- Idempotent : chaque instruction vérifie information_schema et ne
-- produit aucune erreur si la migration est rejouée.
-- Compatible MySQL 5.7+ / MariaDB 10.3+ (pas de ADD COLUMN IF NOT EXISTS).
-- Aucune donnée existante n'est supprimée : les messages historiques
-- sont considérés comme lus (lu = 1) afin de ne pas gonfler les
-- compteurs des comptes déjà actifs.
--
-- Exécution : mysql -u root -p < database/migrations/20260809_message_read_tracking.sql
-- ============================================================

SET NAMES utf8mb4;
USE gestion_carrieres;

-- 1) Colonne `lu` (0 = non lu, 1 = lu) -------------------------------------
-- La création est conditionnée et mémorisée dans @created_lu : le remplissage
-- historique (étape 4) n'a lieu QUE lors de la création effective de la
-- colonne, jamais en cas de rejeu de la migration.
SET @created_lu := (
  SELECT COUNT(*) = 0 FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'message' AND COLUMN_NAME = 'lu'
);
SET @sql := IF(@created_lu = 1,
  'ALTER TABLE message ADD COLUMN lu TINYINT(1) NOT NULL DEFAULT 0 AFTER contenu',
  'SELECT ''message.lu déjà présente'' AS info'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- 2) Colonne `date_lecture` -------------------------------------------------
SET @col := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'message' AND COLUMN_NAME = 'date_lecture'
);
SET @sql := IF(@col = 0,
  'ALTER TABLE message ADD COLUMN date_lecture DATETIME NULL AFTER lu',
  'SELECT ''message.date_lecture déjà présente'' AS info'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- 3) Index de comptage des non lus ------------------------------------------
SET @idx := (
  SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'message' AND INDEX_NAME = 'idx_message_destinataire_lu'
);
SET @sql := IF(@idx = 0,
  'ALTER TABLE message ADD INDEX idx_message_destinataire_lu (id_destinataire, lu)',
  'SELECT ''idx_message_destinataire_lu déjà présent'' AS info'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- 4) Les messages historiques (antérieurs à cette fonctionnalité) sont
--    marqués comme lus pour préserver l'expérience des comptes existants.
--    Exécuté uniquement lors de la création effective de la colonne.
SET @sql := IF(@created_lu = 1,
  'UPDATE message SET lu = 1 WHERE lu = 0',
  'SELECT ''aucun remplissage nécessaire'' AS info'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
