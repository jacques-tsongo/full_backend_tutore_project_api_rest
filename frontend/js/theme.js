const Theme = {
  init() {
    const theme = localStorage.getItem(Storage.themeKey) || 'light';
    document.documentElement.dataset.theme = theme;
    $$('[data-theme-toggle]').forEach((button) => button.addEventListener('click', () => this.toggle()));
  },
  toggle() {
    const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    localStorage.setItem(Storage.themeKey, next);
  }
};

document.addEventListener('DOMContentLoaded', () => Theme.init());
