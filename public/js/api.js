// Small API helper to talk to the mock server
(function () {
  const baseUrl = window.__MOCK_API_BASE__ || '/api';

  async function safeJson(res) {
    try { return await res.json(); } catch (e) { return null; }
  }

  async function login(email, password) {
    const res = await fetch(baseUrl + '/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password })
    });
    if (!res.ok) {
      const j = await safeJson(res);
      throw new Error((j && (j.error || j.message)) || `Login failed (${res.status})`);
    }
    return res.json();
  }

  async function markAttendance(payload = {}) {
    const token = sessionStorage.getItem('workline_token');
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = 'Bearer ' + token;

    const res = await fetch(baseUrl + '/attendance', {
      method: 'POST',
      headers,
      body: JSON.stringify(payload)
    });

    if (!res.ok) {
      const j = await safeJson(res);
      throw new Error((j && (j.error || j.message)) || `Attendance failed (${res.status})`);
    }
    return res.json();
  }

  // expose
  window.AppApi = Object.assign(window.AppApi || {}, { login, markAttendance });
})();
