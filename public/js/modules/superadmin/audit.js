/**
 * audit.js
 * Audit Logs Management and Display
 */

import { fetchWithAuth, escapeHtml, safeAdd, formatActionType, actionTypeMap } from './utils.js';
import { fetchUsers } from './users.js'; // Helper for populating user filter

// Global storage for logs to support modal details
window.auditLogsData = [];

export async function fetchAuditLogs(filters = {}) {
  const query = new URLSearchParams(filters).toString();
  try {
    const response = await fetchWithAuth(`/admin/audit-logs?${query}`, {
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' }
    });
    if (response.ok) {
      const responseData = await response.json();
      return responseData.data || responseData || [];
    } else {
      console.error('Failed to fetch audit logs');
      return [];
    }
  } catch (e) {
    console.error('Error fetching audit logs:', e);
    return [];
  }
}

export function renderAuditLogs(logs) {
  const auditLogsTbody = document.getElementById('audit-logs-tbody');
  if (!auditLogsTbody) return;

  auditLogsTbody.innerHTML = '';

  // Update global store
  window.auditLogsData = logs || [];

  if (!logs || logs.length === 0) {
    auditLogsTbody.innerHTML = '<tr><td colspan="4" style="text-align:center;padding:24px;color:var(--muted-foreground);">No audit logs found for the selected criteria.</td></tr>';
    return;
  }

  logs.forEach((log, index) => {
    const timestamp = new Date(log.createdAt).toLocaleString();
    const actionType = formatActionType(log.actionType);
    const username = log.userName || `User ID: ${log.userId || 'Unknown'}`;

    const row = `
            <tr>
                <td>${escapeHtml(timestamp)}</td>
                <td>${escapeHtml(username)}</td>
                <td><span class="status action-${(log.actionType || '').toLowerCase()}">${escapeHtml(actionType)}</span></td>
                <td><button class="btn-small btn-view-audit" data-index="${index}" style="padding: 4px 12px; font-size: 0.875rem;">View</button></td>
            </tr>
        `;
    auditLogsTbody.insertAdjacentHTML('beforeend', row);
  });

  // Attach listeners for view buttons
  document.querySelectorAll('.btn-view-audit').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const index = e.target.getAttribute('data-index');
      openAuditDetailsModal(index);
    });
  });
}

export async function populateUserFilter() {
  const auditUserFilter = document.getElementById('audit-user-filter');
  if (!auditUserFilter) return;

  try {
    const users = await fetchUsers(1, '', 'all'); // Fetch all users for filter
    if (!users || !Array.isArray(users)) {
      console.warn('populateUserFilter: users data is invalid', users);
      return;
    }
    auditUserFilter.innerHTML = '<option value="">All Users</option>'; // Reset
    users.forEach(user => {
      const option = document.createElement('option');
      option.value = user.user_id;
      // Include username for clarity
      option.textContent = `${user.full_name || user.username} (${user.username})`;
      auditUserFilter.appendChild(option);
    });
  } catch (error) {
    console.error('Error populating user filter:', error);
  }
}

function populateActionFilter() {
  const auditActionFilter = document.getElementById('audit-action-filter');
  if (!auditActionFilter) return;

  auditActionFilter.innerHTML = '<option value="">All Actions</option>';
  Object.entries(actionTypeMap).forEach(([dbValue, displayName]) => {
    const option = document.createElement('option');
    option.value = dbValue;
    option.textContent = displayName;
    auditActionFilter.appendChild(option);
  });
}

async function applyAuditFilters() {
  const auditStartDate = document.getElementById('audit-start-date');
  const auditEndDate = document.getElementById('audit-end-date');
  const auditUserFilter = document.getElementById('audit-user-filter');
  const auditActionFilter = document.getElementById('audit-action-filter');

  const filters = {};
  if (auditStartDate && auditStartDate.value) filters.startDate = auditStartDate.value;
  if (auditEndDate && auditEndDate.value) filters.endDate = auditEndDate.value;
  if (auditUserFilter && auditUserFilter.value) filters.userId = auditUserFilter.value;
  if (auditActionFilter && auditActionFilter.value) filters.actionType = auditActionFilter.value;

  const logs = await fetchAuditLogs(filters);
  renderAuditLogs(logs);
}

// Modal Functions
export function openAuditDetailsModal(logIndex) {
  const log = window.auditLogsData[logIndex];
  if (!log) {
    console.warn('Log data not found at index:', logIndex);
    return;
  }

  const timestamp = new Date(log.createdAt).toLocaleString();
  const actionType = formatActionType(log.actionType);
  const username = log.userName || `User ID: ${log.userId || 'Unknown'}`;
  const details = log.details || {};

  // Populate modal fields
  const el = (id) => document.getElementById(id);
  if (el('audit-detail-timestamp')) el('audit-detail-timestamp').textContent = timestamp;
  if (el('audit-detail-user')) el('audit-detail-user').textContent = username;
  if (el('audit-detail-action')) el('audit-detail-action').textContent = actionType;

  // Format and display details
  const detailsContent = el('audit-detail-content');
  if (detailsContent) {
    if (details && Object.keys(details).length > 0) {
      detailsContent.innerHTML = `<pre style="margin: 0; white-space: pre-wrap; word-wrap: break-word;">${escapeHtml(JSON.stringify(details, null, 2))}</pre>`;
    } else {
      detailsContent.textContent = 'No additional details available';
    }
  }

  // Show modal
  const modal = document.getElementById('audit-details-modal');
  if (modal) {
    modal.style.display = 'flex';
  }
}

export function closeAuditDetailsModal() {
  const modal = document.getElementById('audit-details-modal');
  if (modal) {
    modal.style.display = 'none';
  }
}

export async function initializeAudit() {
  populateActionFilter();

  // Event listeners
  const auditStartDate = document.getElementById('audit-start-date');
  const auditEndDate = document.getElementById('audit-end-date');
  const auditUserFilter = document.getElementById('audit-user-filter');
  const auditActionFilter = document.getElementById('audit-action-filter');

  safeAdd(auditStartDate, 'change', applyAuditFilters);
  safeAdd(auditEndDate, 'change', applyAuditFilters);
  safeAdd(auditUserFilter, 'change', applyAuditFilters);
  safeAdd(auditActionFilter, 'change', applyAuditFilters);

  // Populate user filter on first click (lazy)
  let userFilterPopulated = false;
  if (auditUserFilter) {
    auditUserFilter.addEventListener('click', async function (e) {
      if (!userFilterPopulated && auditUserFilter.children.length <= 1) {
        userFilterPopulated = true;
        await populateUserFilter();
      }
    });
  }

  // Modal close listeners
  const modal = document.getElementById('audit-details-modal');
  if (modal) {
    modal.addEventListener('click', (e) => {
      if (e.target === modal) closeAuditDetailsModal();
    });
  }
  const closeBtn = document.querySelector('#audit-details-modal .close-modal'); // assuming there's a close btn class
  if (closeBtn) safeAdd(closeBtn, 'click', closeAuditDetailsModal);

  // Initial load
  const logs = await fetchAuditLogs();
  renderAuditLogs(logs);
}
