-- ============================================================
-- Migration : domaines professionnels
-- Date      : 2026-08-23
-- Base      : gestion_carrieres
-- Objet     : ajoute l'entité `domaine` et rattache le domaine
--             professionnel au profil professionnel, à l'entreprise
--             et à l'offre d'emploi.
--
-- Additive et sans perte : aucune table existante n'est supprimée,
-- aucune donnée n'est réinitialisée, aucun domaine de démonstration
-- n'est inséré. Les nouvelles colonnes sont NULL afin de préserver
-- les anciens profils / entreprises / offres ; l'application rend le
-- domaine obligatoire uniquement pour les nouvelles créations et pour
-- les actions métier sensibles (visibilité, candidature, publication).
--
-- Exécution : mysql -u root -p < database/migrations/20260823_add_domain.sql
-- ============================================================

SET NAMES utf8mb4;
USE gestion_carrieres;

-- 1) Catalogue des domaines professionnels -------------------------------
CREATE TABLE IF NOT EXISTS domaine (
  id_domaine INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  nom_domaine VARCHAR(150) NOT NULL UNIQUE
) ENGINE=InnoDB;

-- 2) Domaine principal du profil professionnel ----------------------------
SET @col := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'profil_professionnel' AND COLUMN_NAME = 'id_domaine'
);
SET @sql := IF(@col = 0,
  'ALTER TABLE profil_professionnel ADD COLUMN id_domaine INT UNSIGNED NULL AFTER id_profil',
  'SELECT ''profil_professionnel.id_domaine déjà présente'' AS info'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @idx := (
  SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'profil_professionnel' AND INDEX_NAME = 'idx_profil_domaine'
);
SET @sql := IF(@idx = 0,
  'ALTER TABLE profil_professionnel ADD INDEX idx_profil_domaine (id_domaine)',
  'SELECT ''idx_profil_domaine déjà présent'' AS info'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @fk := (
  SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS
  WHERE CONSTRAINT_SCHEMA = DATABASE() AND TABLE_NAME = 'profil_professionnel' AND CONSTRAINT_NAME = 'fk_profil_domaine'
);
SET @sql := IF(@fk = 0,
  'ALTER TABLE profil_professionnel ADD CONSTRAINT fk_profil_domaine FOREIGN KEY (id_domaine) REFERENCES domaine(id_domaine) ON DELETE RESTRICT',
  'SELECT ''fk_profil_domaine déjà présente'' AS info'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- 3) Domaine d'activité de l'entreprise ----------------------------------
SET @col := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'entreprise' AND COLUMN_NAME = 'id_domaine'
);
SET @sql := IF(@col = 0,
  'ALTER TABLE entreprise ADD COLUMN id_domaine INT UNSIGNED NULL AFTER id_utilisateur',
  'SELECT ''entreprise.id_domaine déjà présente'' AS info'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @idx := (
  SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'entreprise' AND INDEX_NAME = 'idx_entreprise_domaine'
);
SET @sql := IF(@idx = 0,
  'ALTER TABLE entreprise ADD INDEX idx_entreprise_domaine (id_domaine)',
  'SELECT ''idx_entreprise_domaine déjà présent'' AS info'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @fk := (
  SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS
  WHERE CONSTRAINT_SCHEMA = DATABASE() AND TABLE_NAME = 'entreprise' AND CONSTRAINT_NAME = 'fk_entreprise_domaine'
);
SET @sql := IF(@fk = 0,
  'ALTER TABLE entreprise ADD CONSTRAINT fk_entreprise_domaine FOREIGN KEY (id_domaine) REFERENCES domaine(id_domaine) ON DELETE RESTRICT',
  'SELECT ''fk_entreprise_domaine déjà présente'' AS info'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- 4) Domaine dénormalisé de l'offre (copié depuis l'entreprise) -----------
-- Source métier : entreprise.id_domaine. La colonne offre_emploi.id_domaine
-- accélère les filtres et garde un historique cohérent de publication.
SET @col := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'offre_emploi' AND COLUMN_NAME = 'id_domaine'
);
SET @sql := IF(@col = 0,
  'ALTER TABLE offre_emploi ADD COLUMN id_domaine INT UNSIGNED NULL AFTER id_entreprise',
  'SELECT ''offre_emploi.id_domaine déjà présente'' AS info'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- Remplit uniquement les offres dont l'entreprise possède déjà un domaine.
-- Aucune valeur arbitraire n'est choisie pour les entreprises sans domaine.
UPDATE offre_emploi o
JOIN entreprise e ON e.id_entreprise = o.id_entreprise
SET o.id_domaine = e.id_domaine
WHERE o.id_domaine IS NULL AND e.id_domaine IS NOT NULL;

SET @idx := (
  SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'offre_emploi' AND INDEX_NAME = 'idx_offre_domaine'
);
SET @sql := IF(@idx = 0,
  'ALTER TABLE offre_emploi ADD INDEX idx_offre_domaine (id_domaine, statut_offre, date_expiration)',
  'SELECT ''idx_offre_domaine déjà présent'' AS info'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @fk := (
  SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS
  WHERE CONSTRAINT_SCHEMA = DATABASE() AND TABLE_NAME = 'offre_emploi' AND CONSTRAINT_NAME = 'fk_offre_domaine'
);
SET @sql := IF(@fk = 0,
  'ALTER TABLE offre_emploi ADD CONSTRAINT fk_offre_domaine FOREIGN KEY (id_domaine) REFERENCES domaine(id_domaine) ON DELETE RESTRICT',
  'SELECT ''fk_offre_domaine déjà présente'' AS info'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
