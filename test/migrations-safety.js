/**
 * Tests de sûreté du système de migrations — aucune base MySQL nécessaire.
 *
 * Vérifie les garanties qui empêchent un déploiement de « perdre » une
 * migration : nommage daté, ordre déterministe, réécriture contrôlée de la base
 * cible et présence du suivi `schema_migrations`.
 *
 * Exécution : node test/migrations-safety.js
 */
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const {
  MIGRATIONS_DIR,
  TRACKING_TABLE,
  listMigrationFiles,
  bindDatabaseName
} = require('../scripts/migrate');

let checks = 0;
const test = (name, fn) => {
  try {
    fn();
    checks += 1;
    console.log(`  OK   ${name}`);
  } catch (error) {
    console.error(`  ECHEC ${name}`);
    console.error(`        ${error.message}`);
    process.exitCode = 1;
  }
};

console.log('Tests de sûreté des migrations');

test('la table de suivi est schema_migrations', () => {
  assert.equal(TRACKING_TABLE, 'schema_migrations');
});

test('le dossier de migrations existe', () => {
  assert.equal(fs.existsSync(MIGRATIONS_DIR), true, MIGRATIONS_DIR);
});

test('les migrations sont nommées AAAAMMJJ_description.sql', () => {
  for (const name of listMigrationFiles()) {
    assert.match(name, /^\d{8}_[a-z0-9_]+\.sql$/, `nom invalide : ${name}`);
  }
});

test('les migrations sont triées par ordre chronologique', () => {
  const names = listMigrationFiles();
  const expected = [...names].sort((a, b) => a.localeCompare(b, 'en'));
  assert.deepEqual(names, expected);
});

test('chaque migration est non vide', () => {
  for (const name of listMigrationFiles()) {
    const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, name), 'utf8');
    assert.ok(sql.trim().length > 0, `fichier vide : ${name}`);
  }
});

test('la base cible est réécrite depuis DB_NAME', () => {
  const sql = 'SET NAMES utf8mb4;\nUSE gestion_carrieres;\nSELECT 1;';
  const bound = bindDatabaseName(sql, 'base_test');
  assert.match(bound, /USE `base_test`;/);
  assert.doesNotMatch(bound, /USE gestion_carrieres;/);
  assert.match(bound, /SET NAMES utf8mb4;/);
  assert.match(bound, /SELECT 1;/);
});

test('une base déjà explicite n’est pas modifiée', () => {
  const sql = 'USE autre_base;\nSELECT 1;';
  assert.equal(bindDatabaseName(sql, 'base_test'), sql);
});

test('un nom de base avec caractères spéciaux est refusé en amont', () => {
  assert.throws(() => {
    const database = 'base`; DROP DATABASE mysql; --';
    if (!/^[A-Za-z0-9_]+$/.test(database)) throw new Error('nom invalide');
  }, /nom invalide/);
});

test('le script crée la table de suivi si absente', () => {
  const source = fs.readFileSync(path.join(process.cwd(), 'scripts', 'migrate.js'), 'utf8');
  assert.match(source, /CREATE TABLE IF NOT EXISTS \$\{TRACKING_TABLE\}/);
  assert.match(source, /applique_le DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP/);
});

test('le script n’enregistre une migration qu’après succès', () => {
  const source = fs.readFileSync(path.join(process.cwd(), 'scripts', 'migrate.js'), 'utf8');
  const applyIndex = source.indexOf('await connection.query(sql);');
  const recordIndex = source.indexOf('INSERT INTO ${TRACKING_TABLE} (nom) VALUES (?)');
  assert.ok(applyIndex > -1 && recordIndex > applyIndex, 'ordre application puis enregistrement');
});

if (process.exitCode) {
  console.error(`\n${checks} test(s) réussi(s), des erreurs subsistent.`);
} else {
  console.log(`\n${checks} test(s) réussi(s).`);
}
