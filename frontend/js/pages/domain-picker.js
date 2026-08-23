// Sélecteur de domaine professionnel (sélection unique et DÉFINITIVE).
//
// Règles d'interface :
//  - aucun écran de confirmation n'est affiché ;
//  - le premier clic sur un domaine remplit immédiatement `id_domaine`, marque
//    la tuile comme choisie et verrouille toutes les autres tuiles ;
//  - un picker `data-submit-on-select="true"` envoie le formulaire dès le clic
//    pour persister le domaine sans étape intermédiaire ;
//  - un picker `data-locked="true"` est en lecture seule (domaine déjà choisi).
//
// SÉCURITÉ : ce verrouillage visuel n'est qu'un confort — le backend revérifie
// systématiquement que le domaine n'a jamais été défini avant de l'enregistrer.
(function () {
  const pickers = document.querySelectorAll('[data-domain-picker]');
  if (!pickers.length) return;

  const getInput = (form) => form
    ? form.querySelector('input[name="id_domaine"], input[data-domain-input]')
    : null;

  const getDomainName = (tile) => (tile.querySelector('span')?.textContent || tile.textContent || '').trim();

  const setTileSelected = (tile, selected) => {
    tile.classList.toggle('chosen', selected);
    tile.setAttribute('aria-pressed', String(selected));
    if (selected) {
      tile.classList.remove('domain-disabled');
      tile.removeAttribute('aria-disabled');
      tile.setAttribute('aria-current', 'true');
      tile.title = `${getDomainName(tile)} — domaine sélectionné`;
    } else {
      tile.removeAttribute('aria-current');
      tile.title = `${getDomainName(tile)} — non sélectionnable`;
    }
  };

  const lockPicker = (picker, selectedTile) => {
    picker.dataset.locked = 'true';
    picker.querySelectorAll('[data-domain-id]').forEach((node) => {
      const selected = node === selectedTile;
      setTileSelected(node, selected);
      if (!selected) {
        node.disabled = true;
        node.classList.add('domain-disabled');
        node.setAttribute('aria-disabled', 'true');
      }
    });
  };

  const findSelectedTile = (picker, input) => {
    const selectedId = input?.value ? String(input.value) : '';
    const byValue = selectedId
      ? Array.from(picker.querySelectorAll('[data-domain-id]')).find((tile) => String(tile.dataset.domainId) === selectedId)
      : null;
    return byValue || picker.querySelector('[data-domain-id].chosen');
  };

  pickers.forEach((picker) => {
    const form = picker.closest('form');
    const input = getInput(form);
    const error = form ? form.querySelector('[data-domain-error]') : null;
    const required = picker.dataset.required !== 'false';
    const submitOnSelect = picker.dataset.submitOnSelect === 'true';
    if (!form || !input) return;

    const initialSelected = findSelectedTile(picker, input);
    if (initialSelected) {
      input.value = initialSelected.dataset.domainId;
      setTileSelected(initialSelected, true);
    }
    if (picker.dataset.locked === 'true' && initialSelected) lockPicker(picker, initialSelected);

    const applyChoice = (tile) => {
      if (!tile || picker.dataset.locked === 'true' || tile.disabled) return;

      picker.querySelectorAll('[data-domain-id]').forEach((node) => setTileSelected(node, node === tile));
      input.value = tile.dataset.domainId;
      if (error) error.hidden = true;
      lockPicker(picker, tile);

      if (submitOnSelect) {
        if (typeof form.requestSubmit === 'function') form.requestSubmit();
        else form.submit();
      }
    };

    picker.addEventListener('click', (event) => {
      const tile = event.target.closest('[data-domain-id]');
      if (tile) applyChoice(tile);
    });

    picker.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      const tile = event.target.closest('[data-domain-id]');
      if (!tile) return;
      event.preventDefault();
      applyChoice(tile);
    });

    form.addEventListener('submit', (event) => {
      if (!required || input.value) return;
      event.preventDefault();
      if (error) error.hidden = false;
      const first = picker.querySelector('[data-domain-id]:not(:disabled)');
      if (first) first.focus();
    });
  });

  // Un domaine approuvé par un administrateur devient immédiatement disponible
  // dans les pickers NON verrouillés des utilisateurs connectés. Le serveur
  // reste la source de vérité et diffusera seulement après le COMMIT SQL.
  document.addEventListener('gc:domaine-nouveau', (event) => {
    const domaine = event.detail?.domaine;
    if (!domaine?.id_domaine || !domaine.nom_domaine) return;
    pickers.forEach((picker) => {
      if (picker.dataset.locked === 'true') return;
      if (picker.querySelector(`[data-domain-id="${Number(domaine.id_domaine)}"]`)) return;
      const tile = document.createElement('button');
      tile.type = 'button';
      tile.className = 'skill-tile domain-tile';
      tile.dataset.domainId = String(Number(domaine.id_domaine));
      tile.setAttribute('aria-pressed', 'false');
      tile.setAttribute('role', 'option');
      const label = document.createElement('span');
      label.textContent = domaine.nom_domaine;
      tile.appendChild(label);
      picker.appendChild(tile);
    });
  });
})();
