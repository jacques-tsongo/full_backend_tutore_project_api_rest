/* Mise à jour ciblée des sélecteurs de compétences lorsqu'une suggestion est
   approuvée. Aucun rechargement complet : l'événement n'est appliqué qu'aux
   contrôles dont data-skill-domain correspond au domaine de la compétence. */
(() => {
  'use strict';

  const sameDomain = (node, skill) =>
    Number(node.dataset.skillDomain || 0) === Number(skill.id_domaine || 0);

  document.addEventListener('gc:competence-nouvelle', (event) => {
    const skill = event.detail?.competence;
    if (!skill?.id_competence || !skill.nom_competence || !skill.id_domaine) return;

    document.querySelectorAll('[data-skill-catalog-empty]').forEach((note) => { note.style.display = 'none'; });
    document.querySelectorAll('[data-skill-submit][data-skill-domain]').forEach((button) => {
      if (sameDomain(button, skill)) button.disabled = false;
    });

    document.querySelectorAll('select[data-skill-domain]').forEach((select) => {
      if (!sameDomain(select, skill)) return;
      if (select.querySelector(`option[value="${Number(skill.id_competence)}"]`)) return;
      const option = document.createElement('option');
      option.value = String(Number(skill.id_competence));
      option.textContent = skill.nom_competence;
      select.appendChild(option);
    });

    document.querySelectorAll('[data-skill-checkboxes][data-skill-domain]').forEach((box) => {
      if (!sameDomain(box, skill)) return;
      if (box.querySelector(`input[value="${Number(skill.id_competence)}"]`)) return;
      const label = document.createElement('label');
      label.className = 'checkbox-chip';
      const input = document.createElement('input');
      input.type = 'checkbox';
      input.name = 'competences';
      input.value = String(Number(skill.id_competence));
      const text = document.createElement('span');
      text.textContent = skill.nom_competence;
      label.append(input, text);
      box.appendChild(label);
    });

    // Page d'onboarding (tuiles + chips). Les gestionnaires de clic existants
    // utilisent la délégation d'événements et prennent donc ces nœuds en charge.
    document.querySelectorAll('[data-skill-grid][data-skill-domain]').forEach((grid) => {
      if (!sameDomain(grid, skill)) return;
      if (grid.querySelector(`[data-skill-id="${Number(skill.id_competence)}"]`)) return;
      const tile = document.createElement('button');
      tile.type = 'button';
      tile.className = 'skill-tile';
      tile.dataset.skillId = String(Number(skill.id_competence));
      tile.setAttribute('aria-pressed', 'false');
      const label = document.createElement('span');
      label.textContent = skill.nom_competence;
      tile.appendChild(label);
      grid.appendChild(tile);

      const chips = document.querySelector(`[data-selected-chips][data-skill-domain="${Number(skill.id_domaine)}"]`);
      if (chips && !chips.querySelector(`[data-chip][data-skill-id="${Number(skill.id_competence)}"]`)) {
        const chip = document.createElement('span');
        chip.className = 'badge info';
        chip.dataset.chip = '';
        chip.dataset.skillId = String(Number(skill.id_competence));
        chip.style.display = 'none';
        chip.append(document.createTextNode(`${skill.nom_competence} `));
        const remove = document.createElement('button');
        remove.type = 'button';
        remove.className = 'chip-x';
        remove.dataset.chipRemove = '';
        remove.setAttribute('aria-label', `Retirer ${skill.nom_competence}`);
        remove.textContent = '×';
        chip.appendChild(remove);
        chips.appendChild(chip);
      }
    });
  });
})();
