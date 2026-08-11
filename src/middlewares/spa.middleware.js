/**
 * SPA-like navigation middleware.
 *
 * Intercepts res.render() calls: when the client sends the custom header
 * X-SPA-Content, only the page-specific content partial is rendered and
 * returned as JSON (title, active sidebar key, subtitle, HTML).
 * Full-page render is delegated to the original res.render() otherwise.
 *
 * This avoids creating duplicate /content routes — the existing page
 * controller handlers work unchanged for both full-page and SPA loads.
 */

const VIEW_META = {
  dashboard:          { active: 'dashboard',      pageId: 'dashboard' },
  profile:            { active: 'profil',          pageId: 'profil' },
  offers:             { active: 'offres',          pageId: 'offres' },
  'offer-details':    { active: 'offres',          pageId: 'offres' },
  applications:       { active: 'candidatures',    pageId: 'candidatures' },
  'applications-received': { active: 'candidatures', pageId: 'candidatures' },
  matching:           { active: 'matching',        pageId: 'matching' },
  messages:           { active: 'messages',        pageId: 'messages' },
  notifications:      { active: 'notifications',   pageId: 'notifications' },
  companies:          { active: 'entreprises',     pageId: 'entreprises' },
  'company-details':  { active: 'entreprises',     pageId: 'entreprises' },
  'company-manage':   { active: 'entreprise',      pageId: 'entreprise' },
  'company-request':  { active: 'parametres',      pageId: 'entreprise-demande' },
  settings:           { active: 'parametres',      pageId: 'parametres' },
};

const SUBTITLES = {
  dashboard:     'Tableau de bord',
  profile:       'Informations professionnelles, fichiers, compétences, expériences et diplômes.',
  offers:        'Recherche, filtres et candidatures.',
  'offer-details': null,
  applications:  'Suivi des candidatures.',
  'applications-received': 'Examinez les profils et mettez à jour les statuts.',
  matching:      'Compatibilité entre vos compétences et les offres ouvertes.',
  messages:      'Échanges avec vos contacts professionnels.',
  notifications: 'Activité de votre compte.',
  companies:     'Entreprises approuvées de la plateforme.',
  'company-details': null,
  'company-manage': 'Informations visibles par les candidats.',
  'company-request': 'Soumettez votre entreprise à la validation d\'un administrateur.',
  settings:      'Compte, sécurité, apparence et espace recruteur.',
};

module.exports = function spaMiddleware(req, res, next) {
  // Store the original Express render function
  const renderExpress = res.render.bind(res);

  // Override res.render to intercept for SPA content requests
  res.render = function renderSPA(view, data, callback) {
    // If not an SPA content request, delegate to Express's real render
    const isSPA = req.headers['x-spa-content'] === '1';

    if (!isSPA) {
      // Full page: render using the shell template with the content inlined
      const viewData = typeof data === 'object' && data !== null ? data : {};
      const meta = VIEW_META[view] || {};
      const subtitle = viewData._subtitle || SUBTITLES[view] || viewData.subtitle || '';

      // Render the original view's content into the shell
      const shellData = {
        ...viewData,
        spaContent: '', // will be replaced after rendering the content
        _active: viewData._active || meta.active || '',
        _pageId: viewData._pageId || meta.pageId || '',
        _subtitle: subtitle,
      };

      // Render the content partial first, then wrap in the shell
      renderExpress(view, viewData, (err, contentHtml) => {
        if (err) {
          // Fallback: try to render via shell if content render fails
          if (callback) return callback(err);
          return;
        }
        shellData.spaContent = contentHtml;
        renderExpress('app-shell', shellData, callback || ((err2, html) => {
          if (err2) { res.status(500).send('Erreur interne.'); return; }
          res.send(html);
        }));
      });
      return this; // res.render returns `this` per Express contract
    }

    // SPA content-only response: render just the content partial as JSON
    try {
      const viewData = typeof data === 'object' && data !== null ? data : {};
      const meta = VIEW_META[view] || {};
      const subtitle = viewData._subtitle || SUBTITLES[view] || viewData.subtitle || '';

      renderExpress(view, viewData, (err, contentHtml) => {
        if (err) {
          console.error('[SPA] Erreur rendu contenu:', err.message);
          res.status(500).json({
            success: false,
            message: 'Impossible de charger cette section. Veuillez réessayer.',
          });
          return;
        }

        res.json({
          success: true,
          content: contentHtml,
          title: viewData.title || '',
          active: viewData._active || meta.active || '',
          subtitle: subtitle,
        });
      });
    } catch (err) {
      console.error('[SPA] Erreur:', err.message);
      res.status(500).json({
        success: false,
        message: 'Impossible de charger cette section. Veuillez réessayer.',
      });
    }

    return this;
  };

  next();
};
