// Central API configuration for the frontend
// Exposes a global `API_URL` and provides a helper `fetchWithAuth`.

// Base API path — adjust as needed in different environments
// Use var to avoid "already declared" errors if loaded multiple times
if (!window.API_URL) {
  // ============================================================
  // PHASE 5: Frontend Config Caching for DNS-01 Support
  // ============================================================
  // 
  // Session-scoped caching prevents hostname re-detection issues
  // during DNS-01 challenge setup when TXT records are being
  // updated in Cloudflare. Cache is cleared on new browser session.
  //
  // Without caching: Each navigation re-detects hostname, which
  // could fail if DNS TXT records are temporarily inconsistent.
  //
  // With caching: First page load detects → cached in sessionStorage
  // → subsequent requests use cached value → DNS-01 challenge safe.
  // ============================================================
  
  // Check if API_URL is already cached in sessionStorage
  const cachedApiUrl = sessionStorage.getItem('API_BASE_URL');
  const cachedHostname = sessionStorage.getItem('API_BASE_HOSTNAME');
  const currentHostname = window.location.hostname;
  
  if (cachedApiUrl && cachedHostname === currentHostname) {
    // Use cached value only if we're on same hostname (prevents stale cache across domain switches)
    window.API_URL = cachedApiUrl;
    console.log('[config] Using cached API_URL from sessionStorage:', window.API_URL);
  } else {
    // First page load or domain changed: detect environment and cache it
    
    // Auto-detect environment based on current hostname
    const hostname = window.location.hostname;
    const protocol = window.location.protocol; // 'http:' or 'https:'
    const isLocalhost = hostname === 'localhost' || hostname === '127.0.0.1';
    const isOnRender = hostname.includes('onrender.com');
    const isCustomDomain = hostname === 'employeeattendance.me';
    const isProductionDomain = isCustomDomain || hostname === 'www.employeeattendance.me';
    const isLocalIP = hostname.startsWith('192.168.') || hostname.startsWith('10.') || hostname.startsWith('172.');
    const isMDNS = hostname.endsWith('.local');
    const isLocalDomain = hostname.includes('local.') || hostname === 'local.attendance.me' || hostname === 'local.employeeattendance.me';

    window.QR_SCANNER_ENABLED = true;
    window.QR_SCANNER_DISABLED_REASON = '';
    
    if (isLocalhost) {
      // Local development: use current protocol (http or https)
      window.API_URL = `${protocol}//localhost:5000/api`;
    } else if (isLocalIP || isMDNS || isLocalDomain) {
      // Local network IP, mDNS (.local), or local domain: use current host with current protocol (Nginx reverse proxy)
      window.API_URL = `${window.location.protocol}//${window.location.host}/api`;
    } else if (isCustomDomain) {
      // Production deployment on custom domain: use HTTPS
      window.API_URL = 'https://employeeattendance.me/api';
    } else if (isOnRender) {
      // Direct Render deployment: use HTTPS Render backend
      window.API_URL = 'https://backend-rxe4.onrender.com/api';
    } else {
      // Fallback: use relative path for safety
      window.API_URL = '/api';
    }
    
    // Cache the detected URL in sessionStorage for stability during DNS transitions
    try {
      sessionStorage.setItem('API_BASE_URL', window.API_URL);
      sessionStorage.setItem('API_BASE_HOSTNAME', window.location.hostname);
      console.log('[config] API_URL detected and cached:', window.API_URL, 'for hostname:', window.location.hostname);
    } catch (e) {
      // If sessionStorage not available, silently continue
      console.warn('[config] sessionStorage not available:', e.message);
    }
  }
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
      return false;
    }
    const data = await res.json();
    return true;
  } catch (err) {
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
      } else {
        url = `${window.API_URL}${input.startsWith('/') ? '' : '/'}${input}`;
      }
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
      }

      // If a refresh is already in progress, wait for it instead of starting a new one
      if (_refreshPromise) {
        try {
          await _refreshPromise;
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
            return true;
          } else {
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
            <div class="se-icon">
              <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <circle cx="12" cy="12" r="10"></circle>
                <polyline points="12 6 12 12 16 14"></polyline>
              </svg>
            </div>
            <h2>Session Expired</h2>
            <p>Your session has expired. You can continue your session (attempt token refresh) or logout.</p>
            <div class="se-actions">
              <button id="se-continue" class="se-btn se-continue">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="margin-right: 6px;">
                  <path d="M5 12h14M12 5l7 7-7 7"></path>
                </svg>
                Continue session
              </button>
              <button id="se-logout" class="se-btn se-logout">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="margin-right: 6px;">
                  <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 3l7 7-7 7M20 10H9"></path>
                </svg>
                Logout
              </button>
            </div>
          </div>
        </div>
      `;
      document.body.appendChild(modal);

      // Enhanced styles using design variables
      const style = document.createElement('style');
      style.id = 'session-expired-modal-style';
      style.innerHTML = `
        #session-expired-modal .se-overlay {
          position: fixed;
          inset: 0;
          background: rgba(12, 15, 19, 0.6);
          backdrop-filter: blur(4px);
          display: flex;
          align-items: center;
          justify-content: center;
          z-index: 9999;
          animation: fadeIn 200ms ease-in-out;
        }
        
        #session-expired-modal .se-box {
          background: var(--bg-secondary, #14181F);
          border: 1px solid var(--border-primary, #2a3754);
          padding: 32px;
          border-radius: 12px;
          max-width: 420px;
          text-align: center;
          box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
          animation: slideUp 300ms ease-out;
        }
        
        #session-expired-modal .se-icon {
          width: 64px;
          height: 64px;
          margin: 0 auto 20px;
          display: flex;
          align-items: center;
          justify-content: center;
          background: var(--yellow-primary, #eab308);
          border-radius: 50%;
          color: #0C0F13;
        }
        
        #session-expired-modal .se-box h2 {
          margin: 0 0 12px 0;
          font-size: 20px;
          font-weight: 600;
          color: var(--text-primary, #f3f4f6);
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        }
        
        #session-expired-modal .se-box p {
          margin: 0 0 24px 0;
          font-size: 14px;
          color: var(--text-secondary, #9ca3af);
          line-height: 1.5;
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        }
        
        #session-expired-modal .se-actions {
          margin-top: 24px;
          display: flex;
          gap: 12px;
          justify-content: center;
          flex-wrap: wrap;
        }
        
        #session-expired-modal .se-btn {
          padding: 10px 18px;
          border-radius: 6px;
          border: 1px solid transparent;
          cursor: pointer;
          font-size: 14px;
          font-weight: 500;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          transition: all var(--transition-base, 200ms ease-in-out);
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
          min-width: 140px;
        }
        
        #session-expired-modal .se-continue {
          background: var(--green-primary, #16a34a);
          color: #fff;
          border-color: var(--green-primary, #16a34a);
        }
        
        #session-expired-modal .se-continue:hover {
          background: #15803d;
          box-shadow: 0 6px 20px rgba(22, 163, 74, 0.25);
          transform: translateY(-2px);
        }
        
        #session-expired-modal .se-continue:active {
          transform: translateY(0);
        }
        
        #session-expired-modal .se-logout {
          background: transparent;
          color: var(--red-primary, #dc2626);
          border-color: var(--red-primary, #dc2626);
        }
        
        #session-expired-modal .se-logout:hover {
          background: rgba(220, 38, 38, 0.1);
          border-color: var(--red-hover, #b91c1c);
          color: var(--red-hover, #b91c1c);
        }
        
        #session-expired-modal .se-logout:active {
          background: rgba(220, 38, 38, 0.2);
        }
        
        @keyframes fadeIn {
          from {
            opacity: 0;
          }
          to {
            opacity: 1;
          }
        }
        
        @keyframes slideUp {
          from {
            opacity: 0;
            transform: translateY(20px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }
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
    return profileCache;
  }

  try {
    const resp = await fetchWithAuth('/auth/profile');
    if (resp && resp.ok) {
      profileCache = await resp.json();
      profileCacheTime = Date.now();
      return profileCache;
    } else {
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
      }
    } catch (err) {
      // Don't redirect on network errors - could be temporary
    }
  }, SESSION_CHECK_INTERVAL_MS);
}

function stopSessionValidation() {
  if (sessionCheckInterval) {
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

