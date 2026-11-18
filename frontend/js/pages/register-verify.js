// Page de vérification de l'inscription : compte à rebours de validité du code
// et délai avant de pouvoir demander un nouveau code. Aucun code n'est stocké
// en JavaScript : le champ est simplement nettoyé pour n'accepter que 6 chiffres.
(function () {
  const form = document.querySelector('[data-signup-verify]');
  if (!form) return;

  const input = form.querySelector('#code');
  const submit = form.querySelector('[data-verify-submit]');
  const expireLabel = form.querySelector('[data-expire-label]');
  const expireMessage = form.querySelector('[data-expire-message]');
  const resendForm = document.querySelector('[data-resend-form]');
  const resendButton = document.querySelector('[data-resend-button]');
  const resendLabel = document.querySelector('[data-resend-label]');
  const resendMessage = document.querySelector('[data-resend-message]');

  const toSeconds = (value) => {
    const number = Number(value);
    return Number.isFinite(number) && number > 0 ? Math.floor(number) : 0;
  };
  const format = (seconds) => {
    const total = Math.max(0, Math.floor(seconds));
    const minutes = Math.floor(total / 60);
    const rest = total % 60;
    return minutes ? `${minutes} min ${String(rest).padStart(2, '0')} s` : `${rest} s`;
  };

  let expire = toSeconds(form.dataset.expireDans);
  let renvoi = toSeconds(form.dataset.renvoiDans);
  let expired = expire <= 0;

  const render = () => {
    if (expireLabel) expireLabel.textContent = expired ? 'expiré' : format(expire);
    if (submit) submit.disabled = expired;
    if (input) input.disabled = expired;

    if (expireMessage) {
      if (expired) {
        expireMessage.textContent = 'Le code a expiré. Demandez un nouveau code ou recommencez l’inscription.';
        expireMessage.classList.add('is-error');
      } else if (expire <= 60) {
        expireMessage.textContent = `Le code expire dans ${format(expire)}.`;
        expireMessage.classList.remove('is-error');
      } else {
        expireMessage.textContent = '';
        expireMessage.classList.remove('is-error');
      }
    }

    if (resendButton) resendButton.disabled = !expired && renvoi > 0;
    if (resendLabel) {
      resendLabel.textContent = !expired && renvoi > 0
        ? `Renvoyer le code (${format(renvoi)})`
        : 'Renvoyer le code';
    }
    if (resendMessage) {
      if (!expired && renvoi > 0) resendMessage.textContent = 'Vous pourrez demander un nouveau code à la fin du compte à rebours.';
      else if (expired) resendMessage.textContent = 'Demandez un nouveau code pour poursuivre.';
      else resendMessage.textContent = '';
    }
  };

  render();
  const timer = setInterval(() => {
    if (expire > 0) expire -= 1;
    else expired = true;
    if (renvoi > 0) renvoi -= 1;
    render();
  }, 1000);

  // Le champ n'accepte que des chiffres (collage compris).
  if (input) {
    input.addEventListener('input', () => {
      input.value = input.value.replace(/\D/g, '').slice(0, 6);
    });
  }

  // Évite le double envoi du formulaire de renvoi.
  if (resendForm) {
    resendForm.addEventListener('submit', () => {
      if (resendButton) resendButton.disabled = true;
      clearInterval(timer);
    });
  }
})();
