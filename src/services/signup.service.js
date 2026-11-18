/**
 * Service d'inscription par code de vérification e-mail (6 chiffres).
 *
 * Aucun compte `utilisateur` n'est créé tant que le code n'est pas validé.
 * Toute la logique temporelle (expiration, délai de renvoi, durée restante)
 * est calculée en SQL (NOW(), DATE_ADD, TIMESTAMPDIFF) — jamais en JS,
 * car le pool MySQL est configuré avec timezone: 'Z'.
 *
 * Sécurité :
 *  - le ticket (transmis au navigateur) et le code ne sont stockés que sous
 *    forme d'empreinte (SHA-256 pour le ticket, HMAC-SHA256 pour le code) ;
 *  - le mot de passe est haché avec bcrypt avant l'insertion en attente ;
 *  - aucun code, mot de passe ou ticket n'est journalisé.
 */
const crypto = require('crypto');
const dns = require('dns').promises;
const bcrypt = require('bcrypt');
const { v4: uuidv4 } = require('uuid');
let disposableDomains = new Set();
try {
  // Liste de domaines d'e-mails jetables (paquet npm). Repli : ensemble vide.
  const list = require('disposable-email-domains');
  disposableDomains = new Set(Array.isArray(list) ? list : []);
} catch (_) {
  disposableDomains = new Set();
}

const db = require('../config/database');
const User = require('../models/user.model');
const domaineService = require('../services/domain.service');
const mailer = require('./email.service');
const { normalizeEmailAddress } = require('../utils/email');

const CODE_PATTERN = /^\d{6}$/;

// Images par défaut PUBLIQUES (frontend/images/defaults) : elles ne contiennent
// aucune donnée personnelle et n'ont pas à passer par /files/:id.
const DEFAULT_AVATAR = '/images/defaults/default-avatar.png';
const DEFAULT_COVER = '/images/defaults/default-cover.png';

class SignupError extends Error {
  constructor(message, status = 400, data = null, code = null) {
    super(message);
    this.name = 'SignupError';
    this.status = status;
    this.data = data;
    this.code = code;
  }
}

const clamp = (value, min, max) => Math.min(Math.max(value, min), max);
const toInt = (value, fallback) => {
  const n = Number(value);
  return Number.isFinite(n) ? Math.trunc(n) : fallback;
};

const loadConfig = (env = process.env) => {
  const rawTtl = toInt(env.EMAIL_CODE_TTL_SECONDS, 600);
  const ttl = clamp(rawTtl || 600, 1, 600);
  const resend = Math.max(1, toInt(env.EMAIL_CODE_RESEND_SECONDS, 60));
  return {
    secret: String(env.EMAIL_CODE_SECRET || ''),
    ttlSeconds: ttl,
    rawTtl,
    resendSeconds: Math.min(resend, ttl),
    maxAttempts: Math.max(1, toInt(env.EMAIL_CODE_MAX_ATTEMPTS, 5)),
    maxResends: Math.max(0, toInt(env.EMAIL_CODE_MAX_RESENDS, 3)),
    blockDisposable: env.BLOCK_DISPOSABLE_EMAILS === undefined
      ? true
      : /^(1|true|yes|oui)$/i.test(String(env.BLOCK_DISPOSABLE_EMAILS).trim()),
    nodeEnv: String(env.NODE_ENV || 'development').toLowerCase()
  };
};

const validateConfig = (config = loadConfig(), logger = console) => {
  const warnings = [];
  if (config.rawTtl > 600) {
    warnings.push('EMAIL_CODE_TTL_SECONDS > 600 : valeur ramenée à 600 secondes.');
  }
  if (config.rawTtl < 60) {
    warnings.push('EMAIL_CODE_TTL_SECONDS < 60 : risque d’échecs d’inscription légitimes.');
  }
  if (!config.secret || config.secret.length < 32) {
    warnings.push('EMAIL_CODE_SECRET absent ou trop court (< 32 caractères) : les inscriptions seront bloquées (503).');
  }
  if (toInt(process.env.EMAIL_CODE_RESEND_SECONDS, 60) > config.ttlSeconds) {
    warnings.push('EMAIL_CODE_RESEND_SECONDS supérieur à la durée du code : valeur ajustée.');
  }
  warnings.forEach((w) => logger.warn?.(`[signup] ${w}`));
  return warnings;
};

