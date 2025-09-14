// Small API helper to talk to the mock server
(function () {
  // Base URL can be changed to 'http://localhost:4000/api' if serving mock server separately
  const baseUrl = window.__MOCK_API_BASE__ || '/api';

  async function login(email, password) {
    const res = await fetch(baseUrl + '/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password })
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || 'Login failed');
    }
    return res.json();
  }

  // expose
  window.AppApi = { login };
})();
