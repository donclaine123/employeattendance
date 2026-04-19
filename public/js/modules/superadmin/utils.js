/**
 * utils.js
 * Shared utility functions for Super Admin Dashboard
 */

import { fetchWithAuth as globalFetchWithAuth } from '../hr/utils.js'; // Reuse if possible, or redefine

/**
 * Wrapper for fetchWithAuth to ensure it's available
 * We can import it from the HR utils if it's generic enough, 
 * but for now let's re-export or simply implement a wrapper.
 * The original superadmin.js used window.fetchWithAuth or similar if it was global.
 * HR utils fetchWithAuth is robust, let's try to reuse it or copy it.
 * To be safe and independent, I'll copy the core logic since cross-module imports 
 * outside of the same feature folder might be fragile if structure changes.
 */
export async function fetchWithAuth(endpoint, options = {}) {
  // Use global API_URL
  const apiBase = window.API_URL || '/api'; // Fallback

  // Ensure endpoint starts with / if not present
  const path = endpoint.startsWith('/') ? endpoint : `/${endpoint}`;

  // Construct full URL if not already absolute
  const url = path.startsWith('http') ? path : `${apiBase}${path}`;

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

  return fetch(url, config);
}

/**
 * Robust date parser for UTC, handling MySQL, Postgres 6-digit microseconds, and localized string formats.
 */
export function parseUTC(dateStr) {
  if (!dateStr) return new Date();
  
  if (typeof dateStr === 'number' || /^\d+$/.test(dateStr)) {
    const num = Number(dateStr);
    return new Date(dateStr.toString().length <= 10 ? num * 1000 : num);
  }

  let s = String(dateStr).trim();

  if (/^\d{4}-\d{2}-\d{2}/.test(s)) {
    s = s.replace(' ', 'T');
    s = s.replace(/(\.\d{3})\d+/, '$1');
    if (!/[Zz]|[+-]\d{2}:?\d{2}$/.test(s)) s += 'Z';
    return new Date(s);
  }

  if (!/GMT|UTC|[+-]\d/.test(s)) {
    const testDate = new Date(`${s} UTC`);
    if (!isNaN(testDate.getTime())) return testDate;
  }

  return new Date(s);
}

/**
 * Escape HTML characters
 */
export function escapeHtml(s) {
  return (s || '').toString().replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * Safe event listener helper
 */
export function safeAdd(el, event, handler, options) {
  if (!el) {
    if (window && window.console && window.console.debug) {
      console.debug('[superadmin] safeAdd: element not found for event', event, el);
    }
    return;
  }
  // Mark element to track which events have been added to prevent duplicates
  if (!el.__safeAddListeners) {
    el.__safeAddListeners = {};
  }
  const key = event + '_' + handler.toString().substring(0, 50);
  if (!el.__safeAddListeners[key]) {
    el.addEventListener(event, handler, options || false);
    el.__safeAddListeners[key] = true;
  }
}

/**
 * Format date for display
 */
export function formatDate(dateString) {
  if (!dateString) return '—';
  return new Date(dateString).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: '2-digit' });
}

/**
 * Format time for display
 */
export function formatTime(timeString) {
  if (!timeString) return '—';
  // If it's a full ISO string
  if (timeString.includes('T')) {
    return new Date(timeString).toLocaleTimeString();
  }
  // If it's HH:mm:ss
  return new Date(`1970-01-01T${timeString}`).toLocaleTimeString();
}

/**
 * Format Action Type for Audit Logs
 */
