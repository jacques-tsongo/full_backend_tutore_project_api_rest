-- ============================================================
-- Migration : contraintes d'intégrité métier en base
-- Date      : 2026-11-07
-- Base      : gestion_carrieres
-- Objet     : faire respecter en base les règles qui n'étaient
--             jusqu'ici validées que par l'application.
--
-- Additive et sans perte : aucune donnée n'est supprimée ni
-- réécrite. Avant chaque contrainte, un rapport de contrôle
-- affiche le nombre de lignes qui la violeraient. Si des lignes
-- sont invalides, l'ALTER échoue (la migration n'est PAS
-- enregistrée par `npm run migrate`) : corrigez les données
-- signalées puis relancez la migration.
--
-- Contraintes idempotentes : chaque ajout vérifie information_schema.
-- Compatible MySQL 8.0.16+ (CHECK réellement appliqué).
--
-- Exécution : npm run migrate
-- Contrôle préalable seul : npm run db:check
-- ============================================================

SET NAMES utf8mb4;
USE gestion_carrieres;

-- ------------------------------------------------------------------
-- 1) Rapport préalable (visible aussi en exécution manuelle)
-- ------------------------------------------------------------------
SELECT 'Contrôle préalable des contraintes d''intégrité' AS rapport;

SELECT 'message : un message ne peut pas s''auto-adresser' AS controle,
       COUNT(*) AS violations
FROM message WHERE id_expediteur = id_destinataire;

SELECT 'matching : score hors de [0, 100]' AS controle,
       COUNT(*) AS violations
FROM matching WHERE score_compatibilite < 0 OR score_compatibilite > 100;

SELECT 'expérience : date_fin antérieure à date_debut' AS controle,
       COUNT(*) AS violations
FROM experience_professionnelle
WHERE date_fin IS NOT NULL AND date_fin < date_debut;

SELECT 'diplôme : date_fin antérieure à date_debut' AS controle,
       COUNT(*) AS violations
FROM diplome
WHERE date_debut IS NOT NULL AND date_fin IS NOT NULL AND date_fin < date_debut;

SELECT 'offre : expiration antérieure au jour de publication' AS controle,
       COUNT(*) AS violations
FROM offre_emploi WHERE date_expiration < DATE(date_publication);

SELECT 'offre : salaire négatif' AS controle,
       COUNT(*) AS violations
FROM offre_emploi WHERE salaire IS NOT NULL AND salaire < 0;

SELECT 'entreprise : status et statut_validation incohérents' AS controle,
       COUNT(*) AS violations
FROM entreprise
WHERE NOT (
  (status = 'pending' AND statut_validation = 'En attente')
  OR (status = 'approved' AND statut_validation = 'Validée')
  OR (status = 'rejected' AND statut_validation = 'Rejetée')
);

SELECT 'fichier : taille nulle ou négative' AS controle,
       COUNT(*) AS violations
FROM fichier WHERE taille <= 0;

