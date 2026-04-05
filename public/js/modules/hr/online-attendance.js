/**
 * HR Online Attendance Verification Module
 * Handles verification of employee-submitted online class attendance
 */

let currentSelectedRecord = null;
let currentTab = 'pending'; // Track which tab is active
const ONLINE_ATTENDANCE_PAGE_SIZE = 8;
let pendingRecordsCache = [];
let historyRecordsCache = [];
let pendingCurrentPage = 1;
let historyCurrentPage = 1;
let onlineAttendanceSectionObserverBound = false;
let onlineAttendanceSectionObserver = null;

export function initOnlineAttendance() {
  ensureControlPanels();
  bindSectionObserver();
  updateControlVisibility();
  setupEventListeners();
  loadPendingRecords();
  
  // Expose refresh function
  window.refreshOnlineAttendance = () => {
    if (currentTab === 'pending') {
      loadPendingRecords();
    } else {
      loadHistoryRecords();
    }
  };
}

/**
 * Setup event listeners
 */
function setupEventListeners() {
  const verifyBtn = document.getElementById('onlineAttendanceVerifyBtn');
  const rejectBtn = document.getElementById('onlineAttendanceRejectBtn');
  const closeBtn = document.getElementById('onlineAttendanceDetailsClose');
  const pendingTab = document.getElementById('onlineAttendancePendingTab');
  const historyTab = document.getElementById('onlineAttendanceHistoryTab');
  const backdrop = document.getElementById('onlineAttendanceDetailsBackdrop');

  // Tab switching
  if (pendingTab) {
    pendingTab.addEventListener('click', () => switchTab('pending'));
  }

  if (historyTab) {
    historyTab.addEventListener('click', () => switchTab('history'));
  }

  if (verifyBtn) {
    verifyBtn.addEventListener('click', () => submitVerification('verify'));
  }

  if (rejectBtn) {
    rejectBtn.addEventListener('click', () => submitVerification('reject'));
  }

  if (closeBtn) {
    closeBtn.addEventListener('click', () => closeDetailsModal());
  }

  if (backdrop) {
    backdrop.addEventListener('click', () => closeDetailsModal());
  }

  setupFilterEventListeners();
}

/**
 * Keep the sidebar filters and pagination aligned with the current online attendance tab.
 */
function updateControlVisibility() {
  const isOnlineSection = document.body?.dataset?.hrSection === 'online-attendance';
  const pendingFilters = document.getElementById('onlineAttendancePendingFiltersCard');
  const historyFilters = document.getElementById('onlineAttendanceHistoryFiltersCard');
  const pendingPagination = document.getElementById('onlineAttendancePendingPagination');
  const historyPagination = document.getElementById('onlineAttendanceHistoryPagination');

  const showPending = isOnlineSection && currentTab === 'pending';
  const showHistory = isOnlineSection && currentTab === 'history';

  if (pendingFilters) pendingFilters.style.display = showPending ? 'flex' : 'none';
  if (historyFilters) historyFilters.style.display = showHistory ? 'flex' : 'none';
  if (pendingPagination) pendingPagination.style.display = showPending ? 'flex' : 'none';
  if (historyPagination) historyPagination.style.display = showHistory ? 'flex' : 'none';
}

/**
 * Inject pagination controls when the section is initialized.
 */
function ensureControlPanels() {
  const pendingSection = document.getElementById('onlineAttendancePendingSection');
  if (pendingSection && !document.getElementById('onlineAttendancePendingPagination')) {
    pendingSection.insertAdjacentHTML('afterend', `
      <div class="online-attendance-pagination" id="onlineAttendancePendingPagination">
        <div class="online-attendance-pagination__info" id="onlineAttendancePendingPageInfo"></div>
        <div class="online-attendance-pagination__actions">
          <button type="button" class="btn-secondary btn-sm" id="onlineAttendancePendingPrevPage">Previous</button>
          <button type="button" class="btn-secondary btn-sm" id="onlineAttendancePendingNextPage">Next</button>
        </div>
      </div>
    `);
  }

  const historySection = document.getElementById('onlineAttendanceHistorySection');
  if (historySection && !document.getElementById('onlineAttendanceHistoryPagination')) {
    historySection.insertAdjacentHTML('afterend', `
      <div class="online-attendance-pagination" id="onlineAttendanceHistoryPagination">
        <div class="online-attendance-pagination__info" id="onlineAttendanceHistoryPageInfo"></div>
        <div class="online-attendance-pagination__actions">
          <button type="button" class="btn-secondary btn-sm" id="onlineAttendanceHistoryPrevPage">Previous</button>
          <button type="button" class="btn-secondary btn-sm" id="onlineAttendanceHistoryNextPage">Next</button>
        </div>
      </div>
    `);
  }
}

