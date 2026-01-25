
import { fetchHeadInfo, escapeHtml } from './utils.js';

export async function fetchApprovalRequests(department) {
  const apiBase = window.API_URL || window.__MOCK_API_BASE__ || '/api';

  try {
    const url = `${apiBase}/requests/pending?department=${encodeURIComponent(department)}&_t=${Date.now()}`;
    console.log('[fetchApprovalRequests] Fetching from:', url);
    // Use fetchWithAuth for cookie-based session auth
    const r = await window.fetchWithAuth(url, {});
    if (!r.ok) {
      console.error('[fetchApprovalRequests] Request failed with status:', r.status);
      return [];
    }
    const res = await r.json();
    // Backend returns { success: true, data: [...], pagination: ... }
    const requests = res.data || (Array.isArray(res) ? res : []);
    console.log('[fetchApprovalRequests] Received', requests.length, 'approval requests for department:', department);
    // console.log('[fetchApprovalRequests] Raw response:', res);
    return requests;
  } catch (e) {
    console.warn('❌ fetchApprovalRequests failed', e);
    return [];
  }
}

export function renderApprovalRequests(requests) {
  const table = document.querySelector('.approval-table');
  if (!table) return;
  const tbody = table.querySelector('tbody');
  if (!tbody) return;
  tbody.innerHTML = ''; // Clear existing rows

  // Render approval requests into the approvals table

  if (!Array.isArray(requests) || requests.length === 0) {
    const tr = document.createElement('tr');
    tr.id = 'approval-empty-row';
    tr.innerHTML = `
            <td colspan="5" style="text-align: center; padding: 32px; border: none;">
                <div style="display: flex; flex-direction: column; align-items: center; justify-content: center;">
                    <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="margin-bottom: 8px; opacity: 0.5;">
                        <path d="M9 12l2 2 4-4"></path>
                        <circle cx="12" cy="12" r="10"></circle>
                    </svg>
                    <div style="font-size: 14px; color: var(--text-secondary);">No pending approvals at this time.</div>
                </div>
            </td>
        `;
    tbody.appendChild(tr);
    return;
  }

  for (const req of requests) {
    const tr = document.createElement('tr');
    tr.dataset.requestId = req.id;

    // Handle different possible field names and formats
    const employeeName = req.employee_name || req.employeeName || req.name || 'Unknown Employee';
    const requestType = req.request_type || req.requestType || req.type || 'Unknown';

    // Handle reason parsing from multiple sources
    let reason = req.reason || req.description || req.notes;

    // If no reason found, try parsing from details JSON
    if (!reason && req.details) {
      if (typeof req.details === 'string') {
        try {
          const detailsObj = JSON.parse(req.details);
          reason = detailsObj.reason || detailsObj.description || detailsObj.notes;
        } catch (e) {
          console.error('Error parsing details JSON for reason:', e);
        }
      } else if (typeof req.details === 'object') {
        reason = req.details.reason || req.details.description || req.details.notes;
      }
    }

    reason = reason || 'No reason provided';

    // Format dates properly - handle multiple possible formats
    let dates = '';

    // Try to get dates from multiple sources
    let startDate = req.start_date || req.startDate;
    let endDate = req.end_date || req.endDate;

    // If not found, try from details object
    if (!startDate && req.details) {
      if (typeof req.details === 'object') {
        startDate = req.details.start_date || req.details.date || req.details.startDate;
        endDate = req.details.end_date || req.details.date || req.details.endDate;
      }
    }

    // console.log('Processing dates for request:', req.id, 'startDate:', startDate, 'endDate:', endDate);

    if (startDate && startDate !== 'null' && startDate !== null) {
      try {
        const start = new Date(startDate).toLocaleDateString();
        // For single-day requests, only show one date
        if (endDate && endDate !== 'null' && endDate !== null && endDate !== startDate) {
          const end = new Date(endDate).toLocaleDateString();
          dates = `${start} to ${end}`;
        } else {
          dates = start;
        }
      } catch (e) {
        console.error('Error parsing dates:', e, 'startDate:', startDate, 'endDate:', endDate);
        dates = 'Invalid date format';
      }
    } else {
      console.log('No valid start date found for request:', req.id);
      dates = 'No date specified';
    }

    // Determine request type badge class
    const badgeClass = requestType.toLowerCase() === 'leave' ? 'leave' : 'overtime';

    tr.innerHTML = `
            <td><span class="employee-name">${escapeHtml(employeeName)}</span></td>
            <td><span class="request-type-badge ${badgeClass}">${escapeHtml(requestType)}</span></td>
            <td><span class="date-range">${escapeHtml(dates)}</span></td>
            <td><span class="request-reason">${escapeHtml(reason)}</span></td>
            <td>
                <div class="approval-actions">
                    <button class="btn-approve">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M9 12l2 2 4-4"></path>
                            <circle cx="12" cy="12" r="10"></circle>
                        </svg>
                        Approve
                    </button>
                    <button class="btn-decline">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <circle cx="12" cy="12" r="10"></circle>
                            <line x1="15" y1="9" x2="9" y2="15"></line>
                            <line x1="9" y1="9" x2="15" y2="15"></line>
                        </svg>
                        Decline
                    </button>
                </div>
            </td>
        `;
    tbody.appendChild(tr);
  }
}

