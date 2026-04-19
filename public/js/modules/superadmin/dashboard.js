/**
 * dashboard.js
 * Dashboard Overview Statistics
 */

import { fetchWithAuth, escapeHtml, formatActionType, parseUTC } from './utils.js';

export async function loadDashboardStats() {
  try {
    void loadRecentAuditEvents();

    // Fetch all users
    const usersResp = await fetchWithAuth('/admin/users?_page=1&_limit=1000', {});
    const usersData = usersResp.ok ? await usersResp.json() : {};
    const users = usersData.data || usersData || [];

    // Fetch all departments
    const deptsResp = await fetchWithAuth('/admin/departments', {});
    const deptsData = deptsResp.ok ? await deptsResp.json() : {};
    const departments = deptsData.data || deptsData || [];

    // Fetch all employees (correct endpoint)
    const empResp = await fetchWithAuth('/hr/employees?_page=1&_limit=1000', {});
    const empData = empResp.ok ? await empResp.json() : {};
    const employees = empData.data || empData || [];

    // Calculate stats
    const totalUsers = Array.isArray(users) ? users.length : 0;
    const activeUsers = Array.isArray(users) ? users.filter(u => u.status && u.status.toLowerCase() === 'active').length : 0;
    const totalDepartments = Array.isArray(departments) ? departments.length : 0;
    const totalEmployees = Array.isArray(employees) ? employees.length : 0;

    // Update dashboard display
    const el = (id) => document.getElementById(id);
    if (el('total-users')) el('total-users').textContent = totalUsers;
    if (el('active-users')) el('active-users').textContent = activeUsers;
    if (el('total-departments')) el('total-departments').textContent = totalDepartments;
    if (el('total-employees')) el('total-employees').textContent = totalEmployees;

    console.log('[dashboard] Stats loaded:', { totalUsers, activeUsers, totalDepartments, totalEmployees });
  } catch (error) {
    console.error('[dashboard] Failed to load stats:', error);
  }
}

async function loadRecentAuditEvents() {
  const container = document.getElementById('dashboardRecentAuditEvents');
  if (!container) return;

  container.innerHTML = `
    <div class="dashboard-side-item" role="status" aria-label="Loading recent audit events" style="align-items: center; min-height: 68px; justify-content: center;">
      <div class="spinner" aria-hidden="true" style="width: 18px; height: 18px; border-width: 2px; border-top-color: var(--primary-color);"></div>
    </div>
  `;

  try {
    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => controller.abort(), 8000);

    const response = await fetchWithAuth('/admin/audit/suspicious?windowMinutes=120', {
      signal: controller.signal
    });

    window.clearTimeout(timeoutId);

    if (!response.ok) {
      throw new Error(`Failed to load audit logs (${response.status})`);
    }

    const payload = await response.json();
    const logs = Array.isArray(payload.data?.recentEvents) ? payload.data.recentEvents : [];

    if (logs.length === 0) {
      container.innerHTML = `
        <div class="dashboard-side-item">
          <div>
            <div class="dashboard-side-label">No recent events</div>
            <div class="dashboard-side-summary">The audit trail is quiet right now.</div>
          </div>
          <div class="dashboard-side-value">Live</div>
        </div>
      `;
      return;
    }

    container.innerHTML = logs.map((log) => {
      const actionLabel = escapeHtml(formatActionType(log.actionType));
      const summary = escapeHtml(buildAuditSummary(log));
      const actor = escapeHtml(log.userName || 'System');
      const role = log.userRole ? ` <span class="dashboard-audit-role">${escapeHtml(log.userRole)}</span>` : '';
      const timeLabel = escapeHtml(formatRelativeTime(log.createdAt));

      return `
        <div class="dashboard-side-item dashboard-audit-item">
          <div>
            <div class="dashboard-side-label">${actionLabel}</div>
            <div class="dashboard-side-summary">${summary}</div>
            <div class="dashboard-audit-meta">${actor}${role}</div>
          </div>
          <div class="dashboard-side-value">${timeLabel}</div>
        </div>
      `;
    }).join('');
  } catch (error) {
    if (error.name === 'AbortError') {
      console.warn('[dashboard] Recent audit events timed out');
    }
    console.error('[dashboard] Failed to load recent audit events:', error);
    container.innerHTML = `
      <div class="dashboard-side-item">
        <div>
          <div class="dashboard-side-label">Audit preview unavailable</div>
          <div class="dashboard-side-summary">The latest events took too long to load.</div>
        </div>
        <div class="dashboard-side-value">—</div>
      </div>
    `;
  }
}

