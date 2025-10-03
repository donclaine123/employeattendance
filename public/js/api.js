// API helper for session-based authentication (cookie-based, no JWTs)
(function () {
  // prefer explicit API_URL, then legacy __MOCK_API_BASE__, then localhost
  const API_URL = window.API_URL || window.__MOCK_API_BASE__ || 'http://localhost:5000/api';

  async function safeJson(res) {
    try { return await res.json(); } catch (e) { return null; }
  }

  // Helper to create fetch options with credentials
  function createFetchOptions(options = {}) {
    return {
      ...options,
      credentials: 'include', // Always send cookies
      headers: {
        'Content-Type': 'application/json',
        ...options.headers
      }
    };
  }

  async function login(email, password) {
    const res = await fetch(API_URL + '/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include', // IMPORTANT: Send and receive cookies
      body: JSON.stringify({ email, password })
    });
    if (!res.ok) {
      const j = await safeJson(res);
      throw new Error((j && (j.error || j.message)) || `Login failed (${res.status})`);
    }
    const json = await res.json();
    // Session cookie is now set automatically by the server - no need to store token
    // Remove any old tokens from sessionStorage
    try { sessionStorage.removeItem('workline_token'); } catch(e) {}
    return json;
  }

  async function markAttendance(payload = {}) {
    const headers = { 'Content-Type': 'application/json' };
    // Session cookie is sent automatically with credentials: 'include'

    const res = await fetch(API_URL + '/attendance', {
      method: 'POST',
      headers,
      credentials: 'include', // Send session cookie
      body: JSON.stringify(payload)
    });

    if (!res.ok) {
      const j = await safeJson(res);
      throw new Error((j && (j.error || j.message)) || `Attendance failed (${res.status})`);
    }
    return res.json();
  }

  async function checkin(payload = {}) {
    const res = await fetch(API_URL + '/attendance/checkin', createFetchOptions({
      method: 'POST',
      body: JSON.stringify(payload)
    }));

    if (!res.ok) {
      const j = await safeJson(res);
      throw new Error((j && (j.error || j.message)) || `Checkin failed (${res.status})`);
    }
    return res.json();
  }

  async function getEmployeeData(email) {
      const res = await fetch(
        `${API_URL}/employee/by-email?email=${encodeURIComponent(email)}`, 
        createFetchOptions()
      );
      if (!res.ok) {
          const j = await safeJson(res);
          throw new Error((j && (j.error || j.message)) || `Get employee failed (${res.status})`);
      }
      return res.json();
  }

  async function getAttendanceHistory(params = {}) {
      const url = new URL(`${API_URL}/attendance/history`);
      if (params.employee) url.searchParams.set('employee', params.employee);
      if (params.start) url.searchParams.set('start', params.start);
      if (params.end) url.searchParams.set('end', params.end);
      const res = await fetch(url.toString(), createFetchOptions());
      if (!res.ok) {
          const j = await safeJson(res);
          throw new Error((j && (j.error || j.message)) || `Get history failed (${res.status})`);
      }
      return res.json();
  }

  async function createRequest(payload) {
      const res = await fetch(`${API_URL}/requests`, createFetchOptions({
        method: 'POST',
        body: JSON.stringify(payload)
      }));
      if (!res.ok) {
          const j = await safeJson(res);
          throw new Error((j && (j.error || j.message)) || `Request creation failed (${res.status})`);
      }
      return res.json();
  }

  async function getRequests(params = {}) {
      const url = new URL(`${API_URL}/requests`);
      if (params.status) url.searchParams.set('status', params.status);
      if (params.type) url.searchParams.set('type', params.type);
      const res = await fetch(url.toString(), createFetchOptions());
      if (!res.ok) {
          const j = await safeJson(res);
          throw new Error((j && (j.error || j.message)) || `Get requests failed (${res.status})`);
      }
      return res.json();
  }

  async function logout() {
      try {
        const res = await fetch(API_URL + '/auth/logout', createFetchOptions({ method: 'POST' }));
        if (!res.ok) {
            const j = await safeJson(res);
            console.warn('Logout API call failed:', (j && (j.error || j.message)) || `Status ${res.status}`);
        }
        // Clean up any old tokens from sessionStorage (migration cleanup)
        try { 
          sessionStorage.removeItem('workline_token');
          sessionStorage.removeItem('workline_user'); 
        } catch(e) {}
        
        // Clear profile cache
        if (window.clearProfileCache) window.clearProfileCache();
        
        // Redirect to login
        window.location.href = '/index.html';
        
        return res.ok;
      } catch (error) {
        console.error('[api] Logout error:', error);
        // Still redirect even if request fails
        window.location.href = '/index.html';
        return false;
      }
  }

  async function getNotifications() {
    const res = await fetch(API_URL + '/notifications', createFetchOptions());
    if (!res.ok) {
      const j = await safeJson(res);
      throw new Error((j && (j.error || j.message)) || `Get notifications failed (${res.status})`);
    }
    return res.json();
  }

  async function markNotificationsRead(notificationIds) {
    const res = await fetch(API_URL + '/notifications/mark-read', createFetchOptions({
      method: 'PUT',
      body: JSON.stringify({ ids: notificationIds })
    }));

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

    const payload = { currentPassword: currentPassword, newPassword: nextPassword };
    const res = await fetch(API_URL + '/account/password', createFetchOptions({
      method: 'PUT',
      body: JSON.stringify(payload)
    }));

    if (!res.ok) {
      const j = await safeJson(res);
      throw new Error((j && (j.error || j.message)) || `Change password failed (${res.status})`);
    }
    return res.json();
  }

  // Generic fetch wrapper for authenticated requests
  async function apiFetch(endpoint, options = {}) {
    const res = await fetch(API_URL + endpoint, createFetchOptions(options));
    
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
