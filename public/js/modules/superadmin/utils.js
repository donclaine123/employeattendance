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
  'USER_DEACTIVATED': 'User Deactivated',
  'USER_REACTIVATED': 'User Reactivated',
  'SESSION_LOGOUT_FORCED': 'Session Logout Forced',
  'QR_PAUSED': 'QR Code Paused',
  'QR_RESUMED': 'QR Code Resumed',
  'EMPLOYEE_CREATED': 'Employee Created',
  'EMPLOYEE_UPDATED': 'Employee Updated',
  'EMPLOYEE_DELETED': 'Employee Deleted',
  'EMPLOYEE_ROLE_UPDATED': 'Employee Role Updated',
  'ATTENDANCE_OVERRIDE': 'Attendance Override',
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
  'INVITATION_CANCELLED': 'Invitation Cancelled'
};

export function formatActionType(actionType) {
  if (!actionType) return 'Unknown';
  return actionTypeMap[actionType] || actionType.replace(/_/g, ' ');
}
