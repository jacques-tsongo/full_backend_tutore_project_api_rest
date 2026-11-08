/**
 * Tests des contraintes d'intégrité en base — aucune base MySQL nécessaire.
 *
 * Vérifie que la migration est additive, idempotente, qu'elle contrôle les
 * données AVANT d'ajouter chaque CHECK, et que le script de rapport couvre
 * exactement les mêmes règles.
 *
 * Exécution : node test/db-constraints.js
 */
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { CHECKS } = require('../scripts/db-integrity');

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

const migrationPath = path.join(process.cwd(), 'database', 'migrations', '20261107_02_contraintes.sql');
const sql = fs.readFileSync(migrationPath, 'utf8');

console.log('Tests des contraintes d’intégrité');

test('le script de contrôle couvre les contraintes attendues', () => {
  assert.equal(CHECKS.length, 8);
  for (const check of CHECKS) {
    assert.match(check.name, /^chk_/);
    assert.ok(check.label.length > 0);
    assert.match(check.sql, /COUNT\(\*\) AS violations/i);
  }
});

test('chaque contrainte est contrôlée puis ajoutée de façon idempotente', () => {
  for (const check of CHECKS) {
    assert.match(sql, new RegExp(`CONSTRAINT_NAME = '${check.name}'`), `${check.name} : contrôle d’existence absent`);
    assert.match(sql, new RegExp(`ADD CONSTRAINT ${check.name} CHECK`), `${check.name} : CHECK absent`);
    assert.match(sql, new RegExp(`'${check.name} déjà présente'`), `${check.name} : branche idempotente absente`);
  }
});

test('un rapport de violations précède les contraintes', () => {
  const report = (sql.slice(0, sql.indexOf('-- 2) message')) .match(/COUNT\(\*\) AS violations/g) || []).length;
  assert.equal(report, CHECKS.length, 'une requête de rapport par contrainte est attendue');
});

test('la migration ne supprime ni ne réécrit aucune donnée', () => {
  assert.doesNotMatch(sql, /\bDELETE\s+FROM\b/i);
  assert.doesNotMatch(sql, /\bTRUNCATE\b/i);
  assert.doesNotMatch(sql, /\bDROP\s+TABLE\b/i);
  assert.doesNotMatch(sql, /^\s*UPDATE\s+/im);
});

test('la migration est exécutable par le runner (USE réécrit, pas de DELIMITER)', () => {
  assert.match(sql, /USE gestion_carrieres;/);
  assert.doesNotMatch(sql, /\bDELIMITER\b/i);
});

if (process.exitCode) {
  console.error(`\n${checks} test(s) réussi(s), des erreurs subsistent.`);
} else {
  console.log(`\n${checks} test(s) réussi(s).`);
}
