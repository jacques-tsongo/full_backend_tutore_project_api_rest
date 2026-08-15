/* LinkEmploi — page « Mes candidatures » (candidat) : le changement de statut
   décidé par le recruteur est appliqué immédiatement sur la ligne concernée. */
(() => {
  'use strict';
  const RT = window.GCRealtime;
  if (!RT) return;

  const { statusClass, esc } = RT;
  if (!document.querySelector('table[data-applications-table]')) return;

  document.addEventListener('gc:candidature-statut', (event) => {
    const detail = event.detail || {};
    const row = document.querySelector(`tr[data-candidature-id="${Number(detail.id_candidature)}"]`);
    if (!row) return;
    const badge = row.querySelector('td .badge');
    if (badge) {
      badge.textContent = esc(detail.statut_candidature);
      badge.className = `badge ${statusClass(detail.statut_candidature)}`;
    }
    // « Annuler » n'est possible que « En attente » : on retire le bouton sinon.
    const cancel = row.querySelector('form[action*="/annuler"]');
    if (cancel && detail.statut_candidature !== 'En attente') cancel.remove();
  });
})();