/**
 * Keep sidebar filters updated when the active HR section changes.
 */
function bindSectionObserver() {
  if (onlineAttendanceSectionObserverBound || !document.body || typeof MutationObserver === 'undefined') {
    return;
  }

  onlineAttendanceSectionObserver = new MutationObserver(() => updateControlVisibility());
  onlineAttendanceSectionObserver.observe(document.body, {
    attributes: true,
    attributeFilter: ['data-hr-section']
  });

  onlineAttendanceSectionObserverBound = true;
}

/**
 * Bind pagination and filter controls.
 */
function setupFilterEventListeners() {
  const pendingSearch = document.getElementById('onlineAttendancePendingSearch');
  const pendingModeFilter = document.getElementById('onlineAttendancePendingModeFilter');
  const pendingStatusFilter = document.getElementById('onlineAttendancePendingStatusFilter');
  const pendingClear = document.getElementById('onlineAttendancePendingClearFilters');
  const pendingPrev = document.getElementById('onlineAttendancePendingPrevPage');
  const pendingNext = document.getElementById('onlineAttendancePendingNextPage');

  if (pendingSearch) pendingSearch.addEventListener('input', () => { pendingCurrentPage = 1; renderPendingSection(); });
  if (pendingModeFilter) pendingModeFilter.addEventListener('change', () => { pendingCurrentPage = 1; renderPendingSection(); });
  if (pendingStatusFilter) pendingStatusFilter.addEventListener('change', () => { pendingCurrentPage = 1; renderPendingSection(); });
  if (pendingClear) pendingClear.addEventListener('click', () => {
    if (pendingSearch) pendingSearch.value = '';
    if (pendingModeFilter) pendingModeFilter.value = '';
    if (pendingStatusFilter) pendingStatusFilter.value = '';
    pendingCurrentPage = 1;
    renderPendingSection();
  });
  if (pendingPrev) pendingPrev.addEventListener('click', () => {
    if (pendingCurrentPage > 1) {
      pendingCurrentPage -= 1;
      renderPendingSection();
    }
  });
  if (pendingNext) pendingNext.addEventListener('click', () => {
    pendingCurrentPage += 1;
    renderPendingSection();
  });

  const historySearch = document.getElementById('onlineAttendanceHistorySearch');
  const historyStatusFilter = document.getElementById('onlineAttendanceHistoryStatusFilter');
  const historyClear = document.getElementById('onlineAttendanceHistoryClearFilters');
  const historyPrev = document.getElementById('onlineAttendanceHistoryPrevPage');
  const historyNext = document.getElementById('onlineAttendanceHistoryNextPage');

  if (historySearch) historySearch.addEventListener('input', () => { historyCurrentPage = 1; renderHistorySection(); });
  if (historyStatusFilter) historyStatusFilter.addEventListener('change', () => { historyCurrentPage = 1; renderHistorySection(); });
  if (historyClear) historyClear.addEventListener('click', () => {
    if (historySearch) historySearch.value = '';
    if (historyStatusFilter) historyStatusFilter.value = '';
    historyCurrentPage = 1;
    renderHistorySection();
  });
  if (historyPrev) historyPrev.addEventListener('click', () => {
    if (historyCurrentPage > 1) {
      historyCurrentPage -= 1;
      renderHistorySection();
    }
  });
  if (historyNext) historyNext.addEventListener('click', () => {
    historyCurrentPage += 1;
    renderHistorySection();
  });
}

/**
 * Switch between pending and history tabs
 */
