/* Entreprises : annuaire, détail d'une entreprise, demande recruteur. */

document.addEventListener('DOMContentLoaded', async () => {
  const page = document.body.dataset.page;
  if (!['companies', 'create-company', 'company-details'].includes(page)) return;
  Auth.requireAuth();
  if (page === 'create-company') return bindCompanyForm();
  if (page === 'company-details') return renderCompanyDetails();
  renderCompanies();
});

function bindCompanyForm() {
  Auth.requireRole(['candidat']);
  const form = $('#companyForm');
  const progress = $('#uploadProgress span');
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const button = form.querySelector('button[type="submit"]');
    if (button) button.disabled = true;
    try {
      const formData = new FormData(form);
      await API.upload('/entreprises/demande-recruteur', formData, (value) => { if (progress) progress.style.width = `${value}%`; });
      toast('Demande envoyée, en attente de validation admin');
      location.href = '/candidate-dashboard.html';
    } catch (error) {
      toast(error.message, 'danger');
      if (button) button.disabled = false;
    }
  });
}

async function renderCompanies() {
  const target = $('#companiesList');
  if (!target) return;
  target.innerHTML = skeleton(4);
  try {
    const { items } = await API.get('/entreprises');
    target.innerHTML = items.map((c) => `
      <div class="card">
        <h3>${escapeHtml(c.nom_entreprise)}</h3>
        <p>${escapeHtml(c.description || 'Entreprise')}</p>
        <p>${escapeHtml(c.ville || '')} ${escapeHtml(c.pays || '')}</p>
        ${statusBadge(c.status || c.statut_validation)}
        <div class="nav-actions" style="margin-top:10px"><a class="btn" href="/company-details.html?id=${c.id_entreprise}">Voir</a></div>
      </div>`).join('') || '<div class="card">Aucune entreprise trouvée.</div>';
  } catch (error) { target.innerHTML = `<div class="card">${escapeHtml(error.message)}</div>`; }
}

async function renderCompanyDetails() {
  const target = $('#companiesList');
  const id = new URLSearchParams(location.search).get('id');
  if (!target || !id) return;
  target.innerHTML = skeleton(2);
  try {
    const { item } = await API.get(`/entreprises/${id}`);
    target.innerHTML = `
      <div class="card">
        <div class="nav-actions" style="justify-content:space-between">
          <h2>${escapeHtml(item.nom_entreprise)}</h2>
          ${statusBadge(item.status || item.statut_validation)}
        </div>
        <p>${escapeHtml(item.secteur_activite || '')}</p>
        <p>${escapeHtml(item.description || '')}</p>
        <p><strong>Adresse :</strong> ${escapeHtml(item.adresse || '')}, ${escapeHtml(item.ville || '')}, ${escapeHtml(item.pays || '')}</p>
        <p><strong>Téléphone :</strong> ${escapeHtml(item.telephone || '-')} · <strong>Email :</strong> ${escapeHtml(item.email || '-')}</p>
        ${item.site_web ? `<p><strong>Site web :</strong> ${escapeHtml(item.site_web)}</p>` : ''}
        <p><strong>RCCM :</strong> ${escapeHtml(item.numero_rccm || '-')} · <strong>N° fiscal :</strong> ${escapeHtml(item.numero_fiscal || '-')}</p>
        ${item.logo ? `<img src="${escapeHtml(item.logo.startsWith('/') ? item.logo : '/' + item.logo)}" alt="Logo" style="max-width:140px;margin-top:10px;border-radius:8px">` : ''}
      </div>`;
  } catch (error) { target.innerHTML = `<div class="card">${escapeHtml(error.message)}</div>`; }
}
