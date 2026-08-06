const API = {
  base: '/api',
  async request(path, options = {}) {
    const headers = options.headers ? { ...options.headers } : {};
    const token = Storage.getToken();
    if (token) headers.Authorization = `Bearer ${token}`;
    if (options.body && !(options.body instanceof FormData)) headers['Content-Type'] = 'application/json';
    const response = await fetch(`${this.base}${path}`, { ...options, headers });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || payload.success === false) throw new Error(payload.message || 'Erreur API');
    return payload.data || {};
  },
  get(path) { return this.request(path); },
  post(path, body) { return this.request(path, { method: 'POST', body: body instanceof FormData ? body : JSON.stringify(body || {}) }); },
  put(path, body) { return this.request(path, { method: 'PUT', body: JSON.stringify(body || {}) }); },
  patch(path, body) { return this.request(path, { method: 'PATCH', body: JSON.stringify(body || {}) }); },
  delete(path) { return this.request(path, { method: 'DELETE' }); },
  upload(path, formData, onProgress) {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('POST', `${this.base}${path}`);
      const token = Storage.getToken();
      if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`);
      xhr.upload.onprogress = (event) => {
        if (event.lengthComputable && onProgress) onProgress(Math.round((event.loaded / event.total) * 100));
      };
      xhr.onload = () => {
        const payload = JSON.parse(xhr.responseText || '{}');
        if (xhr.status >= 200 && xhr.status < 300 && payload.success !== false) resolve(payload.data || {});
        else reject(new Error(payload.message || 'Upload impossible'));
      };
      xhr.onerror = () => reject(new Error('Connexion interrompue'));
      xhr.send(formData);
    });
  }
};
