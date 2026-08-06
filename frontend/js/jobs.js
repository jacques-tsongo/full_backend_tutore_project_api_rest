/* Offres d'emploi : liste publique, recherche, détails, candidature,
   création d'offre (dashboard recruteur), gestion de ses offres et compétences requises. */

document.addEventListener('DOMContentLoaded', async () => {
  const page = document.body.dataset.page;
  if (!['jobs', 'job-details', 'recruiter-dashboard'].includes(page)) return;
  Auth.requireAuth();

  if (page === 'recruiter-dashboard') {
    bindJobForm();
    renderMyOffers();
    return;
  }
  if (page === 'job-details') {
    renderJobDetails();
    return;
  }
  renderJobs();
  bindJobsToolbar();
});

/* ---------- Liste des offres (candidats & recruteurs) ---------- */

const state = { q: '', statut: '', page: 1 };

function bindJobsToolbar() {
  const search = $('#jobSearch');
  if (search) search.addEventListener('input', debounce(() => { state.q = search.value.trim(); state.page = 1; renderJobs(); }, 300));
  const statut = $('#jobStatutFilter');
  if (statut) {
    if ((Storage.getUser() || {}).role !== 'candidat') statut.classList.remove('hidden');
    statut.addEventListener('change', () => { state.statut = statut.value; state.page = 1; renderJobs(); });
  }
  const prev = $('#jobsPrev');
  const next = $('#jobsNext');
  if (prev) prev.addEventListener('click', () => { if (state.page > 1) { state.page -= 1; renderJobs(); } });
  if (next) next.addEventListener('click', () => { state.page += 1; renderJobs(); });
}

async function renderJobs() {
  const target = $('#jobsList');
  if (!target) return;
  target.innerHTML = skeleton(4);
  const user = Storage.getUser() || {};
  const params = new URLSearchParams({ page: state.page, limit: 10 });
  if (state.q) params.set('q', state.q);
  if (state.statut && user.role !== 'candidat') params.set('statut', state.statut);
  try {
    const { items, pagination } = await API.get(`/offres?${params}`);
    if (!items.length) {
      target.innerHTML = '<div class="card">Aucune offre trouvée.</div>';
      renderPagination(pagination);
      return;
    }
    target.innerHTML = items.map((job) => `
      <div class="list-item">
        <div>
          <strong>${escapeHtml(job.titre_offre)}</strong>
          <p>${escapeHtml(job.nom_entreprise || '')} · ${escapeHtml(job.localisation)} · Expire le ${formatDate(job.date_expiration)}</p>
        </div>
        <div class="nav-actions">
          ${statusBadge(job.statut_offre)}
          <a class="btn" href="/job-details.html?id=${job.id_offre}">Détails</a>
          ${user.role === 'candidat' && job.statut_offre === 'Ouverte' ? `<button class="btn primary" data-apply="${job.id_offre}">Postuler</button>` : ''}
        </div>
      </div>`).join('');
    $$('[data-apply]').forEach((button) => button.addEventListener('click', () => applyJob(button.dataset.apply)));
    renderPagination(pagination);
  } catch (error) {
    target.innerHTML = `<div class="card">${escapeHtml(error.message)}</div>`;
  }
}

function renderPagination(pagination) {
  const info = $('#jobsPaginationInfo');
  const prev = $('#jobsPrev');
  const next = $('#jobsNext');
  if (!info) return;
  if (!pagination || pagination.total === 0) { info.textContent = ''; return; }
  info.textContent = `Page ${pagination.page} / ${pagination.pages} — ${pagination.total} offre(s)`;
  if (prev) prev.disabled = pagination.page <= 1;
  if (next) next.disabled = pagination.page >= pagination.pages;
}

async function applyJob(id) {
  const letter = window.prompt('Lettre de motivation (optionnelle) :') || '';
  try {
    await API.post(`/offres/${id}/postuler`, { lettre_motivation: letter });
    toast('Candidature envoyée');
    renderJobs();
  } catch (error) { toast(error.message, 'danger'); }
}

/* ---------- Détail d'une offre ---------- */

