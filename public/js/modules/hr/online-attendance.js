/**
 * HR Online Attendance Processing Module
 * Handles employee-submitted online class intake and done tracking
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
  const doneBtn = document.getElementById('onlineAttendanceDoneBtn');
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

  if (doneBtn) {
    doneBtn.addEventListener('click', () => markAsDone());
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

function showOnlineAttendanceToast(message, type = 'info') {
  if (!message || typeof document === 'undefined' || !document.body) {
    return;
  }

  const existingToast = document.getElementById('onlineAttendanceToast');
  if (existingToast) {
    existingToast.remove();
  }

  const palette = type === 'success'
    ? { background: '#064e3b', border: '#10b981', color: '#ecfdf5' }
    : type === 'error'
      ? { background: '#7f1d1d', border: '#ef4444', color: '#fef2f2' }
      : { background: '#0f172a', border: '#38bdf8', color: '#e0f2fe' };

  const toast = document.createElement('div');
  toast.id = 'onlineAttendanceToast';
  toast.setAttribute('role', 'status');
  toast.setAttribute('aria-live', 'polite');
  toast.textContent = message;
  toast.style.cssText = `
    position: fixed;
    top: 20px;
    right: 20px;
    z-index: 10000;
    max-width: min(92vw, 360px);
    padding: 12px 16px;
    border-radius: 10px;
    border: 1px solid ${palette.border};
    background: ${palette.background};
    color: ${palette.color};
    box-shadow: 0 12px 24px rgba(0, 0, 0, 0.18);
    font-size: 14px;
    line-height: 1.4;
    font-weight: 600;
    letter-spacing: 0.01em;
  `;

  document.body.appendChild(toast);

  const dismissToast = () => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(-4px)';
    toast.style.transition = 'opacity 0.2s ease, transform 0.2s ease';
    window.setTimeout(() => toast.remove(), 200);
  };

  const timeoutId = window.setTimeout(dismissToast, 2800);
  toast.addEventListener('click', () => {
    window.clearTimeout(timeoutId);
    toast.remove();
  });
}

function parseOnlineAttendanceTimestamp(value) {
  if (!value) return 0;

  const parsed = Date.parse(String(value));
  return Number.isNaN(parsed) ? 0 : parsed;
}

function getPendingAttendanceTimestamp(record) {
  const metadata = record?.metadata || {};
  const fallbackTimestamp = record?.date && record?.time_in
    ? `${record.date}T${record.time_in}`
    : record?.date || null;

  const candidates = [
    metadata?.submitted_at,
    record?.submitted_at,
    record?.created_at,
    record?.saved_at,
    fallbackTimestamp
  ];

  for (const candidate of candidates) {
    const candidateTimestamp = parseOnlineAttendanceTimestamp(candidate);
    if (candidateTimestamp) {
      return candidateTimestamp;
    }
  }

  return 0;
}

function getDoneAttendanceTimestamp(record) {
  const metadata = record?.metadata || {};
  const fallbackTimestamp = record?.date && record?.time_in
    ? `${record.date}T${record.time_in}`
    : record?.date || null;

  const candidates = [
    metadata?.done_at,
    metadata?.verified_at,
    metadata?.submitted_at,
    record?.submitted_at,
    record?.created_at,
    record?.saved_at,
    fallbackTimestamp
  ];

  for (const candidate of candidates) {
    const candidateTimestamp = parseOnlineAttendanceTimestamp(candidate);
    if (candidateTimestamp) {
      return candidateTimestamp;
    }
  }

  return 0;
}

function sortOnlineAttendanceRecords(records, mode = 'pending') {
  const items = Array.isArray(records) ? [...records] : [];
  const getTimestamp = mode === 'done' ? getDoneAttendanceTimestamp : getPendingAttendanceTimestamp;

  return items.sort((left, right) => getTimestamp(right) - getTimestamp(left));
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
  const pendingClear = document.getElementById('onlineAttendancePendingClearFilters');
  const pendingPrev = document.getElementById('onlineAttendancePendingPrevPage');
  const pendingNext = document.getElementById('onlineAttendancePendingNextPage');

  if (pendingSearch) pendingSearch.addEventListener('input', () => { pendingCurrentPage = 1; renderPendingSection(); });
  if (pendingModeFilter) pendingModeFilter.addEventListener('change', () => { pendingCurrentPage = 1; renderPendingSection(); });
  if (pendingClear) pendingClear.addEventListener('click', () => {
    if (pendingSearch) pendingSearch.value = '';
    if (pendingModeFilter) pendingModeFilter.value = '';
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
  const historyClear = document.getElementById('onlineAttendanceHistoryClearFilters');
  const historyPrev = document.getElementById('onlineAttendanceHistoryPrevPage');
  const historyNext = document.getElementById('onlineAttendanceHistoryNextPage');

  if (historySearch) historySearch.addEventListener('input', () => { historyCurrentPage = 1; renderHistorySection(); });
  if (historyClear) historyClear.addEventListener('click', () => {
    if (historySearch) historySearch.value = '';
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
    pendingRecordsCache = sortOnlineAttendanceRecords(Array.isArray(records) ? records : [], 'pending');
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

  const filteredRecords = sortOnlineAttendanceRecords(filterPendingRecords(pendingRecordsCache), 'pending');
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
    mode: (document.getElementById('onlineAttendancePendingModeFilter')?.value || '').trim().toLowerCase()
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
  const { search, mode } = getPendingFilterValues();

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

    return matchesSearch && matchesMode;
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
          <button class="btn-view-details" onclick="window.viewOnlineAttendanceDetails('${record.attendance_id}')" style="padding: 6px 12px; background: var(--accent-primary); color: var(--bg-primary); border: none; border-radius: 4px; cursor: pointer; font-size: 12px; font-weight: 500; transition: background 0.2s;">
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
      showOnlineAttendanceToast('Record not found', 'error');
      return;
    }

    currentSelectedRecord = record;
    showDetailsModal(record);
  } catch (error) {
    console.error('[Online Attendance HR] View details error:', error);
    showOnlineAttendanceToast('Error loading record details', 'error');
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
 * Mark the selected submission as done
 */
