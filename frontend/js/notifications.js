document.addEventListener('DOMContentLoaded', async () => {
  if (document.body.dataset.page !== 'notifications') return;
  Auth.requireAuth();
  const target = $('#notificationsList');
  target.innerHTML = skeleton(4);
  try {
    const { items } = await API.get('/notifications');
    target.innerHTML = items.map((n) => `
      <div class="list-item"><div><strong>${escapeHtml(n.contenu_notification)}</strong><p>${formatDate(n.date_notification)} ${statusBadge(n.statut_notification)}</p></div><button class="btn" data-read="${n.id_notification}">Marquer lu</button></div>`).join('') || '<div class="card">Aucune notification.</div>';
    $$('[data-read]').forEach((button) => button.addEventListener('click', async () => {
      await API.patch(`/notifications/${button.dataset.read}/lire`, {});
      button.closest('.list-item').remove();
    }));
  } catch (error) { target.innerHTML = `<div class="card">${escapeHtml(error.message)}</div>`; }
});
