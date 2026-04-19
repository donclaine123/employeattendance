/**
 * audit.js
 * Audit Logs Management and Display
 */

import { fetchWithAuth, escapeHtml, safeAdd, showToast, formatActionType, actionTypeMap, parseUTC } from './utils.js';
import { fetchUsers } from './users.js';

// Global storage for logs and pagination state
window.auditLogsData = [];
let auditPagination = { page: 1, limit: 25, total: 0, pages: 1 };
let auditCurrentFilters = {};
let auditUsersCache = []; // Cache for user search
let auditSignalsState = { windowMinutes: 15, totals: null, alerts: [] };

// ── Avatar colors ─────────────────────────────────────────────────────────────
const AVATAR_COLORS = [
  '#6366f1', '#8b5cf6', '#ec4899', '#f97316', '#14b8a6',
  '#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#06b6d4'
];
function getAvatarColor(name = '') {
  return AVATAR_COLORS[(name.charCodeAt(0) || 0) % AVATAR_COLORS.length];
}
function getInitials(name = '') {
  return (name.trim().split(/\s+/)[0]?.[0] || '?').toUpperCase();
}

// ── Action badge categories ───────────────────────────────────────────────────
const ACTION_CATEGORY = {
  USER_DEACTIVATED: 'danger',
  DEPARTMENT_DELETED: 'danger', BULK_USER_ACTIVATION: 'danger',
  INVITATION_CANCELLED: 'danger',
  INVITATION_DELETED: 'danger',
  HOURLY_ROUNDS_VERIFIED: 'info',
  REPORT_DOWNLOADED: 'info',
  USER_UPDATED: 'warning', EMPLOYEE_UPDATED: 'warning',
  DEPARTMENT_UPDATED: 'warning', SETTINGS_UPDATED: 'warning',
  EMPLOYEE_ROLE_UPDATED: 'warning', QR_PAUSED: 'warning',
  DEPARTMENT_CREATED: 'success',
  USER_REACTIVATED: 'success', INVITATION_ACCEPTED: 'success',
  QR_RESUMED: 'success',
  DEPARTMENT_HEAD_ASSIGNED: 'info', DEPARTMENT_HEAD_SWAPPED: 'warning', DEPARTMENT_HEAD_REMOVED: 'danger',
  INVITATION_CREATED: 'info',
  INVITATION_RESENT: 'info', INVITATION_SUPERSEDED: 'info',
};

