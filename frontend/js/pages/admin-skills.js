/* LinkEmploi — page « Compétences » (admin) : le catalogue se met à jour
   immédiatement quand une compétence est créée / modifiée / supprimée. */
(() => {
  'use strict';
  const RT = window.GCRealtime;
  if (!RT) return;

  const { esc } = RT;
  const tbody = document.querySelector('tbody[data-skills-body]');
  if (!tbody) return;

  const findRow = (id) => document.querySelector(`tr[data-id="${Number(id)}"]`);
  const updateCount = () => {
    const strong = document.querySelector('[data-skills-count]');
    if (strong) strong.textContent = `Catalogue (${tbody.querySelectorAll('tr').length})`;
  };
  const rowHtml = (c) => `
    <tr data-id="${Number(c.id_competence)}">
      <td><strong>${esc(c.nom_competence)}</strong></td>
      <td>${c.id_domaine ? `<span class="badge info">${esc(c.nom_domaine || c.id_domaine)}</span>` : '—'}</td>
      <td>${esc(c.description || '—')}</td>
      <td>
        <form method="post" action="/admin/competences/${Number(c.id_competence)}/supprimer" class="inline-form">
          <button class="btn danger" type="submit" aria-label="Supprimer ${esc(c.nom_competence)}">Supprimer</button>
        </form>
      </td>
    </tr>`;

  document.addEventListener('gc:competence-nouvelle', (event) => {
    const { competence } = event.detail || {};
    if (!competence || !competence.id_competence) return;
    if (findRow(competence.id_competence)) return; // anti-doublon
    tbody.insertAdjacentHTML('beforeend', rowHtml(competence));
    updateCount();
  });

  document.addEventListener('gc:competence-modifiee', (event) => {
    const { competence } = event.detail || {};
    if (!competence) return;
    const row = findRow(competence.id_competence);
    if (row) {
      // Ré-affiche la ligne complète (nom, domaine, description) : plus simple
      // et sûr que de patcher cellule par cellule depuis l'ajout du domaine.
      row.outerHTML = rowHtml(competence);
    }
  });

  document.addEventListener('gc:competence-supprimee', (event) => {
    const { id_competence } = event.detail || {};
    const row = findRow(id_competence);
    if (row) {
      row.remove();
      updateCount();
    }
  });
})();