document.addEventListener('DOMContentLoaded', () => {
  const form = $('#registerForm');
  if (!form) return;
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const body = Object.fromEntries(new FormData(form));
    try {
      const { token, user } = await API.post('/auth/register', body);
      Storage.setSession(token, user);
      location.href = '/candidate-dashboard.html';
    } catch (error) { toast(error.message, 'danger'); }
  });
});
