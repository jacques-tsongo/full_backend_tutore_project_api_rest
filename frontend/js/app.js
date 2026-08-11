/* LinkEmploi — SPA-like navigation for authenticated area + page interactions.
   - Sidebar click interception: load content via fetch, no full page reload.
   - History API (pushState / popstate) for natural back/forward behavior.
   - Async form submission (data-spa-form) to avoid full page reloads.
   - Theme toggle, mobile sidebar, flash messages, badge refresh. */
(() => {
  'use strict';

  const THEME_KEY = 'gc_theme';
  const SPA_HEADER = 'X-SPA-Content';
  const CONTENT_ID = 'app-content';

  /* ---------- Helpers ---------- */
  const setCookie = (name, value, days = 180) => {
    const maxAge = days * 24 * 60 * 60;
    document.cookie = `${name}=${encodeURIComponent(value)}; path=/; max-age=${maxAge}; SameSite=Lax`;
  };

  const isAuthPage = () => Boolean(document.body.dataset.userId);

  /** Determine the SPA content URL for a given path.
   *  /dashboard → /dashboard  (server checks header)
   *  /offres?q=term → /offres?query with same params
   */
  const spaUrl = (path) => path; // The server intercepts via X-SPA-Content header

  /** Map a URL pathname to the known sidebar active key. */
  const pathToActive = (pathname) => {
    if (pathname === '/dashboard') return 'dashboard';
    if (pathname === '/profil') return 'profil';
    if (pathname.startsWith('/offres')) return 'offres';
    if (pathname === '/candidatures') return 'candidatures';
    if (pathname === '/matching') return 'matching';
    if (pathname === '/messages') return 'messages';
    if (pathname === '/notifications') return 'notifications';
    if (pathname === '/entreprises') return 'entreprises';
    if (pathname === '/entreprise') return 'entreprise';
    if (pathname === '/entreprise/demande') return 'parametres';
    if (pathname === '/parametres') return 'parametres';
    return '';
  };

  /* ---------- Content Loading ---------- */

  /** Show loading skeleton in #app-content. */
  const showLoading = () => {
    const el = document.getElementById(CONTENT_ID);
    if (!el) return;
    el.innerHTML = `
      <div style="display:grid;gap:16px;padding-top:8px">
        <div class="skeleton" style="height:66px"></div>
        <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:18px">
          <div class="skeleton" style="height:100px"></div>
          <div class="skeleton" style="height:100px"></div>
          <div class="skeleton" style="height:100px"></div>
        </div>
        <div class="skeleton" style="height:200px"></div>
      </div>`;
  };

  /** Show error state in #app-content with retry option. */
  const showError = (message, retryFn) => {
    const el = document.getElementById(CONTENT_ID);
    if (!el) return;
    const retryBtn = retryFn
      ? `<button class="btn primary" id="spa-retry-btn">Réessayer</button>`
      : '';
    el.innerHTML = `
      <div class="card empty-state" style="margin-top:40px">
        <span style="font-size:38px">⚠️</span>
        <p>${message || 'Impossible de charger cette section. Veuillez réessayer.'}</p>
        ${retryBtn}
      </div>`;
    if (retryFn) {
      const btn = document.getElementById('spa-retry-btn');
      if (btn) btn.addEventListener('click', retryFn);
    }
  };

  /** Display a flash message in #app-content (prepended). */
  const showFlash = (type, message) => {
    if (!message) return;
    const el = document.getElementById(CONTENT_ID);
    if (!el) return;
    const alertEl = document.createElement('div');
    alertEl.className = `alert alert-${type || 'info'}`;
    alertEl.setAttribute('role', 'status');
    alertEl.setAttribute('data-flash', '');
    alertEl.innerHTML = `<span>${message}</span><button type="button" class="alert-close" data-flash-close aria-label="Fermer">×</button>`;
    el.prepend(alertEl);
    // Reinitialize flash behavior for this element
    initFlashNode(alertEl);
  };

  /** Fetch SPA content and update the page. Returns true on success. */
  const loadContent = async (url, { pushState = true, fromPopState = false } = {}) => {
    const contentEl = document.getElementById(CONTENT_ID);
    if (!contentEl) return false; // Not on an authenticated shell page

    showLoading();

    try {
      const response = await fetch(url, {
        headers: { [SPA_HEADER]: '1' },
        credentials: 'same-origin',
      });

      // 401 → session expired, redirect to login
      if (response.status === 401) {
        window.location.href = '/login?erreur=' + encodeURIComponent('Session expirée. Veuillez vous reconnecter.');
        return false;
      }

      // 403 → unauthorized
      if (response.status === 403) {
        showError('Vous n\'avez pas les droits nécessaires pour consulter cette section.');
        return false;
      }

      // 404
      if (response.status === 404) {
        showError('Cette page est introuvable.');
        return false;
      }

      if (!response.ok) {
        showError('Impossible de charger cette section. Veuillez réessayer.', () => loadContent(url, { pushState, fromPopState }));
        return false;
      }

      const data = await response.json();

      if (!data.success) {
        showError(data.message || 'Erreur lors du chargement.', () => loadContent(url, { pushState, fromPopState }));
        return false;
      }

      // Update content
      contentEl.innerHTML = data.content;

      // Update page title
      if (data.title) {
        document.title = `${data.title} · LinkEmploi`;
      }

      // Update sidebar active state
      if (data.active) {
        updateSidebarActive(data.active);
      }

      // Update URL
      if (pushState && !fromPopState) {
        history.pushState({ url }, '', url);
      }

      // Reinitialize interactive elements in the new content
      initContentLoaded();

      // Scroll to top of main content
      const main = contentEl.closest('.main');
      if (main) main.scrollTop = 0;

      // Refresh badge counts after navigation
      refreshBadges();

      return true;
    } catch (err) {
      if (err.name === 'AbortError') return false;
      showError('Erreur réseau. Vérifiez votre connexion.', () => loadContent(url, { pushState, fromPopState }));
      return false;
    }
  };

  /** Update sidebar active link. */
  const updateSidebarActive = (activeKey) => {
    document.querySelectorAll('.side-nav a').forEach((link) => {
      link.classList.remove('active');
      const href = link.getAttribute('href');
      if (!href) return;
      const linkKey = pathToActive(href);
      if (linkKey === activeKey) {
        link.classList.add('active');
      }
    });
  };

  /* ---------- Sidebar Navigation Interception ---------- */

  const isSpaNavigable = (href) => {
    if (!href) return false;
    // Must be a local authenticated path
    const spaPaths = ['/dashboard', '/profil', '/offres', '/candidatures',
      '/matching', '/messages', '/notifications', '/entreprises',
      '/entreprise', '/entreprise/demande', '/parametres'];
    return spaPaths.some((p) => href === p || href.startsWith(p + '?') || href.startsWith(p + '#'));
  };

  const initSidebarNav = () => {
    // Intercept sidebar links
    document.addEventListener('click', (e) => {
      const link = e.target.closest('.side-nav a');
      if (!link) return;
      const href = link.getAttribute('href');
      if (!isSpaNavigable(href)) return;
      e.preventDefault();
      loadContent(href);
      // Close mobile sidebar
      const sidebar = document.querySelector('[data-sidebar]');
      if (sidebar && window.innerWidth <= 920) sidebar.classList.remove('open');
    });

    // Intercept topbar links to messages/notifications
    document.addEventListener('click', (e) => {
      const link = e.target.closest('.app-topbar a[href="/messages"], .app-topbar a[href="/notifications"]');
      if (!link) return;
      e.preventDefault();
      loadContent(link.getAttribute('href'));
    });

    // Intercept in-content navigation links (pagination, back links, internal links)
    document.addEventListener('click', (e) => {
      const link = e.target.closest('a');
      if (!link) return;
      const href = link.getAttribute('href');
      if (!href || href.startsWith('#') || href.startsWith('http') || href.startsWith('mailto:')) return;
      if (!isSpaNavigable(href)) return;
      // Don't intercept links with target="_blank"
      if (link.getAttribute('target') === '_blank') return;
      // Don't intercept if inside a form (could be a submit helper)
      if (link.closest('form')) return;
      e.preventDefault();
      loadContent(href);
    });
  };

  /* ---------- Async Form Handling (data-spa-form) ---------- */

  const initSPAForms = () => {
    document.addEventListener('submit', async (e) => {
      const form = e.target;
      if (!form.hasAttribute('data-spa-form')) return;
      if (form.getAttribute('enctype') === 'multipart/form-data') return; // skip file uploads

      e.preventDefault();

      // Confirmation dialog
      if (form.dataset.confirm && !window.confirm(form.dataset.confirm)) return;

      const url = form.action || window.location.href;
      const method = (form.method || 'POST').toUpperCase();

      try {
        const body = new URLSearchParams(new FormData(form));
        const resp = await fetch(url, {
          method,
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            [SPA_HEADER]: '1',
          },
          body: body.toString(),
          credentials: 'same-origin',
        });

        if (resp.status === 401) {
          window.location.href = '/login?erreur=' + encodeURIComponent('Session expirée.');
          return;
        }

        const data = await resp.json().catch(() => null);

        if (data && data.redirectTo) {
          // Load the page the redirect was targeting (via SPA content fetch)
          const redirectUrl = data.redirectTo;
          const success = await loadContent(redirectUrl, { pushState: true });
          if (success && data.message) {
            showFlash(data.flashType || (data.success ? 'success' : 'danger'), data.message);
          }
          if (!success) {
            // Fallback: full page redirect
            window.location.href = redirectUrl;
          }
        } else if (data && data.message) {
          showFlash(data.flashType || 'info', data.message);
        }
      } catch (err) {
        showFlash('danger', 'Erreur réseau. Veuillez réessayer.');
      }
    });
  };

  /* ---------- Browser History (popstate) ---------- */

  const initHistory = () => {
    // Save initial state
    if (isAuthPage()) {
      history.replaceState({ url: window.location.pathname + window.location.search }, '', window.location.href);
    }

    window.addEventListener('popstate', (e) => {
      if (!isAuthPage()) return;
      const url = e.state?.url || (window.location.pathname + window.location.search);
      // Check if it's a SPA-navigable path
      if (isSpaNavigable(url.split('?')[0])) {
        loadContent(url, { pushState: false, fromPopState: true });
      } else {
        // Non-SPA path (e.g. login page): full page reload
        window.location.reload();
      }
    });
  };

  /* ---------- Badge Refresh ---------- */

  const refreshBadges = async () => {
    const msgNode = document.querySelector('[data-count="unread-messages"]');
    const notifNode = document.querySelector('[data-count="unread-notifications"]');
    if (!msgNode && !notifNode) return;
    try {
      const [msgs, notifs] = await Promise.all([
        fetch('/api/messages/non-lus', { credentials: 'same-origin' }).then((r) => (r.ok ? r.json() : null)),
        fetch('/api/notifications/non-lues', { credentials: 'same-origin' }).then((r) => (r.ok ? r.json() : null)),
      ]);
      const apply = (node, total) => {
        if (!node || total == null) return;
        node.textContent = total > 99 ? '99+' : String(total);
        node.classList.toggle('hidden', total <= 0);
      };
      apply(msgNode, msgs && msgs.data ? msgs.data.total : null);
      apply(notifNode, notifs && notifs.data ? notifs.data.total : null);
    } catch (_) { /* badges SSR restent la référence */ }
  };

  /* ---------- Theme ---------- */

  const initTheme = () => {
    const stored = localStorage.getItem(THEME_KEY);
    if (stored && document.documentElement.dataset.theme !== stored) {
      document.documentElement.dataset.theme = stored;
    }
    document.querySelectorAll('[data-theme-toggle]').forEach((button) => {
      button.addEventListener('click', () => {
        const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
        document.documentElement.dataset.theme = next;
        localStorage.setItem(THEME_KEY, next);
        setCookie(THEME_KEY, next);
        // Update theme toggle button icons if present
        button.querySelectorAll('.icon').forEach((icon) => {
          // Swap sun/moon icon text if available
        });
      });
    });
  };

  /* ---------- Mobile Sidebar ---------- */

  const initSidebar = () => {
    const sidebar = document.querySelector('[data-sidebar]');
    document.querySelectorAll('[data-side-toggle]').forEach((button) => {
      button.addEventListener('click', () => sidebar && sidebar.classList.toggle('open'));
    });
    if (sidebar) {
      document.addEventListener('click', (event) => {
        if (window.innerWidth > 920) return;
        if (!sidebar.classList.contains('open')) return;
        if (sidebar.contains(event.target) || event.target.closest('[data-side-toggle]')) return;
        sidebar.classList.remove('open');
      });
    }
  };

  /* ---------- Flash Messages ---------- */

  const initFlashNode = (node) => {
    const close = node.querySelector('[data-flash-close]');
    if (close) close.addEventListener('click', () => node.remove());
    setTimeout(() => { node.classList.add('flash-fade'); setTimeout(() => node.remove(), 420); }, 6000);
  };

  const initFlash = () => {
    document.querySelectorAll('[data-flash]').forEach(initFlashNode);
  };

  /* ---------- Re-initialize after SPA content load ---------- */

  const initContentLoaded = () => {
    // Confirm dialogs for destructive forms
    document.querySelectorAll('#app-content form[data-confirm]').forEach((form) => {
      form.addEventListener('submit', (event) => {
        if (!window.confirm(form.dataset.confirm)) event.preventDefault();
      });
    });

    // Toggle (collapsible edit forms)
    document.querySelectorAll('#app-content [data-toggle]').forEach((button) => {
      button.addEventListener('click', () => {
        const target = document.getElementById(button.dataset.toggle);
        if (target) target.classList.toggle('hidden');
      });
    });

    // Reject form (admin)
    document.querySelectorAll('#app-content form[data-reject-form]').forEach((form) => {
      form.addEventListener('submit', (event) => {
        const reason = window.prompt('Motif du rejet (optionnel) :') || '';
        const input = form.querySelector('input[name="reason"]');
        if (input) input.value = reason;
      });
    });

    // Flash messages in newly loaded content
    document.querySelectorAll('#app-content [data-flash]').forEach(initFlashNode);

    // Theme toggle in loaded content (settings page)
    document.querySelectorAll('#app-content [data-theme-toggle]').forEach((button) => {
      button.addEventListener('click', () => {
        const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
        document.documentElement.dataset.theme = next;
        localStorage.setItem(THEME_KEY, next);
        setCookie(THEME_KEY, next);
      });
    });
  };

  /* ---------- Initialization ---------- */

  document.addEventListener('DOMContentLoaded', () => {
    initTheme();
    initSidebar();
    initFlash();
    initSidebarNav();
    initSPAForms();
    initContentLoaded();
    refreshBadges();
    setInterval(refreshBadges, 60000);

    // Only initialize SPA history on authenticated pages
    if (isAuthPage()) {
      initHistory();
    }

    // Handle BFCache restoration: re-fetch current content instead of full reload
    window.addEventListener('pageshow', (event) => {
      if (!isAuthPage()) return;
      if (event.persisted || (performance.getEntriesByType && performance.getEntriesByType('navigation').some((nav) => nav.type === 'back_forward'))) {
        // Re-fetch current page content via SPA
        const currentUrl = window.location.pathname + window.location.search;
        if (isSpaNavigable(window.location.pathname)) {
          loadContent(currentUrl, { pushState: false });
        } else {
          window.location.reload();
        }
      }
    });
  });
})();
