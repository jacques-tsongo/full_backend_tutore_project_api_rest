// Sélecteur de domaine professionnel (sélection unique).
// Les formulaires envoient l'identifiant réel `id_domaine` dans un champ caché ;
// le backend revérifie toujours l'existence du domaine avant d'enregistrer.
(function () {
  const pickers = document.querySelectorAll('[data-domain-picker]');
  if (!pickers.length) return;

  pickers.forEach((picker) => {
    const form = picker.closest('form');
    const input = form ? form.querySelector('input[name="id_domaine"]') : null;
    const error = form ? form.querySelector('[data-domain-error]') : null;
    const required = picker.dataset.required !== 'false';
    if (!form || !input) return;

    const select = (tile) => {
      picker.querySelectorAll('[data-domain-id]').forEach((node) => {
        const active = node === tile;
        node.classList.toggle('chosen', active);
        node.setAttribute('aria-pressed', String(active));
      });
      input.value = tile ? tile.dataset.domainId : '';
      if (error) error.hidden = true;
    };

    picker.addEventListener('click', (event) => {
      const tile = event.target.closest('[data-domain-id]');
      if (!tile) return;
      select(tile);
    });

    picker.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      const tile = event.target.closest('[data-domain-id]');
      if (!tile) return;
      event.preventDefault();
      select(tile);
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
