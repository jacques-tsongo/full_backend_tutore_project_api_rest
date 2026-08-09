const FLASH_COOKIE = 'gc_flash';

/**
 * Flash « sans session » : le message d'une action de formulaire (POST web)
 * est stocké dans un cookie httpOnly de très courte durée, lu une seule fois
 * lors du rendu de la page suivante, puis effacé.
 */
const cookieOpts = { httpOnly: true, sameSite: 'lax', path: '/', maxAge: 30 * 1000 };

exports.flash = (res, type, message) =>
  res.cookie(FLASH_COOKIE, JSON.stringify({ type, message }), cookieOpts);

/** Middleware : expose `res.locals.flash` et consomme le cookie (une seule lecture). */
exports.readFlash = (req, res, next) => {
  res.locals.flash = null;
  const raw = req.cookies?.[FLASH_COOKIE];
  if (raw) {
    try { res.locals.flash = JSON.parse(raw); } catch (_) { res.locals.flash = null; }
    res.clearCookie(FLASH_COOKIE, { path: '/' });
  }
  // Thème mémorisé dans un cookie lisible serveur-side : le HTML est rendu avec
  // le bon `data-theme` dès le premier octet (aucun flash de thème au chargement).
  res.locals.theme = req.cookies?.gc_theme === 'dark' ? 'dark' : 'light';
  next();
};

/** URL de retour sûre : uniquement un chemin local, jamais une URL externe. */
exports.backUrl = (req, fallback = '/') => {
  const ref = req.get('Referer') || '';
  try {
    // Referer absolue même origine → chemin local.
    const url = new URL(ref, 'http://localhost');
    if (url.origin === new URL(req.get('Referer') || '', 'http://localhost').origin && url.pathname.startsWith('/')) {
      return `${url.pathname}${url.search}${url.hash}`;
    }
  } catch (_) { /* ignore */ }
  return ref.startsWith('/') && !ref.startsWith('//') ? ref : fallback;
};
