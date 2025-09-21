// Central API configuration for the frontend
// Exposes a global `API_URL` and provides a helper `fetchWithAuth`.

// Base API path — adjust as needed in different environments
const API_URL = window.API_URL || 'https://backend-rxe4.onrender.com/api';
window.API_URL = API_URL;

// Default fetch options used by app requests
const defaultFetchOptions = {
  headers: {
    'Content-Type': 'application/json',
    'Accept': 'application/json'
  }
};

// Health check at startup to give early feedback
(async function runHealthCheck() {
  try {
    // derive backend base (strip trailing /api if present)
    const base = (API_URL && API_URL.endsWith('/api')) ? API_URL.slice(0, -4) : API_URL || '';
    const res = await fetch(`${base}/health`, { method: 'GET' });
    if (!res.ok) return console.warn('[config] backend health check failed', res.status);
    const data = await res.json();
    console.log('[config] backend reachable — health:', data);
  } catch (err) {
    console.warn('[config] backend not reachable for health check', err.message);
  }
})();

// Helper: fetch requests with a simple auth strategy
// - If sessionStorage contains `workline_token`, use Authorization: Bearer <token>
// - Otherwise, perform request without Authorization (caller may use credentials if desired)
async function fetchWithAuth(input, options = {}) {
  const merged = {
    ...defaultFetchOptions,
    ...options,
    headers: {
      ...defaultFetchOptions.headers,
      ...(options.headers || {})
    }
  };

  // Normalize URL: if it's a relative path not starting with /api or http, prepend API_URL
  let url = input;
  if (typeof input === 'string') {
    if (!input.startsWith('http') && !input.startsWith('/api')) {
      url = `${API_URL}${input.startsWith('/') ? '' : '/'}${input}`;
    }
  }

  // If we have a stored JWT, add Authorization header
  const token = sessionStorage.getItem('workline_token');
  if (token) merged.headers['Authorization'] = `Bearer ${token}`;

  // By default do not include credentials; callers can pass credentials: 'include' if they need cookies
  try {
    const resp = await fetch(url, merged);

    // If 401 and we have a token, remove it (it might be invalid) then return the response so callers can handle it
    if (resp.status === 401 && token) {
      sessionStorage.removeItem('workline_token');
      console.warn('[config] token rejected by server, removed token from sessionStorage');
    }

    return resp;
  } catch (err) {
    console.error('[config] fetch error', err);
    throw err;
  }
}

// Expose helper globally for the existing codebase
window.fetchWithAuth = fetchWithAuth;
