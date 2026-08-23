// Sélecteur de domaine professionnel (sélection unique et DÉFINITIVE).
//
// Règles d'interface :
//  - un clic sur un domaine ouvre une MODAL de confirmation : le domaine
//    n'est jamais considéré comme choisi sur un simple clic ;
//  - « Retour » annule : aucune valeur n'est enregistrée ;
//  - « Confirmer » valide le choix : le champ caché `id_domaine` est rempli,
//    les autres domaines sont désactivés et, si le picker porte
//    `data-submit-on-confirm`, le formulaire est envoyé immédiatement ;
//  - un picker `data-locked="true"` est en lecture seule (domaine déjà
//    confirmé) : aucun clic n'est pris en compte.
//
// SÉCURITÉ : ce verrouillage visuel n'est qu'un confort — le backend
// revérifie systématiquement (profil : refus de modification si un domaine
// existe ; entreprise : idem). Modifier le HTML ne contourne rien.
(function () {
  const pickers = document.querySelectorAll('[data-domain-picker]');
  if (!pickers.length) return;

  /* ---------- Modal de confirmation (créée une seule fois) ---------- */
  let overlay = null;
  const buildModal = () => {
    if (overlay) return overlay;
    overlay = document.createElement('div');
    overlay.className = 'domain-modal-overlay';
    overlay.hidden = true;
    overlay.innerHTML = [
      '<div class="domain-modal" role="dialog" aria-modal="true" aria-labelledby="domain-modal-title">',
      '  <h3 id="domain-modal-title">Confirmer votre domaine professionnel</h3>',
      '  <p class="domain-modal-selected">Vous avez sélectionné : <strong data-modal-domain></strong>.</p>',
      '  <p class="domain-modal-warning">Ce choix sera <strong>définitif</strong>. Après confirmation, vous ne pourrez plus sélectionner un autre domaine.</p>',
      '  <p class="domain-modal-question">Êtes-vous sûr de vouloir continuer ?</p>',
      '  <div class="domain-modal-actions">',
      '    <button type="button" class="btn" data-modal-cancel>Retour</button>',
      '    <button type="button" class="btn primary" data-modal-confirm>Confirmer mon domaine</button>',
      '  </div>',
      '</div>'
    ].join('');
    document.body.appendChild(overlay);
    return overlay;
  };

  let pendingConfirm = null;
  const closeModal = () => {
    if (overlay) overlay.hidden = true;
    pendingConfirm = null;
  };
  const openModal = (domainName, titleText, onConfirm) => {
    const node = buildModal();
    node.querySelector('[data-modal-domain]').textContent = domainName;
    node.querySelector('#domain-modal-title').textContent = titleText;
    pendingConfirm = onConfirm;
    node.hidden = false;
    node.querySelector('[data-modal-confirm]').focus();
  };

  document.addEventListener('click', (event) => {
    if (!overlay || overlay.hidden) return;
    if (event.target.closest('[data-modal-cancel]')) { closeModal(); return; }
    if (event.target.closest('[data-modal-confirm]')) {
      const action = pendingConfirm;
      closeModal();
      if (action) action();
      return;
    }
    // Clic sur le fond sombre = annulation.
    if (event.target === overlay) closeModal();
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && overlay && !overlay.hidden) closeModal();
  });

  /* ------------------------- Pickers ------------------------- */
  pickers.forEach((picker) => {
    const form = picker.closest('form');
    const input = form ? form.querySelector('input[name="id_domaine"]') : null;
    const error = form ? form.querySelector('[data-domain-error]') : null;
    const required = picker.dataset.required !== 'false';
    const locked = picker.dataset.locked === 'true';
    const submitOnConfirm = picker.dataset.submitOnConfirm === 'true';
    const modalTitle = picker.dataset.confirmTitle || 'Confirmer votre domaine professionnel';
    if (!form || !input) return;

    // Verrouille visuellement les tuiles non choisies d'un picker confirmé.
    const lockTiles = () => {
      picker.dataset.locked = 'true';
      picker.querySelectorAll('[data-domain-id]').forEach((node) => {
        if (!node.classList.contains('chosen')) {
          node.disabled = true;
          node.classList.add('domain-disabled');
          node.setAttribute('aria-disabled', 'true');
        }
      });
    };

    const applyChoice = (tile) => {
      picker.querySelectorAll('[data-domain-id]').forEach((node) => {
        const active = node === tile;
        node.classList.toggle('chosen', active);
        node.setAttribute('aria-pressed', String(active));
      });
      input.value = tile.dataset.domainId;
      if (error) error.hidden = true;
      lockTiles();
      if (submitOnConfirm) {
        if (typeof form.requestSubmit === 'function') form.requestSubmit();
        else form.submit();
      }
    };

    if (locked) { lockTiles(); }

    const onTileActivate = (tile) => {
      // Domaine déjà confirmé (ou choix déjà validé dans ce formulaire) :
      // plus aucune sélection possible.
      if (picker.dataset.locked === 'true' || tile.disabled) return;
      if (tile.classList.contains('chosen')) return;
      const name = (tile.querySelector('span')?.textContent || tile.textContent).trim();
      openModal(name, modalTitle, () => applyChoice(tile));
    };

    picker.addEventListener('click', (event) => {
      const tile = event.target.closest('[data-domain-id]');
      if (tile) onTileActivate(tile);
    });

    picker.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      const tile = event.target.closest('[data-domain-id]');
      if (!tile) return;
      event.preventDefault();
      onTileActivate(tile);
    });

    form.addEventListener('submit', (event) => {
      if (!required || input.value) return;
      event.preventDefault();
      if (error) error.hidden = false;
      const first = picker.querySelector('[data-domain-id]');
      if (first) first.focus();
    });
  });
})();
