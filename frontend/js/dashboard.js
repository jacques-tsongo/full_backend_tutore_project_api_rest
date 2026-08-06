/* Dashboards : statistiques (candidat / recruteur / admin),
   validation des entreprises, gestion des utilisateurs et des compétences (admin). */

document.addEventListener('DOMContentLoaded', async () => {
  const page = document.body.dataset.page;
  if (!page || !page.includes('dashboard')) return;
  Auth.requireAuth();
  window.renderDashboardStats = renderDashboardStats;
  try {
    if (page === 'admin-dashboard') {
      Auth.requireRole(['administrateur']);
      await renderDashboardStats();
      renderPendingCompanies();
      renderUsers();
      renderSkills();
      bindSkillCreator();
    } else {
      await renderDashboardStats();
    }
  } catch (error) { toast(error.message, 'danger'); }
});

async function renderDashboardStats() {
  const stats = $('#stats');
  if (!stats) return;
  stats.innerHTML = skeleton(3);
  const page = document.body.dataset.page;
  try {
    if (page === 'admin-dashboard') {
      const { users, offers, applications } = await API.get('/admin/statistiques');
      stats.innerHTML = `
        <div class="card stat"><span>Utilisateurs</span><strong>${users.total || 0}</strong><small>${users.candidats || 0} candidats · ${users.recruteurs || 0} recruteurs</small></div>
        <div class="card stat"><span>Offres</span><strong>${offers.total || 0}</strong><small>${offers.ouvertes || 0} ouvertes</small></div>
        <div class="card stat"><span>Candidatures</span><strong>${applications.total || 0}</strong><small>Total plateforme</small></div>`;
    } else if (page === 'recruiter-dashboard') {
      const apps = await API.get('/candidatures/recues');
      const mine = await API.get('/offres?mine=1&limit=100');
      stats.innerHTML = `
        <div class="card stat"><span>Mes offres</span><strong>${mine.items.length}</strong><small>Publiées</small></div>
        <div class="card stat"><span>Candidatures reçues</span><strong>${apps.items.length}</strong><small>Depuis vos offres</small></div>
        <div class="card stat"><span>En attente</span><strong>${apps.items.filter((a) => a.statut_candidature === 'En attente').length}</strong><small>À examiner</small></div>`;
    } else {
      const apps = await API.get('/candidatures/me');
      stats.innerHTML = `
        <div class="card stat"><span>Mes candidatures</span><strong>${apps.items.length}</strong><small>Suivi actif</small></div>
        <div class="card stat"><span>En attente</span><strong>${apps.items.filter((a) => a.statut_candidature === 'En attente').length}</strong><small>En cours d'examen</small></div>
        <div class="card stat"><span>Entretiens</span><strong>${apps.items.filter((a) => a.statut_candidature === 'Entretien').length}</strong><small>Programmés</small></div>`;
    }
  } catch (error) { toast(error.message, 'danger'); }
}

/* ---------- Admin : entreprises en attente ---------- */

async function renderPendingCompanies() {
  const target = $('#pendingCompanies');
  if (!target) return;
  target.innerHTML = skeleton(2);
  try {
    const { items } = await API.get('/admin/companies/pending');
    target.innerHTML = items.length ? items.map((c) => {
      let docs = [];
      try { docs = JSON.parse(c.documents_justificatifs || '[]'); } catch (_) { docs = []; }
      return `
      <div class="list-item">
        <div>
          <strong>${escapeHtml(c.nom_entreprise)}</strong>
          <p>${escapeHtml(c.ville || '')} ${escapeHtml(c.pays || '')} · ${escapeHtml(c.email || '')} · RCCM : ${escapeHtml(c.numero_rccm || '-')}</p>
          ${docs.length ? `<p>Documents : ${docs.map((d) => `<a href="${escapeHtml(d)}" target="_blank">${escapeHtml(d.split('/').pop())}</a>`).join(', ')}</p>` : ''}
        </div>
        <div class="nav-actions">
          <button class="btn primary" data-approve="${c.id_entreprise}">Approuver</button>
          <button class="btn danger" data-reject="${c.id_entreprise}">Rejeter</button>
        </div>
      </div>`; }).join('') : '<div class="card">Aucune demande en attente.</div>';
    $$('[data-approve]').forEach((button) => button.addEventListener('click', async () => {
      try {
        await API.put(`/admin/companies/${button.dataset.approve}/approve`, {});
        toast('Entreprise approuvée, utilisateur promu recruteur');
        renderPendingCompanies();
        renderUsers();
        renderDashboardStats();
      } catch (error) { toast(error.message, 'danger'); }
    }));
    $$('[data-reject]').forEach((button) => button.addEventListener('click', async () => {
      const reason = window.prompt('Motif du rejet (optionnel) :') || '';
      try {
        await API.put(`/admin/companies/${button.dataset.reject}/reject`, { reason });
        toast('Entreprise rejetée');
        renderPendingCompanies();
      } catch (error) { toast(error.message, 'danger'); }
    }));
  } catch (error) { target.innerHTML = `<div class="card">${escapeHtml(error.message)}</div>`; }
}

