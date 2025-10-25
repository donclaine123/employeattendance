// Central API configuration for the frontend
// Exposes a global `API_URL` and provides a helper `fetchWithAuth`.

// Base API path — adjust as needed in different environments
// Use var to avoid "already declared" errors if loaded multiple times
if (!window.API_URL) {
  // Auto-detect environment based on current hostname
  const hostname = window.location.hostname;
  const isLocalhost = hostname === 'localhost' || hostname === '127.0.0.1';
  const isDeployed = hostname === 'employeeattendance.me' || hostname.includes('onrender.com');
  
  if (isLocalhost) {
    // Local development: use local backend
    window.API_URL = 'http://localhost:5000/api';
  } else if (isDeployed) {
    // Production deployment: use deployed backend
    window.API_URL = 'https://backend-rxe4.onrender.com/api';
  } else {
    // Fallback for other environments
    window.API_URL = 'http://localhost:5000/api';
  }
  
  console.log('[config] Environment detected - hostname:', hostname, '-> API_URL:', window.API_URL);
}


// Default fetch options used by app requests
const defaultFetchOptions = {
  headers: {
    'Content-Type': 'application/json',
    'Accept': 'application/json'
  }
};


// Health check at startup to give early feedback
// DISABLED: This was causing race conditions with profile fetches
window._healthCheckPromise = (async function runHealthCheck() {
  try {
    const base = (window.API_URL && window.API_URL.endsWith('/api')) ? window.API_URL.slice(0, -4) : window.API_URL || '';
    const res = await fetch(`${base}/health`, { method: 'GET', credentials: 'include' });
    if (!res.ok) {
      console.warn('[config] backend health check failed', res.status);
      return false;
    }
    const data = await res.json();
    console.log('[config] backend reachable — health:', data);
    return true;
  } catch (err) {
    console.warn('[config] backend not reachable for health check', err.message);
    return false;
  }
})();

// Global refresh lock to prevent concurrent refresh attempts
let _refreshPromise = null;

// Helper: fetch requests with cookie-based authentication
// Cookies are sent automatically with credentials: 'include'
// Automatically handles token refresh on 401 errors
async function fetchWithAuth(input, options = {}) {
  const merged = {
    ...defaultFetchOptions,
    ...options,
    credentials: 'include', // IMPORTANT: Send cookies with every request
    headers: {
      ...defaultFetchOptions.headers,
      ...(options.headers || {})
    }
  };

  // Normalize URL: convert relative paths to full backend URL
  let url = input;
  if (typeof input === 'string') {
    if (!input.startsWith('http')) {
      // If it's a relative path (doesn't start with http):
      // - If it starts with /api, prepend just the domain part of API_URL (remove /api)
      // - Otherwise, prepend the full API_URL
      if (input.startsWith('/api')) {
        const backendDomain = window.API_URL.replace('/api', '');
        url = backendDomain + input;
        console.log('[config.fetchWithAuth] /api path detected - constructing full URL:', { input, API_URL: window.API_URL, backendDomain, finalUrl: url });
      } else {
        url = `${window.API_URL}${input.startsWith('/') ? '' : '/'}${input}`;
        console.log('[config.fetchWithAuth] Non-/api path - using API_URL:', { input, API_URL: window.API_URL, finalUrl: url });
      }
    } else {
      console.log('[config.fetchWithAuth] Full HTTP URL - no normalization:', { input });
    }
  }

  // NO LONGER USE sessionStorage token - cookies handle authentication automatically

  try {
    const resp = await fetch(url, merged);

    // If 401, check if session was terminated or just expired
    if (resp.status === 401) {
      // Check if this is a forced logout by admin
      try {
        const errorData = await resp.clone().json();
        if (errorData.error === 'Session terminated' || errorData.message?.includes('terminated by an administrator')) {
          console.error('[config] Session terminated by administrator - forcing logout');
          if (window.clearProfileCache) window.clearProfileCache();
          alert('Your session has been terminated by an administrator. Please log in again.');
          const currentPath = window.location.pathname;
          const isInPagesFolder = currentPath.includes('/pages/');
          const loginPath = isInPagesFolder ? '../index.html' : './index.html';
          window.location.href = loginPath;
          throw new Error('Session terminated by administrator');
        }
      } catch (parseErr) {
        // If we can't parse the response, continue with normal token refresh flow
        console.log('[config] Could not parse 401 response, continuing with refresh flow');
      }

      console.warn('[config] Access token expired or invalid — handling token refresh');

      // If a refresh is already in progress, wait for it instead of starting a new one
      if (_refreshPromise) {
        console.log('[config] Refresh already in progress, waiting...');
        try {
          await _refreshPromise;
          console.log('[config] Existing refresh completed, retrying original request');
          return fetch(url, merged);
        } catch (refreshError) {
          console.error('[config] Existing refresh failed');
          throw refreshError;
        }
      }

      // Start a new refresh process
      _refreshPromise = (async () => {
        try {
          // Show session-expired modal and await user decision
          const userChoice = await showSessionExpiredModal(); // 'continue' or 'logout'

          if (userChoice === 'logout') {
            // Clear and redirect to login
            if (window.clearProfileCache) window.clearProfileCache();
            const currentPath = window.location.pathname;
            const isInPagesFolder = currentPath.includes('/pages/');
            const loginPath = isInPagesFolder ? '../index.html' : './index.html';
            window.location.href = loginPath;
            throw new Error('Session expired - user logged out');
          }

          // If user chose to continue, attempt refresh
          const refreshResp = await fetch(`${window.API_URL}/auth/refresh`, {
            method: 'POST',
            credentials: 'include'
          });

          if (refreshResp.ok) {
            console.log('[config] Token refreshed successfully');
            return true;
          } else {
            console.warn('[config] Token refresh failed after user continue, redirecting to login');
            if (window.clearProfileCache) window.clearProfileCache();
            const currentPath = window.location.pathname;
            const isInPagesFolder = currentPath.includes('/pages/');
            const loginPath = isInPagesFolder ? '../index.html' : './index.html';
            window.location.href = loginPath;
            throw new Error('Session expired');
          }
        } finally {
          _refreshPromise = null; // Clear the lock
        }
      })();

      // Wait for refresh to complete
      await _refreshPromise;
      
      // Retry the original request with new access token
      // IMPORTANT: Create a fresh options object because the body stream may have been consumed
      console.log('[config] Retrying original request after refresh');
      const retryOptions = {
        ...options,
        credentials: 'include',
        headers: {
          ...defaultFetchOptions.headers,
          ...(options.headers || {})
        }
      };
      return fetch(url, retryOptions);
    }

    return resp;
  } catch (err) {
    console.error('[config] fetch error', err);
    throw err;
  }
}

