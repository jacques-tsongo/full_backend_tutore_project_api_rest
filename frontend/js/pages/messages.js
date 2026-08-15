/* LinkEmploi — page Messagerie : nouveau message instantané, conversation
   mise à jour sans rechargement, compteurs non lus, resynchronisation du fil
   après reconnexion. Anti-doublons via data-id des messages / conversations. */
(() => {
  'use strict';
  const RT = window.GCRealtime;
  if (!RT) return;

  const { userId, esc, shortDate, initials } = RT;
  const threadCard = document.querySelector('.thread-card[data-thread-user]');
  const threadUser = threadCard ? Number(threadCard.dataset.threadUser) : null;
  const threadList = document.querySelector('.thread-list');
  const conversationsList = document.querySelector('.messages-side .list');

  /* ------------------------- Fil de discussion --------------------------- */
  const messageNode = (m, expediteurNom, expediteurPrenom) => {
    const own = Number(m.id_expediteur) === userId;
    const seen = own && Number(m.lu) === 1 ? ' · Vu' : '';
    return `
      <div class="thread-msg ${own ? 'own' : ''}" data-id="${Number(m.id_message)}">
        <div class="thread-bubble">
          <strong>${esc(expediteurPrenom || '')} ${esc(expediteurNom || '')}</strong>
          <p>${esc(m.contenu)}</p>
          <small>${shortDate(m.date_message)}${seen}</small>
        </div>
      </div>`;
  };

  const appendThreadMessage = (m, expediteur) => {
    if (!threadList || threadUser == null) return;
    // Anti-doublon : le message (déjà rendu côté serveur après le PRG) ne
    // doit jamais apparaître deux fois.
    if (document.querySelector(`.thread-list .thread-msg[data-id="${Number(m.id_message)}"]`)) return;
    threadList.insertAdjacentHTML('beforeend', messageNode(m, expediteur.nom, expediteur.prenom));
    threadList.scrollTop = threadList.scrollHeight;
  };

  /* Marque « Vu » sur MES messages une fois qu'ils ont été lus. */
  const markOwnAsSeen = (otherId) => {
    if (!threadList || threadUser !== Number(otherId)) return;
    threadList.querySelectorAll('.thread-msg.own:not(.seen-marked)').forEach((node) => {
      const small = node.querySelector('small');
      if (small && !small.textContent.includes('Vu')) small.textContent += ' · Vu';
      node.classList.add('seen-marked');
    });
  };

  /* --------------------- Liste des conversations -------------------------- */
  const conversationItem = (message, expediteur, nonLus) => {
    const partner = Number(message.id_expediteur) === Number(userId) ? Number(message.id_destinataire) : Number(message.id_expediteur);
    return `
    <a class="list-item conversation-item${partner === threadUser ? ' active' : ''}"
       data-user-id="${partner}" href="/messages?dest=${partner}">
      <span class="avatar-img sm">
        <span class="avatar-fallback">${initials(expediteur.prenom, expediteur.nom)}</span>
      </span>
      <div class="conversation-meta">
        <strong>${esc(expediteur.prenom)} ${esc(expediteur.nom)}</strong>
        <p>${esc(String(message.contenu || '').slice(0, 60))}${String(message.contenu || '').length > 60 ? '…' : ''}</p>
      </div>
      <div class="conversation-side">
        <small class="muted-note">${shortDate(message.date_message)}</small>
        ${nonLus > 0 ? `<span class="count">${nonLus}</span>` : ''}
      </div>
    </a>`;
  };

  const updateConversation = (message, expediteur) => {
    const partner = Number(message.id_expediteur) === userId ? Number(message.id_destinataire) : Number(message.id_expediteur);
    const node = document.querySelector(`.conversation-item[data-user-id="${partner}"]`);
    const preview = String(message.contenu || '').slice(0, 60);
    const received = Number(message.id_destinataire) === userId;
    // Un message reçu sur la conversation OUVERTE est déjà marqué lu par le serveur.
    const isOpenThread = received && threadUser === partner;
    const nonLus = received && !isOpenThread ? 1 : 0;
    if (node) {
      node.querySelector('.conversation-meta p').textContent = `${preview}${String(message.contenu || '').length > 60 ? '…' : ''}`;
      node.querySelector('.muted-note').textContent = shortDate(message.date_message);
      if (nonLus) {
        let badge = node.querySelector('.conversation-side .count');
        if (!badge) {
          node.querySelector('.conversation-side').insertAdjacentHTML('beforeend', '<span class="count">0</span>');
          badge = node.querySelector('.conversation-side .count');
        }
        badge.textContent = Number(badge.textContent) + 1;
      }
      // Remonte la conversation en tête de liste.
      node.parentNode.prepend(node);
    } else if (conversationsList) {
      conversationsList.insertAdjacentHTML('afterbegin', conversationItem(message, expediteur, nonLus));
    }
  };

  /* --------------- Resynchronisation après reconnexion -------------------- */
  /* Les événements manqués ne sont PAS rejoués : on relit le fil courant
     depuis la base (source de vérité) puis on reconstruit le DOM. */
  const resyncThread = async () => {
    if (!threadCard || threadUser == null || !threadList) return;
    try {
      const res = await fetch(`/api/messages/${threadUser}`, { credentials: 'same-origin' });
      if (!res.ok) return;
      const json = await res.json();
      const items = (json.data && json.data.items) || [];
      if (items.length && document.querySelectorAll('.thread-list .thread-msg').length === items.length) return;
      threadList.innerHTML = items
        .map((m) => messageNode(m, m.expediteur_nom, m.expediteur_prenom))
        .join('');
      threadList.scrollTop = threadList.scrollHeight;
      RT.refreshBadges();
    } catch (_) { /* silencieux */ }
  };

  /* --------------------------- Événements -------------------------------- */
  document.addEventListener('gc:message', (event) => {
    const { message, expediteur } = event.detail || {};
    if (!message) return;
    const mine = Number(message.id_expediteur) === userId;
    // Fil ouvert avec l'expéditeur → affichage direct.
    if (!mine && threadUser === Number(message.id_expediteur) && Number(message.id_destinataire) === userId) {
      appendThreadMessage(message, expediteur);
      // La conversation est ouverte : le message reçu est immédiatement
      // marqué lu côté serveur (compteur cohérent, source = base).
      fetch(`/api/messages/${threadUser}`, { credentials: 'same-origin' }).catch(() => {});
    } else if (mine && threadUser === Number(message.id_destinataire)) {
      appendThreadMessage(message, expediteur);
    }
    updateConversation(message, expediteur || { nom: '', prenom: '' });
  });

  document.addEventListener('gc:message-lu', (event) => {
    const detail = event.detail || {};
    // `message_lu` reçu en tant que DESTINATAIRE → mes messages sont vus.
    if (Number(detail.id_destinataire) === userId && detail.id_expediteur) {
      markOwnAsSeen(detail.id_expediteur);
    }
    RT.refreshBadges();
  });

  document.addEventListener('gc:reconnect', resyncThread);
})();
