/**
 * Test de sûreté des requêtes SQL paginées — NE NÉCESSITE AUCUNE BASE MySQL.
 *
 * Objectif : garantir qu'aucune requête exécutée via `mysql2.execute()`
 * (requêtes préparées) n'envoie de placeholder `?` dans une clause structurelle
 * `LIMIT` / `OFFSET`. Sur MySQL >= 8.0.22, mysql2 encode les nombres JavaScript
 * en MYSQL_TYPE_DOUBLE et le serveur refuse ce type pour LIMIT/OFFSET :
 *   Error: Incorrect arguments to mysqld_stmt_execute
 *   code: ER_WRONG_ARGUMENTS / errno: 1210 / sqlState: HY000
 *
 * Trois niveaux de vérification :
 *   1. Encodage réel des paramètres par mysql2 (preuve du mécanisme 1210) ;
 *   2. Analyse statique du dossier `src/` (aucun `LIMIT ?` / `OFFSET ?`) ;
 *   3. Tests d'intégration sur l'application Express réelle, avec un pool
 *      MySQL bouchonné qui se comporte comme un serveur STRICT (il rejette les
 *      placeholders LIMIT/OFFSET et tout désaccord placeholders/paramètres),
 *      plus des tentatives d'injection sur sort/order/page/limit/q/statut.
 *
 * Lancement : node test/sql-pagination-safety.js   (ou npm run test:sql)
 */
const fs = require('fs');
const path = require('path');
const http = require('http');
const jwt = require('jsonwebtoken');

process.env.NODE_ENV = process.env.NODE_ENV || 'test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-sql-pagination';
process.env.DB_HOST = process.env.DB_HOST || '127.0.0.1';
process.env.DB_USER = process.env.DB_USER || 'root';
process.env.DB_PASSWORD = process.env.DB_PASSWORD || '';
process.env.DB_NAME = process.env.DB_NAME || 'gestion_carrieres';

const ROOT = path.join(__dirname, '..');
const results = { pass: 0, fail: 0, details: [] };
const ok = (name, extra = '') => { results.pass++; results.details.push({ ok: true, name, extra }); };
const ko = (name, extra = '') => { results.fail++; results.details.push({ ok: false, name, extra }); };
const check = (name, condition, extra = '') => (condition ? ok(name, extra) : ko(name, extra));

/* ======================================================================
 * 1. Preuve du mécanisme : comment mysql2 encode un nombre pour execute()
 * ====================================================================== */
// mysql2 limite ses sous-chemins exportés : on cible les fichiers internes
// exactement comme le fait `Execute._serializeToBuffer` lors d'un execute().
const MYSQL2_LIB = path.join(path.dirname(require.resolve('mysql2')), 'lib');
const { toParameter } = require(path.join(MYSQL2_LIB, 'packets/encode_parameter.js'));
const Types = require(path.join(MYSQL2_LIB, 'constants/types.js'));

const typeName = (t) => Object.keys(Types).find((k) => Types[k] === t) || String(t);
const limitParam = toParameter(20, 'utf8');            // un `LIMIT ?` avant correction
const offsetParam = toParameter(0, 'utf8');

console.log(`\nParamètre numérique LIMIT encodé par mysql2  : type=${typeName(limitParam.type)} (${limitParam.type})`);
console.log(`Paramètre numérique OFFSET encodé par mysql2 : type=${typeName(offsetParam.type)} (${offsetParam.type})`);
console.log('(Sur MySQL >= 8.0.22, un paramètre DOUBLE est refusé pour LIMIT/OFFSET → errno 1210.)\n');

check('mysql2 encode un nombre JS en MYSQL_TYPE_DOUBLE (cause du 1210)',
  limitParam.type === Types.DOUBLE && offsetParam.type === Types.DOUBLE,
  `LIMIT → ${typeName(limitParam.type)}, OFFSET → ${typeName(offsetParam.type)}`);
