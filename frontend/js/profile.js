document.addEventListener('DOMContentLoaded', async () => {
  if (document.body.dataset.page !== 'profile') return;
  Auth.requireRole(['candidat']);
  const form = $('#profileForm');
  const progress = $('#uploadProgress span');
  try {
    const { profile } = await API.get('/profil');
    if (profile) Object.entries(profile).forEach(([key, value]) => { if (form[key]) form[key].value = value || ''; });
  } catch (_) {}
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    try { await API.put('/profil', Object.fromEntries(new FormData(form))); toast('Profil enregistre'); }
    catch (error) { toast(error.message, 'danger'); }
  });
  $('#cvInput')?.addEventListener('change', async (event) => uploadFile('/profil/cv', 'cv', event.target.files[0], progress));
  $('#photoInput')?.addEventListener('change', async (event) => uploadFile('/profil/photo', 'photo', event.target.files[0], progress));
});

async function uploadFile(path, field, file, progress) {
  if (!file) return;
  const formData = new FormData();
  formData.append(field, file);
  try {
    await API.upload(path, formData, (value) => { if (progress) progress.style.width = `${value}%`; });
    toast('Fichier envoye');
  } catch (error) { toast(error.message, 'danger'); }
}
