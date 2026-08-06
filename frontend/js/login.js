document.addEventListener('DOMContentLoaded', () => {
  const form = $('#loginForm');
  if (!form) return;
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const body = Object.fromEntries(new FormData(form));
    try {
      const { token, user } = await API.post('/auth/login', body);
      Storage.setSession(token, user);
      location.href = Auth.dashboardFor(user);
    } catch (error) { toast(error.message, 'danger'); }
  });
});