/* ---------- Admin : utilisateurs ---------- */

async function renderUsers() {
  const target = $('#adminUsers');
  if (!target) return;
  target.innerHTML = skeleton(2);
  try {
    const { items } = await API.get('/admin/utilisateurs');
    target.innerHTML = `<div class="table-wrap"><table>
      <thead><tr><th>Nom</th><th>Email</th><th>Rôle</th><th>Statut</th><th>Inscription</th><th>Actions</th></tr></thead>
      <tbody>${items.map((u) => `
        <tr>
          <td>${escapeHtml(u.prenom)} ${escapeHtml(u.nom)}</td>
          <td>${escapeHtml(u.email)}</td>
          <td>${escapeHtml(u.role)}</td>
          <td>${statusBadge(u.statut_compte)}</td>
          <td>${formatDate(u.date_inscription)}</td>
          <td class="nav-actions">
            <button class="btn" data-user-status="${u.id_utilisateur}" data-status="${u.statut_compte === 'actif' ? 'suspendu' : 'actif'}">
              ${u.statut_compte === 'actif' ? 'Suspendre' : 'Réactiver'}
            </button>
          </td>
        </tr>`).join('')}</tbody></table></div>`;
    $$('[data-user-status]').forEach((button) => button.addEventListener('click', async () => {
      try {
        await API.patch(`/admin/utilisateurs/${button.dataset.userStatus}/statut`, { statut_compte: button.dataset.status });
        toast('Statut utilisateur mis à jour');
        renderUsers();
      } catch (error) { toast(error.message, 'danger'); }
    }));
  } catch (error) { target.innerHTML = `<div class="card">${escapeHtml(error.message)}</div>`; }
}

/* ---------- Admin : compétences ---------- */

async function renderSkills() {
  const target = $('#adminSkills');
  if (!target) return;
  try {
    const { items } = await API.get('/competences');
    target.innerHTML = items.length ? items.map((s) => `
      <div class="list-item">
        <div><strong>${escapeHtml(s.nom_competence)}</strong><p>${escapeHtml(s.description || '')}</p></div>
        <button class="btn danger" data-delete-skill="${s.id_competence}">Supprimer</button>
      </div>`).join('') : '<div class="card">Aucune compétence. Créez la première ci-dessous.</div>';
    $$('[data-delete-skill]').forEach((button) => button.addEventListener('click', async () => {
      if (!window.confirm('Supprimer cette compétence ?')) return;
      try {
        await API.delete(`/competences/${button.dataset.deleteSkill}`);
        toast('Compétence supprimée');
        renderSkills();
      } catch (error) { toast(error.message, 'danger'); }
    }));
  } catch (error) { target.innerHTML = `<div class="card">${escapeHtml(error.message)}</div>`; }
}

function bindSkillCreator() {
  const form = $('#newSkillForm');
  if (!form) return;
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const body = Object.fromEntries(new FormData(form));
    try {
      await API.post('/competences', { nom_competence: body.nom_competence, description: body.description || '' });
      toast('Compétence créée');
      form.reset();
      renderSkills();
    } catch (error) { toast(error.message, 'danger'); }
  });
}
