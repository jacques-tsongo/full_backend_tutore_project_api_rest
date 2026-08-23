const express = require('express');
const path = require('path');
const fs = require('fs');
const helmet = require('helmet'); 
const cors = require('cors'); 
const morgan = require('morgan'); 
const cookieParser = require('cookie-parser');
const { notFound, errorHandler } = require('./middlewares/error.middleware'); 
const { readFlash } = require('./helpers/flash');
const { success } = require('./utils/apiResponse');
const app = express();

/* ------------------------- Sécurité & parsing --------------------------- */
// CSP : `connect-src` autorise la même origine ET les WebSocket (Socket.IO),
// requis par le temps réel ; le reste du CSP reste celui par défaut.
app.use(helmet({
  crossOriginResourcePolicy: false,
  contentSecurityPolicy: {
    useDefaults: true,
    directives: {
      'connect-src': ["'self'", 'ws:', 'wss:'],
      // Tuiles cartographiques OpenStreetMap (feuilles Leaflet locales).
      'img-src': ["'self'", 'data:', 'https://tile.openstreetmap.org']
    }
  }
}));

const swaggerUi = require("swagger-ui-express");
const swaggerSpec = require("../swagger");
const rootPath = process.cwd();
const frontendPath = path.join(rootPath, 'frontend');

// pour la documentation de l'API
app.use("/api-docs", swaggerUi.serve, swaggerUi.setup(swaggerSpec));

/* ------------------------- Parsing (JSON / formulaires) ------------------ */
app.use(cors({ origin: process.env.CORS_ORIGIN?.split(',') || true, credentials: true })); 
app.use(express.json({ limit: '1mb' })); 
app.use(express.urlencoded({ extended: false, limit: '1mb' })); // formulaires HTML
app.use(cookieParser());
app.use(morgan('dev')); 
app.use('/uploads', express.static(path.join(rootPath, 'uploads')));
app.use(express.static(frontendPath));
app.use(readFlash);

/* ---------------------- Moteur de vues EJS ------------------------------- */
app.set('view engine', 'ejs');
app.set('views', path.join(rootPath, 'views'));

/* --------------------- Helpers disponibles dans les vues ------------------ */
// Icône SVG professionnelle (Lucide, servie en local — aucune dépendance CDN).
const iconCache = new Map();
app.locals.icon = (name, cls = 'icon') => {
  if (!iconCache.has(name)) {
    let svg = '';
    try {
      svg = fs.readFileSync(path.join(frontendPath, 'vendor', 'lucide', `${name}.svg`), 'utf8');
    } catch (_) { svg = ''; }
    // Retire le commentaire de licence et injecte la classe de présentation.
    svg = svg.replace(/<!--[\s\S]*?-->/g, '').trim().replace('class="lucide', 'class=" icon-placeholder lucide');
    iconCache.set(name, svg);
  }
  const svg = iconCache.get(name);
  if (!svg) return '';
  return cls ? svg.replace(' icon-placeholder ', ` ${cls} `) : svg.replace(' icon-placeholder ', ' ');
};
app.locals.formatDate = (value) => {
  if (!value) return '-';
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? '-' : d.toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' });
};
app.locals.formatDateTime = (value) => {
  if (!value) return '-';
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? '-' : `${d.toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' })} ${d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}`;
};
// Normalise les chemins de fichiers stockés ('uploads/x' ou '/uploads/x').
app.locals.asset = (p) => (p ? (String(p).startsWith('/') ? p : `/${p}`) : null);
app.locals.statusClass = (value = '') => {
  const v = String(value);
  if (['approved', 'Validée', 'Acceptée', 'Ouverte', 'actif', 'Lue', 'APPROUVEE'].includes(v)) return 'success';
  if (['rejected', 'Rejetée', 'Refusée', 'Suspendue', 'suspendu', 'Annulée', 'REFUSEE'].includes(v)) return 'danger';
  if (['pending', 'En attente', 'approved_but', 'inactif', 'Entretien', 'EN_ATTENTE'].includes(v)) return 'warning';
  if (['Présélectionnée', 'Fermée'].includes(v)) return 'info';
  return 'neutral';
};
app.locals.dateInput = (value) => {
  if (!value) return '';
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? '' : d.toISOString().slice(0, 10);
};

/* ------------------- Redirections des anciennes pages .html -------------- */
const legacyRedirects = {
  '/index.html': '/',
  '/login.html': '/login',
  '/register.html': '/register',
  '/about.html': '/about',
  '/contact.html': '/contact',
  '/candidate-dashboard.html': '/dashboard',
  '/recruiter-dashboard.html': '/dashboard',
  '/admin-dashboard.html': '/dashboard',
  '/profile.html': '/profil',
  '/settings.html': '/parametres',
  '/jobs.html': '/offres',
  '/applications.html': '/candidatures',
  '/matching.html': '/matching',
  '/messages.html': '/messages',
  '/notifications.html': '/notifications',
  '/companies.html': '/entreprises',
  '/create-company.html': '/entreprise/demande',
  '/404.html': '/'
};
app.use((req, res, next) => {
  const target = legacyRedirects[req.path];
  if (target) return res.redirect(301, target);
  if (req.path === '/job-details.html' && req.query.id) return res.redirect(301, `/offres/${encodeURIComponent(req.query.id)}`);
  if (req.path === '/job-details.html') return res.redirect(301, '/offres');
  if (req.path === '/company-details.html' && req.query.id) return res.redirect(301, `/entreprises/${encodeURIComponent(req.query.id)}`);
  if (req.path === '/company-details.html') return res.redirect(301, '/entreprises');
  return next();
});

/* ------------------------------ API -------------------------------------- */
app.get('/api/health', (req, res) => success(res, 'API opérationnelle.', { environment: process.env.NODE_ENV || 'development' })); 
app.use('/api/auth', require('./routes/auth.routes')); 
app.use('/api/profil', require('./routes/profile.routes'));
// company.routes AVANT resource.routes  : GET /api/entreprises/mine et
// PUT /api/entreprises/:id (propriétaire) doivent primer sur /:id générique.
app.use('/api', require('./routes/company.routes')); 
app.use('/api', require('./routes/resource.routes')); 
app.use('/api', require('./routes/jobs.routes')); 
app.use('/api/messages', require('./routes/message.routes')); 
app.use('/api/notifications', require('./routes/notification.routes')); 
app.use('/api/suggestions', require('./routes/suggestion.routes'));
app.use('/api/admin', require('./routes/admin.routes')); 

/* --------------------------- Pages EJS ----------------------------------- */
app.use('/', require('./routes/web.routes'));

/* ------------------------------ Erreurs ---------------------------------- */
app.use(notFound); 
app.use(errorHandler); 
 
 module.exports = app;