check('une chaîne numérique est traitée comme texte (VAR_STRING)',
  toParameter('20', 'utf8').type === Types.VAR_STRING);
check('aucun type entier n’est utilisé par mysql2 pour execute()',
  ![Types.LONGLONG, Types.LONG, Types.TINY, Types.SHORT].includes(toParameter(20, 'utf8').type));

/* ======================================================================
 * 2. Analyse statique : plus aucun placeholder LIMIT/OFFSET dans src/
 * ====================================================================== */
const walk = (dir, out = []) => {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (e.name.endsWith('.js')) out.push(p);
  }
  return out;
};

const PLACEHOLDER_RE = /\b(?:LIMIT|OFFSET)\s+\?(?:\s*,|\s|$)/i;
const staticViolations = [];
for (const file of walk(path.join(ROOT, 'src'))) {
  const lines = fs.readFileSync(file, 'utf8').split('\n');
  lines.forEach((line, i) => {
    if (/^\s*(\/\/|\*|\/\*)/.test(line)) return; // commentaires ignorés
    if (PLACEHOLDER_RE.test(line)) {
      staticViolations.push(`${path.relative(ROOT, file)}:${i + 1} → ${line.trim().slice(0, 110)}`);
    }
  });
}
check('analyse statique : aucun « LIMIT ? » / « OFFSET ? » dans src/',
  staticViolations.length === 0, staticViolations.join(' | '));

const queryUtils = require(path.join(ROOT, 'src/utils/query.js'));
check('pagination() conserve son principe (page >= 1, limit 1..100, offset calculé)',
  JSON.stringify(queryUtils.pagination({ page: '3', limit: '20' })) === JSON.stringify({ page: 3, limit: 20, offset: 40 })
  && queryUtils.pagination({}).limit === 10
  && queryUtils.pagination({ page: '0', limit: '500' }).limit === 100
  && queryUtils.pagination({ page: '-4' }).page === 1);

const hasHelpers = typeof queryUtils.limitOffsetClause === 'function' && typeof queryUtils.limitClause === 'function';
check('helpers limitOffsetClause() / limitClause() présents dans utils/query.js', hasHelpers);

if (hasHelpers) {
  check('limitOffsetClause() produit des entiers littéraux',
    queryUtils.limitOffsetClause(20, 40) === 'LIMIT 20 OFFSET 40'
    && queryUtils.limitOffsetClause('10', '0') === 'LIMIT 10 OFFSET 0'
    && queryUtils.limitOffsetClause(1, 0) === 'LIMIT 1 OFFSET 0');

  const rejectedInputs = ['10; DROP TABLE utilisateur', '10 OR 1=1', '-5', '1.5', '', null, undefined, {}, [], 'NaN', '20abc', Infinity];
  const rejected = rejectedInputs.filter((v) => {
    try { queryUtils.limitOffsetClause(v, 0); return false; } catch (_) { return true; }
  });
  check('limitOffsetClause() rejette toute valeur non entière (injection comprise)',
    rejected.length === rejectedInputs.length, `refusés ${rejected.length}/${rejectedInputs.length}`);
  check('limitClause() refuse une valeur non entière et accepte un entier',
    queryUtils.limitClause(50) === 'LIMIT 50'
    && queryUtils.limitClause('50') === 'LIMIT 50'
    && (() => { try { queryUtils.limitClause('50;DELETE'); return false; } catch (_) { return true; } })());
}

/* ======================================================================
 * 3. Tests d'intégration : application réelle + pool MySQL strict bouchonné
 * ====================================================================== */

/** Comptage des `?` de liaison, en ignorant ceux situés dans des littéraux SQL. */
const countPlaceholders = (sql) => {
  let count = 0;
  let quote = null;
  for (let i = 0; i < sql.length; i++) {
    const c = sql[i];
    if (quote) {
      if (c === '\\') { i++; continue; }
      if (c === quote) quote = null;
      continue;
    }
    if (c === "'" || c === '"' || c === '`') { quote = c; continue; }
    if (c === '?') count++;
  }
  return count;
};

