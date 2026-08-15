/* LinkEmploi — page Notifications : une notification entrante apparaît
   immédiatement en tête de liste sans rechargement. */
(() => {
  'use strict';
  const RT = window.GCRealtime;
  if (!RT) return;

  const { esc, shortDate, statusClass } = RT;
  const listContainer = document.querySelector('.list[data-notifications-list]');
  if (!listContainer) return;

  const findItem = (id) => document.querySelector(`.notification-item[data-id="${Number(id)}"]`);

  const notificationItem = (n) => `
    <div class="list-item notification-item ${n.statut_notification === 'Non lue' ? 'unread' : ''}" data-id="${Number(n.id_notification)}">
      <div>
        <strong>${esc(n.contenu_notification)}</strong>
        <p>${shortDate(n.date_notification)} <span class="badge ${n.statut_notification === 'Non lue' ? 'warning' : 'neutral'}">${esc(n.statut_notification)}</span></p>
      </div>
      ${n.statut_notification === 'Non lue'
        ? `<form method="post" action="/notifications/${Number(n.id_notification)}/lire" class="inline-form">
             <button class="btn" type="submit">Marquer lue</button>
           </form>`
        : ''}
    </div>`;

  document.addEventListener('gc:notification', (event) => {
    const { notification } = event.detail || {};
    if (!notification) return;
    if (findItem(notification.id_notification)) return; // anti-doublon
    listContainer.insertAdjacentHTML('afterbegin', notificationItem(notification));
    // Affiche l'action « Tout marquer lu » dès qu'une notification non lue existe.
    if (notification.statut_notification === 'Non lue' && !document.querySelector('form[action="/notifications/lire-toutes"]')) {
      const toolbar = document.querySelector('.toolbar');
      if (toolbar) {
        toolbar.insertAdjacentHTML(
          'afterbegin',
          '<form method="post" action="/notifications/lire-toutes" class="inline-form"><button class="btn" type="submit">Tout marquer lu</button></form>'
        );
      }
    }
  });
})();