const canSignup = (config = loadConfig()) => {
  if (!config.secret || config.secret.length < 32) return false;
  const mailConfig = mailer.loadConfig();
  try { mailer.assertDriverAllowed(mailConfig); } catch (_) { return false; }
  return mailer.isConfigured(mailConfig);
};

const signupBlockedReason = (config = loadConfig()) => {
  if (!config.secret || config.secret.length < 32) return 'EMAIL_CODE_SECRET';
  const mailConfig = mailer.loadConfig();
  try { mailer.assertDriverAllowed(mailConfig); } catch (e) { return e.message; }
  if (!mailer.isConfigured(mailConfig)) {
    if (!mailConfig.smtpUser) return 'SMTP_USER';
    if (!mailConfig.smtpPass) return 'SMTP_PASS';
    return 'configuration e-mail incomplète';
  }
  return null;
};

const ensureSignupAllowed = (config = loadConfig()) => {
  if (!canSignup(config)) {
    throw new SignupError('L’inscription est momentanément indisponible.', 503, {
      reason: signupBlockedReason(config)
    }, 'signup_unavailable');
  }
};

const maskEmail = (email) => {
  const value = String(email || '');
  const [local = '', domain = ''] = value.split('@');
  if (!domain) return '***';
  const head = local.slice(0, 1) || '*';
  return `${head}***@${domain}`;
};

const hashTicket = (ticket) => crypto.createHash('sha256').update(String(ticket)).digest('hex');
const codeHmac = (idInscription, code, secret) =>
  crypto.createHmac('sha256', String(secret))
    .update(`${idInscription}:${String(code)}`)
    .digest('hex');
const generateCode = () => String(crypto.randomInt(0, 1000000)).padStart(6, '0');
const generateTicket = () => crypto.randomBytes(32).toString('base64url');

const safeEqualHex = (left, right) => {
  const a = Buffer.from(String(left || ''), 'hex');
  const b = Buffer.from(String(right || ''), 'hex');
  return a.length > 0 && a.length === b.length && crypto.timingSafeEqual(a, b);
};

const buildCodeEmail = ({ prenom = '', code, minutes }) => {
  const safeName = mailer.escapeHtml(prenom || '');
  const safeCode = mailer.escapeHtml(code);
  const plural = minutes > 1 ? 's' : '';
  const subject = 'Votre code de vérification — LinkEmploi';
  const text = [
    `Bonjour ${prenom || ''},`,
    '',
    'Voici votre code de vérification LinkEmploi :',
    code,
    '',
    `Ce code est valable ${minutes} minute${plural}.`,
    'Si vous n’êtes pas à l’origine de cette demande, ignorez ce message.',
    '',
    'L’équipe LinkEmploi'
  ].join('\n');
  const html = `
    <div style="font-family:Arial,Helvetica,sans-serif;color:#1f2933;line-height:1.6;max-width:560px;margin:0 auto">
      <h1 style="font-size:22px;color:#0f6b7b">Code de vérification</h1>
      <p>Bonjour ${safeName},</p>
      <p>Voici votre code de vérification LinkEmploi :</p>
      <p style="font-size:32px;letter-spacing:8px;font-weight:700;color:#0f6b7b;margin:24px 0">${safeCode}</p>
      <p>Ce code est valable <strong>${minutes} minute${plural}</strong>.</p>
      <p style="font-size:13px;color:#52606d">Si vous n’êtes pas à l’origine de cette demande, ignorez simplement ce message.</p>
      <p>L’équipe LinkEmploi</p>
    </div>`;
  return { subject, text, html };
};

const isDisposable = (email, config = loadConfig()) => {
  if (!config.blockDisposable) return false;
  const domain = String(email || '').split('@')[1] || '';
  return disposableDomains.has(domain.toLowerCase());
};