function switchTab(tab) {
  currentTab = tab;
  updateControlVisibility();

  const pendingSection = document.getElementById('onlineAttendancePendingSection');
  const historySection = document.getElementById('onlineAttendanceHistorySection');
  const pendingTab = document.getElementById('onlineAttendancePendingTab');
  const historyTab = document.getElementById('onlineAttendanceHistoryTab');

  const setTabState = (button, active) => {
    if (!button) return;
    button.classList.toggle('active', active);
    button.setAttribute('aria-selected', active ? 'true' : 'false');
  };

  if (tab === 'pending') {
    // Show pending, hide history
    if (pendingSection) pendingSection.style.display = 'block';
    if (historySection) historySection.style.display = 'none';
    setTabState(pendingTab, true);
    setTabState(historyTab, false);
    loadPendingRecords();
  } else {
    // Show history, hide pending
    if (pendingSection) pendingSection.style.display = 'none';
    if (historySection) historySection.style.display = 'block';
    setTabState(pendingTab, false);
    setTabState(historyTab, true);
    loadHistoryRecords();
  }
}

/**
 * Load pending online attendance records
 */
async function loadPendingRecords() {
  const tableBody = document.getElementById('onlineAttendanceTableBody');
  const emptyState = document.getElementById('onlineAttendanceEmptyState');
  const loadingState = document.getElementById('onlineAttendanceLoadingState');

  if (!tableBody) return;

  // Show loading state
  if (loadingState) loadingState.style.display = 'flex';
  if (emptyState) emptyState.style.display = 'none';
  tableBody.innerHTML = '';

  try {
    const apiBase = window.API_URL || '/api';
    const response = await fetch(`${apiBase}/attendance/hr/online-attendance/pending`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json'
      }
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch pending records: ${response.status}`);
    }

    const result = await response.json();
    const records = result.data || [];
    pendingRecordsCache = Array.isArray(records) ? records : [];
    pendingCurrentPage = 1;

    console.log('[Online Attendance HR] Loaded records:', pendingRecordsCache.length);

    if (loadingState) loadingState.style.display = 'none';

    renderPendingSection();
  } catch (error) {
    console.error('[Online Attendance HR] Load error:', error);
    if (loadingState) loadingState.style.display = 'none';
    if (emptyState) emptyState.style.display = 'flex';
    
    // Show error message
    const errorMsg = document.createElement('div');
    errorMsg.style.cssText = 'color: var(--red-primary); padding: 12px; border-radius: var(--radius-md); background: var(--red-badge-bg); margin-top: var(--spacing-md);';
    errorMsg.textContent = `Error loading records: ${error.message}`;
    if (tableBody.parentElement) tableBody.parentElement.appendChild(errorMsg);
  }
}

/**
 * Render the pending tab using the current filters and pagination state.
 */
function renderPendingSection() {
  const tableBody = document.getElementById('onlineAttendanceTableBody');
  const emptyState = document.getElementById('onlineAttendanceEmptyState');
  const pagination = document.getElementById('onlineAttendancePendingPagination');
  const pageInfo = document.getElementById('onlineAttendancePendingPageInfo');
  const prevBtn = document.getElementById('onlineAttendancePendingPrevPage');
  const nextBtn = document.getElementById('onlineAttendancePendingNextPage');

  if (!tableBody) return;

  const filteredRecords = filterPendingRecords(pendingRecordsCache);
  if (filteredRecords.length === 0) {
    tableBody.innerHTML = '';
    if (emptyState) emptyState.style.display = 'flex';
    if (pagination) pagination.style.display = 'none';
    return;
  }

  if (emptyState) emptyState.style.display = 'none';

  const totalPages = Math.max(1, Math.ceil(filteredRecords.length / ONLINE_ATTENDANCE_PAGE_SIZE));
  if (pendingCurrentPage > totalPages) pendingCurrentPage = totalPages;

  const startIndex = (pendingCurrentPage - 1) * ONLINE_ATTENDANCE_PAGE_SIZE;
  const pageRecords = filteredRecords.slice(startIndex, startIndex + ONLINE_ATTENDANCE_PAGE_SIZE);
  renderPendingRecords(pageRecords, tableBody);

  if (pagination) pagination.style.display = 'flex';
  if (pageInfo) {
    const startDisplay = startIndex + 1;
    const endDisplay = startIndex + pageRecords.length;
    pageInfo.textContent = filteredRecords.length === pageRecords.length
      ? `Showing all ${filteredRecords.length} records`
      : `Showing ${startDisplay}-${endDisplay} of ${filteredRecords.length}`;
  }
  if (prevBtn) prevBtn.disabled = pendingCurrentPage <= 1;
  if (nextBtn) nextBtn.disabled = pendingCurrentPage >= totalPages;
}

function getPendingFilterValues() {
  return {
    search: (document.getElementById('onlineAttendancePendingSearch')?.value || '').trim().toLowerCase(),
    mode: (document.getElementById('onlineAttendancePendingModeFilter')?.value || '').trim().toLowerCase(),
    status: (document.getElementById('onlineAttendancePendingStatusFilter')?.value || '').trim().toLowerCase()
  };
}

function getPendingRecordStatus(record) {
  const metadata = record.metadata || {};

  if (metadata.verified_at && metadata.verification_action === 'verify') {
    return 'verified';
  }

  if (metadata.verification_action === 'reject' || metadata.rejection_reason) {
    return 'rejected';
  }

  return 'pending';
}

function filterPendingRecords(records) {
  const { search, mode, status } = getPendingFilterValues();

  return records.filter(record => {
    const metadata = record.metadata || {};
    const employee = record.employees || {};
    const employeeName = `${employee.first_name || ''} ${employee.last_name || ''}`.trim();
    const employeeEmail = employee.email || '';
    const subject = metadata.subject || '';
    const modalType = (metadata.online_class_modal || '').toLowerCase();
    const recordStatus = getPendingRecordStatus(record);
    const searchSource = [
      employeeName,
      employeeEmail,
      subject,
      metadata.instructor_name || '',
      metadata.online_class_modal || '',
      formatDate(record.date),
      recordStatus
    ]
      .join(' ')
      .toLowerCase();

    const matchesSearch = !search || searchSource.includes(search);
    const matchesMode = !mode || modalType === mode;
    const matchesStatus = !status || recordStatus === status;

    return matchesSearch && matchesMode && matchesStatus;
  });
}

/**
 * Render pending records in table
 */
function renderPendingRecords(records, tableBody) {
  const html = records.map(record => {
    const metadata = record.metadata || {};
    const employee = record.employees || {};
    const employeeName = `${employee.first_name || ''} ${employee.last_name || ''}`.trim() || 'Unknown';
    const employeeEmail = employee.email || '';
    const subject = metadata.subject || 'N/A';
    const date = formatDate(record.date);
    const modalType = metadata.online_class_modal || 'N/A';

    // Determine status
    let statusBadge = '<span style="display: inline-block; padding: 4px 8px; border-radius: 4px; font-size: 11px; font-weight: 600; background: var(--border-primary); color: var(--text-secondary);">Pending</span>';
    
    if (metadata.verified_at && metadata.verification_action === 'verify') {
      statusBadge = '<span style="display: inline-block; padding: 4px 8px; border-radius: 4px; font-size: 11px; font-weight: 600; background: rgba(34, 197, 94, 0.1); color: #22c55e;">Verified ✓</span>';
    } else if (metadata.verification_action === 'reject' || metadata.rejection_reason) {
      statusBadge = '<span style="display: inline-block; padding: 4px 8px; border-radius: 4px; font-size: 11px; font-weight: 600; background: rgba(239, 68, 68, 0.1); color: #ef4444;">Rejected</span>';
    }

    return `
      <tr style="border-bottom: 1px solid var(--border-primary);">
        <td style="padding: 12px; color: var(--text-primary); font-size: var(--text-sm);">
          <div style="font-weight: 500;">${escapeHtml(employeeName)}</div>
          <div style="color: var(--text-muted); font-size: 12px;">${escapeHtml(employeeEmail)}</div>
        </td>
        <td style="padding: 12px; color: var(--text-primary); font-size: var(--text-sm);">${escapeHtml(subject)}</td>
        <td style="padding: 12px; color: var(--text-primary); font-size: var(--text-sm);">${date}</td>
        <td style="padding: 12px; color: var(--text-primary); font-size: var(--text-sm);">
          <span style="display: inline-block; padding: 4px 8px; border-radius: 4px; font-size: 11px; font-weight: 600; background: var(--border-primary); color: var(--text-secondary); text-transform: capitalize;">
            ${escapeHtml(modalType)}
          </span>
        </td>
        <td style="padding: 12px; color: var(--text-primary); font-size: var(--text-sm);">
          ${statusBadge}
        </td>
        <td style="padding: 12px; text-align: center;">
          <button class="btn-view-details" onclick="window.viewOnlineAttendanceDetails('${record.attendance_id}')" style="padding: 6px 12px; background: var(--accent-primary); color: white; border: none; border-radius: 4px; cursor: pointer; font-size: 12px; font-weight: 500; transition: background 0.2s;">
            View Details
          </button>
        </td>
      </tr>
    `;
  }).join('');

  tableBody.innerHTML = html;
}

/**
 * View details and open verification modal
 */
async function viewDetails(attendanceId) {
  try {
    const apiBase = window.API_URL || '/api';
    const response = await fetch(`${apiBase}/attendance/hr/online-attendance/pending`, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' }
    });

    if (!response.ok) throw new Error('Failed to fetch details');

    const result = await response.json();
    const records = result.data || [];
    const record = records.find(r => r.attendance_id == attendanceId);

    if (!record) {
      alert('Record not found');
      return;
    }

    currentSelectedRecord = record;
    showDetailsModal(record);
  } catch (error) {
    console.error('[Online Attendance HR] View details error:', error);
    alert('Error loading record details');
  }
}

/**
 * Show details modal
 */
function showDetailsModal(record) {
  const modal = document.getElementById('onlineAttendanceDetailsModal');
  const backdrop = document.getElementById('onlineAttendanceDetailsBackdrop');
  const content = document.getElementById('onlineAttendanceDetailsContent');
  const metadata = record.metadata || {};
  const employee = record.employees || {};

  const html = `
    <div style="display: flex; flex-direction: column; gap: var(--spacing-lg);">
      <!-- Employee Info -->
      <div style="border-bottom: 1px solid var(--border-primary); padding-bottom: var(--spacing-lg);">
        <h4 style="font-size: var(--text-sm); font-weight: 600; color: var(--text-muted); text-transform: uppercase; margin: 0 0 8px 0;">Employee Information</h4>
        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: var(--spacing-md);">
          <div>
            <label style="font-size: 11px; color: var(--text-muted); text-transform: uppercase; font-weight: 600;">Name</label>
            <p style="margin: 4px 0 0 0; color: var(--text-primary); font-size: var(--text-sm);">${escapeHtml(`${employee.first_name || ''} ${employee.last_name || ''}`.trim())}</p>
          </div>
          <div>
            <label style="font-size: 11px; color: var(--text-muted); text-transform: uppercase; font-weight: 600;">Email</label>
            <p style="margin: 4px 0 0 0; color: var(--text-primary); font-size: var(--text-sm);">${escapeHtml(employee.email || '')}</p>
          </div>
        </div>
      </div>

      <!-- Class Details -->
      <div style="border-bottom: 1px solid var(--border-primary); padding-bottom: var(--spacing-lg);">
        <h4 style="font-size: var(--text-sm); font-weight: 600; color: var(--text-muted); text-transform: uppercase; margin: 0 0 8px 0;">Class Details</h4>
        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: var(--spacing-md);">
          <div>
            <label style="font-size: 11px; color: var(--text-muted); text-transform: uppercase; font-weight: 600;">Subject</label>
            <p style="margin: 4px 0 0 0; color: var(--text-primary); font-size: var(--text-sm);">${escapeHtml(metadata.subject || '')}</p>
          </div>
          <div>
            <label style="font-size: 11px; color: var(--text-muted); text-transform: uppercase; font-weight: 600;">Instructor</label>
            <p style="margin: 4px 0 0 0; color: var(--text-primary); font-size: var(--text-sm);">${escapeHtml(metadata.instructor_name || '')}</p>
          </div>
          <div>
            <label style="font-size: 11px; color: var(--text-muted); text-transform: uppercase; font-weight: 600;">Date</label>
            <p style="margin: 4px 0 0 0; color: var(--text-primary); font-size: var(--text-sm);">${formatDate(record.date)}</p>
          </div>
          <div>
            <label style="font-size: 11px; color: var(--text-muted); text-transform: uppercase; font-weight: 600;">Time In</label>
            <p style="margin: 4px 0 0 0; color: var(--text-primary); font-size: var(--text-sm);">${formatTime(record.time_in)}</p>
          </div>
          <div>
            <label style="font-size: 11px; color: var(--text-muted); text-transform: uppercase; font-weight: 600;">Delivery Mode</label>
            <p style="margin: 4px 0 0 0; color: var(--text-primary); font-size: var(--text-sm); text-transform: capitalize;">${escapeHtml(metadata.online_class_modal || '')}</p>
          </div>
          <div>
            <label style="font-size: 11px; color: var(--text-muted); text-transform: uppercase; font-weight: 600;">Class Period</label>
            <p style="margin: 4px 0 0 0; color: var(--text-primary); font-size: var(--text-sm);">${escapeHtml(metadata.class_period || '')}</p>
          </div>
        </div>
      </div>

      <!-- Program & Section -->
      <div style="border-bottom: 1px solid var(--border-primary); padding-bottom: var(--spacing-lg);">
        <div>
          <label style="font-size: 11px; color: var(--text-muted); text-transform: uppercase; font-weight: 600;">Program | Year | Section</label>
          <p style="margin: 4px 0 0 0; color: var(--text-primary); font-size: var(--text-sm);">${escapeHtml(metadata.program_year_section || '')}</p>
        </div>
      </div>

      <!-- Online Class Link -->
      <div style="border-bottom: 1px solid var(--border-primary); padding-bottom: var(--spacing-lg);">
        <label style="font-size: 11px; color: var(--text-muted); text-transform: uppercase; font-weight: 600; display: block; margin-bottom: 8px;">Online Class Link</label>
        ${metadata.online_class_link ? `
          <a href="${escapeHtml(metadata.online_class_link)}" target="_blank" rel="noopener noreferrer" style="color: var(--accent-primary); font-size: var(--text-sm); word-break: break-all; display: inline-flex; align-items: center; gap: 6px;">
            ${escapeHtml(metadata.online_class_link)}
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path>
              <polyline points="15 3 21 3 21 9"></polyline>
              <line x1="10" y1="14" x2="21" y2="3"></line>
            </svg>
          </a>
        ` : '<p style="margin: 0; color: var(--text-muted); font-size: var(--text-sm);">No link provided</p>'}
      </div>

      <!-- T&C Status -->
      <div style="border-bottom: 1px solid var(--border-primary); padding-bottom: var(--spacing-lg);">
        <label style="font-size: 11px; color: var(--text-muted); text-transform: uppercase; font-weight: 600; display: block; margin-bottom: 8px;">Terms & Conditions</label>
        <div style="display: flex; align-items: center; gap: 8px; color: var(--text-primary); font-size: var(--text-sm);">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="color: var(--green-primary);">
            <polyline points="20 6 9 17 4 12"></polyline>
          </svg>
          <span>Accepted</span>
        </div>
      </div>

      <!-- Submission Time -->
      <div>
        <label style="font-size: 11px; color: var(--text-muted); text-transform: uppercase; font-weight: 600;">Submitted At</label>
        <p style="margin: 4px 0 0 0; color: var(--text-primary); font-size: var(--text-sm);">${formatDateTime(metadata.submitted_at || record.created_at)}</p>
      </div>
    </div>
  `;

  if (content) content.innerHTML = html;
  if (modal) modal.style.display = 'flex';
  if (backdrop) backdrop.style.display = 'block';
}

/**
 * Close details modal
 */
function closeDetailsModal() {
  const modal = document.getElementById('onlineAttendanceDetailsModal');
  const backdrop = document.getElementById('onlineAttendanceDetailsBackdrop');

  if (modal) modal.style.display = 'none';
  if (backdrop) backdrop.style.display = 'none';

  currentSelectedRecord = null;
}

/**
 * Submit verification
 */
async function submitVerification(action) {
  if (!currentSelectedRecord) {
    alert('No record selected');
    return;
  }

  const attendanceId = currentSelectedRecord.attendance_id;
  const verifyBtn = document.getElementById('onlineAttendanceVerifyBtn');
  const rejectBtn = document.getElementById('onlineAttendanceRejectBtn');

  const isVerify = action === 'verify';
  const btn = isVerify ? verifyBtn : rejectBtn;
  const originalText = btn.textContent;

  btn.disabled = true;
  btn.textContent = isVerify ? 'Verifying...' : 'Rejecting...';

  try {
    const apiBase = window.API_URL || '/api';
    const response = await fetch(`${apiBase}/attendance/hr/online-attendance/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        attendanceId,
        action,
        notes: null
      })
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.message || `Failed to ${action} record`);
    }

    console.log(`[Online Attendance HR] Successfully ${action}ed record`);

    // Show success message
    alert(`Record ${action === 'verify' ? 'verified' : 'rejected'} successfully`);

    // Close modal and refresh
    closeDetailsModal();
    loadPendingRecords();
  } catch (error) {
    console.error(`[Online Attendance HR] ${action} error:`, error);
    alert(`Error: ${error.message}`);
    btn.disabled = false;
    btn.textContent = originalText;
  }
}