export const actionTypeMap = {
  'USER_UPDATED': 'User Updated',
  'PROFILE_UPDATED': 'Profile Updated',
  'USER_DEACTIVATED': 'User Deactivated',
  'USER_REACTIVATED': 'User Reactivated',
  'QR_PAUSED': 'QR Code Paused',
  'QR_RESUMED': 'QR Code Resumed',
  'EMPLOYEE_UPDATED': 'Employee Updated',
  'EMPLOYEE_ROLE_UPDATED': 'Employee Role Updated',
  'ONLINE_ATTENDANCE_SUBMITTED': 'Online Attendance Submitted',
  'ONLINE_ATTENDANCE_VERIFIED': 'Online Attendance Verified',
  'ONLINE_ATTENDANCE_REJECTED': 'Online Attendance Rejected',
  'HOURLY_ROUNDS_VERIFIED': 'Hourly Rounds Verified',
  'REPORT_DOWNLOADED': 'Report Downloaded',
  'DEPARTMENT_CREATED': 'Department Created',
  'DEPARTMENT_UPDATED': 'Department Updated',
  'DEPARTMENT_DELETED': 'Department Deleted',
  'DEPARTMENT_HEAD_ASSIGNED': 'Department Head Assigned',
  'BULK_USER_ACTIVATION': 'Bulk User Activation',
  'SETTINGS_UPDATED': 'Settings Updated',
  'INVITATION_CREATED': 'Invitation Created',
  'INVITATION_SUPERSEDED': 'Invitation Superseded',
  'INVITATION_ACCEPTED': 'Invitation Accepted',
  'INVITATION_RESENT': 'Invitation Resent',
  'INVITATION_CANCELLED': 'Invitation Cancelled',
  'INVITATION_DELETED': 'Invitation Cancelled',
  'BACKUP_DOWNLOADED': 'Backup Downloaded',
  'BACKUP_DELETED': 'Backup Deleted',
  'DEPARTMENT_CHANGED': 'Department Updated',
  'ROLE_CHANGED': 'Role Updated'
};

export function formatActionType(actionType) {
  if (!actionType) return 'Unknown';
  return actionTypeMap[actionType] || actionType.replace(/_/g, ' ');
}

/**
 * Show a toast notification
 * @param {string} message - Message to display
 * @param {string} type - 'success', 'error', or 'info' (default: 'info')
 * @param {number} duration - Duration in ms before auto-dismiss (default: 4000)
 */
export function showToast(message, type = 'info', duration = 4000) {
  const container = document.getElementById('toast-container');
  if (!container) return;

  // Create icon based on type
  let icon = '✓';
  if (type === 'error') icon = '✕';
  if (type === 'info') icon = 'ℹ';

  // Create toast element
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.innerHTML = `
    <div class="toast-icon">${icon}</div>
    <div>${message}</div>
  `;

  // Add to container
  container.appendChild(toast);

  // Auto-dismiss after duration
  const timeout = setTimeout(() => {
    toast.classList.add('fade-out');
    setTimeout(() => {
      toast.remove();
    }, 300);
  }, duration);

  // Allow manual dismiss by clicking
  toast.addEventListener('click', () => {
    clearTimeout(timeout);
    toast.classList.add('fade-out');
    setTimeout(() => {
      toast.remove();
    }, 300);
  });

  return toast;
}

/**
 * Show a confirmation dialog
 * @param {string} title - Dialog title
 * @param {string} message - Confirmation message
 * @returns {Promise<boolean>} Returns true if confirmed, false if cancelled
 */
export function showConfirmDialog(title, message) {
  return new Promise((resolve) => {
    const modal = document.getElementById('confirm-modal');
    const titleEl = document.getElementById('confirm-title');
    const messageEl = document.getElementById('confirm-message');
    const closeBtn = document.getElementById('confirm-close-btn');
    const cancelBtn = document.getElementById('confirm-cancel-btn');
    const okBtn = document.getElementById('confirm-ok-btn');

    if (!modal) {
      console.error('Confirmation modal not found');
      resolve(false);
      return;
    }

    // Set content
    titleEl.textContent = title;
    messageEl.textContent = message;

    // Close modal function
    const closeModal = () => {
      modal.style.display = 'none';
    };

    // Handle OK
    const handleOk = () => {
      closeModal();
      resolve(true);
    };

    // Handle Cancel
    const handleCancel = () => {
      closeModal();
      resolve(false);
    };

    // Handle close click
    const handleClose = (e) => {
      if (e.target === modal) {
        handleCancel();
      }
    };

    // Attach listeners
    okBtn.onclick = handleOk;
    cancelBtn.onclick = handleCancel;
    closeBtn.onclick = handleCancel;
    modal.onclick = handleClose;

    // Show modal
    modal.style.display = 'flex';
  });
}