// Vrai si l'échec DNS signifie « introuvable » (y compris via Promise.any).
const isDnsNotFound = (err) => {
  if (!err) return false;
  if (err.code === 'ENODATA' || err.code === 'ENOTFOUND') return true;
  if (err.name === 'AggregateError' && Array.isArray(err.errors)) {
    return err.errors.length > 0 && err.errors.every(isDnsNotFound);
  }
  return false;
};

const checkMx = async (email) => {
  const domain = String(email || '').split('@')[1] || '';
  if (!domain) return { ok: false, reason: 'no_domain' };
  const timeout = (ms) => new Promise((_, reject) => setTimeout(
    () => reject(Object.assign(new Error('DNS timeout'), { code: 'TIMEOUT' })), ms
  ));
  try {
    const records = await Promise.race([dns.resolveMx(domain), timeout(3000)]);
    if (Array.isArray(records) && records.length) return { ok: true };
    return { ok: false, reason: 'no_mx' };
  } catch (err) {
    if (isDnsNotFound(err)) {
      try {
        await Promise.race([Promise.any([dns.resolve4(domain), dns.resolve6(domain)]), timeout(3000)]);
        return { ok: true, implicit: true };
      } catch (err2) {
        if (isDnsNotFound(err2)) {
          return { ok: false, reason: 'domain_not_found' };
        }
      }
    }
    // Panne DNS / délai dépassé : on laisse passer (ne pas bloquer sur le réseau).
    return { ok: true, degraded: true, error: err && err.code };
  }
};

/** Purge opportuniste des inscriptions expirées depuis plus d'une heure. */
const purgeExpired = async (connection = db) => {
  await connection.execute(
    'DELETE FROM inscription_en_attente WHERE expire_at < DATE_SUB(NOW(), INTERVAL 1 HOUR)'
  );
};

const selectTiming = async (connection, ticketHash) => {
  const [rows] = await connection.execute(
    `SELECT id_inscription, email, nom, prenom, telephone, id_domaine, mot_de_passe,
            code_hash, tentatives, envois,
            TIMESTAMPDIFF(SECOND, NOW(), expire_at) AS expire_dans,
            GREATEST(TIMESTAMPDIFF(SECOND, NOW(), DATE_ADD(dernier_envoi_at, INTERVAL ? SECOND)), 0) AS renvoi_dans
     FROM inscription_en_attente
     WHERE ticket_hash = ?`,
    [loadConfig().resendSeconds, ticketHash]
  );
  return rows[0] || null;
};

const timingPayload = (row) => ({
  expire_dans: Math.max(0, Number(row.expire_dans) || 0),
  renvoi_dans: Math.max(0, Number(row.renvoi_dans) || 0)
});

const sendCode = async ({ email, prenom, code, config }) => {
  const minutes = Math.max(1, Math.round(config.ttlSeconds / 60));
  const message = buildCodeEmail({ prenom, code, minutes });
  try {
    await mailer.send({ to: email, ...message });
  } catch (error) {
    console.error('[signup] Échec de l’envoi du code pour', maskEmail(email), ':', error.code || error.message);
    if (error instanceof mailer.MailNotConfiguredError || error instanceof mailer.MailQuotaError) {
      throw new SignupError('L’inscription est momentanément indisponible.', 503, {
        reason: error.code
      }, 'signup_unavailable');
    }
    throw new SignupError('Impossible d’envoyer le code de vérification pour le moment.', 502, null, 'mail_failed');
  }
};

