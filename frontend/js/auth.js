const Auth = {
  user: null,
  async init() {
    this.user = Storage.getUser();
    if (Storage.getToken()) {
      try {
        const { user } = await API.get('/auth/me');
        this.user = user;
        Storage.setUser(user);
      } catch (_) {
        Storage.clear();
        this.user = null;
      }
    }
    this.renderNav();
  },
  requireAuth() {
    if (!Storage.getToken()) location.href = '/login.html';
  },
  requireRole(roles) {
    this.requireAuth();
    const user = Storage.getUser();
    if (user && !roles.includes(user.role)) location.href = this.dashboardPath(user.role);
  },
  dashboardFor(user = Storage.getUser()) {
    if (!user) return '/login.html';
    if (user.role === 'administrateur') return '/admin-dashboard.html';
    if (user.role === 'recruteur') return '/recruiter-dashboard.html';
    return '/candidate-dashboard.html';
  },
  dashboardPath(role) {
    if (role === 'administrateur') return '/admin-dashboard.html';
    if (role === 'recruteur') return '/recruiter-dashboard.html';
    return '/candidate-dashboard.html';
  },
  logout() {
    Storage.clear();
    location.href = '/login.html';
  },
  renderNav() {
    const user = Storage.getUser();
    $$('[data-user-name]').forEach((node) => { node.textContent = user ? `${user.prenom} ${user.nom}` : 'Invite'; });
    $$('[data-user-role]').forEach((node) => { node.textContent = user ? user.role : 'public'; });
    $$('[data-logout]').forEach((node) => node.addEventListener('click', () => this.logout()));
  }
};

document.addEventListener('DOMContentLoaded', () => Auth.init());