const state = { mode: 'empty', candidateHasDomain: true, calls: [], violations: [] };

const USERS = {
  1: { id_utilisateur: 1, nom: 'Candidat', prenom: 'Alice', email: 'alice@example.com', telephone: null, photo: null, photo_couverture: null, role: 'candidat', date_inscription: new Date(), statut_compte: 'actif' },
  2: { id_utilisateur: 2, nom: 'Recruteur', prenom: 'Bob', email: 'bob@example.com', telephone: null, photo: null, photo_couverture: null, role: 'recruteur', date_inscription: new Date(), statut_compte: 'actif' },
  3: { id_utilisateur: 3, nom: 'Admin', prenom: 'Carol', email: 'carol@example.com', telephone: null, photo: null, photo_couverture: null, role: 'administrateur', date_inscription: new Date(), statut_compte: 'actif' }
};

const offerRow = (id) => ({
  id_offre: id, titre_offre: `Offre ${id}`, description_offre: 'desc', localisation: 'Kinshasa',
  salaire: 1000, statut_offre: 'Ouverte', id_domaine: 10, id_domaine_effectif: 10, nom_domaine: 'Informatique',
  date_publication: new Date(), date_expiration: new Date(Date.now() + 86400000),
  id_entreprise: 5, nom_entreprise: 'ACME', logo_entreprise: null, ville_entreprise: 'Kinshasa',
  pays_entreprise: 'RDC', id_recruteur: 2
});

/** Réponses simulées : « empty » = tables vides, « data » = quelques lignes. */
const resolveRows = (sql, params) => {
  const hasData = state.mode === 'data';

  if (/FROM utilisateur\s+WHERE id_utilisateur = \?/i.test(sql)) {
    return [USERS[Number(params[0])]].filter(Boolean);
  }
  if (/COUNT\(\*\)/i.test(sql)) {
    return [{ total: hasData ? 3 : 0 }];
  }
  if (/FROM profil_professionnel p/i.test(sql)) {
    return state.candidateHasDomain ? [{ id_domaine: 10, nom_domaine: 'Informatique' }] : [];
  }
  if (/FROM offre_emploi o/i.test(sql)) {
    return hasData ? [offerRow(1), offerRow(2), offerRow(3)] : [];
  }
  if (/FROM entreprise e/i.test(sql)) {
    if (/e\.id_utilisateur = \? AND e\.status = 'approved'/i.test(sql)) {
      return hasData ? [{ id_entreprise: 5, id_utilisateur: 2, id_domaine: 10, nom_entreprise: 'ACME', status: 'approved' }] : [];
    }
    return hasData ? [{ id_entreprise: 5, id_utilisateur: 2, id_domaine: 10, nom_entreprise: 'ACME', ville: 'Kinshasa', pays: 'RDC', status: 'approved' }] : [];
  }
  if (/FROM competence/i.test(sql)) {
    return hasData ? [{ id_competence: 1, nom_competence: 'Node.js', id_domaine: 10 }] : [];
  }
  if (/FROM domaine/i.test(sql)) {
    return hasData ? [{ id_domaine: 10, nom_domaine: 'Informatique' }] : [];
  }
  return [];
};

