
/**
 * Shared Utility Functions for Department Head Dashboard
 */

export function escapeHtml(s) {
  return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function convertTo12Hour(time24) {
  if (!time24) return 'Unknown time';

  // Parse HH:MM:SS or HH:MM format
  const timeParts = time24.split(':');
  let hour = parseInt(timeParts[0], 10);
  const minute = timeParts[1] || '00';

  const ampm = hour >= 12 ? 'PM' : 'AM';
  hour = hour % 12 || 12; // Convert 0 to 12 for 12 AM

  // Format with leading zero for single-digit hours
  const hourStr = hour < 10 ? '0' + hour : hour;

  return `${hourStr}:${minute} ${ampm}`;
}

export async function fetchHeadInfo(forceRefresh = false) {
  try {
    const apiBase = window.API_URL || window.__MOCK_API_BASE__ || '/api';

    // Use global fetchUserProfile if available (defined in profile.js likely)
    // If we are modularizing strictly, we might want to import this too, but for now rely on window.
    if (typeof window.fetchUserProfile !== 'function') {
      console.warn('[fetchHeadInfo] window.fetchUserProfile is not defined');
      return null;
    }

    // Force refresh of profile cache to get latest data
    const user = await window.fetchUserProfile(forceRefresh);

    // Profiles may expose the email under different keys (email, username, user_email)
    let email = null;
    if (user) {
      email = user.email || user.username || user.user_email || (user.user && user.user.email) || null;
    }

    // If we don't have at least an email, we can't look up employee info
    if (!email) return null;

    const url = apiBase + '/employee/by-email?email=' + encodeURIComponent(email) + '&_t=' + Date.now();

    // Support cookie-based auth using fetchWithAuth (global)
    const r = await fetchWithAuth(url, {});

    if (!r.ok) {
      // treat 401/404 as 'not found / not authorized' and return null silently
      return null;
    }

    const res = await r.json();
    // Unwrap data if present (backend sends { success: true, data: { ... } })
    return res.data || res;
  } catch (e) {
    console.warn('[fetchHeadInfo] Error:', e);
    return null;
  }
}
