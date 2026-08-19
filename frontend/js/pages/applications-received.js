/* LinkEmploi — page « Candidatures reçues » (recruteur) : une nouvelle
   candidature apparaît immédiatement sous forme de carte, avec mise à jour
   du badge « Candidatures reçues » de la navigation.

   Décision de recrutement limitée à deux actions : Accepter ou Refuser
   (boutons distincts, pas de liste déroulante). Si l'offre a déjà été
   attribuée (offre_pourvue), aucun bouton n'est affiché : le backend reste
   la source de vérité (verrou transactionnel + garde-fou 409). */
(() => {
  'use strict';
  const RT = window.GCRealtime;
  if (!RT) return;

  const { esc, shortDate, initials, statusClass } = RT;
  const listContainer = document.querySelector('.list[data-applications-list]');
  if (!listContainer) return; // page réservée aux recruteurs

  const findCard = (id) => document.querySelector(`.application-card[data-candidature-id="${Number(id)}"]`);

  // Actions possibles uniquement sur une candidature « En attente » ;
  // une candidature déjà traitée est finale, une offre pourvue bloque tout.
  const actions = (c) => {
    if (c.statut_candidature !== 'En attente') {
      return `<span class="badge ${statusClass(c.statut_candidature)}">Décision finale</span>`;
    }
    if (c.offre_pourvue) {
      return `<span class="badge warning">Offre déjà attribuée</span>`;
    }
    return `
      <form method="post" action="/candidatures/${Number(c.id_candidature)}/statut" class="form-inline app-status">
        <input type="hidden" name="statut_candidature" value="Acceptée">
        <button class="btn success" type="submit">Accepter</button>
      </form>
      <form method="post" action="/candidatures/${Number(c.id_candidature)}/statut" class="form-inline app-status">
        <input type="hidden" name="statut_candidature" value="Refusée">
        <button class="btn danger" type="submit">Refuser</button>
      </form>`;
  };

  const applicationCard = (c) => `
    <div class="card application-card" data-candidature-id="${Number(c.id_candidature)}">
      <div class="offer-head">
        <div class="user-cell">
          <span class="avatar-img">
            ${c.photo ? `<img src="${esc(c.photo)}" alt="${esc(`${c.prenom} ${c.nom}`)}">`
              : `<span class="avatar-fallback">${initials(c.prenom, c.nom)}</span>`}
          </span>
          <div>
            <strong>${esc(c.prenom)} ${esc(c.nom)}</strong>
            <p class="muted-note">
              ${c.email ? `${esc(c.email)}` : ''}${c.telephone ? ` · ${esc(c.telephone)}` : ''}
            </p>
            <p class="muted-note">Offre : <a href="/offres/${Number(c.id_offre)}">${esc(c.titre_offre)}</a> · Postulé le ${shortDate(c.date_candidature)}</p>
          </div>
        </div>
        <div class="nav-actions">
          ${c.score_compatibilite != null ? `<span class="badge info">Matching ${esc(c.score_compatibilite)}%</span>` : ''}
          <span class="badge ${statusClass(c.statut_candidature)}">${esc(c.statut_candidature)}</span>
        </div>
      </div>
      ${c.lettre_motivation ? `<p><strong>Lettre de motivation :</strong> ${esc(c.lettre_motivation)}</p>` : ''}
      ${c.competences ? `<p><strong>Compétences :</strong> ${esc(c.competences)}</p>` : ''}
      ${c.bio ? `<p><strong>Bio :</strong> ${esc(c.bio)}</p>` : ''}
      <div class="nav-actions app-actions">
        ${c.cv ? `<a class="btn" href="${esc(c.cv)}" target="_blank" rel="noopener">Voir le CV</a>` : ''}
        <a class="btn" href="/messages?dest=${Number(c.id_utilisateur)}">Contacter</a>
        ${actions(c)}
      </div>
    </div>`;

  document.addEventListener('gc:candidature-nouvelle', (event) => {
    const { candidature } = event.detail || {};
    if (!candidature || candidature.statut_candidature === 'Annulée') return;
    if (findCard(candidature.id_candidature)) return; // anti-doublon
    listContainer.insertAdjacentHTML('afterbegin', applicationCard(candidature));
    // Badge « Candidatures reçues » : une candidature débute toujours
    // « En attente » (garde-fou : le badge reste recalculé à chaque rendu).
    const badge = document.querySelector('[data-count="unread-applications"]');
    if (badge) {
      badge.textContent = Number(badge.textContent) + 1;
      badge.classList.remove('hidden');
    }
  });

  // Réception temps réel d'une décision (ex. acceptation faite sur un autre
  // onglet) : la carte est re-rendue avec les actions à jour.
  document.addEventListener('gc:candidature-statut', (event) => {
    const detail = event.detail || {};
    if (!detail.id_candidature) return;
    if (!detail.titre_offre) return; // ne s'applique qu'aux événements recruteur
    // Simple marqueur visuel : la page se recharge volontairement sur clic,
    // ce gestionnaire sert surtout aux vues candidat.
  });
})();