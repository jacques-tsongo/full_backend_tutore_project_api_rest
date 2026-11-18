-- ============================================================
-- Migration : inscriptions en attente de vérification par code e-mail
-- Date      : 2026-11-16
-- Base      : gestion_carrieres
-- Objet     : stocker temporairement les données d'inscription jusqu'à
--             validation du code à 6 chiffres envoyé par e-mail.
--
-- Additive et idempotente (CREATE TABLE IF NOT EXISTS). Aucun compte
-- n'est créé dans `utilisateur` tant que le code n'est pas validé.
-- Les données sensibles : mot de passe haché (bcrypt), ticket et code
-- stockés uniquement sous forme d'empreinte (SHA-256 / HMAC-SHA256).
--
-- Sans dépendance aux migrations 20261107_01/02. Exécution manuelle
-- après sauvegarde : mysql -u <user> -p gestion_carrieres < ce_fichier.sql
-- ============================================================

SET NAMES utf8mb4;
USE gestion_carrieres;

CREATE TABLE IF NOT EXISTS inscription_en_attente (
  id_inscription CHAR(36) NOT NULL,
  email VARCHAR(254) NOT NULL,
  nom VARCHAR(100) NOT NULL,
  prenom VARCHAR(100) NOT NULL,
  telephone VARCHAR(20) NULL,
  id_domaine INT UNSIGNED NULL,
  mot_de_passe VARCHAR(255) NOT NULL,
  ticket_hash CHAR(64) NOT NULL,
  code_hash CHAR(64) NOT NULL,
  expire_at DATETIME NOT NULL,
  tentatives TINYINT UNSIGNED NOT NULL DEFAULT 0,
  envois TINYINT UNSIGNED NOT NULL DEFAULT 1,
  dernier_envoi_at DATETIME NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id_inscription),
  UNIQUE KEY uq_inscription_en_attente_email (email),
  INDEX idx_inscription_en_attente_expire (expire_at),
  INDEX idx_inscription_en_attente_ticket (ticket_hash)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
