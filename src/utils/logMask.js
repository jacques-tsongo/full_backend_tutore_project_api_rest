/**
 * Masquage des secrets dans les URL journalisées.
 *
 * Deux fuites possibles avec `morgan('dev')` :
 *   - `/verify-email?token=<64 hexadécimaux>`  → paramètre `token=…` ;
 *   - `/api/auth/verify-email/<64 hexadécimaux>` → jeton dans le chemin.
 *
 * Toute séquence de 64 caractères hexadécimaux et toute valeur du paramètre
 * `token` sont remplacées par `[masqué]`.
 */
const TOKEN_QUERY = /([?&]token=)[^&\s]*/gi;
const HEX_64 = /\b[a-f0-9]{64}\b/gi;
const MASK = '[masqué]';

const maskSensitiveUrl = (url = '') => String(url)
  .replace(TOKEN_QUERY, `$1${MASK}`)
  .replace(HEX_64, MASK);

module.exports = { maskSensitiveUrl, MASK };
