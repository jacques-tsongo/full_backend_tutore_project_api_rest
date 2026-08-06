document.addEventListener('DOMContentLoaded', async () => {
  if (document.body.dataset.page !== 'messages') return;
  Auth.requireAuth();
  const target = $('#messagesList');
  target.innerHTML = skeleton(3);
  try {
    const { items } = await API.get('/messages');
    target.innerHTML = items.map((m) => `<div class="list-item"><div><strong>${escapeHtml(m.prenom)} ${escapeHtml(m.nom)}</strong><p>${escapeHtml(m.dernier_message || '')}</p></div><small>${formatDate(m.derniere_date)}</small></div>`).join('') || '<div class="card">Aucune conversation.</div>';
  } catch (error) { target.innerHTML = `<div class="card">${escapeHtml(error.message)}</div>`; }
});