/**
 * Format date
 */
function formatDate(dateStr) {
  if (!dateStr) return '--';
  const date = new Date(dateStr + 'T00:00:00');
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

/**
 * Format time
 */
function formatTime(timeStr) {
  if (!timeStr) return '--:--';
  return timeStr.substring(0, 5); // HH:MM format
}

/**
 * Format date and time
 */
function formatDateTime(dateTimeStr) {
  if (!dateTimeStr) return '--';
  const date = new Date(dateTimeStr);
  return date.toLocaleDateString('en-US', { 
    month: 'short', 
    day: 'numeric', 
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
}

/**
 * Load verified/rejected history records
 */
async function loadHistoryRecords() {
  const tableBody = document.getElementById('onlineAttendanceHistoryTableBody');
  const emptyState = document.getElementById('onlineAttendanceHistoryEmptyState');
  const loadingState = document.getElementById('onlineAttendanceHistoryLoadingState');

  if (!tableBody) return;

  // Show loading state
  if (loadingState) loadingState.style.display = 'flex';
  if (emptyState) emptyState.style.display = 'none';
  tableBody.innerHTML = '';

  try {
    const apiBase = window.API_URL || '/api';
    const response = await fetch(`${apiBase}/attendance/hr/online-attendance/history`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json'
      }
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch history: ${response.status}`);
    }

    const result = await response.json();
    const records = result.data || [];
    historyRecordsCache = Array.isArray(records) ? records : [];
    historyCurrentPage = 1;

    console.log('[Online Attendance HR] Loaded history records:', historyRecordsCache.length);

    if (loadingState) loadingState.style.display = 'none';

    renderHistorySection();
  } catch (error) {
    console.error('[Online Attendance HR] History load error:', error);
    if (loadingState) loadingState.style.display = 'none';
    if (emptyState) emptyState.style.display = 'flex';
    
    // Show error message
    const errorMsg = document.createElement('div');
    errorMsg.style.cssText = 'color: var(--red-primary); padding: 12px; border-radius: var(--radius-md); background: var(--red-badge-bg); margin-top: var(--spacing-md);';
    errorMsg.textContent = `Error loading history: ${error.message}`;
    if (tableBody.parentElement) tableBody.parentElement.appendChild(errorMsg);
  }
}

/**
 * Render the history tab using the current filters and pagination state.
 */
function renderHistorySection() {
  const tableBody = document.getElementById('onlineAttendanceHistoryTableBody');
  const emptyState = document.getElementById('onlineAttendanceHistoryEmptyState');
  const pagination = document.getElementById('onlineAttendanceHistoryPagination');
  const pageInfo = document.getElementById('onlineAttendanceHistoryPageInfo');
  const prevBtn = document.getElementById('onlineAttendanceHistoryPrevPage');
  const nextBtn = document.getElementById('onlineAttendanceHistoryNextPage');

  if (!tableBody) return;

  const filteredRecords = filterHistoryRecords(historyRecordsCache);
  if (filteredRecords.length === 0) {
    tableBody.innerHTML = '';
    if (emptyState) emptyState.style.display = 'flex';
    if (pagination) pagination.style.display = 'none';
    return;
  }

  if (emptyState) emptyState.style.display = 'none';

  const totalPages = Math.max(1, Math.ceil(filteredRecords.length / ONLINE_ATTENDANCE_PAGE_SIZE));
  if (historyCurrentPage > totalPages) historyCurrentPage = totalPages;

  const startIndex = (historyCurrentPage - 1) * ONLINE_ATTENDANCE_PAGE_SIZE;
  const pageRecords = filteredRecords.slice(startIndex, startIndex + ONLINE_ATTENDANCE_PAGE_SIZE);
  renderHistoryRecords(pageRecords, tableBody);

  if (pagination) pagination.style.display = 'flex';
  if (pageInfo) {
    const startDisplay = startIndex + 1;
    const endDisplay = startIndex + pageRecords.length;
    pageInfo.textContent = filteredRecords.length === pageRecords.length
      ? `Showing all ${filteredRecords.length} records`
      : `Showing ${startDisplay}-${endDisplay} of ${filteredRecords.length}`;
  }
  if (prevBtn) prevBtn.disabled = historyCurrentPage <= 1;
  if (nextBtn) nextBtn.disabled = historyCurrentPage >= totalPages;
}

function getHistoryFilterValues() {
  return {
    search: (document.getElementById('onlineAttendanceHistorySearch')?.value || '').trim().toLowerCase(),
    status: (document.getElementById('onlineAttendanceHistoryStatusFilter')?.value || '').trim().toLowerCase()
  };
}

function getHistoryRecordStatus(record) {
  const metadata = record.metadata || {};

  if (metadata.verification_action === 'reject' || metadata.rejection_reason) {
    return 'rejected';
  }

  return 'verified';
}

function filterHistoryRecords(records) {
  const { search, status } = getHistoryFilterValues();

  return records.filter(record => {
    const metadata = record.metadata || {};
    const employee = record.employees || {};
    const employeeName = `${employee.first_name || ''} ${employee.last_name || ''}`.trim();
    const subject = metadata.subject || '';
    const verifiedBy = metadata.verified_by_email || metadata.verified_by || '';
    const recordStatus = getHistoryRecordStatus(record);
    const searchSource = [
      employeeName,
      employee.email || '',
      subject,
      verifiedBy,
      formatDate(record.date),
      recordStatus
    ]
      .join(' ')
      .toLowerCase();

    const matchesSearch = !search || searchSource.includes(search);
    const matchesStatus = !status || recordStatus === status;

    return matchesSearch && matchesStatus;
  });
}

/**
 * Render history records in table
 */
function renderHistoryRecords(records, tableBody) {
  const html = records.map(record => {
    const metadata = record.metadata || {};
    const employee = record.employees || {};
    const employeeName = `${employee.first_name || ''} ${employee.last_name || ''}`.trim() || 'Unknown';
    const subject = metadata.subject || 'N/A';
    const date = formatDate(record.date);
    
    console.log('[History Render] Record:', record.attendance_id, 'Metadata:', metadata);
    
    // Determine status badge
    let statusBadge = '<span style="display: inline-block; padding: 4px 8px; border-radius: 4px; font-size: 11px; font-weight: 600; background: rgba(34, 197, 94, 0.1); color: #22c55e;">Verified ✓</span>';
    
    if (metadata.verification_action === 'reject' || metadata.rejection_reason) {
      statusBadge = '<span style="display: inline-block; padding: 4px 8px; border-radius: 4px; font-size: 11px; font-weight: 600; background: rgba(239, 68, 68, 0.1); color: #ef4444;">Rejected</span>';
    }
    
    const verifiedAt = metadata.verified_at ? formatDateTime(metadata.verified_at) : 'N/A';
    const verifiedBy = metadata.verified_by_email ? metadata.verified_by_email : (metadata.verified_by ? `User #${metadata.verified_by}` : 'N/A');
    
    console.log('[History Render] Verified By value:', verifiedBy, 'from metadata.verified_by:', metadata.verified_by);

    return `
      <tr style="border-bottom: 1px solid var(--border-primary);">
        <td style="padding: 12px; color: var(--text-primary); font-size: var(--text-sm);">
          <div style="font-weight: 500;">${escapeHtml(employeeName)}</div>
          <div style="color: var(--text-muted); font-size: 12px;">${escapeHtml(employee.email || '')}</div>
        </td>
        <td style="padding: 12px; color: var(--text-primary); font-size: var(--text-sm);">${escapeHtml(subject)}</td>
        <td style="padding: 12px; color: var(--text-primary); font-size: var(--text-sm);">${date}</td>
        <td style="padding: 12px; color: var(--text-primary); font-size: var(--text-sm);">
          ${statusBadge}
        </td>
        <td style="padding: 12px; color: var(--text-primary); font-size: var(--text-sm);">${verifiedBy}</td>
        <td style="padding: 12px; color: var(--text-primary); font-size: var(--text-sm);">${verifiedAt}</td>
      </tr>
    `;
  }).join('');

  tableBody.innerHTML = html;
}

/**
 * Escape HTML
 */
function escapeHtml(text) {
  if (!text) return '';
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// Expose to global for onclick handlers
window.viewOnlineAttendanceDetails = viewDetails;
