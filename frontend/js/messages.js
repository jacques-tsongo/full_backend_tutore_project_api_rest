/* Messagerie : conversations, fil de discussion et envoi de messages. */

document.addEventListener('DOMContentLoaded', async () => {
  if (document.body.dataset.page !== 'messages') return;
  Auth.requireAuth();
  await renderConversations();
  bindCompose();
  const dest = new URLSearchParams(location.search).get('dest');
  if (dest) openConversation(dest);
});

let activeUser = null;

async function renderConversations() {
  const target = $('#messagesList');
  if (!target) return;
  target.innerHTML = skeleton(3);
  try {
    const { items } = await API.get('/messages');
    target.innerHTML = items.map((m) => `
      <div class="list-item" style="cursor:pointer" data-conversation="${m.id_utilisateur}">
        <div>
          <strong>${escapeHtml(m.prenom)} ${escapeHtml(m.nom)}</strong>
          <p>${escapeHtml(m.dernier_message || '')}</p>
        </div>
        <small>${formatDate(m.derniere_date)}</small>
      </div>`).join('') || '<div class="card">Aucune conversation.</div>';
    $$('[data-conversation]').forEach((node) => node.addEventListener('click', () => openConversation(node.dataset.conversation)));
  } catch (error) { target.innerHTML = `<div class="card">${escapeHtml(error.message)}</div>`; }
}

async function openConversation(userId) {
  activeUser = userId;
  const thread = $('#messageThread');
  if (!thread) return;
  thread.innerHTML = skeleton(2);
  try {
    const { items } = await API.get(`/messages/${userId}`);
    const me = Storage.getUser();
    thread.innerHTML = `
      <div class="card form">
        <h2>Conversation</h2>
        <div id="threadMessages" class="list">${items.map((msg) => `
          <div class="list-item ${msg.id_expediteur === me?.id_utilisateur ? '' : 'active'}" style="${msg.id_expediteur === me?.id_utilisateur ? 'opacity:.85' : 'border-left:3px solid var(--primary)'}">
            <div><strong>${escapeHtml(msg.expediteur_prenom)} ${escapeHtml(msg.expediteur_nom)}</strong>
            <p>${escapeHtml(msg.contenu)}</p></div>
            <small>${formatDate(msg.date_message)}</small>
          </div>`).join('')}</div>
        <div class="field"><label>Votre message</label><textarea id="messageInput" rows="3"></textarea></div>
        <button id="messageSend" class="btn primary">Envoyer</button>
      </div>`;
    $('#messageSend').addEventListener('click', async () => {
      const input = $('#messageInput');
      const contenu = input.value.trim();
      if (!contenu) return toast('Message vide', 'danger');
      try {
        await API.post('/messages', { id_destinataire: Number(activeUser), contenu });
        input.value = '';
        openConversation(activeUser);
        renderConversations();
      } catch (error) { toast(error.message, 'danger'); }
    });
  } catch (error) { thread.innerHTML = `<div class="card">${escapeHtml(error.message)}</div>`; }
}

async function bindCompose() {
  const form = $('#composeForm');
  if (!form) return;
  try {
    const { items } = await API.get('/messages/contacts');
    const select = $('#composeRecipient');
    if (!select) return;
    select.innerHTML = '<option value="">— Choisir un contact —</option>' + items.map((u) =>
      `<option value="${u.id_utilisateur}">${escapeHtml(u.prenom)} ${escapeHtml(u.nom)}${u.email ? ' (' + escapeHtml(u.email) + ')' : ''}</option>`).join('');
    if (!items.length) select.innerHTML = '<option value="">Aucun contact disponible</option>';
  } catch (_) { /* les contacts sont optionnels pour l'envoi direct */ }

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const body = Object.fromEntries(new FormData(form));
    if (!body.id_destinataire) return toast('Choisissez un destinataire', 'danger');
    try {
      await API.post('/messages', { id_destinataire: Number(body.id_destinataire), contenu: body.contenu });
      toast('Message envoyé');
      form.reset();
      renderConversations();
      openConversation(body.id_destinataire);
    } catch (error) { toast(error.message, 'danger'); }
  });
}
