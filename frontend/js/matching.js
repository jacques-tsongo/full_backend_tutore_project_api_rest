/* Matching : score de compatibilité entre le profil du candidat et les offres ouvertes. */

document.addEventListener('DOMContentLoaded', async () => {
  if (document.body.dataset.page !== 'matching') return;
  Auth.requireRole(['candidat']);
  const form = $('#matchingForm');
  const select = $('#offerSelect');
  const result = $('#matchingResult');

  if (select) {
    select.innerHTML = '<option value="">Chargement des offres…</option>';
    try {
      const { items } = await API.get('/offres?limit=100');
      select.innerHTML = items.length
        ? '<option value="">— Choisir une offre —</option>' + items.map((o) =>
          `<option value="${o.id_offre}">${escapeHtml(o.titre_offre)} — ${escapeHtml(o.nom_entreprise || '')}</option>`).join('')
        : '<option value="">Aucune offre ouverte</option>';
    } catch (error) {
      select.innerHTML = `<option value="">${escapeHtml(error.message)}</option>`;
    }
  }

  if (form) {
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      const id = select ? select.value : new FormData(form).get('id_offre');
      if (!id) return toast('Choisissez une offre', 'danger');
      if (result) result.innerHTML = skeleton(1);
      try {
        const { matching } = await API.get(`/offres/${id}/matching`);
        if (result) {
          result.innerHTML = `<div class="card stat">
            <span>Score de compatibilité</span>
            <strong>${matching.score}%</strong>
            <small>${matching.matched}/${matching.required} compétences requises maîtrisées</small>
          </div>`;
        }
      } catch (error) { toast(error.message, 'danger'); }
    });
  }
});
