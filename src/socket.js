/**
 * Socket.IO — couche temps réel de l'application.
 *
 * L'API REST + MySQL restent la source officielle des données ; Socket.IO ne
 * fait qu'informer les clients connectés qu'une donnée vient d'être créée,
 * modifiée ou supprimée (jamais l'inverse).
 *
 * Authentification : le client navigateur est identifié via le cookie
 * httpOnly `gc_token` (même JWT que l'API REST). Un client API peut aussi
 * fournir le jeton via `auth.token` (Authorization: Bearer équivalent).
 * Chaque socket rejoint :
 *   - `user_<id_utilisateur>`  → messages / notifications privés ;
 *   - `role_<role>`            → diffusions ciblées (offres, compétences).
 */
const { Server } = require('socket.io');
const jwt = require('jsonwebtoken');
const User = require('./models/user.model');

let io = null;

/** Lit le cookie `gc_token` depuis l'en-tête Cookie de la poignée de main. */
const tokenFromCookie = (header = '') => {
  const match = String(header).split(';').map((p) => p.trim()).find((p) => p.startsWith('gc_token='));
  return match ? match.slice('gc_token='.length) : null;
};

/** Initialise Socket.IO sur le serveur HTTP existant (un seul serveur). */
const initSocket = (server) => {
  io = new Server(server, {
    // Même origine que l'application (pages EJS + API) : pas de CORS distant.
    cors: { origin: false },
    serveClient: true
  });

  io.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth?.token || tokenFromCookie(socket.handshake.headers?.cookie);
      if (!token) return next(new Error('non_authentifie'));
      const payload = jwt.verify(token, process.env.JWT_SECRET);
      const user = await User.findById(payload.id);
      if (!user || user.statut_compte !== 'actif') return next(new Error('compte_indisponible'));
      socket.user = user;
      return next();
    } catch (_) {
      return next(new Error('non_authentifie'));
    }
  });

  io.on('connection', (socket) => {
    const userId = socket.user.id_utilisateur;
    // Rooms d'identification : privées (user_x) et par rôle (role_x).
    socket.join(`user_${userId}`);
    socket.join(`role_${socket.user.role}`);
  });

  return io;
};

/** Retourne l'instance Socket.IO (null si non initialisée). */
const getIO = () => io;

/** Envoie un événement à un utilisateur précis (room user_x). */
const emitToUser = (userId, event, data) => {
  try { if (io) io.to(`user_${userId}`).emit(event, data); } catch (_) { /* non bloquant */ }
};

/** Envoie un événement à tous les utilisateurs d'un rôle (room role_x). */
const emitToRole = (role, event, data) => {
  try { if (io) io.to(`role_${role}`).emit(event, data); } catch (_) { /* non bloquant */ }
};

/** Diffuse un événement à tous les clients connectés et authentifiés. */
const emitAll = (event, data) => {
  try { if (io) io.emit(event, data); } catch (_) { /* non bloquant */ }
};

module.exports = { initSocket, getIO, emitToUser, emitToRole, emitAll };