/** Pool bouchonné : simule un serveur MySQL >= 8.0.22 STRICT. */
const fakeExecute = async (sql, params = []) => {
  const call = { sql, params: Array.isArray(params) ? params : [] };
  state.calls.push(call);

  // Le serveur refuse les placeholders structurels (comportement MySQL >= 8.0.22).
  if (/\b(?:LIMIT|OFFSET)\s+\?/i.test(sql)) {
    state.violations.push(`Placeholder LIMIT/OFFSET exécuté : ${sql.trim().split('\n').join(' ').slice(0, 130)}`);
    const error = new Error('Incorrect arguments to mysqld_stmt_execute');
    error.code = 'ER_WRONG_ARGUMENTS';
    error.errno = 1210;
    error.sqlState = 'HY000';
    throw error;
  }
  // ER_PARSE_ERROR-like : désaccord entre placeholders et paramètres fournis.
  const expected = countPlaceholders(sql);
  if (expected !== call.params.length) {
    state.violations.push(`Désaccord placeholders/paramètres (${expected} attendus, ${call.params.length} fournis) : ${sql.trim().split('\n').join(' ').slice(0, 130)}`);
    const error = new Error(`You have an error in your SQL syntax (placeholders=${expected}, params=${call.params.length})`);
    error.code = 'ER_PARSE_ERROR';
    error.errno = 1064;
    error.sqlState = '42000';
    throw error;
  }
  return [resolveRows(sql, call.params), []];
};

const fakeConnection = {
  execute: fakeExecute,
  query: fakeExecute,
  beginTransaction: async () => {},
  commit: async () => {},
  rollback: async () => {},
  release: () => {}
};

const fakePool = {
  execute: fakeExecute,
  query: fakeExecute,
  getConnection: async () => fakeConnection,
  end: async () => {},
  on: () => {}
};

// Injection du pool bouchonné AVANT le chargement de l'application.
const dbModulePath = require.resolve(path.join(ROOT, 'src/config/database.js'));
require.cache[dbModulePath] = {
  id: dbModulePath, filename: dbModulePath, loaded: true, exports: fakePool, children: [], paths: []
};

const app = require(path.join(ROOT, 'src/app.js'));
const server = http.createServer(app);

const tokenFor = (id) => jwt.sign({ id, role: USERS[id].role }, process.env.JWT_SECRET, { expiresIn: '1h' });

const request = (base, method, url, user, { cookie = false } = {}) => new Promise((resolve, reject) => {
  const headers = {};
  if (user) {
    const token = tokenFor(user);
    if (cookie) headers.Cookie = `gc_token=${token}`;
    else headers.Authorization = `Bearer ${token}`;
  }
  const req = http.request(`${base}${url}`, { method, headers }, (res) => {
    let body = '';
    res.on('data', (c) => { body += c; });
    res.on('end', () => {
      let json = null;
      try { json = JSON.parse(body); } catch (_) { /* réponse HTML */ }
      resolve({ status: res.statusCode, body, json, contentType: res.headers['content-type'] || '', location: res.headers.location });
    });
  });
  req.on('error', reject);
  req.end();
});