const validateStartPayload = (body = {}) => {
  const nom = typeof body.nom === 'string' ? body.nom.trim() : '';
  const prenom = typeof body.prenom === 'string' ? body.prenom.trim() : '';
  const email = normalizeEmailAddress(body.email);
  const motDePasse = typeof body.mot_de_passe === 'string' ? body.mot_de_passe : '';
  const telephone = typeof body.telephone === 'string' && body.telephone.trim()
    ? body.telephone.trim()
    : null;
  const idDomaine = Number(body.id_domaine);
  if (!nom || !prenom) {
    throw new SignupError('Informations d’inscription invalides.', 422, null, 'invalid_payload');
  }
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new SignupError('Adresse e-mail invalide.', 422, null, 'invalid_email');
  }
  if (motDePasse.length < 8 || motDePasse.length > 72) {
    throw new SignupError('Le mot de passe doit contenir entre 8 et 72 caractères.', 422, null, 'invalid_password');
  }
  if (!Number.isInteger(idDomaine) || idDomaine < 1) {
    throw new SignupError('Veuillez sélectionner un domaine professionnel valide.', 422, null, 'invalid_domain');
  }
  return { nom, prenom, email, motDePasse, telephone, idDomaine };
};

/**
 * Étape 1 : enregistre une inscription en attente et envoie le code.
 * Aucun compte `utilisateur` n'est créé ici.
 */
const start = async ({ body = {} } = {}) => {
  const config = loadConfig();
  ensureSignupAllowed(config);
  const payload = validateStartPayload(body);

  if (isDisposable(payload.email, config)) {
    throw new SignupError('Les adresses e-mail jetables ne sont pas autorisées.', 422, null, 'disposable_email');
  }

  if (await User.findByEmail(payload.email)) {
    throw new SignupError('Cette adresse e-mail est déjà utilisée.', 409, null, 'email_taken');
  }

  const mx = await checkMx(payload.email);
  if (!mx.ok) {
    throw new SignupError('Ce domaine e-mail n’existe pas ou ne peut pas recevoir de messages.', 422, null, 'invalid_domain_mail');
  }

  const selectedDomain = await domaineService.findById(payload.idDomaine);
  if (!selectedDomain) {
    throw new SignupError('Veuillez sélectionner un domaine professionnel valide.', 422, null, 'invalid_domain');
  }

  const idInscription = uuidv4();
  const ticket = generateTicket();
  const code = generateCode();
  const passwordHash = await bcrypt.hash(payload.motDePasse, 12);

  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();
    // Une nouvelle demande remplace l'éventuelle inscription en attente : la
    // contrainte UNIQUE(email) empêche tout doublon.
    await connection.execute('DELETE FROM inscription_en_attente WHERE email = ?', [payload.email]);
    await connection.execute(
      `INSERT INTO inscription_en_attente
         (id_inscription, email, nom, prenom, telephone, id_domaine, mot_de_passe,
          ticket_hash, code_hash, expire_at, tentatives, envois, dernier_envoi_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, DATE_ADD(NOW(), INTERVAL ? SECOND), 0, 1, NOW())`,
      [
        idInscription,
        payload.email,
        payload.nom,
        payload.prenom,
        payload.telephone,
        payload.idDomaine,
        passwordHash,
        hashTicket(ticket),
        codeHmac(idInscription, code, config.secret),
        config.ttlSeconds
      ]
    );
    await connection.commit();
  } catch (error) {
    await connection.rollback().catch(() => {});
    if (error && error.code === 'ER_DUP_ENTRY') {
      throw new SignupError('Cette adresse e-mail est déjà utilisée.', 409, null, 'email_taken');
    }
    throw error;
  } finally {
    connection.release();
  }

  try {
    await sendCode({ email: payload.email, prenom: payload.prenom, code, config });
  } catch (error) {
    // Aucun code n'a pu être envoyé : l'inscription en attente est annulée
    // pour permettre une nouvelle tentative immédiate.
    await db.execute('DELETE FROM inscription_en_attente WHERE id_inscription = ?', [idInscription]).catch(() => {});
    throw error;
  }

  const row = await selectTiming(db, hashTicket(ticket));
  const timing = row ? timingPayload(row) : { expire_dans: config.ttlSeconds, renvoi_dans: config.resendSeconds };
  return {
    ticket,
    email_masque: maskEmail(payload.email),
    ...timing
  };
};

