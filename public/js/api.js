// Small API helper to talk to the mock server
(function () {
  // prefer explicit API_URL, then legacy __MOCK_API_BASE__, then localhost
  const API_URL = window.API_URL || window.__MOCK_API_BASE__ || 'http://localhost:5000/api';

  async function safeJson(res) {
    try { return await res.json(); } catch (e) { return null; }
  }

  async function login(email, password) {
    const res = await fetch(API_URL + '/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password })
    });
    if (!res.ok) {
      const j = await safeJson(res);
      throw new Error((j && (j.error || j.message)) || `Login failed (${res.status})`);
    }
    const json = await res.json();
    // persist token if present
    try{ if (json && json.token) sessionStorage.setItem('workline_token', json.token); }catch(e){}
    return json;
  }

  async function markAttendance(payload = {}) {
    const token = sessionStorage.getItem('workline_token');
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = 'Bearer ' + token;

    const res = await fetch(API_URL + '/attendance', {
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

  async function checkin(payload = {}) {
    const token = sessionStorage.getItem('workline_token');
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = 'Bearer ' + token;

    const res = await fetch(API_URL + '/attendance/checkin', {
      method: 'POST',
      headers,
      body: JSON.stringify(payload)
    });

    if (!res.ok) {
      const j = await safeJson(res);
      throw new Error((j && (j.error || j.message)) || `Checkin failed (${res.status})`);
    }
    return res.json();
  }

  // expose
  window.AppApi = Object.assign(window.AppApi || {}, { login, markAttendance, checkin });
})();
