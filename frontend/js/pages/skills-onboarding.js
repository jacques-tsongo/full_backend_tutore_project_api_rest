// Page « Ajouter vos compétences » (post-inscription).
// Un clic sur une tuile du catalogue la sélectionne / la retire ; les choix
// sont reflétés dans le panneau « Mes compétences sélectionnées » puis
// envoyés au serveur sous forme de champs cachés `competences` (POST
// /competences → enregistrement en masse côté backend).
(function () {
  const form = document.getElementById('skills-onboarding-form');
  if (!form) return;

  const grid = form.querySelector('[data-skill-grid]');
  const chipsBox = form.querySelector('[data-selected-chips]');
  const emptyNote = form.querySelector('.selected-empty');
  if (!grid || !chipsBox) return;

  const ids = new Set(Array.from(chipsBox.querySelectorAll('[data-chip]')).map((c) => c.dataset.skillId));
  let inputs = []; // champs cachés synchros avec `ids`

  const syncInputs = () => {
    inputs.forEach((i) => i.remove());
    inputs = [];
    ids.forEach((id) => {
      const input = document.createElement('input');
      input.type = 'hidden';
      input.name = 'competences';
      input.value = id;
      form.appendChild(input);
      inputs.push(input);
    });
  };

  const refresh = () => {
    grid.querySelectorAll('[data-skill-id]').forEach((tile) => {
      const chosen = ids.has(tile.dataset.skillId);
      tile.classList.toggle('chosen', chosen);
      tile.setAttribute('aria-pressed', String(chosen));
    });
    chipsBox.querySelectorAll('[data-chip]').forEach((chip) => {
      chip.hidden = !ids.has(chip.dataset.skillId);
    });
    if (emptyNote) emptyNote.hidden = ids.size > 0;
    syncInputs();
  };

  const toggle = (id) => {
    ids.has(id) ? ids.delete(id) : ids.add(id);
    refresh();
  };

  grid.addEventListener('click', (e) => {
    const tile = e.target.closest('[data-skill-id]');
    if (tile) toggle(tile.dataset.skillId);
  });

  chipsBox.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-chip-remove]');
    if (btn) {
      const chip = btn.closest('[data-chip]');
      if (chip) ids.delete(chip.dataset.skillId);
      refresh();
    }
  });

  refresh();
})();
