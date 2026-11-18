/**
 * Diagnostic de la configuration e-mail (Nodemailer / Gmail) — AUCUN envoi par défaut.
 *
 *   node scripts/check-mail.js
 *   node scripts/check-mail.js --send-to=adresse@exemple.com
 *
 * Les secrets (SMTP_PASS, code) ne sont jamais affichés.
 */
require('dotenv').config();
const mailer = require('../src/services/email.service');

const config = mailer.loadConfig();
const status = mailer.getStatus(config);

console.log('Configuration de l’envoi d’e-mails (Nodemailer / Gmail)');
console.log(`  MAIL_DRIVER       : ${config.driver}`);
console.log(`  SMTP_HOST         : ${config.smtpHost}`);
console.log(`  SMTP_PORT         : ${config.smtpPort}`);
console.log(`  SMTP_SECURE       : ${config.smtpSecure}`);
console.log(`  SMTP_USER         : ${config.smtpUser || '(absent)'}`);
console.log(`  SMTP_PASS         : ${config.smtpPass ? 'présent' : 'absent'}`);
console.log(`  MAIL_FROM_NAME    : ${config.fromName}`);
console.log(`  MAIL_FROM_EMAIL   : ${config.fromEmail || '(absent)'}`);
console.log(`  MAIL_DAILY_LIMIT  : ${config.dailyLimit}`);
console.log(`  MAIL_OUTBOX_DIR   : ${config.outboxDir}`);
console.log(`  EMAIL_CODE_SECRET : ${process.env.EMAIL_CODE_SECRET ? 'présent' : 'absent'}`);
console.log(`  EMAIL_CODE_TTL_SECONDS : ${process.env.EMAIL_CODE_TTL_SECONDS || '600 (défaut)'}`);
console.log(`\n${status.signupState}`);

const sendArg = process.argv.find((arg) => arg.startsWith('--send-to='));

(async () => {
  try {
    if (config.driver === 'smtp') {
      await mailer.verifyConnection({ config });
      console.log('\nVérification SMTP : connexion réussie.');
    }
  } catch (error) {
    console.error(`\nVérification SMTP : échec (${error.code || 'erreur'}${error.causeCode ? `, ${error.causeCode}` : ''}).`);
    hint(error);
    if (!sendArg) process.exitCode = 1;
  }

  if (!sendArg) {
    console.log('\nAucun envoi demandé. Utilisez --send-to=adresse@exemple.com pour tester un envoi réel.');
    return;
  }

  const to = sendArg.slice('--send-to='.length).trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) {
    console.error('\nAdresse de test invalide : utilisez --send-to=adresse@exemple.com');
    process.exit(1);
  }
  if (!mailer.isConfigured(config)) {
    console.error('\nImpossible d’envoyer : la configuration e-mail est incomplète ou le driver est refusé.');
    process.exit(1);
  }

  try {
    await mailer.send({
      to,
      subject: 'Test d’envoi — LinkEmploi',
      text: 'Ceci est un e-mail de test envoyé depuis scripts/check-mail.js.',
      html: '<p>Ceci est un e-mail de test envoyé depuis <code>scripts/check-mail.js</code>.</p>'
    }, { config });
    console.log(`\nSuccès : e-mail de test traité pour ${mailer.maskEmail(to)}.`);
  } catch (error) {
    console.error(`\nÉchec de l’envoi (${error.code || 'erreur'}${error.causeCode ? `, ${error.causeCode}` : ''}).`);
    hint(error);
    process.exitCode = 1;
  }
})();

function hint(error) {
  const code = String(error.causeCode || error.responseCode || error.code || '');
  if (code === '535' || /535/.test(error.message || '')) {
    console.error('Piste (535) : mot de passe d’application Gmail refusé. Vérifiez que la validation en deux étapes est activée sur le compte Gmail dédié, puis créez un nouveau mot de passe d’application et renseignez-le dans SMTP_PASS (16 caractères, sans espaces).');
  } else if (code === '534' || code === '550' || /534|550/.test(error.message || '')) {
    console.error('Piste (534/550) : quota dépassé ou envoi bloqué par Gmail. Vérifiez la limite de 500 destinataires/jour, l’état du compte et utilisez un compte Gmail dédié à l’application.');
  } else if (code === 'ETIMEDOUT' || code === 'ESOCKET' || /timeout|délai/i.test(error.message || '')) {
    console.error('Piste : délai dépassé lors de la connexion SMTP. Vérifiez SMTP_HOST/SMTP_PORT/SMTP_SECURE, le pare-feu et la connexion réseau.');
  } else if (error.code === 'not_configured' || error.code === 'driver_forbidden') {
    console.error('Piste : vérifiez MAIL_DRIVER, SMTP_USER/SMTP_PASS et les règles (console/outbox interdits en production, smtp interdit en test).');
  }
}