async function markAsDone() {
  if (!currentSelectedRecord) {
    showOnlineAttendanceToast('No record selected', 'error');
    return;
  }

  const attendanceId = currentSelectedRecord.attendance_id;
  const doneBtn = document.getElementById('onlineAttendanceDoneBtn');
  if (!doneBtn) {
    showOnlineAttendanceToast('Done action is unavailable', 'error');
    return;
  }

  const originalText = doneBtn.textContent;

  doneBtn.disabled = true;
  doneBtn.textContent = 'Marking as Done...';

  let markedSuccessfully = false;

  try {
    const apiBase = window.API_URL || '/api';
    const response = await fetch(`${apiBase}/attendance/hr/online-attendance/done`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        attendanceId,
        notes: null
      })
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.message || 'Failed to mark record as done');
    }

    console.log('[Online Attendance HR] Successfully marked record as done');

    markedSuccessfully = true;

    // Close modal and refresh
    closeDetailsModal();
    showOnlineAttendanceToast('Record marked as done successfully', 'success');
  } catch (error) {
    console.error('[Online Attendance HR] Done action error:', error);
    showOnlineAttendanceToast(`Error: ${error.message}`, 'error');
  } finally {
    doneBtn.disabled = false;
    doneBtn.textContent = originalText;
  }

  if (markedSuccessfully) {
    try {
      await loadPendingRecords();
    } catch (refreshError) {
      console.error('[Online Attendance HR] Refresh after done error:', refreshError);
      showOnlineAttendanceToast('Record updated, but the list could not refresh.', 'error');
    }
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
 * Load processed done records
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
    const response = await fetch(`${apiBase}/attendance/hr/online-attendance/done`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json'
      }
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch done records: ${response.status}`);
    }

    const result = await response.json();
    const records = result.data || [];
    historyRecordsCache = sortOnlineAttendanceRecords(Array.isArray(records) ? records : [], 'done');
    historyCurrentPage = 1;

    console.log('[Online Attendance HR] Loaded done records:', historyRecordsCache.length);

    if (loadingState) loadingState.style.display = 'none';

    renderHistorySection();
  } catch (error) {
    console.error('[Online Attendance HR] Done load error:', error);
    if (loadingState) loadingState.style.display = 'none';
    if (emptyState) emptyState.style.display = 'flex';
    
    // Show error message
    const errorMsg = document.createElement('div');
    errorMsg.style.cssText = 'color: var(--red-primary); padding: 12px; border-radius: var(--radius-md); background: var(--red-badge-bg); margin-top: var(--spacing-md);';
    errorMsg.textContent = `Error loading done records: ${error.message}`;
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

  const filteredRecords = sortOnlineAttendanceRecords(filterHistoryRecords(historyRecordsCache), 'done');
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
    search: (document.getElementById('onlineAttendanceHistorySearch')?.value || '').trim().toLowerCase()
  };
}

function getHistoryRecordStatus() {
  return 'done';
}

function filterHistoryRecords(records) {
  const { search } = getHistoryFilterValues();

  return records.filter(record => {
    const metadata = record.metadata || {};
    const employee = record.employees || {};
    const employeeName = `${employee.first_name || ''} ${employee.last_name || ''}`.trim();
    const subject = metadata.subject || '';
    const verifiedBy = metadata.done_by_email || metadata.done_by || metadata.verified_by_email || metadata.verified_by || '';
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

    return matchesSearch;
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
    
    console.log('[Done Render] Record:', record.attendance_id, 'Metadata:', metadata);

    const doneAtSource = metadata.done_at || metadata.verified_at || null;
    const doneBy = metadata.done_by_email
      ? metadata.done_by_email
      : (metadata.done_by ? `User #${metadata.done_by}` : (metadata.verified_by_email ? metadata.verified_by_email : (metadata.verified_by ? `User #${metadata.verified_by}` : 'N/A')));
    const doneAt = doneAtSource ? formatDateTime(doneAtSource) : 'N/A';

    const statusBadge = '<span style="display: inline-block; padding: 4px 8px; border-radius: 4px; font-size: 11px; font-weight: 600; background: rgba(34, 197, 94, 0.1); color: #22c55e;">Done ✓</span>';

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
        <td style="padding: 12px; color: var(--text-primary); font-size: var(--text-sm);">${doneBy}</td>
        <td style="padding: 12px; color: var(--text-primary); font-size: var(--text-sm);">${doneAt}</td>
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
