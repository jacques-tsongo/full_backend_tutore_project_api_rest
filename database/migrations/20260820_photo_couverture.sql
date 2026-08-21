-- ============================================================
-- Migration : photo de couverture des utilisateurs
-- Date      : 2026-08-20
-- Base      : gestion_carrieres
-- Objet     : ajoute le champ `photo_couverture` à la table
--             `utilisateur` (bannière d'en-tête du profil).
--             Sert exclusivement à l'affichage : aucun fichier
--             binaire en base, uniquement un chemin (même
--             convention que `photo` → uploads/covers/...).
--
-- Idempotent : l'instruction vérifie information_schema et ne
-- produit aucune erreur si la migration est rejouée.
-- Aucune donnée existante n'est modifiée : les comptes créés
-- avant cette migration ont la colonne NULL et l'interface
-- affiche l'image de couverture par défaut ; seuls les comptes
-- créés après l'inscription reçoivent les valeurs par défaut.
--
-- Exécution : mysql -u root -p < database/migrations/20260820_photo_couverture.sql
-- ============================================================

SET NAMES utf8mb4;
USE gestion_carrieres;

-- Colonne `photo_couverture` -------------------------------------
SET @col := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'utilisateur' AND COLUMN_NAME = 'photo_couverture'
);
SET @sql := IF(@col = 0,
  'ALTER TABLE utilisateur ADD COLUMN photo_couverture VARCHAR(255) NULL AFTER photo',
  'SELECT ''utilisateur.photo_couverture déjà présente'' AS info'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;