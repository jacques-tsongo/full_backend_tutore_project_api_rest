/* LinkEmploi — interactions des pages rendues par le serveur (EJS).
   Aucun jeton n'est stocké côté client : la session utilise le cookie httpOnly.
   - bascule de thème (localStorage + cookie pour un rendu serveur sans flash) ;
   - menu latéral mobile ;
   - confirmations avant actions destructrices ;
   - fermeture/masquage des messages flash ;
   - affichage des formulaires de modification ;
   - motif de rejet des entreprises (admin) ;
   - rechargement léger des badges de navigation après actions. */
(() => {
  'use strict';

  const THEME_KEY = 'gc_theme';
  const setCookie = (name, value, days = 180) => {
    const maxAge = days * 24 * 60 * 60;
    document.cookie = `${name}=${encodeURIComponent(value)}; path=/; max-age=${maxAge}; SameSite=Lax`;
  };

  document.addEventListener('DOMContentLoaded', () => {
    /* Thème : conserve le choix côté serveur (cookie) et côté client. */
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
      });
    });

    /* Menu latéral (mobile). */
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

    /* Confirmations avant action destructive. */
    document.querySelectorAll('form[data-confirm]').forEach((form) => {
      form.addEventListener('submit', (event) => {
        if (!window.confirm(form.dataset.confirm)) event.preventDefault();
      });
    });

    /* Messages flash : fermeture manuelle + auto-masquage progressif. */
    document.querySelectorAll('[data-flash]').forEach((node) => {
      const close = node.querySelector('[data-flash-close]');
      if (close) close.addEventListener('click', () => node.remove());
      setTimeout(() => { node.classList.add('flash-fade'); setTimeout(() => node.remove(), 420); }, 6000);
    });

    /* Formulaires repliables (boutons « Modifier »). */
    document.querySelectorAll('[data-toggle]').forEach((button) => {
      button.addEventListener('click', () => {
        const target = document.getElementById(button.dataset.toggle);
        if (target) target.classList.toggle('hidden');
      });
    });

    /* Rejet d'entreprise (admin) : demande du motif, injecté dans le champ caché. */
    document.querySelectorAll('form[data-reject-form]').forEach((form) => {
      form.addEventListener('submit', (event) => {
        const reason = window.prompt('Motif du rejet (optionnel) :') || '';
        const input = form.querySelector('input[name="reason"]');
        if (input) input.value = reason;
      });
    });

    /* Badges de navigation : rafraîchit les compteurs non lus (API → base). */
    const refreshBadges = async () => {
      const msgNode = document.querySelector('[data-count="unread-messages"]');
      const notifNode = document.querySelector('[data-count="unread-notifications"]');
      if (!msgNode && !notifNode) return;
      try {
        const [msgs, notifs] = await Promise.all([
          fetch('/api/messages/non-lus', { credentials: 'same-origin' }).then((r) => (r.ok ? r.json() : null)),
          fetch('/api/notifications/non-lues', { credentials: 'same-origin' }).then((r) => (r.ok ? r.json() : null))
        ]);
        const apply = (node, total) => {
          if (!node || total == null) return;
          node.textContent = total > 99 ? '99+' : String(total);
          node.classList.toggle('hidden', total <= 0);
        };
        apply(msgNode, msgs && msgs.data ? msgs.data.total : null);
        apply(notifNode, notifs && notifs.data ? notifs.data.total : null);
      } catch (_) { /* silencieux : les badges SSR restent la référence */ }
    };
    refreshBadges();
    setInterval(refreshBadges, 60000); // synchronisation légère toutes les minutes

    /* Force la revalidation des pages authentifiées restaurées depuis le Back-Forward Cache. */
    window.addEventListener('pageshow', (event) => {
      const pageId = document.body.dataset.page;
      const hasUser = Boolean(document.body.dataset.userId);
      const isAuthPage = hasUser && pageId !== 'login' && pageId !== 'register' && pageId !== 'home' && pageId !== 'about' && pageId !== 'contact' && pageId !== '404';
      if (isAuthPage && (event.persisted || (performance.getEntriesByType && performance.getEntriesByType('navigation').some((nav) => nav.type === 'back_forward')))) {
        window.location.reload();
      }
    });
  });
})();