// Expose helper globally for the existing codebase
window.fetchWithAuth = fetchWithAuth;

// --- Session expired modal helper ---
let _sessionModalPromise = null;
function showSessionExpiredModal() {
  // Prevent multiple modals
  if (_sessionModalPromise) return _sessionModalPromise;

  _sessionModalPromise = new Promise((resolve) => {
    // Create modal container if not present
    let modal = document.getElementById('session-expired-modal');
    if (!modal) {
      modal = document.createElement('div');
      modal.id = 'session-expired-modal';
      modal.innerHTML = `
        <div class="se-overlay">
          <div class="se-box">
            <h2>Session expired</h2>
            <p>Your session has expired. You can continue your session (attempt token refresh) or logout.</p>
            <div class="se-actions">
              <button id="se-continue" class="se-btn se-continue">Continue session</button>
              <button id="se-logout" class="se-btn se-logout">Logout</button>
            </div>
          </div>
        </div>
      `;
      document.body.appendChild(modal);

      // basic styles (kept minimal)
      const style = document.createElement('style');
      style.id = 'session-expired-modal-style';
      style.innerHTML = `
        #session-expired-modal .se-overlay{position:fixed;inset:0;background:rgba(0,0,0,0.45);display:flex;align-items:center;justify-content:center;z-index:9999}
        #session-expired-modal .se-box{background:#fff;padding:20px;border-radius:8px;max-width:420px;text-align:center;box-shadow:0 6px 30px rgba(0,0,0,0.2)}
        #session-expired-modal .se-actions{margin-top:16px;display:flex;gap:8px;justify-content:center}
        #session-expired-modal .se-btn{padding:8px 12px;border-radius:4px;border:0;cursor:pointer}
        #session-expired-modal .se-continue{background:#2ecc71;color:#fff}
        #session-expired-modal .se-logout{background:#e74c3c;color:#fff}
      `;
      document.head.appendChild(style);
    }

    // Wire buttons
    const cont = document.getElementById('se-continue');
    const out = document.getElementById('se-logout');

    function cleanup() {
      if (modal) modal.style.display = 'none';
      _sessionModalPromise = null;
      if (cont) cont.onclick = null;
      if (out) out.onclick = null;
    }

    // Show modal
    modal.style.display = 'block';

    if (cont) cont.onclick = () => { cleanup(); resolve('continue'); };
    if (out) out.onclick = () => { cleanup(); resolve('logout'); };
  });

  return _sessionModalPromise;
}

