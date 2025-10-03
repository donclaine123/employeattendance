// Central API configuration for the frontend
// Exposes a global `API_URL` and provides a helper `fetchWithAuth`.

// Base API path — adjust as needed in different environments
// Use var to avoid "already declared" errors if loaded multiple times
if (!window.API_URL) {
  // Deployed backend (commented out)
  window.API_URL = 'https://backend-rxe4.onrender.com/api';
  
  // Local backend (using deployed database)
  // window.API_URL = 'http://localhost:5000/api';
}


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
    const base = (window.API_URL && window.API_URL.endsWith('/api')) ? window.API_URL.slice(0, -4) : window.API_URL || '';
    const res = await fetch(`${base}/health`, { method: 'GET' });
    if (!res.ok) return console.warn('[config] backend health check failed', res.status);
    const data = await res.json();
    console.log('[config] backend reachable — health:', data);
  } catch (err) {
    console.warn('[config] backend not reachable for health check', err.message);
  }
})();

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

  // Normalize URL: if it's a relative path not starting with /api or http, prepend API_URL
  let url = input;
  if (typeof input === 'string') {
    if (!input.startsWith('http') && !input.startsWith('/api')) {
      url = `${window.API_URL}${input.startsWith('/') ? '' : '/'}${input}`;
    }
  }

  // NO LONGER USE sessionStorage token - cookies handle authentication automatically

  try {
    const resp = await fetch(url, merged);

    // If 401, try to refresh the access token
    if (resp.status === 401) {
      console.warn('[config] Access token expired or invalid, attempting refresh...');
      
      try {
        const refreshResp = await fetch(`${window.API_URL}/auth/refresh`, {
          method: 'POST',
          credentials: 'include'
        });

        if (refreshResp.ok) {
          console.log('[config] Token refreshed successfully, retrying original request');
          // Retry the original request with new access token (cookie was set automatically)
          return fetch(url, merged);
        } else {
          console.warn('[config] Token refresh failed, redirecting to login');
          // Clear any cached profile data
          if (window.clearProfileCache) window.clearProfileCache();
          // Redirect to login page - handle subdirectory paths
          const currentPath = window.location.pathname;
          const isInPagesFolder = currentPath.includes('/pages/');
          const loginPath = isInPagesFolder ? '../index.html' : './index.html';
          window.location.href = loginPath;
          throw new Error('Session expired');
        }
      } catch (refreshError) {
        console.error('[config] Error during token refresh:', refreshError);
        if (window.clearProfileCache) window.clearProfileCache();
        // Redirect to login page - handle subdirectory paths
        const currentPath = window.location.pathname;
        const isInPagesFolder = currentPath.includes('/pages/');
        const loginPath = isInPagesFolder ? '../index.html' : './index.html';
        window.location.href = loginPath;
        throw refreshError;
      }
    }

    return resp;
  } catch (err) {
    console.error('[config] fetch error', err);
    throw err;
  }
}

// Expose helper globally for the existing codebase
window.fetchWithAuth = fetchWithAuth;

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

// Expose helpers globally
window.fetchUserProfile = fetchUserProfile;
window.clearProfileCache = clearProfileCache;

