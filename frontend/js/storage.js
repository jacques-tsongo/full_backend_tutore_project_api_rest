const Storage = {
  tokenKey: 'gc_token',
  userKey: 'gc_user',
  themeKey: 'gc_theme',
  getToken() { return localStorage.getItem(this.tokenKey); },
  setSession(token, user) {
    localStorage.setItem(this.tokenKey, token);
    localStorage.setItem(this.userKey, JSON.stringify(user || {}));
  },
  getUser() {
    try { return JSON.parse(localStorage.getItem(this.userKey) || 'null'); }
    catch (_) { return null; }
  },
  setUser(user) { localStorage.setItem(this.userKey, JSON.stringify(user || {})); },
  clear() {
    localStorage.removeItem(this.tokenKey);
    localStorage.removeItem(this.userKey);
  }
};