function buildAuditSummary(log = {}) {
  const details = log.details || {};
  const actor = log.userName || details.username || 'System';

  switch (log.actionType) {
    case 'INVITATION_CREATED':
      return `${actor} invited ${details.email || 'a user'} as ${details.role || 'user'}`;
    case 'INVITATION_ACCEPTED':
      return `${details.email || 'An invite'} was accepted`;
    case 'INVITATION_RESENT':
      return `${actor} resent an invitation to ${details.email || 'a user'}`;
    case 'INVITATION_CANCELLED':
      return `${actor} cancelled an invitation for ${details.email || 'a user'}`;
    case 'DEPARTMENT_HEAD_ASSIGNED':
      return `${actor} assigned ${details.head_username || details.employee_name || 'a user'} to ${details.department_name || 'a department'}`;
    case 'SETTINGS_UPDATED':
      return `${actor} updated ${Array.isArray(details.updatedKeys) && details.updatedKeys.length ? details.updatedKeys.join(', ') : 'system settings'}`;
    case 'USER_UPDATED':
    case 'EMPLOYEE_UPDATED':
      return details.description || `${actor} updated ${details.username || details.employee_name || 'a record'}`;
    case 'USER_DEACTIVATED':
      return `${actor} deactivated ${details.username || details.email || details.employee_name || 'a user'}`;
    case 'USER_REACTIVATED':
    case 'EMPLOYEE_REACTIVATED':
      return `${actor} reactivated ${details.username || details.email || details.employee_name || 'a user'}`;
    default:
      return details.description || `${actor} performed ${formatActionType(log.actionType).toLowerCase()}`;
  }
}

function formatRelativeTime(value) {
  const date = parseUTC(value);
  const diffMs = Date.now() - date.getTime();

  if (!Number.isFinite(diffMs) || diffMs < 0) {
    return 'Just now';
  }

  const diffMinutes = Math.floor(diffMs / 60000);
  if (diffMinutes < 1) return 'Just now';
  if (diffMinutes < 60) return `${diffMinutes}m ago`;

  const diffHours = Math.floor(diffMinutes / 60);
  if (diffHours < 24) return `${diffHours}h ago`;

  return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

export async function updateOverview() {
  try {
    // Fetch authoritative profile from server (do not rely on sessionStorage)
    let currentUser = {};
    try {
      const profileResp = await fetchWithAuth('/auth/profile');
      if (profileResp && (profileResp.ok || profileResp.status === 304)) {
        try {
          currentUser = profileResp.status === 304 ? {} : await profileResp.json();
        } catch (e) {
          currentUser = {};
        }
      }
    } catch (e) {
      console.warn('[superadmin] Failed to fetch profile for overview:', e);
      currentUser = {};
    }

    // Update greeting name
    const greetingStrong = document.querySelector('.greeting strong');
    if (greetingStrong) {
      const displayName = currentUser.full_name || [(currentUser.first_name || ''), (currentUser.last_name || '')].filter(Boolean).join(' ') || (currentUser.username || 'Administrator');
      greetingStrong.textContent = displayName;
    }

    // Update role and last login inside the left employee-card
    const cardRows = document.querySelectorAll('.employee-card .card-row');
    if (cardRows && cardRows.length >= 3) {
      // Role (row 0)
      const roleValue = cardRows[0].querySelector('.value');
      if (roleValue) roleValue.textContent = (currentUser.role || 'Super Admin');

      // Last Login (row 2)
      const lastLoginValue = cardRows[2].querySelector('.value');
      if (lastLoginValue) {
        const last = currentUser.last_login || currentUser.lastLogin || currentUser.last_logged_in;
        lastLoginValue.textContent = last ? new Date(last).toLocaleDateString() + ' ' + new Date(last).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'Never';
      }
    }

    // Quick Stats are also updated by loadDashboardStats but updateOverview in legacy handled them too.
    // We can leave the basic stats in loadDashboardStats as it's more comprehensive.

  } catch (e) {
    console.error('updateOverview error:', e);
  }
}