/**
 * Renvoie un nouveau code pour une inscription en attente.
 * Le délai de renvoi et le nombre maximal de renvois sont appliqués.
 */
const resend = async ({ ticket } = {}) => {
  const config = loadConfig();
  ensureSignupAllowed(config);
  if (!ticket || typeof ticket !== 'string') {
    throw new SignupError('Demande d’inscription invalide.', 422, null, 'invalid_ticket');
  }
  const ticketHash = hashTicket(ticket);
  const row = await selectTiming(db, ticketHash);
  if (!row) {
    throw new SignupError('Demande d’inscription introuvable. Recommencez l’inscription.', 410, { expired: true }, 'not_found');
  }
  if (Number(row.expire_dans) <= 0) {
    await db.execute('DELETE FROM inscription_en_attente WHERE id_inscription = ?', [row.id_inscription]).catch(() => {});
    throw new SignupError('Le code a expiré. Recommencez l’inscription.', 410, { expired: true }, 'expired');
  }
  if (Number(row.tentatives) >= config.maxAttempts) {
    throw new SignupError('Trop de tentatives. Recommencez l’inscription.', 429, { tentatives_restantes: 0 }, 'too_many_attempts');
  }
  if (Number(row.envois) >= config.maxResends + 1) {
    throw new SignupError('Nombre maximal de renvois atteint. Recommencez l’inscription.', 429, null, 'too_many_resends');
  }
  if (Number(row.renvoi_dans) > 0) {
    throw new SignupError('Patientez avant de demander un nouveau code.', 429, {
      renvoi_dans: Number(row.renvoi_dans)
    }, 'too_soon');
  }

  const code = generateCode();
  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();
    const [updated] = await connection.execute(
      `UPDATE inscription_en_attente
       SET code_hash = ?, tentatives = 0, envois = envois + 1,
           dernier_envoi_at = NOW(), expire_at = DATE_ADD(NOW(), INTERVAL ? SECOND)
       WHERE id_inscription = ? AND ticket_hash = ?`,
      [codeHmac(row.id_inscription, code, config.secret), config.ttlSeconds, row.id_inscription, ticketHash]
    );
    if (!updated.affectedRows) {
      throw new SignupError('Demande d’inscription introuvable. Recommencez l’inscription.', 410, { expired: true }, 'not_found');
    }
    // L'envoi est fait avant le COMMIT : en cas d'échec, l'ancien code reste
    // valide et l'utilisateur peut réessayer sans perdre son inscription.
    await sendCode({ email: row.email, prenom: row.prenom, code, config });
    await connection.commit();
  } catch (error) {
    await connection.rollback().catch(() => {});
    throw error;
  } finally {
    connection.release();
  }

  const fresh = await selectTiming(db, ticketHash);
  const timing = fresh ? timingPayload(fresh) : { expire_dans: config.ttlSeconds, renvoi_dans: config.resendSeconds };
  return { email_masque: maskEmail(row.email), ...timing };
};

/**
 * Crée le compte vérifié et son profil professionnel.
 * Point d'entrée UNIQUE de `User.create` côté application (hors seed).
 */
const createVerifiedUser = async (pending, connection) => {
  const user = await User.create({
    nom: pending.nom,
    prenom: pending.prenom,
    email: pending.email,
    password: pending.mot_de_passe,
    telephone: pending.telephone,
    role: 'candidat',
    photo: DEFAULT_AVATAR,
    photoCouverture: DEFAULT_COVER,
    emailVerifie: 1,
    connection
  });
  if (!user) throw new Error('Création du compte impossible.');
  await connection.execute(
    'INSERT INTO profil_professionnel (id_utilisateur, id_domaine) VALUES (?, ?)',
    [user.id_utilisateur, pending.id_domaine]
  );
  return user;
};

/**
 * Étape 2 : valide le code et crée le compte de manière atomique.
 * En cas de code incorrect, l'inscription en attente est conservée.
 */