async function renderJobDetails() {
  const target = $('#jobDetails');
  const id = new URLSearchParams(location.search).get('id');
  if (!target || !id) return;
  target.innerHTML = skeleton(3);
  const user = Storage.getUser() || {};
  try {
    const { item } = await API.get(`/offres/${id}`);
    const isExpired = item.date_expiration && new Date(item.date_expiration) < new Date();
    target.innerHTML = `
      <div class="card">
        <div class="nav-actions" style="justify-content:space-between">
          <h2>${escapeHtml(item.titre_offre)}</h2>
          ${statusBadge(item.statut_offre)}
        </div>
        <p><strong>${escapeHtml(item.nom_entreprise || '')}</strong> — ${escapeHtml(item.localisation)}</p>
        ${item.salaire ? `<p>Salaire : <strong>${escapeHtml(String(item.salaire))} $</strong></p>` : ''}
        <p>Expire le : ${formatDate(item.date_expiration)}</p>
        <p>${escapeHtml(item.description_offre || '')}</p>
        ${(item.competences || []).length ? `
          <h3>Compétences requises</h3>
          <div class="nav-actions">${item.competences.map((s) => `<span class="badge">${escapeHtml(s.nom_competence)} — ${escapeHtml(s.niveau_requis)}</span>`).join('')}</div>` : ''}
      </div>
      <div id="applyZone" class="card form"></div>
      <div id="matchZone"></div>`;

    const applyZone = $('#applyZone');
    if (user.role === 'candidat') {
      if (item.statut_offre !== 'Ouverte' || isExpired) {
        applyZone.innerHTML = '<p>Cette offre est fermée aux nouvelles candidatures.</p>';
      } else {
        const applied = await API.get('/candidatures/me').then((r) => r.items.some((a) => Number(a.id_offre) === Number(id))).catch(() => false);
        if (applied) {
          applyZone.innerHTML = '<p>Vous avez déjà postulé à cette offre. Suivez son statut dans <a href="/applications.html">vos candidatures</a>.</p>';
        } else {
          applyZone.innerHTML = `
            <h3>Postuler</h3>
            <div class="field"><label>Lettre de motivation (optionnelle)</label><textarea id="applyLetter" placeholder="Présentez-vous, expliquez votre motivation…"></textarea></div>
            <button id="applyBtn" class="btn primary">Envoyer ma candidature</button>`;
          $('#applyBtn').addEventListener('click', async () => {
            try {
              const { matching } = await API.post(`/offres/${id}/postuler`, { lettre_motivation: $('#applyLetter').value });
              toast(`Candidature envoyée${matching ? ` — Score de matching : ${matching.score}%` : ''}`);
              renderJobDetails();
            } catch (error) { toast(error.message, 'danger'); }
          });
        }
      }
    } else {
      applyZone.innerHTML = '<p>Seuls les comptes candidats peuvent postuler à cette offre.</p>';
    }

    if (user.role === 'candidat') {
      const matchZone = $('#matchZone');
      const { matching } = await API.get(`/offres/${id}/matching`).catch(() => ({ matching: null }));
      if (matching) {
        matchZone.innerHTML = `<div class="card stat"><span>Score de matching avec votre profil</span><strong>${matching.score}%</strong><small>${matching.matched}/${matching.required} compétences requises maîtrisées</small></div>`;
      }
    }
  } catch (error) {
    target.innerHTML = `<div class="card">${escapeHtml(error.message)}</div>`;
  }
}

/* ---------- Dashboard recruteur : créer / gérer ses offres ---------- */

function bindJobForm() {
  const form = $('#jobForm');
  if (!form) return;
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const button = form.querySelector('button[type="submit"]');
    if (button) button.disabled = true;
    try {
      const body = Object.fromEntries(new FormData(form));
      await API.post('/offres', body);
      toast('Offre publiée');
      form.reset();
      renderMyOffers();
      const stats = $('#stats');
      if (stats) renderRecruiterStats();
    } catch (error) {
      toast(error.message, 'danger');
    } finally {
      if (button) button.disabled = false;
    }
  });
}

async function renderRecruiterStats() {
  const stats = $('#stats');
  if (!stats) return;
  try {
    const apps = await API.get('/candidatures/recues');
    const mine = await API.get('/offres?mine=1&limit=100');
    stats.innerHTML = `
      <div class="card stat"><span>Mes offres</span><strong>${mine.items.length}</strong><small>Publiées</small></div>
      <div class="card stat"><span>Candidatures reçues</span><strong>${apps.items.length}</strong><small>Depuis vos offres</small></div>
      <div class="card stat"><span>En attente</span><strong>${apps.items.filter((a) => a.statut_candidature === 'En attente').length}</strong><small>À examiner</small></div>`;
  } catch (_) { /* silencieux */ }
}

