/* LinkEmploi — page « Matching » : chaque carte d'offre porte son propre
   bouton « Calculer la compatibilité ». Le score est calculé côté serveur
   (mêmes données que l'API, aucun calcul dupliqué dans le navigateur),
   puis affiché directement dans la carte concernée. */
(() => {
  'use strict';
  const grid = document.querySelector('[data-match-grid]');
  if (!grid) return;

  grid.addEventListener('click', async (event) => {
    const button = event.target.closest('[data-match-button]');
    if (!button) return;

    const card = button.closest('[data-offre-id]');
    const id = card && card.dataset.offreId;
    if (!id) return;

    button.disabled = true;
    button.textContent = 'Calcul en cours…';
    const zone = card.querySelector('[data-score-zone]');

    try {
      const res = await fetch(`/api/offres/${id}/matching`, { credentials: 'same-origin' });
      const body = await res.json();
      if (!res.ok || !body.success) throw new Error(body.message || 'Impossible de calculer le score.');
      const score = Number(body.data.matching.score);
      zone.innerHTML = `
        <div class="progress"><span style="width: ${Math.min(Math.max(score, 0), 100)}%"></span></div>
        <p class="match-score-label"><strong>${score}%</strong> de compatibilité</p>`;
    } catch (err) {
      zone.innerHTML = `<p class="match-score-label danger-text">${err.message}</p>`;
    } finally {
      button.disabled = false;
      button.textContent = 'Calculer la compatibilité';
      // Recharge silencieuse des données pour la prochaine visite (le score
      // est persisté en base par le backend via la table `matching`).
    }
  });
})();