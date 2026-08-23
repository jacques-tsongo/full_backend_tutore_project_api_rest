-- ============================================================
-- Migration : rattachement des compétences aux domaines
-- Date      : 2026-08-23
-- Base      : gestion_carrieres
-- Objet     : ajoute la relation DOMAINE (1,N) → COMPETENCE via la
--             colonne competence.id_domaine.
--
-- Additive et sans perte :
--   - aucune table n'est supprimée ni recréée ;
--   - aucune compétence existante n'est modifiée ou supprimée ;
--   - la colonne est NULLABLE : les compétences historiques restent
--     en base avec id_domaine = NULL (aucun domaine ne leur est
--     attribué arbitrairement — l'administrateur les classera
--     manuellement depuis la page « Compétences ») ;
--   - l'application impose le domaine UNIQUEMENT pour les nouvelles
--     compétences créées après cette migration.
--
-- Exécution : mysql -u root -p < database/migrations/20260823_competence_domaine.sql
-- ============================================================

SET NAMES utf8mb4;
USE gestion_carrieres;

-- 1) Colonne competence.id_domaine (NULL pour préserver l'existant) --------
SET @col := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'competence' AND COLUMN_NAME = 'id_domaine'
);
SET @sql := IF(@col = 0,
  'ALTER TABLE competence ADD COLUMN id_domaine INT UNSIGNED NULL AFTER id_competence',
  'SELECT ''competence.id_domaine déjà présente'' AS info'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- 2) Index de filtrage (catalogue par domaine) -----------------------------
SET @idx := (
  SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'competence' AND INDEX_NAME = 'idx_competence_domaine'
);
SET @sql := IF(@idx = 0,
  'ALTER TABLE competence ADD INDEX idx_competence_domaine (id_domaine)',
  'SELECT ''idx_competence_domaine déjà présent'' AS info'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- 3) Clé étrangère vers le catalogue des domaines --------------------------
-- ON DELETE RESTRICT : un domaine utilisé par une compétence ne peut pas
-- être supprimé (cohérent avec les autres FK domaine du projet).
SET @fk := (
  SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS
  WHERE CONSTRAINT_SCHEMA = DATABASE() AND TABLE_NAME = 'competence' AND CONSTRAINT_NAME = 'fk_competence_domaine'
);
SET @sql := IF(@fk = 0,
  'ALTER TABLE competence ADD CONSTRAINT fk_competence_domaine FOREIGN KEY (id_domaine) REFERENCES domaine(id_domaine) ON DELETE RESTRICT',
  'SELECT ''fk_competence_domaine déjà présente'' AS info'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- Aucun UPDATE de données : les compétences sans domaine sont signalées à
-- l'administrateur dans l'interface, qui les classe lui-même.
