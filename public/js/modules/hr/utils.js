/**
 * utils.js
 * Shared utility functions for HR Dashboard
 */

/**
 * Normalize string (trim and lowercase)
 * @param {string} s 
 * @returns {string}
 */
export function normalize(s) {
  return (s || '').toString().trim().toLowerCase();
}

/**
 * Escape HTML characters
 * @param {string} s 
 * @returns {string}
 */
export function escapeHtml(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/**
 * Format date for display (Month DD, YYYY)
 * @param {string} dateStr 
 * @returns {string}
 */
export function formatDate(dateStr) {
  if (!dateStr || dateStr === 'Not specified') return 'Not specified';
  try {
    const date = new Date(dateStr);
    return date.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
  } catch {
    return 'Invalid date';
  }
}

/**
 * Format last login timestamp
 * @param {string} loginStr 
 * @returns {string}
 */
export function formatLastLogin(loginStr) {
  if (!loginStr || loginStr === 'Never') return 'Never';
  try {
    const date = new Date(loginStr);
    if (isNaN(date.getTime())) return 'Never';

    // Format: "9/23/2025, 12:28:47 PM"
    return date.toLocaleString('en-US', {
      month: 'numeric',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      second: '2-digit',
      hour12: true
    });
  } catch {
    return 'Never';
  }
}

/**
 * Map user role to display name
 * @param {string} role 
 * @returns {string}
 */
export function formatRoleDisplay(role) {
  if (!role) return 'Not specified';

  const roleMap = {
    'head_dept': 'Department Head',
    'employee': 'Employee',
    'superadmin': 'Super Admin',
    'hr': 'Attendance Monitoring Team'
  };

  return roleMap[role] || (role.charAt(0).toUpperCase() + role.slice(1));
}

/**
 * Debounce function to limit rate of execution
 * @param {Function} func 
 * @param {number} wait 
 * @returns {Function}
 */
export function debounce(func, wait) {
  let timeout;
  return function executedFunction(...args) {
    const later = () => {
      clearTimeout(timeout);
      func(...args);
    };
    clearTimeout(timeout);
    timeout = setTimeout(later, wait);
  };
}

/**
 * Authenticated Fetch Wrapper
 * Returns a raw Response object (unlike api.js which returns parsed JSON)
 * This maintains compatibility with the modularized code.
 * @param {string} endpoint 
 * @param {object} options 
 * @returns {Promise<Response>}
 */
export async function fetchWithAuth(endpoint, options = {}) {
  // Use global API_URL
  const apiBase = window.API_URL || '/api';

  // Ensure endpoint starts with / if not present
  let path = endpoint.startsWith('/') ? endpoint : `/${endpoint}`;

  // Prevent double /api prefix (e.g. /api/api/...)
  if (apiBase.endsWith('/api') && path.startsWith('/api/')) {
    path = path.substring(4); // Remove leading /api from path
  }


  const defaultHeaders = {
    'Content-Type': 'application/json'
  };

  // Merge options
  const config = {
    ...options,
    credentials: 'include', // Important for cookies
    headers: {
      ...defaultHeaders,
      ...options.headers
    }
  };

  return fetch(apiBase + path, config);
}

/**
 * Show global loading overlay
 */
export function showLoading() {
  let overlay = document.getElementById('globalLoadingOverlay');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'globalLoadingOverlay';
    overlay.className = 'loading-overlay';
    overlay.innerHTML = '<div class="spinner"></div>';
    document.body.appendChild(overlay);
  }
  overlay.style.display = 'flex';
}

/**
 * Hide global loading overlay
 */
export function hideLoading() {
  const overlay = document.getElementById('globalLoadingOverlay');
  if (overlay) {
    overlay.style.display = 'none';
  }
}

