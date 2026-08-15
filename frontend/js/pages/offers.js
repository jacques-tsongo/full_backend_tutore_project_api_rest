/* LinkEmploi — pages Offres : liste (/offres) et détail (/offres/:id).
   Une offre publiée/modifiée/supprimée apparaît immédiatement, sans
   rechargement. Les règles d'accès actuelles sont respectées côté client :
   un candidat ne voit que les offres « Ouverte » non expirées. */
(() => {
  'use strict';
  const RT = window.GCRealtime;
  if (!RT) return;

  const { userId, statusClass, esc, shortDate } = RT;
  const role = document.body.dataset.role;

  /* --------------------------- Liste /offres ----------------------------- */
  const listContainer = document.querySelector('.list[data-offers-list]');

  const offerVisible = (offer) => {
    if (!offer) return false;
    if (role === 'candidat') {
      const expired = new Date(offer.date_expiration) < new Date();
      if (offer.statut_offre !== 'Ouverte' || expired) return false;
    }
    if (listContainer) {
      if (listContainer.dataset.statut && offer.statut_offre !== listContainer.dataset.statut) return false;
      const q = (listContainer.dataset.q || '').trim().toLowerCase();
      if (q) {
        const hay = `${offer.titre_offre || ''} ${offer.localisation || ''} ${offer.nom_entreprise || ''}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      // Sur une page paginée, on n'injecte pas de carte en tête (évite de
      // décaler la pagination) : le prochain chargement la montrera.
      if (Number(listContainer.dataset.page || 1) > 1) return false;
    }
    return true;
  };

  const offerCard = (job) => {
    const applied = listContainer && listContainer.dataset.applied
      ? listContainer.dataset.applied.split(',').includes(String(job.id_offre))
      : false;
    const canApply = role === 'candidat' && job.statut_offre === 'Ouverte' && !applied;
    return `
      <div class="list-item offer-item" data-offer-id="${Number(job.id_offre)}">
        <div class="offer-main">
          <strong class="offer-title"><a href="/offres/${Number(job.id_offre)}">${esc(job.titre_offre)}</a></strong>
          <p class="muted-note">
            ${esc(job.nom_entreprise || '—')} ·
            ${esc(job.localisation)} ·
            expire le ${shortDate(job.date_expiration)}
            ${job.salaire ? ` · ${esc(job.salaire)} $` : ''}
          </p>
        </div>
        <div class="nav-actions">
          <span class="badge ${statusClass(job.statut_offre)}">${esc(job.statut_offre)}</span>
          <a class="btn" href="/offres/${Number(job.id_offre)}">Détails</a>
          ${canApply ? `<a class="btn primary" href="/offres/${Number(job.id_offre)}#postuler">Postuler</a>`
            : role === 'candidat' && applied ? '<span class="badge success">Déjà postulé</span>' : ''}
        </div>
      </div>`;
  };

  const findCard = (idOffre) => document.querySelector(`.offer-item[data-offer-id="${Number(idOffre)}"]`);

  const updateCard = (job) => {
    const card = findCard(job.id_offre);
    if (!card) return;
    card.querySelector('.offer-title a').textContent = job.titre_offre;
    card.querySelector('.offer-main .muted-note').innerHTML = `
      ${esc(job.nom_entreprise || '—')} ·
      ${esc(job.localisation)} ·
      expire le ${shortDate(job.date_expiration)}
      ${job.salaire ? ` · ${esc(job.salaire)} $` : ''}`;
    const badge = card.querySelector('.badge');
    badge.textContent = job.statut_offre;
    badge.className = `badge ${statusClass(job.statut_offre)}`;
    // Boutons Postuler / Déjà postulé selon le nouveau statut.
    const actions = card.querySelector('.nav-actions');
    actions.querySelectorAll('a.btn.primary, span.badge.success').forEach((n) => n.remove());
    if (role === 'candidat' && job.statut_offre === 'Ouverte') {
      const applied = listContainer ? listContainer.dataset.applied.split(',').includes(String(job.id_offre)) : false;
      if (!applied) actions.insertAdjacentHTML('afterbegin', `<a class="btn primary" href="/offres/${Number(job.id_offre)}#postuler">Postuler</a>`);
    }
  };

  /* ------------------------- Détail /offres/:id --------------------------- */
  const detailCard = document.querySelector('.job-hero[data-offer-id]');
  const currentOfferId = detailCard ? Number(detailCard.dataset.offerId) : null;

  const updateDetail = (job) => {
    const field = (name) => detailCard.querySelector(`[data-field="${name}"]`);
    field('titre').textContent = job.titre_offre;
    const loc = field('localisation');
    if (loc) loc.innerHTML = `<strong>${esc(job.nom_entreprise || '—')}</strong> · ${esc(job.localisation)}`;
    const badge = field('statut');
    badge.textContent = job.statut_offre;
    badge.className = `badge ${statusClass(job.statut_offre)}`;
    const sal = field('salaire');
    if (sal) {
      if (job.salaire) { sal.classList.remove('hidden'); sal.querySelector('strong').textContent = `${job.salaire} $`; }
      else sal.classList.add('hidden');
    }
    const exp = field('expiration');
    if (exp && exp.querySelector('strong')) exp.querySelector('strong').textContent = shortDate(job.date_expiration);
    const desc = field('description');
    if (desc) desc.textContent = job.description_offre;
    const skills = field('competences');
    if (skills) {
      const chips = (job.competences || []).map((s) => `<span class="badge info">${esc(s.nom_competence)} — ${esc(s.niveau_requis)}</span>`).join('');
      skills.innerHTML = chips;
      field('competences-title')?.classList.toggle('hidden', !chips);
      skills.classList.toggle('hidden', !chips);
    }
  };

  /* --------------------------- Événements -------------------------------- */
  document.addEventListener('gc:offre-nouvelle', (event) => {
    const { offer } = event.detail || {};
    if (!offer || !listContainer) return;
    if (findCard(offer.id_offre)) return; // anti-doublon
    if (!offerVisible(offer)) return;
    listContainer.insertAdjacentHTML('afterbegin', offerCard(offer));
  });

  document.addEventListener('gc:offre-modifiee', (event) => {
    const { offer } = event.detail || {};
    if (!offer) return;
    if (listContainer) {
      if (findCard(offer.id_offre)) updateCard(offer);
    }
    if (detailCard && Number(offer.id_offre) === currentOfferId) updateDetail(offer);
  });

  document.addEventListener('gc:offre-supprimee', (event) => {
    const { id_offre } = event.detail || {};
    if (!id_offre) return;
    if (listContainer) {
      const card = findCard(id_offre);
      if (card) card.remove();
    }
    // L'offre affichée en détail n'existe plus : on quitte proprement la page
    // (navigation légitime, pas un rechargement de l'application).
    if (detailCard && Number(id_offre) === currentOfferId) {
      window.location.href = '/offres';
    }
  });
})();
