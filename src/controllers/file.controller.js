const fs = require('fs/promises');
const path = require('path');
const { fail } = require('../utils/apiResponse');
const asyncHandler = require('../utils/asyncHandler');
const fileAccess = require('../services/fileAccess.service');
const files = require('../services/fileStorage.service');

const INLINE_TYPES = new Set(['image/jpeg', 'image/png', 'application/pdf']);
const ASCII_NAME = /[^\x20-\x7e]/g;

const contentDisposition = (file) => {
  const fallback = path.basename(String(file.nom_original || 'fichier'))
    .replace(/["\\]/g, '')
    .replace(ASCII_NAME, '_')
    .slice(0, 150) || 'fichier';
  const mode = INLINE_TYPES.has(file.type_mime) ? 'inline' : 'attachment';
  return `${mode}; filename="${fallback}"`;
};

/**
 * Sert un fichier privé après contrôle d'accès.
 * Réponse 404 identique pour « inexistant » et « interdit » : un utilisateur ne
 * peut pas déduire l'existence d'un fichier auquel il n'a pas droit.
 */
exports.get = asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1) return fail(res, 'Fichier introuvable.', [], 404);

  const file = await fileAccess.findById(id);
  if (!file || !(await fileAccess.canAccess(file, req.user))) {
    return fail(res, 'Fichier introuvable.', [], 404);
  }

  const absolutePath = files.resolveStoredPath(file.chemin);
  try {
    await fs.access(absolutePath);
  } catch (_) {
    return fail(res, 'Fichier introuvable.', [], 404);
  }

  res.set('Content-Type', file.type_mime);
  res.set('Content-Length', String(file.taille));
  res.set('Content-Disposition', contentDisposition(file));
  res.set('Cache-Control', 'private, max-age=0, must-revalidate');
  res.set('X-Content-Type-Options', 'nosniff');
  return res.sendFile(absolutePath);
});