const verify = async ({ ticket, code } = {}) => {
  const config = loadConfig();
  ensureSignupAllowed(config);
  if (!ticket || typeof ticket !== 'string') {
    throw new SignupError('Demande d’inscription invalide.', 422, null, 'invalid_ticket');
  }
  if (!CODE_PATTERN.test(String(code || ''))) {
    throw new SignupError('Le code doit contenir 6 chiffres.', 422, { tentatives_restantes: config.maxAttempts }, 'invalid_code');
  }

  const ticketHash = hashTicket(ticket);
  const row = await selectTiming(db, ticketHash);
  if (!row) {
    throw new SignupError('Demande d’inscription introuvable. Recommencez l’inscription.', 410, { expired: true }, 'not_found');
  }
  if (Number(row.expire_dans) <= 0) {
    await db.execute('DELETE FROM inscription_en_attente WHERE id_inscription = ?', [row.id_inscription]).catch(() => {});
    throw new SignupError('Le code a expiré. Recommencez l’inscription.', 410, { expired: true }, 'expired');
  }
  if (Number(row.tentatives) >= config.maxAttempts) {
    await db.execute('DELETE FROM inscription_en_attente WHERE id_inscription = ?', [row.id_inscription]).catch(() => {});
    throw new SignupError('Trop de tentatives. Recommencez l’inscription.', 429, { tentatives_restantes: 0 }, 'too_many_attempts');
  }

  const expected = codeHmac(row.id_inscription, code, config.secret);
  if (!safeEqualHex(expected, row.code_hash)) {
    const nextAttempts = Number(row.tentatives) + 1;
    const remaining = Math.max(0, config.maxAttempts - nextAttempts);
    if (remaining <= 0) {
      await db.execute('DELETE FROM inscription_en_attente WHERE id_inscription = ?', [row.id_inscription]).catch(() => {});
      throw new SignupError('Trop de tentatives. Recommencez l’inscription.', 429, { tentatives_restantes: 0 }, 'too_many_attempts');
    }
    await db.execute(
      'UPDATE inscription_en_attente SET tentatives = ? WHERE id_inscription = ?',
      [nextAttempts, row.id_inscription]
    );
    throw new SignupError('Code incorrect.', 422, { tentatives_restantes: remaining }, 'invalid_code');
  }

  const connection = await db.getConnection();
  let userId;
  try {
    await connection.beginTransaction();
    // Relecture verrouillée : deux validations simultanées ne peuvent pas
    // créer deux comptes pour la même inscription.
    const [lockedRows] = await connection.execute(
      `SELECT id_inscription, email, nom, prenom, telephone, id_domaine, mot_de_passe,
              code_hash, tentatives, expire_at
       FROM inscription_en_attente WHERE id_inscription = ? FOR UPDATE`,
      [row.id_inscription]
    );
    const locked = lockedRows[0];
    if (!locked) {
      throw new SignupError('Demande d’inscription introuvable. Recommencez l’inscription.', 410, { expired: true }, 'not_found');
    }
    const [expiryRows] = await connection.execute(
      'SELECT TIMESTAMPDIFF(SECOND, NOW(), expire_at) AS expire_dans FROM inscription_en_attente WHERE id_inscription = ?',
      [locked.id_inscription]
    );
    if (!expiryRows[0] || Number(expiryRows[0].expire_dans) <= 0) {
      await connection.execute('DELETE FROM inscription_en_attente WHERE id_inscription = ?', [locked.id_inscription]);
      await connection.commit();
      throw new SignupError('Le code a expiré. Recommencez l’inscription.', 410, { expired: true }, 'expired');
    }
    if (!safeEqualHex(codeHmac(locked.id_inscription, code, config.secret), locked.code_hash)) {
      throw new SignupError('Code incorrect.', 422, { tentatives_restantes: Math.max(0, config.maxAttempts - Number(locked.tentatives) - 1) }, 'invalid_code');
    }

    const domain = await domaineService.findById(locked.id_domaine, connection);
    if (!domain) {
      await connection.execute('DELETE FROM inscription_en_attente WHERE id_inscription = ?', [locked.id_inscription]);
      await connection.commit();
      throw new SignupError('Le domaine professionnel sélectionné n’existe plus. Recommencez l’inscription.', 422, null, 'invalid_domain');
    }

    const [existing] = await connection.execute(
      'SELECT id_utilisateur FROM utilisateur WHERE email = ? FOR UPDATE',
      [locked.email]
    );
    if (existing.length) {
      await connection.execute('DELETE FROM inscription_en_attente WHERE id_inscription = ?', [locked.id_inscription]);
      await connection.commit();
      throw new SignupError('Cette adresse e-mail est déjà utilisée.', 409, null, 'email_taken');
    }

    const created = await createVerifiedUser(locked, connection);
    userId = created.id_utilisateur;
    await connection.execute('DELETE FROM inscription_en_attente WHERE id_inscription = ?', [locked.id_inscription]);
    await connection.commit();
  } catch (error) {
    await connection.rollback().catch(() => {});
    if (error instanceof SignupError) throw error;
    if (error && error.code === 'ER_DUP_ENTRY') {
      throw new SignupError('Cette adresse e-mail est déjà utilisée.', 409, null, 'email_taken');
    }
    throw error;
  } finally {
    connection.release();
  }

  const fresh = await User.findById(userId);
  return { user: fresh };
};

