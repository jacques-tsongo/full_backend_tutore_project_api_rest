const $ = (selector, scope = document) => scope.querySelector(selector);
const $$ = (selector, scope = document) => Array.from(scope.querySelectorAll(selector));

const escapeHtml = (value = '') => String(value)
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;')
  .replaceAll("'", '&#039;');

const toast = (message, type = 'info') => {
  const old = $('.toast');
  if (old) old.remove();
  const node = document.createElement('div');
  node.className = `toast ${type}`;
  node.textContent = message;
  document.body.appendChild(node);
  setTimeout(() => node.remove(), 4200);
};

const formatDate = (value) => value ? new Date(value).toLocaleDateString() : '-';
const statusBadge = (value = '') => {
  const v = String(value);
  const cls = ['approved', 'Validée', 'Acceptée', 'Ouverte'].includes(v) ? 'success'
    : ['rejected', 'Rejetée', 'Refusée', 'Suspendue'].includes(v) ? 'danger'
    : 'warning';
  return `<span class="badge ${cls}">${escapeHtml(v || '-')}</span>`;
};

const skeleton = (count = 3) => Array.from({ length: count }, () => '<div class="skeleton"></div>').join('');
