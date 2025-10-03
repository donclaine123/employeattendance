// Central API configuration for the frontend
// Exposes a global `API_URL` and provides a helper `fetchWithAuth`.

// Base API path — adjust as needed in different environments
// Use var to avoid "already declared" errors if loaded multiple times
if (!window.API_URL) {
  // Use relative URL for same-origin deployment (works for both local and production)
  // This allows cookies to work properly since frontend and backend are on same domain
  window.API_URL = '/api';
  
  // Alternative: Explicitly set based on environment
  // window.API_URL = window.location.origin + '/api';
}

if (!window.API_BASE_URL) {
  // Use current origin (works for both local and production)
  window.API_BASE_URL = window.location.origin;
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

// Helper: fetch requests using session-based authentication
// Session cookie is sent automatically with credentials: 'include'
// No need for Authorization headers - cookies handle authentication
async function fetchWithAuth(input, options = {}) {
  const merged = {
    ...defaultFetchOptions,
    ...options,
    credentials: 'include', // IMPORTANT: Always send cookies for session-based auth
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

  // Clean up old JWT tokens from sessionStorage (migration cleanup)
  try {
    if (sessionStorage.getItem('workline_token')) {
      sessionStorage.removeItem('workline_token');
    }
  } catch(e) {}

  try {
    const resp = await fetch(url, merged);

    // If 401, session has expired - redirect to login
    if (resp.status === 401) {
      console.warn('[config] session expired or not authenticated');
      // Clear any old storage
      try {
        sessionStorage.removeItem('workline_token');
        sessionStorage.removeItem('workline_user');
      } catch(e) {}
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

