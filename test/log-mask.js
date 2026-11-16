/**
 * Masquage des jetons de vérification dans les URL journalisées par morgan.
 *
 * Exécution : node test/log-mask.js (npm run test:log-mask)
 */
const assert = require('node:assert/strict');
const { maskSensitiveUrl, MASK } = require('../src/utils/logMask');

let checks = 0;
const test = (name, fn) => {
  try {
    fn();
    checks += 1;
    console.log(`  OK   ${name}`);
  } catch (error) {
    console.error(`  ECHEC ${name}`);
    console.error(`        ${error.stack || error.message}`);
    process.exitCode = 1;
  }
};

console.log('Masquage des jetons dans les logs');

test('le paramètre token= est masqué', () => {
  const token = 'a'.repeat(64);
  const url = `/verify-email?token=${token}`;
  const masked = maskSensitiveUrl(url);
  assert.equal(masked, `/verify-email?token=${MASK}`);
  assert.doesNotMatch(masked, /a{64}/);
});

test('un jeton dans le chemin est masqué', () => {
  const token = 'B'.repeat(64);
  const masked = maskSensitiveUrl(`/api/auth/verify-email/${token}`);
  assert.equal(masked, `/api/auth/verify-email/${MASK}`);
});

test('une URL ordinaire reste intacte', () => {
  assert.equal(maskSensitiveUrl('/api/auth/login?x=1'), '/api/auth/login?x=1');
  assert.equal(maskSensitiveUrl('/offres/12'), '/offres/12');
});

test('le masquage vaut aussi pour une séquence hexadécimale isolée', () => {
  const token = '0123456789abcdef'.repeat(4);
  const masked = maskSensitiveUrl(`/verify-email?token=${token}&lang=fr`);
  assert.match(masked, new RegExp(`token=${MASK.replace(/[[\]]/g, '\\$&')}&lang=fr`));
  assert.doesNotMatch(masked, new RegExp(token));
});

if (process.exitCode) {
  console.error(`\n${checks} test(s) réussi(s), des erreurs subsistent.`);
} else {
  console.log(`\n${checks} test(s) réussi(s).`);
}
