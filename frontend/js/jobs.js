document.addEventListener('DOMContentLoaded', async () => {
  if (!['jobs', 'job-details'].includes(document.body.dataset.page)) return;
  Auth.requireAuth();
  const form = $('#jobForm');
  if (form) form.addEventListener('submit', createJob);
  renderJobs();
});

async function renderJobs() {
  const target = $('#jobsList');
  if (!target) return;
  target.innerHTML = skeleton(4);
  try {
    const { items } = await API.get('/offres');
    target.innerHTML = items.map((job) => `
      <div class="list-item">
        <div><strong>${escapeHtml(job.titre_offre)}</strong><p>${escapeHtml(job.localisation)} · Expire le ${formatDate(job.date_expiration)}</p></div>
        <div>${statusBadge(job.statut_offre)} <button class="btn" data-apply="${job.id_offre}">Postuler</button></div>
      </div>`).join('') || '<div class="card">Aucune offre disponible.</div>';
    $$('[data-apply]').forEach((button) => button.addEventListener('click', () => applyJob(button.dataset.apply)));
  } catch (error) { target.innerHTML = `<div class="card">${escapeHtml(error.message)}</div>`; }
}

async function applyJob(id) {
  try { await API.post(`/offres/${id}/postuler`, {}); toast('Candidature envoyee'); }
  catch (error) { toast(error.message, 'danger'); }
}

async function createJob(event) {
  event.preventDefault();
  try {
    await API.post('/offres', Object.fromEntries(new FormData(event.target)));
    toast('Offre creee');
    event.target.reset();
    renderJobs();
  } catch (error) { toast(error.message, 'danger'); }
}
