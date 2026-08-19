-- ============================================================
-- Migration : géolocalisation des entreprises
-- Date      : 2026-08-17
-- Base      : gestion_carrieres
-- Objet     : ajoute les coordonnées géographiques réelles
--             (latitude / longitude) à la table `entreprise`.
--             Elles alimentent le sélecteur de carte (création /
--             modification d'entreprise), la fiche publique et la
--             validation administrateur.
--
-- Idempotent : chaque instruction vérifie information_schema et ne
-- produit aucune erreur si la migration est rejouée.
-- Aucune donnée existante n'est supprimée : les colonnes sont NULL
-- tant que le propriétaire n'a pas géolocalisé son entreprise.
--
-- Exécution : mysql -u root -p < database/migrations/20260817_entreprise_geolocalisation.sql
-- ============================================================

SET NAMES utf8mb4;
USE gestion_carrieres;

-- 1) Colonne `latitude` ------------------------------------------------------
-- DECIMAL(10,7) : précision ~1 cm, compatible WGS84 (OSM / Leaflet).
SET @col := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'entreprise' AND COLUMN_NAME = 'latitude'
);
SET @sql := IF(@col = 0,
  'ALTER TABLE entreprise ADD COLUMN latitude DECIMAL(10,7) NULL AFTER description',
  'SELECT ''entreprise.latitude déjà présente'' AS info'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- 2) Colonne `longitude` -----------------------------------------------------
SET @col := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'entreprise' AND COLUMN_NAME = 'longitude'
);
SET @sql := IF(@col = 0,
  'ALTER TABLE entreprise ADD COLUMN longitude DECIMAL(10,7) NULL AFTER latitude',
  'SELECT ''entreprise.longitude déjà présente'' AS info'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;