// ── Description generator ─────────────────────────────────────────────────────
function generateDescription(actionType, details = {}) {
  const d = details || {};
  const map = {
    USER_CREATED: () => `Created new user "${d.email}" as ${d.role}`,
    USER_UPDATED: () => d.fieldLabel ? `Updated the "${d.fieldLabel}" of user "${d.username || d.targetUserId || 'user'}"` : `Updated profile of "${d.username || 'user'}"`,
    USER_DEACTIVATED: () => `Deactivated user "${d.email || d.username || 'user'}"`,
    USER_REACTIVATED: () => `Reactivated user "${d.email || d.username || 'user'}"`,
    ROLE_CHANGED: () => d.description || `Role changed from "${d.old_role_name || 'unknown'}" to "${d.new_role_name}" for ${d.username || d.user_id || 'user'}`,
    DEPARTMENT_CHANGED: () => d.description || `Department changed from "${d.old_dept_name || 'none'}" to "${d.new_dept_name || 'unknown'}" for ${d.username || d.user_id || 'user'}`,
    PASSWORD_RESET: () => `Password reset by admin`,
    PASSWORD_CHANGED: () => `Password changed by user`,
    USER_FORCE_LOGOUT: () => `Force logged out user "${d.username || d.user_id}"`,
    AUTH_LOGIN_FAILED: () => {
      const email = d.email || d.username || 'unknown account';
      const reason = d.reason ? ` (${d.reason})` : '';
      return `Failed login attempt for "${email}"${reason}`;
    },
    EMPLOYEE_UPDATED: () => {
      if (d.description) return d.description;
      if (d.changes) {
        const fields = Object.keys(d.changes).join(', ');
        if (fields) return `Updated the "${fields}" of employee "${d.username || d.employee_id}"`;
      }
      return `Updated record for employee "${d.username || d.employee_id}"`;
    },
    EMPLOYEE_DEACTIVATED: () => `Deactivated employee "${d.username || d.employee_id}"`,
    EMPLOYEE_REACTIVATED: () => `Reactivated employee "${d.username || d.employee_id}"`,
    ATTENDANCE_OVERRIDDEN: () => `Overridden attendance for "${d.employee_name || d.attendance_id}" to "${d.new_status}"`,
    ATTENDANCE_VERIFIED: () => `Verified attendance for "${d.employee_name || d.attendance_id}" as "${d.verified_status}"`,
    HOURLY_ROUNDS_VERIFIED: () => {
      const state = d.verification_state === 'cleared' ? 'Cleared' : 'Verified';
      return `${state} hourly round ${d.hour_block ? `for ${d.hour_block}` : ''} for "${d.employee_id || d.attendance_id || 'record'}" as "${d.verified_status || d.status || 'unknown'}"`;
    },
    REPORT_DOWNLOADED: () => {
      const reportName = d.report_type || 'report';
      const format = d.file_format ? d.file_format.toUpperCase() : 'FILE';
      const range = d.date_from && d.date_to ? ` (${d.date_from} to ${d.date_to})` : '';
      return `Generated ${reportName} as ${format}${range}`;
    },
    DEPARTMENT_CREATED: () => `Created department "${d.department_name || 'unknown'}"`,
    DEPARTMENT_UPDATED: () => d.fieldLabel ? `Updated department "${d.department_name}" from "${d.oldValue}" to "${d.newValue}"` : `Updated department "${d.department_name || 'unknown'}"`,
    DEPARTMENT_DELETED: () => `Deleted department "${d.department_name || d.department_id}"`,
    DEPARTMENT_HEAD_ASSIGNED: () => `Assigned ${d.head_username || 'user'} as head for ${d.department_name || 'department'}`,
    DEPARTMENT_HEAD_SWAPPED: () => `Replaced ${d.old_head_username || 'user'} with ${d.new_head_username || 'user'} as head for ${d.department_name || 'department'}`,
    DEPARTMENT_HEAD_REMOVED: () => `Removed ${d.removed_head_username || 'user'} as head from ${d.department_name || 'department'}`,
    BULK_USER_ACTIVATION: () => `Performed bulk user activation`,
    SETTINGS_UPDATED: () => `Updated system settings: ${(d.updatedKeys || []).join(', ')}`,
    INVITATION_CREATED: () => `Sent invitation to "${d.email}" as ${d.role}`,
    INVITATION_SUPERSEDED: () => `Replaced existing invitation for "${d.email}"`,
    INVITATION_ACCEPTED: () => `Invitation accepted by "${d.email}"`,
    INVITATION_RESENT: () => `Resent invitation to "${d.email}"`,
    INVITATION_CANCELLED: () => `Invitation cancelled for "${d.email}"`,
    INVITATION_DELETED: () => `Invitation cancelled for "${d.email}"`,
  };
  return map[actionType] ? map[actionType]() : formatActionType(actionType);
}

function normalizeAuditFilters(filters = {}) {
  const normalized = { ...filters };

  if (Array.isArray(normalized.actionTypes)) {
    normalized.actionTypes = normalized.actionTypes.filter(Boolean).join(',');
  }

  if (normalized.actionType && !normalized.actionTypes) {
    normalized.actionTypes = String(normalized.actionType).trim();
  }

  if (normalized.userIds && Array.isArray(normalized.userIds)) {
    normalized.userIds = normalized.userIds.join(',');
  }

  return normalized;
}