/** Annule une inscription en attente (idempotent). */
const cancel = async ({ ticket } = {}) => {
  if (!ticket || typeof ticket !== 'string') return { cancelled: false };
  const [result] = await db.execute(
    'DELETE FROM inscription_en_attente WHERE ticket_hash = ?',
    [hashTicket(ticket)]
  );
  return { cancelled: result.affectedRows > 0 };
};

/** Informations d'affichage pour la page de saisie du code. */
const getPending = async ({ ticket } = {}) => {
  if (!ticket || typeof ticket !== 'string') return null;
  const row = await selectTiming(db, hashTicket(ticket));
  if (!row || Number(row.expire_dans) <= 0) return null;
  return {
    email_masque: maskEmail(row.email),
    expire_dans: Math.max(0, Number(row.expire_dans) || 0),
    renvoi_dans: Math.max(0, Number(row.renvoi_dans) || 0),
    tentatives_restantes: Math.max(0, loadConfig().maxAttempts - Number(row.tentatives))
  };
};

/** Message d'état affiché au démarrage du serveur. */
const describeState = (config = loadConfig()) => {
  if (!config.secret || config.secret.length < 32) {
    return 'Inscription par code e-mail : INACTIVE — LES INSCRIPTIONS SONT BLOQUÉES (variable manquante : EMAIL_CODE_SECRET)';
  }
  const mailConfig = mailer.loadConfig();
  try {
    mailer.assertDriverAllowed(mailConfig);
  } catch (error) {
    return `Inscription par code e-mail : INACTIVE — LES INSCRIPTIONS SONT BLOQUÉES (${error.message})`;
  }
  if (!mailer.isConfigured(mailConfig)) {
    return mailer.describeSignupState(mailConfig);
  }
  if (mailConfig.driver === 'console') {
    return 'Inscription par code e-mail : ACTIVE en mode CONSOLE (développement : le code s’affiche dans ce terminal)';
  }
  if (mailConfig.driver === 'outbox') {
    return 'Inscription par code e-mail : ACTIVE en mode OUTBOX (tests : les e-mails sont écrits dans le dossier outbox)';
  }
  const minutes = Math.max(1, Math.round(config.ttlSeconds / 60));
  return `Inscription par code e-mail : ACTIVE (SMTP Gmail, code valable ${minutes} min)`;
};

module.exports = {
  SignupError,
  loadConfig,
  validateConfig,
  canSignup,
  signupBlockedReason,
  describeState,
  start,
  resend,
  verify,
  cancel,
  getPending,
  purgeExpired,
  createVerifiedUser,
  // Fonctions pures exposées pour les tests unitaires.
  maskEmail,
  generateCode,
  generateTicket,
  hashTicket,
  codeHmac,
  buildCodeEmail,
  isDisposable,
  checkMx
};