async function handleApprovalAction(requestId, action) {
  const apiBase = window.API_URL || window.__MOCK_API_BASE__ || '/api';

  try {
    let url;
    let method = 'POST';
    let body = {};
    let confirmMsg = '';

    if (action === 'approved') {
      confirmMsg = 'Are you sure you want to approve this request?';
      url = `${apiBase}/requests/${requestId}/approve`;
    } else if (action === 'rejected') {
      confirmMsg = 'Are you sure you want to decline this request?';
      url = `${apiBase}/requests/${requestId}/reject`;
      // body = { reason: 'No reasoning provided' }; // User asked not to add reasoning for now
    } else {
      console.warn('Unknown action:', action);
      return;
    }

    if (!confirm(confirmMsg)) return;

    const r = await window.fetchWithAuth(url, {
      method: method,
      body: JSON.stringify(body)
    });

    if (r.ok) {
      // Refresh the list after action
      loadApprovalRequests();
    } else {
      const res = await r.json();
      alert('Action failed: ' + (res.message || 'Unknown error'));
    }
  } catch (e) {
    console.error('handleApprovalAction failed', e);
    alert('An error occurred. Please try again.');
  }
}

export async function loadApprovalRequests() {
  try {
    const head = await fetchHeadInfo();
    const dept = head && head.department ? head.department : null;

    if (dept) {
      const requests = await fetchApprovalRequests(dept);
      renderApprovalRequests(requests);
    } else {
      renderApprovalRequests([]);
    }
  } catch (e) {
    console.warn('loadApprovalRequests failed', e);
    renderApprovalRequests([]);
  }
}

export function initApprovals() {
  // Event delegation for table actions
  const approvalTableBody = document.querySelector('.approval-table tbody');
  if (approvalTableBody) {
    // Remove existing listeners if any (by replacing the node or just ensuring only one init)
    // Since we are moving to modules, we assume init is called once.
    approvalTableBody.addEventListener('click', function (event) {
      const target = event.target;
      // Handle button clicks (could be on the button or explicit SVG/text inside)
      const btn = target.closest('button');
      if (!btn) return;

      const tr = btn.closest('tr');
      if (!tr || !tr.dataset.requestId) return;

      const requestId = tr.dataset.requestId;
      if (btn.classList.contains('btn-approve')) {
        handleApprovalAction(requestId, 'approved');
      } else if (btn.classList.contains('btn-decline')) {
        handleApprovalAction(requestId, 'rejected');
      }
    });
    console.log('[initApprovals] Approval table listener attached');
  }
}