// ── Fetch ─────────────────────────────────────────────────────────────────────
async function fetchAuditLogsPage(filters = {}, page = 1, limit = 25) {
  const params = new URLSearchParams({ ...normalizeAuditFilters(filters), _page: page, _limit: limit });
  try {
    const response = await fetchWithAuth(`/admin/audit-logs?${params}`, {
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' }
    });
    if (response.ok) {
      return await response.json();
    }
    console.error('Failed to fetch audit logs');
    return null;
  } catch (e) {
    console.error('Error fetching audit logs:', e);
    return null;
  }
}

export async function fetchAuditLogs(filters = {}, page = 1, limit = 25) {
  const json = await fetchAuditLogsPage(filters, page, limit);
  if (!json) return [];

  auditPagination = json.pagination || { page, limit, total: 0, pages: 1 };
  return json.data || [];
}

async function fetchSuspiciousSignals(windowMinutes = 15) {
  try {
    const response = await fetchWithAuth(`/admin/audit/suspicious?windowMinutes=${encodeURIComponent(windowMinutes)}`, {
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' }
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch suspicious signals (${response.status})`);
    }

    const json = await response.json();
    return json.data || { windowMinutes, totals: null, alerts: [], recentEvents: [] };
  } catch (error) {
    console.error('[audit] fetchSuspiciousSignals error:', error);
    return { windowMinutes, totals: null, alerts: [], recentEvents: [] };
  }
}

// ── Render rows ───────────────────────────────────────────────────────────────
export function renderAuditLogs(logs) {
  const tbody = document.getElementById('audit-logs-tbody');
  if (!tbody) return;

  tbody.innerHTML = '';
  window.auditLogsData = logs || [];

  if (!logs || logs.length === 0) {
    tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;padding:32px;color:var(--text-muted);">No audit logs found for the selected criteria.</td></tr>';
    renderPagination();
    return;
  }

  logs.forEach((log, index) => {
    const username = log.userName || log.details?.email || log.details?.username || `User #${log.userId || '?'}`;
    const userRole = log.userRole || '';
    const category = ACTION_CATEGORY[log.actionType] || 'default';
    const actionLabel = formatActionType(log.actionType);
    const description = generateDescription(log.actionType, log.details);
    const timestamp = parseUTC(log.createdAt).toLocaleString();
    const color = getAvatarColor(username);
    const initials = getInitials(username);

    tbody.insertAdjacentHTML('beforeend', `
      <tr class="${category === 'danger' ? 'audit-row-danger' : ''}">
        <td>
          <div class="audit-user-cell">
            <div class="audit-avatar" style="background:${color};">${escapeHtml(initials)}</div>
            <div>
              <div class="audit-username">${escapeHtml(username)}</div>
              ${userRole ? `<div class="audit-user-role">${escapeHtml(userRole)}</div>` : ''}
            </div>
          </div>
        </td>
        <td><span class="audit-badge audit-badge-${category}">${escapeHtml(actionLabel)}</span></td>
        <td class="audit-description">${escapeHtml(description)}</td>
        <td class="audit-timestamp">${escapeHtml(timestamp)}</td>
        <td><button class="btn-small audit-view-btn btn-view-audit" data-index="${index}">View Details</button></td>
      </tr>
    `);
  });

  tbody.querySelectorAll('.btn-view-audit').forEach(btn => {
    btn.addEventListener('click', e => openAuditDetailsModal(e.target.getAttribute('data-index')));
  });

  renderPagination();
}

// ── Pagination ────────────────────────────────────────────────────────────────
function renderPagination() {
  const container = document.getElementById('audit-pagination');
  if (!container) return;
  const { page, pages, total, limit } = auditPagination;
  const startItem = total > 0 ? ((page - 1) * limit) + 1 : 0;
  const endItem = total > 0 ? Math.min(page * limit, total) : 0;

  container.innerHTML = `
    <span class="audit-pagination-info">Showing ${startItem}-${endItem} of ${total} events</span>
    <div class="audit-pagination-controls">
      <div class="audit-page-size">
        Rows per page
        <select id="audit-page-size">
          ${[25, 50, 100].map(n => `<option value="${n}" ${limit === n ? 'selected' : ''}>${n}</option>`).join('')}
        </select>
      </div>
      <button class="audit-page-btn" id="audit-prev-btn" ${page <= 1 ? 'disabled' : ''} aria-label="Previous page">&lsaquo;</button>
      <span class="audit-page-indicator">Page ${page} of ${pages || 1}</span>
      <button class="audit-page-btn" id="audit-next-btn" ${page >= pages ? 'disabled' : ''} aria-label="Next page">&rsaquo;</button>
    </div>
  `;

  document.getElementById('audit-prev-btn')?.addEventListener('click', () => loadAuditPage(page - 1));
  document.getElementById('audit-next-btn')?.addEventListener('click', () => loadAuditPage(page + 1));
  document.getElementById('audit-page-size')?.addEventListener('change', e => {
    auditPagination.limit = parseInt(e.target.value);
    loadAuditPage(1);
  });
}

async function loadAuditPage(page) {
  const logs = await fetchAuditLogs(auditCurrentFilters, page, auditPagination.limit);
  renderAuditLogs(logs);
}

// ── Filters ───────────────────────────────────────────────────────────────────
export async function populateUserFilter() {
  try {
    const allUsers = [];
    const pageSize = 200;
    let page = 1;

    while (page <= 50) {
      const users = await fetchUsers(page, '', 'all', pageSize);
      if (!users || !Array.isArray(users) || users.length === 0) break;
      allUsers.push(...users);
      if (users.length < pageSize) break;
      page += 1;
    }

    const uniqueUsers = new Map();
    allUsers.forEach(user => {
      if (user?.user_id) uniqueUsers.set(user.user_id, user);
    });
    auditUsersCache = Array.from(uniqueUsers.values());
  } catch (err) {
    console.error('Error populating user filter:', err);
  }
}

function populateActionFilter() {
  const container = document.getElementById('audit-action-filter');
  if (!container) return;

  container.innerHTML = '';

  Object.entries(actionTypeMap).forEach(([value, label]) => {
    const optionLabel = document.createElement('label');
    optionLabel.className = 'audit-action-option';

    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.value = value;
    checkbox.setAttribute('aria-label', label);

    const text = document.createElement('span');
    text.textContent = label;

    optionLabel.appendChild(checkbox);
    optionLabel.appendChild(text);
    container.appendChild(optionLabel);
  });
}

function getSelectedActionTypes() {
  const container = document.getElementById('audit-action-filter');
  if (!container) return [];

  return Array.from(container.querySelectorAll('input[type="checkbox"]:checked'))
    .map(checkbox => checkbox.value)
    .filter(Boolean);
}

async function clearAuditFilters() {
  const get = id => document.getElementById(id);

  ['audit-start-date', 'audit-end-date', 'audit-user-filter', 'audit-ip-filter'].forEach(id => {
    const element = get(id);
    if (element) element.value = '';
  });

  document.querySelectorAll('#audit-action-filter input[type="checkbox"]').forEach(checkbox => {
    checkbox.checked = false;
  });

  auditCurrentFilters = {};
  const logs = await fetchAuditLogs({}, 1, auditPagination.limit);
  renderAuditLogs(logs);
  auditSignalsState = await fetchSuspiciousSignals(15);
  renderSuspiciousSignals(auditSignalsState);
}

function getAuditFilterValue(id) {
  return document.getElementById(id)?.value?.trim() || '';
}

async function applyAuditFilters() {
  const get = id => document.getElementById(id);
  auditCurrentFilters = {};
  if (get('audit-start-date')?.value) auditCurrentFilters.startDate = get('audit-start-date').value;
  if (get('audit-end-date')?.value) auditCurrentFilters.endDate = get('audit-end-date').value;
  
  // Handle user search
  const userSearchValue = getAuditFilterValue('audit-user-filter');
  if (userSearchValue) {
    const searchLower = userSearchValue.toLowerCase();
    const matchingUsers = auditUsersCache.filter(user => {
      const fullName = (user.full_name || '').toLowerCase();
      const username = (user.username || '').toLowerCase();
      const email = (user.email || '').toLowerCase();
      return fullName.includes(searchLower) || username.includes(searchLower) || email.includes(searchLower);
    });

    const exactMatches = matchingUsers.filter(user => {
      const fullName = (user.full_name || '').toLowerCase();
      const username = (user.username || '').toLowerCase();
      const email = (user.email || '').toLowerCase();
      return fullName === searchLower || username === searchLower || email === searchLower;
    });

    const targetMatches = exactMatches.length > 0 ? exactMatches : matchingUsers;

    if (targetMatches.length === 1) {
      auditCurrentFilters.userId = targetMatches[0].user_id;
    } else if (targetMatches.length > 1) {
      auditCurrentFilters.userIds = targetMatches.map(user => user.user_id).join(',');
    } else {
      auditCurrentFilters.userId = -1;
    }
  }

  const actionTypes = getSelectedActionTypes();
  if (actionTypes.length > 0) auditCurrentFilters.actionTypes = actionTypes;

  const ipSearchValue = getAuditFilterValue('audit-ip-filter');
  if (ipSearchValue) auditCurrentFilters.ipAddress = ipSearchValue;

  const logs = await fetchAuditLogs(auditCurrentFilters, 1, auditPagination.limit);
  renderAuditLogs(logs);

  auditSignalsState = await fetchSuspiciousSignals(15);
  renderSuspiciousSignals(auditSignalsState);
}

function getAuditSeverityClass(severity = '') {
  const normalized = String(severity).toLowerCase();
  if (normalized === 'critical') return 'critical';
  if (normalized === 'warning') return 'warning';
  return 'info';
}

function renderSuspiciousSignals(signalData) {
  const container = document.getElementById('audit-suspicious-panel');
  if (!container) return;

  const totals = signalData?.totals || {};
  const alerts = Array.isArray(signalData?.alerts) ? signalData.alerts : [];
  const windowMinutes = signalData?.windowMinutes || 15;

  if (!alerts.length) {
    container.innerHTML = `
      <div class="audit-insights-banner">
        <div class="audit-insights-banner-message">
          <div class="audit-insights-banner-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M12 2l8 4v6c0 5-3.5 9.5-8 10-4.5-.5-8-5-8-10V6l8-4z"></path>
              <path d="M9 12l2 2 4-4"></path>
            </svg>
          </div>
          <div class="audit-insights-banner-copywrap">
            <div class="audit-insights-banner-title">No suspicious patterns detected</div>
            <div class="audit-insights-banner-copy">The current signal set is clean based on the last ${escapeHtml(windowMinutes)} minutes of audit activity.</div>
          </div>
        </div>
        <div class="audit-insights-banner-action">
          <button type="button" class="btn-secondary" id="audit-compliance-export-btn">Export Compliance Report</button>
        </div>
      </div>
      <div class="audit-compliance-grid">
        <div><span>Total Events</span><strong>${escapeHtml(String(totals.events ?? 0))}</strong></div>
        <div><span>Failed Logins</span><strong>${escapeHtml(String(totals.failedLogins ?? 0))}</strong></div>
        <div><span>Force Logouts</span><strong>${escapeHtml(String(totals.forceLogouts ?? 0))}</strong></div>
        <div><span>Admin Actions</span><strong>${escapeHtml(String(totals.adminActions ?? 0))}</strong></div>
      </div>
    `;
    return;
  }

  const alertCards = alerts.map((alert) => {
    const severityClass = getAuditSeverityClass(alert.severity);
    const countText = Number.isFinite(alert.count) ? `${alert.count} event${alert.count === 1 ? '' : 's'}` : 'Signal';
    const details = alert.context ? Object.entries(alert.context).map(([key, value]) => {
      const label = key.replace(/([A-Z])/g, ' $1').replace(/_/g, ' ').replace(/^./, (char) => char.toUpperCase());
      return `<span><strong>${escapeHtml(label)}:</strong> ${escapeHtml(Array.isArray(value) ? value.join(', ') : String(value))}</span>`;
    }).join('') : '';

    return `
      <article class="audit-alert-card ${severityClass}">
        <div class="audit-alert-card-head">
          <div>
            <div class="audit-alert-title">${escapeHtml(alert.title || 'Suspicious pattern')}</div>
            <div class="audit-alert-copy">${escapeHtml(alert.message || '')}</div>
          </div>
          <span class="audit-alert-severity ${severityClass}">${escapeHtml(String(alert.severity || 'info').toUpperCase())}</span>
        </div>
        <div class="audit-alert-meta">
          <span>${escapeHtml(countText)}</span>
          ${details ? `<div class="audit-alert-details">${details}</div>` : ''}
        </div>
      </article>
    `;
  }).join('');

  container.innerHTML = `
    <div class="audit-insights-summary">
      <div class="audit-insights-summary-title">Suspicious activity in the last ${escapeHtml(windowMinutes)} minutes</div>
      <div class="audit-insights-actions">
        <button type="button" class="btn-secondary" id="audit-compliance-export-btn">Export compliance report</button>
      </div>
      <div class="audit-insights-summary-grid">
        <div><span>Alerts</span><strong>${escapeHtml(String(totals.alertCount ?? alerts.length))}</strong></div>
        <div><span>Events</span><strong>${escapeHtml(String(totals.events ?? 0))}</strong></div>
        <div><span>Failed logins</span><strong>${escapeHtml(String(totals.failedLogins ?? 0))}</strong></div>
        <div><span>Login events</span><strong>${escapeHtml(String(totals.loginEvents ?? 0))}</strong></div>
        <div><span>Force logouts</span><strong>${escapeHtml(String(totals.forceLogouts ?? 0))}</strong></div>
        <div><span>Admin actions</span><strong>${escapeHtml(String(totals.adminActions ?? 0))}</strong></div>
      </div>
    </div>
    <div class="audit-alert-grid">
      ${alertCards}
    </div>
    <div class="audit-compliance-note">
      Compliance snapshot generated from live audit signals. Review critical alerts before exporting or sharing the report.
    </div>
  `;

  safeAdd(document.getElementById('audit-compliance-export-btn'), 'click', () => exportComplianceReport(signalData));
}

function buildComplianceReportText(signalData) {
  const totals = signalData?.totals || {};
  const alerts = Array.isArray(signalData?.alerts) ? signalData.alerts : [];
  const windowMinutes = signalData?.windowMinutes || 15;
  const lines = [
    'Superadmin Audit Compliance Snapshot',
    `Window: Last ${windowMinutes} minutes`,
    `Generated: ${new Date().toLocaleString()}`,
    '',
    'Summary',
    `- Total events: ${totals.events ?? 0}`,
    `- Failed logins: ${totals.failedLogins ?? 0}`,
    `- Login events: ${totals.loginEvents ?? 0}`,
    `- Logout events: ${totals.logoutEvents ?? 0}`,
    `- Force logouts: ${totals.forceLogouts ?? 0}`,
    `- Admin actions: ${totals.adminActions ?? 0}`,
    `- Alert count: ${totals.alertCount ?? alerts.length}`,
    '',
    'Alerts',
  ];

  if (!alerts.length) {
    lines.push('No suspicious patterns detected.');
  } else {
    alerts.forEach((alert, index) => {
      lines.push(`${index + 1}. [${String(alert.severity || 'info').toUpperCase()}] ${alert.title || 'Suspicious pattern'}`);
      lines.push(`   ${alert.message || ''}`);
      if (Number.isFinite(alert.count)) {
        lines.push(`   Count: ${alert.count}`);
      }
      if (alert.context) {
        Object.entries(alert.context).forEach(([key, value]) => {
          lines.push(`   ${key}: ${Array.isArray(value) ? value.join(', ') : String(value)}`);
        });
      }
    });
  }

  lines.push('', 'Note', 'This report is generated from live audit signals and should be reviewed alongside the full audit log before distribution.');
  return lines.join('\n');
}

function exportComplianceReport(signalData = auditSignalsState) {
  const reportText = buildComplianceReportText(signalData);
  const blob = new Blob([reportText], { type: 'text/plain;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `audit_compliance_report_${new Date().toISOString().slice(0, 10)}.txt`;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  showToast('Compliance report exported.', 'success');
}

// ── Details modal ─────────────────────────────────────────────────────────────
function formatDetailsHTML(obj) {
  if (obj === null || obj === undefined) return '<i>null</i>';
  if (typeof obj !== 'object') return escapeHtml(String(obj));
  if (Array.isArray(obj)) {
    if (!obj.length) return '<i>empty list</i>';
    return `<ul style="margin:0;padding-left:20px;">${obj.map(v => `<li>${formatDetailsHTML(v)}</li>`).join('')}</ul>`;
  }
  const entries = Object.entries(obj);
  if (!entries.length) return '<i>empty</i>';
  let html = `<div style="border:1px solid var(--border-primary);border-radius:var(--radius-md);overflow:hidden;">
    <table class="data-table" style="margin:0;width:100%;box-shadow:none;">
      <thead><tr>
        <th style="width:35%;padding:10px 16px;font-size:11px;">KEY</th>
        <th style="padding:10px 16px;font-size:11px;">VALUE</th>
      </tr></thead><tbody>`;
  for (const [key, value] of entries) {
    const label = key.replace(/([A-Z])/g, ' $1').replace(/_/g, ' ').replace(/^./, s => s.toUpperCase());
    html += `<tr>
      <td style="padding:10px 16px;font-weight:500;color:var(--text-secondary);white-space:nowrap;font-size:13px;">${escapeHtml(label)}</td>
      <td style="padding:10px 16px;color:var(--text-primary);font-size:13px;word-break:break-word;">
        ${typeof value === 'object' && value !== null ? formatDetailsHTML(value) : escapeHtml(String(value))}
      </td>
    </tr>`;
  }
  html += `</tbody></table></div>`;
  return html;
}

export function openAuditDetailsModal(logIndex) {
  const log = window.auditLogsData[logIndex];
  if (!log) return;

  const el = id => document.getElementById(id);
  const username = log.userName || `User #${log.userId}`;
  const userRole = log.userRole || '';
  const action = formatActionType(log.actionType);
  const timestamp = parseUTC(log.createdAt).toLocaleString();
  const details = log.details || {};

  // Breadcrumb + title
  if (el('audit-drawer-entry-id')) el('audit-drawer-entry-id').textContent = `Entry #${log.id || logIndex}`;
  if (el('audit-drawer-title')) el('audit-drawer-title').textContent = action;

  // Context fields
  if (el('audit-detail-action')) el('audit-detail-action').textContent = action;
  if (el('audit-detail-timestamp')) el('audit-detail-timestamp').textContent = timestamp;
  if (el('audit-detail-ip')) el('audit-detail-ip').textContent = log.ipAddress || '—';
  if (el('audit-detail-user')) el('audit-detail-user').textContent = username;
  if (el('audit-detail-role')) el('audit-detail-role').textContent = userRole;
  if (el('audit-detail-useragent')) el('audit-detail-useragent').textContent = log.userAgent || '—';

  // Avatar
  const avatarEl = el('audit-detail-avatar');
  if (avatarEl) {
    avatarEl.textContent = getInitials(username);
    avatarEl.style.background = getAvatarColor(username);
  }

  // Payload tabs
  const previewBtn = el('audit-tab-preview');
  const rawBtn = el('audit-tab-raw');
  const content = el('audit-detail-content');

  const previewHTML = Object.keys(details).length
    ? formatDetailsHTML(details)
    : '<div style="padding:20px;text-align:center;color:var(--text-muted);">No payload data available</div>';

  const rawHTML = `<pre class="audit-raw-json">${escapeHtml(JSON.stringify(details, null, 2))}</pre>`;

  function showPreview() {
    content.innerHTML = previewHTML;
    previewBtn.classList.add('active');
    rawBtn.classList.remove('active');
  }
  function showRaw() {
    content.innerHTML = rawHTML;
    rawBtn.classList.add('active');
    previewBtn.classList.remove('active');
  }

  // Default to preview tab
  showPreview();
  previewBtn.onclick = showPreview;
  rawBtn.onclick = showRaw;

  // Open drawer
  document.getElementById('audit-detail-drawer')?.classList.add('open');
  document.getElementById('audit-drawer-backdrop')?.classList.add('open');
  document.body.style.overflow = 'hidden';
}

export function closeAuditDetailsModal() {
  document.getElementById('audit-detail-drawer')?.classList.remove('open');
  document.getElementById('audit-drawer-backdrop')?.classList.remove('open');
  document.body.style.overflow = '';
}

// ── Export CSV ────────────────────────────────────────────────────────────────
async function fetchAllAuditLogsForExport() {
  const pageSize = 100;
  let page = 1;
  let allLogs = [];

  while (page <= 50) {
    const json = await fetchAuditLogsPage(auditCurrentFilters, page, pageSize);
    const logs = json?.data || [];
    allLogs = allLogs.concat(logs);

    const pagination = json?.pagination || { pages: 1 };
    if (page >= (pagination.pages || 1) || logs.length < pageSize) {
      break;
    }

    page += 1;
  }

  return allLogs;
}

async function exportAuditLogsCSV() {
  const logs = await fetchAllAuditLogsForExport();
  if (!logs.length) {
    showToast('No audit log data to export.', 'info');
    return;
  }
  const headers = ['Timestamp', 'User', 'Role', 'Action', 'Description', 'IP Address'];
  const rows = logs.map(log => [
    parseUTC(log.createdAt).toLocaleString(),
    log.userName || `User #${log.userId}`,
    log.userRole || '',
    formatActionType(log.actionType),
    generateDescription(log.actionType, log.details),
    log.ipAddress || ''
  ]);
  const csv = [headers, ...rows].map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' }));
  a.download = `audit_logs_${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  showToast('Audit logs exported as CSV.', 'success');
}

// ── Initialize ────────────────────────────────────────────────────────────────
export async function initializeAudit() {
  populateActionFilter();
  await populateUserFilter();

  const get = id => document.getElementById(id);
  safeAdd(get('audit-start-date'), 'change', applyAuditFilters);
  safeAdd(get('audit-end-date'), 'change', applyAuditFilters);
  safeAdd(get('audit-user-filter'), 'input', applyAuditFilters);
  safeAdd(get('audit-action-filter'), 'change', applyAuditFilters);
  safeAdd(get('audit-ip-filter'), 'input', applyAuditFilters);
  safeAdd(get('audit-export-btn'), 'click', exportAuditLogsCSV);
  safeAdd(get('audit-refresh-btn'), 'click', applyAuditFilters);
  safeAdd(get('audit-clear-filters-btn'), 'click', clearAuditFilters);

  const modal = get('audit-details-modal');
  if (modal) modal.addEventListener('click', e => { if (e.target === modal) closeAuditDetailsModal(); });

  // Close drawer when clicking the backdrop
  document.getElementById('audit-drawer-backdrop')?.addEventListener('click', closeAuditDetailsModal);
  document.querySelectorAll('#audit-details-modal .modal-close, #audit-details-modal .btn-secondary')
    .forEach(btn => safeAdd(btn, 'click', closeAuditDetailsModal));

  window.closeAuditDetailsModal = closeAuditDetailsModal;
  window.openAuditDetailsModal = openAuditDetailsModal;

  const logs = await fetchAuditLogs({}, 1, 25);
  renderAuditLogs(logs);
  auditSignalsState = await fetchSuspiciousSignals(15);
  renderSuspiciousSignals(auditSignalsState);
}
