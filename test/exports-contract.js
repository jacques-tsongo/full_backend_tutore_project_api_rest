/**
 * Contrat des exports des modules locaux — aucune base ni réseau.
 *
 * Pour chaque fichier JavaScript de `src/`, on repère les imports locaux :
 *   - `const x = require('./module')`  → on vérifie chaque `x.nom` utilisé ;
 *   - `const { a, b } = require('./module')` → on vérifie que `a` et `b`
 *     existent réellement dans les exports du module cible.
 *
 * Le module cible est chargé avec `require` : le pool mysql2 ne se connecte
 * pas tant qu'aucune requête n'est exécutée. Un module dont le chargement
 * échoue (effets de bord) est ignoré avec un message explicite.
 *
 * Exécution : node test/exports-contract.js (npm run test:contract)
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'src');

const listJsFiles = (dir) => {
  const files = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...listJsFiles(full));
    else if (entry.isFile() && entry.name.endsWith('.js')) files.push(full);
  }
  return files;
};

const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Repère les imports locaux (namespace et destructurés) d'un fichier. */
const collectImports = (source, fileDir) => {
  const imports = [];

  const namespaceRe = /(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*require\(\s*(['"])(\.[^'"]*)\2\s*\)/g;
  for (const match of source.matchAll(namespaceRe)) {
    imports.push({ kind: 'namespace', alias: match[1], names: null, request: match[3], fileDir });
  }

  const destructuredRe = /(?:const|let|var)\s*\{([^}]*)\}\s*=\s*require\(\s*(['"])(\.[^'"]*)\2\s*\)/g;
  for (const match of source.matchAll(destructuredRe)) {
    const names = match[1]
      .split(',')
      .map((part) => part.trim())
      .map((part) => part.split(':')[0].split('=')[0].trim())
      .filter((name) => name && !name.startsWith('...'));
    imports.push({ kind: 'destructured', alias: null, names, request: match[3], fileDir });
  }

  return imports;
};

/**
 * Propriétés réellement appelées sur un alias (`x.nom`).
 * Les chemins des `require('./…')` sont retirés au préalable : sinon un fichier
 * `emailVerification.service.js` ferait croire à l'usage de `x.service`.
 */
const usedProperties = (source, alias) => {
  const withoutRequirePaths = source.replace(/require\(\s*(['"])\.[^'"]*\1\s*\)/g, 'require()');
  const names = new Set();
  const re = new RegExp(`\\b${escapeRegExp(alias)}\\.([A-Za-z_$][\\w$]*)`, 'g');
  for (const match of withoutRequirePaths.matchAll(re)) names.add(match[1]);
  return [...names];
};

const loadTarget = (fileDir, request) => {
  const resolved = require.resolve(path.resolve(fileDir, request));
  // `server.js` démarre l'écoute et se connecte à MySQL : jamais chargé ici.
  if (path.basename(resolved) === 'server.js') {
    return { skipped: `module à effets de bord ignoré (${path.relative(ROOT, resolved)})` };
  }
  try {
    return { exports: require(resolved), resolved };
  } catch (error) {
    return { skipped: `module à effets de bord ignoré (${path.relative(ROOT, resolved)} : ${error.message})` };
  }
};

const hasExport = (target, name) => target != null && name in Object(target);

let checks = 0;
const failures = [];

const files = listJsFiles(SRC);
const skipped = new Set();

for (const file of files) {
  const source = fs.readFileSync(file, 'utf8');
  const imports = collectImports(source, path.dirname(file));

  for (const entry of imports) {
    const loaded = loadTarget(entry.fileDir, entry.request);
    if (loaded.skipped) {
      if (!skipped.has(loaded.skipped)) {
        skipped.add(loaded.skipped);
        console.log(`  IGNORÉ ${loaded.skipped}`);
      }
      continue;
    }

    const expected = entry.kind === 'namespace'
      ? usedProperties(source, entry.alias).map((name) => ({ name, label: `${entry.alias}.${name}` }))
      : entry.names.map((name) => ({ name, label: name }));

    for (const { name, label } of expected) {
      checks += 1;
      if (!hasExport(loaded.exports, name)) {
        failures.push(
          `${path.relative(ROOT, file)} : « ${label} » introuvable dans les exports de `
          + `${path.relative(ROOT, loaded.resolved)}`
        );
      }
    }
  }
}

console.log(`\nContrat des exports : ${checks} vérification(s).`);
if (failures.length) {
  console.error(`\n${failures.length} erreur(s) de contrat :`);
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exitCode = 1;
} else {
  console.log('Tous les imports locaux correspondent aux exports des modules.');
}