-- ------------------------------------------------------------------
-- 2) message : expéditeur différent du destinataire
-- ------------------------------------------------------------------
SET @has := (
  SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS
  WHERE CONSTRAINT_SCHEMA = DATABASE() AND TABLE_NAME = 'message'
    AND CONSTRAINT_NAME = 'chk_message_not_self'
);
SET @sql := IF(@has > 0,
  'SELECT ''chk_message_not_self déjà présente'' AS info',
  'ALTER TABLE message ADD CONSTRAINT chk_message_not_self CHECK (id_expediteur <> id_destinataire)'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- ------------------------------------------------------------------
-- 3) matching : score de compatibilité borné
-- ------------------------------------------------------------------
SET @has := (
  SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS
  WHERE CONSTRAINT_SCHEMA = DATABASE() AND TABLE_NAME = 'matching'
    AND CONSTRAINT_NAME = 'chk_matching_score_range'
);
SET @sql := IF(@has > 0,
  'SELECT ''chk_matching_score_range déjà présente'' AS info',
  'ALTER TABLE matching ADD CONSTRAINT chk_matching_score_range CHECK (score_compatibilite BETWEEN 0 AND 100)'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- ------------------------------------------------------------------
-- 4) expériences : chronologie cohérente
-- ------------------------------------------------------------------
SET @has := (
  SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS
  WHERE CONSTRAINT_SCHEMA = DATABASE() AND TABLE_NAME = 'experience_professionnelle'
    AND CONSTRAINT_NAME = 'chk_experience_dates'
);
SET @sql := IF(@has > 0,
  'SELECT ''chk_experience_dates déjà présente'' AS info',
  'ALTER TABLE experience_professionnelle ADD CONSTRAINT chk_experience_dates CHECK (date_fin IS NULL OR date_fin >= date_debut)'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- ------------------------------------------------------------------
-- 5) diplômes : chronologie cohérente (colonnes optionnelles)
-- ------------------------------------------------------------------
SET @has := (
  SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS
  WHERE CONSTRAINT_SCHEMA = DATABASE() AND TABLE_NAME = 'diplome'
    AND CONSTRAINT_NAME = 'chk_diplome_dates'
);
SET @sql := IF(@has > 0,
  'SELECT ''chk_diplome_dates déjà présente'' AS info',
  'ALTER TABLE diplome ADD CONSTRAINT chk_diplome_dates CHECK (date_debut IS NULL OR date_fin IS NULL OR date_fin >= date_debut)'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- ------------------------------------------------------------------
-- 6) offres : expiration non antérieure à la publication
-- ------------------------------------------------------------------
SET @has := (
  SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS
  WHERE CONSTRAINT_SCHEMA = DATABASE() AND TABLE_NAME = 'offre_emploi'
    AND CONSTRAINT_NAME = 'chk_offre_dates'
);
SET @sql := IF(@has > 0,
  'SELECT ''chk_offre_dates déjà présente'' AS info',
  'ALTER TABLE offre_emploi ADD CONSTRAINT chk_offre_dates CHECK (date_expiration >= DATE(date_publication))'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- ------------------------------------------------------------------
-- 7) offres : salaire positif ou nul
-- ------------------------------------------------------------------
SET @has := (
  SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS
  WHERE CONSTRAINT_SCHEMA = DATABASE() AND TABLE_NAME = 'offre_emploi'
    AND CONSTRAINT_NAME = 'chk_offre_salaire'
);
SET @sql := IF(@has > 0,
  'SELECT ''chk_offre_salaire déjà présente'' AS info',
  'ALTER TABLE offre_emploi ADD CONSTRAINT chk_offre_salaire CHECK (salaire IS NULL OR salaire >= 0)'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- ------------------------------------------------------------------
-- 8) entreprise : les deux colonnes de statut restent cohérentes
-- ------------------------------------------------------------------
SET @has := (
  SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS
  WHERE CONSTRAINT_SCHEMA = DATABASE() AND TABLE_NAME = 'entreprise'
    AND CONSTRAINT_NAME = 'chk_entreprise_status_coherent'
);
SET @sql := IF(@has > 0,
  'SELECT ''chk_entreprise_status_coherent déjà présente'' AS info',
  'ALTER TABLE entreprise ADD CONSTRAINT chk_entreprise_status_coherent CHECK ((status = ''pending'' AND statut_validation = ''En attente'') OR (status = ''approved'' AND statut_validation = ''Validée'') OR (status = ''rejected'' AND statut_validation = ''Rejetée''))'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- ------------------------------------------------------------------
-- 9) fichiers : un fichier vide n'a pas sa place en base
-- ------------------------------------------------------------------
SET @has := (
  SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS
  WHERE CONSTRAINT_SCHEMA = DATABASE() AND TABLE_NAME = 'fichier'
    AND CONSTRAINT_NAME = 'chk_fichier_taille'
);
SET @sql := IF(@has > 0,
  'SELECT ''chk_fichier_taille déjà présente'' AS info',
  'ALTER TABLE fichier ADD CONSTRAINT chk_fichier_taille CHECK (taille > 0)'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SELECT 'Contraintes d''intégrité vérifiées.' AS rapport;
