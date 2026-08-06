document.addEventListener('DOMContentLoaded', async () => {
  const page = document.body.dataset.page;
  if (!page || !page.includes('dashboard')) return;
  Auth.requireAuth();
  const stats = $('#stats');
  if (stats) stats.innerHTML = skeleton(3);
  try {
    if (page === 'admin-dashboard') {
      Auth.requireRole(['administrateur']);
      const { users, offers, applications } = await API.get('/admin/statistiques');
      stats.innerHTML = `
        <div class="card stat"><span>Utilisateurs</span><strong>${users.total || 0}</strong><small>${users.recruteurs || 0} recruteurs</small></div>
        <div class="card stat"><span>Offres</span><strong>${offers.total || 0}</strong><small>${offers.ouvertes || 0} ouvertes</small></div>
        <div class="card stat"><span>Candidatures</span><strong>${applications.total || 0}</strong><small>Total plateforme</small></div>`;
      renderPendingCompanies();
    } else if (page === 'recruiter-dashboard') {
      Auth.requireRole(['recruteur']);
      const apps = await API.get('/candidatures/recues');
      stats.innerHTML = `<div class="card stat"><span>Candidatures recues</span><strong>${apps.items.length}</strong><small>Depuis vos offres</small></div>`;
    } else {
      Auth.requireRole(['candidat']);
      const apps = await API.get('/candidatures/me');
      stats.innerHTML = `<div class="card stat"><span>Mes candidatures</span><strong>${apps.items.length}</strong><small>Suivi actif</small></div>`;
    }
  } catch (error) { toast(error.message, 'danger'); }
});

async function renderPendingCompanies() {
  const target = $('#pendingCompanies');
  if (!target) return;
  const { items } = await API.get('/admin/companies/pending');
  target.innerHTML = items.length ? items.map((c) => `
    <div class="list-item">
      <div><strong>${escapeHtml(c.nom_entreprise)}</strong><p>${escapeHtml(c.ville || '')} ${statusBadge(c.status)}</p></div>
      <div class="nav-actions">
        <button class="btn primary" data-approve="${c.id_entreprise}">Approuver</button>
        <button class="btn danger" data-reject="${c.id_entreprise}">Rejeter</button>
      </div>
    </div>`).join('') : '<div class="card">Aucune demande en attente.</div>';
  $$('[data-approve]').forEach((button) => button.addEventListener('click', async () => {
    await API.put(`/admin/companies/${button.dataset.approve}/approve`, {});
    toast('Entreprise approuvee');
    renderPendingCompanies();
  }));
  $$('[data-reject]').forEach((button) => button.addEventListener('click', async () => {
    await API.put(`/admin/companies/${button.dataset.reject}/reject`, {});
    toast('Entreprise rejetee');
    renderPendingCompanies();
  }));
}
