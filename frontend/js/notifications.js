document.addEventListener('DOMContentLoaded', async () => {
  if (document.body.dataset.page !== 'notifications') return;
  Auth.requireAuth();
  const target = $('#notificationsList');
  const readAllBtn = $('#notificationsReadAll');
  if (readAllBtn) readAllBtn.addEventListener('click', async () => {
    try {
      await API.patch('/notifications/lire-toutes', {});
      toast('Toutes les notifications sont lues');
      renderNotifications();
    } catch (error) { toast(error.message, 'danger'); }
  });
  await renderNotifications();

  async function renderNotifications() {
    target.innerHTML = skeleton(4);
    try {
      const { items } = await API.get('/notifications');
      target.innerHTML = items.map((n) => `
        <div class="list-item">
          <div><strong>${escapeHtml(n.contenu_notification)}</strong><p>${formatDate(n.date_notification)} ${statusBadge(n.statut_notification)}</p></div>
          ${n.statut_notification === 'Non lue' ? `<button class="btn" data-read="${n.id_notification}">Marquer lue</button>` : ''}
        </div>`).join('') || '<div class="card">Aucune notification.</div>';
      $$('[data-read]').forEach((button) => button.addEventListener('click', async () => {
        try {
          await API.patch(`/notifications/${button.dataset.read}/lire`, {});
          renderNotifications();
        } catch (error) { toast(error.message, 'danger'); }
      }));
    } catch (error) { target.innerHTML = `<div class="card">${escapeHtml(error.message)}</div>`; }
  }
});
