/* Candidatures : suivi candidat (annulation) et revue recruteur (statuts, contact). */

const APPLICATION_STATUSES = ['En attente', 'Présélectionnée', 'Entretien', 'Acceptée', 'Refusée'];

document.addEventListener('DOMContentLoaded', async () => {
  if (document.body.dataset.page !== 'applications') return;
  Auth.requireAuth();
  renderApplications();
});

async function renderApplications() {
  const target = $('#applicationsList');
  if (!target) return;
  target.innerHTML = skeleton(4);
  const user = Storage.getUser();
  try {
    if (user?.role === 'recruteur') {
      await renderRecruiterApplications(target);
    } else {
      await renderCandidateApplications(target);
    }
  } catch (error) {
    target.innerHTML = `<div class="card">${escapeHtml(error.message)}</div>`;
  }
}

/* ---------- Candidat : mes candidatures ---------- */

async function renderCandidateApplications(target) {
  const { items } = await API.get('/candidatures/me');
  if (!items.length) {
    target.innerHTML = '<div class="card">Vous n\'avez pas encore postulé. Parcourez les <a href="/jobs.html">offres</a>.</div>';
    return;
  }
  target.innerHTML = `<div class="table-wrap"><table>
    <thead><tr><th>Offre</th><th>Entreprise</th><th>Statut</th><th>Score matching</th><th>Date</th><th>Action</th></tr></thead>
    <tbody>${items.map((x) => `
      <tr>
        <td><a href="/job-details.html?id=${x.id_offre}">${escapeHtml(x.titre_offre)}</a><br><small>${escapeHtml(x.localisation || '')}</small></td>
        <td>${escapeHtml(x.nom_entreprise || '')}</td>
        <td>${statusBadge(x.statut_candidature)}</td>
        <td>${x.score_compatibilite != null ? `${x.score_compatibilite}%` : '-'}</td>
        <td>${formatDate(x.date_candidature)}</td>
        <td>
          <div class="nav-actions">
            ${x.id_recruteur ? `<a class="btn" href="/messages.html?dest=${x.id_recruteur}">Contacter</a>` : ''}
            ${x.statut_candidature === 'En attente' ? `<button class="btn danger" data-cancel="${x.id_candidature}">Annuler</button>` : ''}
          </div>
        </td>
      </tr>`).join('')}</tbody></table></div>`;

  $$('[data-cancel]').forEach((button) => button.addEventListener('click', async () => {
    if (!window.confirm('Annuler cette candidature ?')) return;
    try {
      await API.patch(`/candidatures/${button.dataset.cancel}/annuler`, {});
      toast('Candidature annulée');
      renderApplications();
    } catch (error) { toast(error.message, 'danger'); }
  }));
}

/* ---------- Recruteur : candidatures reçues ---------- */

async function renderRecruiterApplications(target) {
  const { items } = await API.get('/candidatures/recues');
  if (!items.length) {
    target.innerHTML = '<div class="card">Aucune candidature reçue pour vos offres.</div>';
    return;
  }
  target.innerHTML = items.map((x) => `
    <div class="card" data-app-card="${x.id_candidature}">
      <div class="nav-actions" style="justify-content:space-between">
        <div>
          <strong>${escapeHtml(x.prenom)} ${escapeHtml(x.nom)}</strong>
          <p>${escapeHtml(x.email || '')} ${x.telephone ? '· ' + escapeHtml(x.telephone) : ''}</p>
          <p>Offre : <a href="/job-details.html?id=${x.id_offre}">${escapeHtml(x.titre_offre)}</a> · Postulé le ${formatDate(x.date_candidature)}</p>
        </div>
        <div class="nav-actions">
          ${x.score_compatibilite != null ? `<span class="badge">Matching ${x.score_compatibilite}%</span>` : ''}
          ${statusBadge(x.statut_candidature)}
        </div>
      </div>
      ${x.lettre_motivation ? `<p><strong>Lettre de motivation :</strong> ${escapeHtml(x.lettre_motivation)}</p>` : ''}
      ${x.competences ? `<p><strong>Compétences :</strong> ${escapeHtml(x.competences)}</p>` : ''}
      ${x.bio ? `<p><strong>Bio :</strong> ${escapeHtml(x.bio)}</p>` : ''}
      <div class="nav-actions">
        ${x.cv ? `<a class="btn" href="${escapeHtml(x.cv.startsWith('/') ? x.cv : '/' + x.cv)}" target="_blank">Voir le CV</a>` : ''}
        <a class="btn" href="/messages.html?dest=${x.id_utilisateur}">Contacter</a>
        <div class="field">
          <select data-status-select="${x.id_candidature}">
            ${APPLICATION_STATUSES.map((s) => `<option ${x.statut_candidature === s ? 'selected' : ''}>${s}</option>`).join('')}
          </select>
        </div>
        <button class="btn primary" data-status-update="${x.id_candidature}">Mettre à jour</button>
      </div>
    </div>`).join('');

  $$('[data-status-update]').forEach((button) => button.addEventListener('click', async () => {
    const id = button.dataset.statusUpdate;
    const statut = $(`[data-status-select="${id}"]`)?.value;
    try {
      await API.patch(`/candidatures/${id}/statut`, { statut_candidature: statut });
      toast(`Statut mis à jour : ${statut}`);
      renderApplications();
    } catch (error) { toast(error.message, 'danger'); }
  }));
}
