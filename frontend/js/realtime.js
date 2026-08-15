/* LinkEmploi — temps réel (Socket.IO).
   Fichier central chargé sur toutes les pages : connexion, identification de
   l'utilisateur, badges de navigation, notifications et dispatch des événements
   vers les scripts de page spécialisés (frontend/js/pages/*.js).

   Principes :
   - l'API REST + MySQL restent la source de vérité : chaque événement déclenche
     un rafraîchissement des compteurs via l'API (jamais de calcul client seul) ;
   - aucun window.location.reload() : seul le DOM concerné est mis à jour ;
   - anti-doublons via les identifiants (data-id) présents dans le DOM ;
   - reconnexion automatique (engine.io) + resynchronisation des compteurs. */
(() => {
  'use strict';

  const userId = Number(document.body.dataset.userId || 0);
  if (!userId) return; // pages publiques / non authentifiées : aucune connexion.

  /* Petit utilitaire partagé : classe de badge, même logique que le serveur. */
  const statusClass = (value = '') => {
    const v = String(value);
    if (['approved', 'Validée', 'Acceptée', 'Ouverte', 'actif', 'Lue'].includes(v)) return 'success';
    if (['rejected', 'Rejetée', 'Refusée', 'Suspendue', 'suspendu', 'Annulée'].includes(v)) return 'danger';
    if (['pending', 'En attente', 'approved_but', 'inactif', 'Entretien'].includes(v)) return 'warning';
    if (['Présélectionnée', 'Fermée'].includes(v)) return 'info';
    return 'neutral';
  };

  const esc = (text) => String(text ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

  const shortDate = (value) => {
    if (!value) return '';
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' });
  };

  const initials = (prenom, nom) => esc(((prenom || ' ')[0] + (nom || ' ')[0]).toUpperCase());

  /* ------------------------- Badges de navigation ------------------------- */
  const badgeNodes = () => ({
    messages: document.querySelectorAll('[data-count="unread-messages"]'),
    notifications: document.querySelectorAll('[data-count="unread-notifications"]')
  });

  const applyBadge = (nodes, total) => {
    nodes.forEach((node) => {
      node.textContent = total > 99 ? '99+' : String(total);
      node.classList.toggle('hidden', total <= 0);
    });
  };

  /** Compteurs non lus relus depuis la base (source de vérité). */
  const refreshBadges = async () => {
    const nodes = badgeNodes();
    if (!nodes.messages.length && !nodes.notifications.length) return;
    try {
      const [msgs, notifs] = await Promise.all([
        fetch('/api/messages/non-lus', { credentials: 'same-origin' }).then((r) => (r.ok ? r.json() : null)),
        fetch('/api/notifications/non-lues', { credentials: 'same-origin' }).then((r) => (r.ok ? r.json() : null))
      ]);
      applyBadge(nodes.messages, msgs && msgs.data ? msgs.data.total : null);
      applyBadge(nodes.notifications, notifs && notifs.data ? notifs.data.total : null);
    } catch (_) { /* silencieux : le rendu SSR reste la référence */ }
  };

  /* ----------------------------- Connexion -------------------------------- */
  const socket = io({ autoConnect: true, reconnection: true, reconnectionAttempts: Infinity, reconnectionDelay: 1000 });

  socket.on('connect', () => refreshBadges());      // + après chaque reconnexion
  socket.on('reconnect', () => {
    refreshBadges();
    document.dispatchEvent(new CustomEvent('gc:reconnect'));
  });

  /* Les événements d'activité rafraîchissent TOUJOURS les compteurs (base). */
  const countEvents = ['nouvelle_notification', 'notification_lue', 'nouveau_message', 'message_lu', 'nouvelle_candidature', 'candidature_statut_modifie'];
  countEvents.forEach((event) => socket.on(event, refreshBadges));

  /* Notification entrante : badge + re-dispatch pour les pages spécialisées. */
  socket.on('nouvelle_notification', (payload) => {
    refreshBadges();
    document.dispatchEvent(new CustomEvent('gc:notification', { detail: payload || {} }));
  });

  /* Dispatch générique vers les scripts de page (messages, offres, …). */
  socket.on('nouveau_message', (p) => document.dispatchEvent(new CustomEvent('gc:message', { detail: p || {} })));
  socket.on('message_lu', (p) => document.dispatchEvent(new CustomEvent('gc:message-lu', { detail: p || {} })));
  socket.on('nouvelle_offre', (p) => document.dispatchEvent(new CustomEvent('gc:offre-nouvelle', { detail: p || {} })));
  socket.on('offre_modifiee', (p) => document.dispatchEvent(new CustomEvent('gc:offre-modifiee', { detail: p || {} })));
  socket.on('offre_supprimee', (p) => document.dispatchEvent(new CustomEvent('gc:offre-supprimee', { detail: p || {} })));
  socket.on('nouvelle_candidature', (p) => document.dispatchEvent(new CustomEvent('gc:candidature-nouvelle', { detail: p || {} })));
  socket.on('candidature_statut_modifie', (p) => document.dispatchEvent(new CustomEvent('gc:candidature-statut', { detail: p || {} })));
  socket.on('nouvelle_competence', (p) => document.dispatchEvent(new CustomEvent('gc:competence-nouvelle', { detail: p || {} })));
  socket.on('competence_modifiee', (p) => document.dispatchEvent(new CustomEvent('gc:competence-modifiee', { detail: p || {} })));
  socket.on('competence_supprimee', (p) => document.dispatchEvent(new CustomEvent('gc:competence-supprimee', { detail: p || {} })));

  /* API publique pour les scripts de page. */
  window.GCRealtime = { userId, socket, refreshBadges, statusClass, esc, shortDate, initials };
})();