const run = async () => {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  console.log(`Application de test : ${base} (pool MySQL bouchonné, mode strict)`);

  const paginationParams = ['', '?page=1', '?page=2', '?limit=10', '?page=1&limit=20', '?page=1&limit=100', '?page=0&limit=0', '?page=-3&limit=-1', '?page=abc&limit=xyz', '?page=999&limit=100'];
  const paginatedRoutes = [
    { url: '/api/offres', user: 1, label: 'offres (candidat, pagination mémoire)' },
    { url: '/api/offres', user: 2, label: 'offres (recruteur, pagination SQL)' },
    { url: '/api/offres', user: 3, label: 'offres (administrateur, pagination SQL)' },
    { url: '/api/offres?mine=1', user: 2, label: 'mes offres (recruteur)', sqlInEmpty: false },
    { url: '/api/competences', user: 1, label: 'competences (candidat)' },
    { url: '/api/competences', user: 3, label: 'competences (admin)' },
    { url: '/api/domaines', user: 1, label: 'domaines' },
    { url: '/api/experiences', user: 1, label: 'experiences' },
    { url: '/api/diplomes', user: 1, label: 'diplomes' },
    { url: '/api/entreprises', user: 1, label: 'entreprises' }
  ];

  for (const scenario of [
    { mode: 'empty', label: 'tables vides' },
    { mode: 'data', label: 'données présentes' }
  ]) {
    state.mode = scenario.mode;
    console.log(`\n--- Scénario : ${scenario.label} ---`);

    for (const route of paginatedRoutes) {
      for (const qs of paginationParams) {
        state.calls = [];
        const res = await request(base, 'GET', `${route.url}${qs}`, route.user);
        const parsed = res.json;
        const p = parsed?.data?.pagination;
        const sqlCalls = state.calls.filter((c) => /FROM (offre_emploi|competence|domaine|experience_professionnelle|diplome|entreprise)\b/i.test(c.sql));
        const expectedSql = scenario.mode === 'data' || route.sqlInEmpty !== false;

        const shapeOk = res.status === 200
          && parsed?.success === true
          && Array.isArray(parsed?.data?.items)
          && p && Number.isInteger(p.page) && Number.isInteger(p.limit) && Number.isInteger(p.total)
          && p.limit >= 1 && p.limit <= 100 && p.page >= 1;

        check(`[${scenario.label}] GET ${route.url} ${qs || '(défaut)'} → 200 + pagination intègre`,
          shapeOk && (!expectedSql || sqlCalls.length > 0),
          `status=${res.status} items=${parsed?.data?.items?.length} pagination=${JSON.stringify(p)} requêtes=${sqlCalls.length}`);

        // La clause LIMIT/OFFSET réellement exécutée doit correspondre à la page demandée.
        const limited = state.calls.map((c) => c.sql.match(/LIMIT\s+(\d+)\s+OFFSET\s+(\d+)/i)).filter(Boolean);
        if (p) {
          check(`[${scenario.label}] GET ${route.url} ${qs || '(défaut)'} → LIMIT/OFFSET = entiers attendus`,
            limited.every((m) => Number(m[1]) === p.limit && Number(m[2]) === (p.page - 1) * p.limit),
            limited.length ? `SQL=${limited.map((m) => `LIMIT ${m[1]} OFFSET ${m[2]}`).join(', ')} attendu LIMIT ${p.limit} OFFSET ${(p.page - 1) * p.limit}` : 'aucune requête LIMIT (pagination mémoire ou réponse vide anticipée)');
        }
      }
    }

    // --- Autres listes (paginées en mémoire ou non paginées) ---
    const otherLists = [
      { url: '/api/messages', user: 1, label: 'conversations' },
      { url: '/api/messages/contacts', user: 1, label: 'contacts candidat' },
      { url: '/api/messages/contacts', user: 2, label: 'contacts recruteur' },
      { url: '/api/messages/contacts', user: 3, label: 'contacts admin' },
      { url: '/api/messages/contacts?q=ali', user: 3, label: 'contacts admin + recherche' },
      { url: '/api/messages/non-lus', user: 1, label: 'messages non lus' },
      { url: '/api/notifications', user: 1, label: 'notifications' },
      { url: '/api/notifications/non-lues', user: 1, label: 'notifications non lues' },
      { url: '/api/candidatures/me', user: 1, label: 'mes candidatures' },
      { url: '/api/candidatures/recues', user: 2, label: 'candidatures reçues' },
      { url: '/api/suggestions/mine', user: 1, label: 'mes suggestions' },
      { url: '/api/mes-competences', user: 1, label: 'mes compétences' },
      { url: '/api/profil/langues', user: 1, label: 'langues du profil' },
      { url: '/api/competences', user: 2, label: 'competences (recruteur)' },
      { url: '/api/notifications?page=1&limit=5', user: 1, label: 'notifications + pagination ignorée' },
      { url: '/api/admin/utilisateurs', user: 3, label: 'utilisateurs (admin)' },
      { url: '/api/admin/utilisateurs?q=ali', user: 3, label: 'utilisateurs (admin + recherche)' },
      { url: '/api/admin/suggestions', user: 3, label: 'suggestions (admin)' },
      { url: '/api/admin/suggestions?statut=EN_ATTENTE&type=DOMAINE', user: 3, label: 'suggestions filtrées (admin)' },
      { url: '/api/admin/statistiques', user: 3, label: 'statistiques (admin)' },
      { url: '/api/admin/companies/pending', user: 3, label: 'entreprises en attente (admin)' }
    ];
    for (const t of otherLists) {
      state.calls = [];
      const res = await request(base, 'GET', t.url, t.user);
      check(`[${scenario.label}] GET ${t.url} (${t.label}) → réponse normale`,
        res.status < 500 && (res.json ? res.json.success !== undefined : true),
        `status=${res.status} corps=${String(res.body).slice(0, 80)}`);
    }
  }

  // --- Cas documenté : candidat SANS domaine professionnel (réponse vide anticipée) ---
  state.mode = 'empty';
  state.candidateHasDomain = false;
  for (const url of ['/api/offres', '/api/competences']) {
    const res = await request(base, 'GET', url, 1);
    check(`candidat sans domaine : GET ${url} → 200 + liste vide sans exception`,
      res.status === 200 && Array.isArray(res.json?.data?.items) && res.json.data.items.length === 0,
      `status=${res.status} items=${res.json?.data?.items?.length} pagination=${JSON.stringify(res.json?.data?.pagination)}`);
  }
  state.candidateHasDomain = true;

  // --- Pages EJS paginées (authentification par cookie) ---
  state.mode = 'data';
  for (const url of ['/offres', '/offres?page=1', '/offres?page=2', '/offres?limit=10', '/offres?page=1&limit=20', '/offres?page=1&limit=100', '/offres?page=0&limit=0', '/offres?page=abc&limit=xyz']) {
    state.calls = [];
    const res = await request(base, 'GET', url, 1, { cookie: true });
    check(`page EJS GET ${url} → 200 (HTML rendu)`,
      res.status === 200 && res.contentType.includes('text/html'),
      `status=${res.status} type=${res.contentType} redirection=${res.location || '-'}`);
  }
  const navPages = ['/dashboard', '/candidatures', '/matching', '/messages', '/notifications', '/competences', '/profil', '/parametres'];
  for (const url of navPages) {
    const res = await request(base, 'GET', url, 1, { cookie: true });
    check(`page EJS GET ${url} → pas d'erreur serveur`, res.status < 500, `status=${res.status}`);
  }

  /* ------------------------- Sécurité : injections ------------------------- */
  const securityPayloads = [
    { url: '/api/offres?sort=id_offre;DROP TABLE utilisateur--', user: 2, payload: 'DROP TABLE' },
    { url: '/api/offres?order=ASC;DROP TABLE utilisateur--', user: 2, payload: 'DROP TABLE' },
    { url: "/api/offres?q=%27%20OR%20%271%27%3D%271", user: 2, payload: "OR '1'='1" },
    { url: '/api/offres?statut=Ouverte%27%20OR%20%271%27%3D%271', user: 2, payload: 'OR' },
    { url: '/api/offres?limit=10;DROP%20TABLE%20utilisateur', user: 2, payload: 'DROP TABLE' },
    { url: '/api/offres?page=1%20OR%201%3D1', user: 2, payload: 'OR 1=1' },
    { url: '/api/offres?page=1&limit=1e9', user: 2, payload: '1e9' },
    { url: '/api/offres?limit[]=10', user: 2, payload: '[]' },
    { url: '/api/competences?sort=nom_competence;DROP TABLE competence--', user: 3, payload: 'DROP TABLE' },
    { url: '/api/competences?order=DESC;DELETE%20FROM%20competence', user: 3, payload: 'DELETE FROM' },
    { url: '/api/competences?id_domaine=10%20OR%201%3D1', user: 3, payload: 'OR 1=1' },
    { url: '/api/domaines?sort=x%27%20OR%20%271%27%3D%271&order=ASC', user: 3, payload: "OR '1'='1" },
    { url: '/api/experiences?sort=poste%27;DROP%20TABLE%20diplome--', user: 1, payload: 'DROP TABLE' },
    { url: '/api/entreprises?q=%27%20UNION%20SELECT%20mot_de_passe%20FROM%20utilisateur--', user: 3, payload: 'UNION SELECT' },
    { url: '/api/messages/contacts?q=%27%20OR%201%3D1--', user: 3, payload: 'OR 1=1' },
    { url: '/api/offres?sort=salaire&order=DESC', user: 2, payload: 'salaire', control: true }
  ];

  for (const t of securityPayloads) {
    state.calls = [];
    const res = await request(base, 'GET', t.url, t.user);
    const sqlText = state.calls.map((c) => c.sql).join('\n');
    const payloadInSql = sqlText.toUpperCase().includes(t.payload.toUpperCase());
    const paramValues = state.calls.flatMap((c) => c.params).map((v) => String(v)).join('|');
    const paramCarries = paramValues.toUpperCase().includes(t.payload.toUpperCase());
    const verdict = t.control ? payloadInSql : (!payloadInSql && res.status < 500);
    check(`injection « ${t.payload} » sur ${t.url.slice(0, 60)}… → ${t.control ? 'colonne autorisée bien utilisée (contrôle)' : 'SQL non altéré'}`,
      verdict,
      `status=${res.status} payloadDansSQL=${payloadInSql} payloadDansParams=${paramCarries}`);
  }

  /* ----------------- Vérifications transverses sur les requêtes ----------------- */
  state.calls = [];
  await request(base, 'GET', '/api/offres?sort=id_offre&order=ASC&page=2&limit=20', 2);
  await request(base, 'GET', '/api/competences?sort=nom_competence&order=ASC&page=3&limit=15', 3);
  await request(base, 'GET', '/api/messages/contacts', 3);
  await request(base, 'GET', '/api/notifications', 1);

  const orderByViolations = state.calls
    .map((c) => c.sql.match(/ORDER BY\s+([^\n]+)/i))
    .filter(Boolean)
    .map((m) => m[1].trim())
    .filter((clause) => !/^([a-z_.]+( (ASC|DESC))?)(, [a-z_.]+( (ASC|DESC))?)*( LIMIT \d+( OFFSET \d+)?)?$/i.test(clause));
  check('les clauses ORDER BY restent limitées aux colonnes autorisées',
    orderByViolations.length === 0, orderByViolations.join(' | '));

  const limitViolations = state.calls
    .filter((c) => /LIMIT/i.test(c.sql))
    .map((c) => c.sql.match(/LIMIT\s+(-?\d+)/i))
    .filter((m) => m && Number(m[1]) < 1);
  check('les clauses LIMIT exécutées sont des entiers positifs',
    limitViolations.length === 0, limitViolations.map(String).join(' | '));

  check('aucune requête rejetée pour erreur structurelle (1210 / 1064) pendant les tests',
    state.violations.length === 0, state.violations.slice(0, 5).join(' | '));

  const contactsLimit = state.calls
    .filter((c) => /FROM utilisateur u[\s\S]*?WHERE u\.id_utilisateur != \?/.test(c.sql))
    .map((c) => c.sql.match(/LIMIT\s+(\d+)/i))
    .filter(Boolean)
    .map((m) => Number(m[1]));
  check('contacts : LIMIT littéral (50) sans paramètre de pagination',
    contactsLimit.length === 1 && contactsLimit[0] === 50, `LIMIT=${contactsLimit.join(',')}`);

  /* --------------------------- Rapport de test --------------------------- */
  console.log('\n================ RÉSULTATS ================');
  for (const d of results.details.filter((x) => !x.ok)) {
    console.log(`❌ ${d.name}${d.extra ? `\n     → ${d.extra}` : ''}`);
  }
  console.log(`\n✅ Vérifications réussies : ${results.pass}`);
  console.log(`❌ Vérifications échouées : ${results.fail}`);
  console.log(`Total : ${results.pass + results.fail}`);

  server.close();
  process.exitCode = results.fail === 0 ? 0 : 1;
};

run().catch((error) => {
  console.error('Erreur pendant les tests :', error);
  server.close();
  process.exitCode = 1;
});
