exports.pagination = (query) => {
  const page = Math.max(parseInt(query.page, 10) || 1, 1);
  const limit = Math.min(Math.max(parseInt(query.limit, 10) || 10, 1), 100);
  return { page, limit, offset: (page - 1) * limit };
};

/**
 * Entier strictement validé pour une clause STRUCTURELLE de SQL (LIMIT / OFFSET).
 *
 * Pourquoi ne pas utiliser un placeholder `?` : `mysql2.execute()` (requêtes
 * préparées) encode les nombres JavaScript en MYSQL_TYPE_DOUBLE ; depuis
 * MySQL 8.0.22 le serveur refuse ce type pour les paramètres de LIMIT/OFFSET et
 * répond « Incorrect arguments to mysqld_stmt_execute »
 * (ER_WRONG_ARGUMENTS, errno 1210). Ces deux valeurs sont donc insérées dans la
 * chaîne SQL, mais UNIQUEMENT après validation stricte : la valeur renvoyée est
 * un nombre entier (`^\d+$`), jamais le texte fourni — aucune injection
 * possible. Toutes les autres valeurs utilisateur restent des paramètres `?`.
 */
const safeClauseInt = (value, { min, name }) => {
  const text = typeof value === 'number' ? String(value) : String(value ?? '').trim();
  const parsed = /^\d+$/.test(text) ? Number(text) : NaN;
  if (!Number.isInteger(parsed) || parsed < min) {
    const error = new Error(`Paramètre de pagination invalide : ${name}.`);
    error.statusCode = 422;
    throw error;
  }
  return parsed;
};

/** Clause `LIMIT n OFFSET m` (n et m strictement validés, jamais des placeholders). */
exports.limitOffsetClause = (limit, offset) =>
  `LIMIT ${safeClauseInt(limit, { min: 1, name: 'limit' })} OFFSET ${safeClauseInt(offset, { min: 0, name: 'offset' })}`;

/** Clause `LIMIT n` (n strictement validé, jamais un placeholder). */
exports.limitClause = (limit) =>
  `LIMIT ${safeClauseInt(limit, { min: 1, name: 'limit' })}`;

exports.listResult = (rows, total, page, limit) => ({
  items: rows,
  pagination: { page, limit, total, pages: Math.ceil(total / limit) }
});
