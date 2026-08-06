document.addEventListener('DOMContentLoaded', async () => {
  const page = document.body.dataset.page;
  if (!['companies', 'create-company', 'company-details'].includes(page)) return;
  Auth.requireAuth();
  if (page === 'create-company') return bindCompanyForm();
  renderCompanies();
});

function bindCompanyForm() {
  Auth.requireRole(['candidat']);
  const form = $('#companyForm');
  const progress = $('#uploadProgress span');
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    try {
      const formData = new FormData(form);
      await API.upload('/entreprises/demande-recruteur', formData, (value) => { if (progress) progress.style.width = `${value}%`; });
      toast('Demande envoyee');
      location.href = '/candidate-dashboard.html';
    } catch (error) { toast(error.message, 'danger'); }
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
        ${statusBadge(c.status || c.statut_validation)}
      </div>`).join('') || '<div class="card">Aucune entreprise trouvee.</div>';
  } catch (error) { target.innerHTML = `<div class="card">${escapeHtml(error.message)}</div>`; }
}