// Helper: fetch current user profile from server (replaces sessionStorage.workline_user)
// Returns the authoritative profile or null on error
// Cache the profile for 30 seconds to avoid excessive API calls
let profileCache = null;
let profileCacheTime = 0;
const PROFILE_CACHE_MS = 30000; // 30 seconds

async function fetchUserProfile(forceRefresh = false) {
  // Return cached profile if still valid
  if (!forceRefresh && profileCache && (Date.now() - profileCacheTime < PROFILE_CACHE_MS)) {
    console.log('[config] Returning cached profile');
    return profileCache;
  }

  try {
    console.log('[config] Fetching profile from /auth/profile');
    const resp = await fetchWithAuth('/auth/profile');
    console.log('[config] Profile response received:', resp ? resp.status : 'null response', 'ok:', resp?.ok);
    if (resp && resp.ok) {
      profileCache = await resp.json();
      console.log('[config] Profile parsed successfully:', profileCache);
      profileCacheTime = Date.now();
      return profileCache;
    } else {
      console.warn('[config] Failed to fetch profile:', resp ? resp.status : 'no response');
      profileCache = null;
      return null;
    }
  } catch (err) {
    console.error('[config] Error fetching profile:', err);
    profileCache = null;
    return null;
  }
}

// Clear profile cache (call on logout)
function clearProfileCache() {
  profileCache = null;
  profileCacheTime = 0;
}

// Session validation: Check if session is still active (detects force logout by admin or new login from same account)
let sessionCheckInterval = null;
const SESSION_CHECK_INTERVAL_MS = 10000; // Check every 10 seconds

function startSessionValidation() {
  // Don't start if already running
  if (sessionCheckInterval) return;
  
  console.log('[config] Starting session validation checks (every 10 seconds)');
  
  sessionCheckInterval = setInterval(async () => {
    try {
      // Make a lightweight request to check session validity
      const resp = await fetch(`${window.API_URL}/auth/session-check`, {
        credentials: 'include'
      });
      
      if (resp.status === 401) {
        // Session is invalid - get error details
        try {
          const errorData = await resp.json();
          stopSessionValidation();
          clearProfileCache();
          
          // Provide specific error messages
          if (errorData.error === 'Invalid token format') {
            alert('Your session token is invalid. You will be redirected to the login page.\n\nNote: If you recently logged in from another location or device, your session may have been replaced.');
          } else if (errorData.error === 'Session terminated') {
            alert('Your session has been terminated. This may have happened if:\n\n1. You logged in from another browser/device\n2. An administrator terminated your session\n3. Your session expired\n\nYou will be redirected to the login page.');
          } else if (errorData.message?.includes('terminated by an administrator')) {
            alert('Your session has been terminated by an administrator. You will be redirected to the login page.');
          } else {
            alert('Your session is no longer valid. You will be redirected to the login page.');
          }
          
          const currentPath = window.location.pathname;
          const isInPagesFolder = currentPath.includes('/pages/');
          const loginPath = isInPagesFolder ? '../index.html' : './index.html';
          window.location.href = loginPath;
        } catch (parseErr) {
          // If we can't parse the error, just redirect anyway since it's 401
          console.error('[config] Session invalid (401) - redirecting to login');
          stopSessionValidation();
          clearProfileCache();
          alert('Your session has expired. You will be redirected to the login page.');
          const currentPath = window.location.pathname;
          const isInPagesFolder = currentPath.includes('/pages/');
          const loginPath = isInPagesFolder ? '../index.html' : './index.html';
          window.location.href = loginPath;
        }
      } else if (resp.ok) {
        // Session is valid - all good
        console.log('[config] Session validation check passed');
      }
    } catch (err) {
      console.warn('[config] Session validation check failed:', err.message);
      // Don't redirect on network errors - could be temporary
    }
  }, SESSION_CHECK_INTERVAL_MS);
}

function stopSessionValidation() {
  if (sessionCheckInterval) {
    console.log('[config] Stopping session validation checks');
    clearInterval(sessionCheckInterval);
    sessionCheckInterval = null;
  }
}

// Auto-start session validation when user is authenticated
// This will be called by auth-guard after successful authentication
function initSessionValidation() {
  // Only start on dashboard pages (not on login page)
  if (window.location.pathname.includes('/pages/')) {
    startSessionValidation();
  }
}

// Expose helpers globally
window.fetchUserProfile = fetchUserProfile;
window.clearProfileCache = clearProfileCache;
window.startSessionValidation = startSessionValidation;
window.stopSessionValidation = stopSessionValidation;
window.initSessionValidation = initSessionValidation;

