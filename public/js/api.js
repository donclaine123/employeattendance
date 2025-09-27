// Small API helper to talk to the mock server
(function () {
  // Use API_URL from config.js, ignore legacy __MOCK_API_BASE__ to avoid old cached URLs
  const API_URL = window.API_URL || 'http://localhost:5000/api';

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

  async function getEmployeeData(email) {
      const token = sessionStorage.getItem('workline_token');
      const headers = { 'Content-Type': 'application/json' };
      if (token) headers['Authorization'] = 'Bearer ' + token;
      const res = await fetch(`${API_URL}/employee/by-email?email=${encodeURIComponent(email)}`, { headers });
      if (!res.ok) {
          const j = await safeJson(res);
          throw new Error((j && (j.error || j.message)) || `Get employee failed (${res.status})`);
      }
      return res.json();
  }

  async function getAttendanceHistory(params = {}) {
      const token = sessionStorage.getItem('workline_token');
      const headers = { 'Content-Type': 'application/json' };
      if (token) headers['Authorization'] = 'Bearer ' + token;
      const url = new URL(`${API_URL}/attendance/history`);
      if (params.employee) url.searchParams.set('employee', params.employee);
      if (params.start) url.searchParams.set('start', params.start);
      if (params.end) url.searchParams.set('end', params.end);
      const res = await fetch(url.toString(), { headers });
      if (!res.ok) {
          const j = await safeJson(res);
          throw new Error((j && (j.error || j.message)) || `Get history failed (${res.status})`);
      }
      return res.json();
  }

  async function createRequest(payload) {
      const token = sessionStorage.getItem('workline_token');
      const headers = { 'Content-Type': 'application/json' };
      if (token) headers['Authorization'] = 'Bearer ' + token;
      const res = await fetch(`${API_URL}/requests`, { method: 'POST', headers, body: JSON.stringify(payload) });
      if (!res.ok) {
          const j = await safeJson(res);
          throw new Error((j && (j.error || j.message)) || `Request creation failed (${res.status})`);
      }
      return res.json();
  }

  async function getRequests(params = {}) {
      const token = sessionStorage.getItem('workline_token');
      const headers = { 'Content-Type': 'application/json' };
      if (token) headers['Authorization'] = 'Bearer ' + token;
      const url = new URL(`${API_URL}/requests`);
      if (params.status) url.searchParams.set('status', params.status);
      if (params.type) url.searchParams.set('type', params.type);
      const res = await fetch(url.toString(), { headers });
      if (!res.ok) {
          const j = await safeJson(res);
          throw new Error((j && (j.error || j.message)) || `Get requests failed (${res.status})`);
      }
      return res.json();
  }

  async function logout() {
      const token = sessionStorage.getItem('workline_token');
      const headers = { 'Content-Type': 'application/json' };
      if (token) headers['Authorization'] = 'Bearer ' + token;
      const res = await fetch(API_URL + '/logout', { method: 'POST', headers });
      if (!res.ok) {
          const j = await safeJson(res);
          // Don't throw error on logout failure, just log it
          console.warn('Logout API call failed:', (j && (j.error || j.message)) || `Status ${res.status}`);
      }
      return res.ok;
  }

  async function getNotifications() {
    const token = sessionStorage.getItem('workline_token');
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = 'Bearer ' + token;

    const res = await fetch(API_URL + '/notifications', { headers });
    if (!res.ok) {
      const j = await safeJson(res);
      throw new Error((j && (j.error || j.message)) || `Get notifications failed (${res.status})`);
    }
    return res.json();
  }

  async function markNotificationsRead(notificationIds) {
    const token = sessionStorage.getItem('workline_token');
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = 'Bearer ' + token;

    const res = await fetch(API_URL + '/notifications/mark-read', {
      method: 'PUT',
      headers,
      body: JSON.stringify({ ids: notificationIds })
    });

    if (!res.ok) {
      const j = await safeJson(res);
      throw new Error((j && (j.error || j.message)) || `Mark notifications read failed (${res.status})`);
    }
    return res.json();
  }

  async function changePassword(oldPassword, newPassword) {
    // Support both signatures: changePassword(obj) or changePassword(oldPass, newPass)
    let currentPassword = null;
    let nextPassword = null;
    if (typeof oldPassword === 'object' && oldPassword !== null) {
      currentPassword = oldPassword.currentPassword || oldPassword.oldPassword || oldPassword.current_password;
      nextPassword = oldPassword.newPassword || oldPassword.new_password || oldPassword.newPassword;
    } else {
      currentPassword = oldPassword;
      nextPassword = newPassword;
    }

    const token = sessionStorage.getItem('workline_token');
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = 'Bearer ' + token;

    const payload = { currentPassword: currentPassword, newPassword: nextPassword };

    const res = await fetch(API_URL + '/account/password', {
      method: 'PUT',
      headers,
      body: JSON.stringify(payload)
    });

    if (!res.ok) {
      const j = await safeJson(res);
      throw new Error((j && (j.error || j.message)) || `Change password failed (${res.status})`);
    }
    return res.json();
  }

  async function apiFetch(endpoint, options = {}) {
    const token = sessionStorage.getItem('workline_token');
    const headers = { 'Content-Type': 'application/json', ...options.headers };
    if (token) headers['Authorization'] = 'Bearer ' + token;

    const config = {
      ...options,
      headers
    };

    const res = await fetch(API_URL + endpoint, config);
    
    if (!res.ok) {
      const j = await safeJson(res);
      throw new Error((j && (j.error || j.message)) || `Request failed (${res.status})`);
    }
    
    return await res.json();
  }

  // expose
  window.AppApi = Object.assign(window.AppApi || {}, { 
      login, 
      logout,
      markAttendance, 
      checkin, 
      getEmployeeData, 
      getAttendanceHistory,
      createRequest,
      getRequests,
      getNotifications,
      markNotificationsRead,
      changePassword,
      apiFetch
    });
})();
