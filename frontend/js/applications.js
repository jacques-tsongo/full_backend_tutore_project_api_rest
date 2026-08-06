document.addEventListener('DOMContentLoaded', async () => {
  if (document.body.dataset.page !== 'applications') return;
  Auth.requireAuth();
  const user = Storage.getUser();
  const path = user?.role === 'recruteur' ? '/candidatures/recues' : '/candidatures/me';
  const target = $('#applicationsList');
  target.innerHTML = skeleton(4);
  try {
    const { items } = await API.get(path);
    target.innerHTML = `<div class="table-wrap"><table><thead><tr><th>Offre</th><th>Candidat</th><th>Statut</th><th>Date</th></tr></thead><tbody>${items.map((x) => `
      <tr><td>${escapeHtml(x.titre_offre)}</td><td>${escapeHtml([x.prenom, x.nom].filter(Boolean).join(' ') || 'Moi')}</td><td>${statusBadge(x.statut_candidature)}</td><td>${formatDate(x.date_candidature)}</td></tr>`).join('')}</tbody></table></div>`;
  } catch (error) { target.innerHTML = `<div class="card">${escapeHtml(error.message)}</div>`; }
});
