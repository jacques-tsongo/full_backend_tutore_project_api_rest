document.addEventListener('DOMContentLoaded', async () => {
  if (document.body.dataset.page !== 'matching') return;
  Auth.requireRole(['candidat']);
  const form = $('#matchingForm');
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const id = new FormData(form).get('id_offre');
    try {
      const { matching } = await API.get(`/offres/${id}/matching`);
      $('#matchingResult').innerHTML = `<div class="card stat"><span>Score</span><strong>${matching.score}%</strong><small>${matching.matched}/${matching.required} competences</small></div>`;
    } catch (error) { toast(error.message, 'danger'); }
  });
});
