-- ============================================================
-- Migration : stockage privé des fichiers téléversés
-- Date      : 2026-11-07
-- Base      : gestion_carrieres
-- Objet     : sortir les fichiers (photos, couvertures, CV, logos,
--             justificatifs) de la racine web publique `uploads/` et les
--             référencer par identifiant via la table `fichier`.
--
-- Les fichiers physiques sont désormais écrits hors du dossier servi
-- statiquement (STORAGE_DIR) et ne sont accessibles que par la route
-- GET /files/:id, qui contrôle les droits de l'utilisateur authentifié.
--
-- Additive et sans perte : CREATE TABLE IF NOT EXISTS. Aucune donnée
-- existante n'est supprimée. Les anciennes valeurs `uploads/...` restent
-- lisibles tant que scripts/migrate-uploads.js n'a pas été exécuté.
--
-- Exécution : npm run migrate
-- ============================================================

SET NAMES utf8mb4;
USE gestion_carrieres;

CREATE TABLE IF NOT EXISTS fichier (
  id_fichier INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  id_utilisateur INT UNSIGNED NOT NULL,
  categorie ENUM('PHOTO','COUVERTURE','CV','LOGO','JUSTIFICATIF') NOT NULL,
  chemin VARCHAR(255) NOT NULL,
  nom_original VARCHAR(255) NOT NULL,
  type_mime VARCHAR(127) NOT NULL,
  taille INT UNSIGNED NOT NULL,
  date_creation DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_fichier_chemin (chemin),
  INDEX idx_fichier_utilisateur_categorie (id_utilisateur, categorie),
  CONSTRAINT fk_fichier_utilisateur
    FOREIGN KEY (id_utilisateur) REFERENCES utilisateur(id_utilisateur) ON DELETE CASCADE
) ENGINE=InnoDB;

-- Repère de migration : la suppression d'un compte supprime ses références de
-- fichiers (ON DELETE CASCADE). Le nettoyage des octets sur disque est assuré
-- par un script d'exploitation (les fichiers ne sont jamais exposés en direct).