async function renderMyOffers() {
  const target = $('#myOffers');
  if (!target) return;
  target.innerHTML = skeleton(2);
  try {
    const { items } = await API.get('/offres?mine=1&limit=100');
    const { items: skills } = await API.get('/competences');
    if (!items.length) {
      target.innerHTML = '<div class="card">Vous n\'avez pas encore publié d\'offre. Utilisez le formulaire ci-dessus.</div>';
      return;
    }
    target.innerHTML = items.map((job) => `
      <div class="card" data-offer-card="${job.id_offre}">
        <div class="nav-actions" style="justify-content:space-between">
          <div>
            <strong>${escapeHtml(job.titre_offre)}</strong>
            <p>${escapeHtml(job.localisation)} · Expire le ${formatDate(job.date_expiration)} · ${job.salaire ? escapeHtml(String(job.salaire)) + ' $' : 'Salaire non précisé'}</p>
            <div class="nav-actions">${statusBadge(job.statut_offre)}</div>
          </div>
          <div class="nav-actions">
            <a class="btn" href="/job-details.html?id=${job.id_offre}">Voir</a>
            <button class="btn" data-toggle-edit="${job.id_offre}">Modifier</button>
            <button class="btn danger" data-delete-offer="${job.id_offre}">Supprimer</button>
          </div>
        </div>
        <form class="form hidden" data-edit-form="${job.id_offre}">
          <div class="grid two">
            <div class="field"><label>Titre</label><input name="titre_offre" value="${escapeHtml(job.titre_offre)}" required></div>
            <div class="field"><label>Localisation</label><input name="localisation" value="${escapeHtml(job.localisation)}" required></div>
          </div>
          <div class="field"><label>Description</label><textarea name="description_offre" required>${escapeHtml(job.description_offre)}</textarea></div>
          <div class="grid two">
            <div class="field"><label>Salaire</label><input name="salaire" type="number" value="${job.salaire ?? ''}"></div>
            <div class="field"><label>Date expiration</label><input name="date_expiration" type="date" value="${job.date_expiration ? String(job.date_expiration).slice(0, 10) : ''}" required></div>
          </div>
          <div class="field"><label>Statut</label>
            <select name="statut_offre">
              ${['Ouverte', 'Fermée', 'Suspendue'].map((s) => `<option ${job.statut_offre === s ? 'selected' : ''}>${s}</option>`).join('')}
            </select>
          </div>
          <button class="btn primary" type="submit">Enregistrer</button>
        </form>
        <form class="form" data-skills-form="${job.id_offre}">
          <h3>Compétences requises</h3>
          <div class="nav-actions">
            <div class="field"><label>Compétence</label>
              <select name="id_competence">${skills.map((s) => `<option value="${s.id_competence}">${escapeHtml(s.nom_competence)}</option>`).join('')}</select>
            </div>
            <div class="field"><label>Niveau requis</label>
              <select name="niveau_requis">${['Débutant', 'Intermédiaire', 'Avancé', 'Expert'].map((n) => `<option>${n}</option>`).join('')}</select>
            </div>
            <button class="btn" type="submit">Ajouter</button>
          </div>
        </form>
      </div>`).join('');

    $$('[data-delete-offer]').forEach((button) => button.addEventListener('click', async () => {
      if (!window.confirm('Supprimer définitivement cette offre et ses candidatures ?')) return;
      try {
        await API.delete(`/offres/${button.dataset.deleteOffer}`);
        toast('Offre supprimée');
        renderMyOffers();
        renderRecruiterStats();
      } catch (error) { toast(error.message, 'danger'); }
    }));

    $$('[data-toggle-edit]').forEach((button) => button.addEventListener('click', () => {
      $(`[data-edit-form="${button.dataset.toggleEdit}"]`)?.classList.toggle('hidden');
    }));

    $$('[data-edit-form]').forEach((form) => form.addEventListener('submit', async (event) => {
      event.preventDefault();
      const id = form.dataset.editForm;
      try {
        await API.put(`/offres/${id}`, Object.fromEntries(new FormData(form)));
        toast('Offre mise à jour');
        renderMyOffers();
      } catch (error) { toast(error.message, 'danger'); }
    }));

    $$('[data-skills-form]').forEach((form) => form.addEventListener('submit', async (event) => {
      event.preventDefault();
      const id = form.dataset.skillsForm;
      const data = Object.fromEntries(new FormData(form));
      try {
        const { item } = await API.get(`/offres/${id}`);
        const existing = (item.competences || []).filter((s) => Number(s.id_competence) !== Number(data.id_competence));
        await API.put(`/offres/${id}/competences`, { competences: [...existing, { id_competence: Number(data.id_competence), niveau_requis: data.niveau_requis }] });
        toast('Compétence requise ajoutée');
        renderMyOffers();
      } catch (error) { toast(error.message, 'danger'); }
    }));
  } catch (error) {
    target.innerHTML = `<div class="card">${escapeHtml(error.message)}</div>`;
  }
}

/* ---------- Petits utilitaires ---------- */

function debounce(fn, delay) {
  let timer;
  return (...args) => { clearTimeout(timer); timer = setTimeout(() => fn(...args), delay); };
}
