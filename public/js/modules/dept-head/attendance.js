
import { fetchHeadInfo, escapeHtml, convertTo12Hour } from './utils.js';
import { updateChips } from './stats.js';

// Store the full attendance data for client-side filtering
let cachedAttendanceData = [];
let cacheRequestId = 0;
// Track the latest request to prevent race conditions
let latestAttendanceRequestId = 0;

async function fetchAttendance(department, filters = {}) {
  // Assign a unique ID to this request
  const requestId = ++latestAttendanceRequestId;
  console.log('[fetchAttendance] Request #' + requestId + ' started for department:', department);

  const apiBase = window.API_URL || window.__MOCK_API_BASE__ || '/api';
  let url = apiBase + '/attendance';
  const params = new URLSearchParams();
  if (department) {
    params.append('department', department);
  }
  if (filters.startDate) {
    params.append('startDate', filters.startDate);
  }
  if (filters.endDate) {
    params.append('endDate', filters.endDate);
  }
  if (filters.employee) {
    params.append('employee', filters.employee);
  }
  if (filters.status) {
    params.append('status', filters.status);
  }
  if (params.toString()) {
    url += '?' + params.toString();
  }

  // Add cache-busting parameter to ensure fresh data
  const separator = url.includes('?') ? '&' : '?';
  url += `${separator}_t=${Date.now()}`;

  try {
    const r = await window.fetchWithAuth(url, {});
    if (!r.ok) return [];
    const res = await r.json();
    // Unwrap data (backend sends { success: true, data: [...], pagination: ... })
    const rows = res.data || (Array.isArray(res) ? res : []);

    // Only return data if this is still the latest request
    if (requestId === latestAttendanceRequestId) {
      console.log('[fetchAttendance] Request #' + requestId + ' completed with', rows.length, 'records');
      return rows;
    } else {
      console.log('[fetchAttendance] Request #' + requestId + ' ignored - newer request #' + latestAttendanceRequestId + ' in progress');
      return [];
    }
  } catch (e) { console.warn('fetchAttendance failed', e); return []; }
}

function renderAttendance(rows, requestId) {
  // Store the current render request ID
  const currentRenderRequestId = requestId !== undefined ? requestId : latestAttendanceRequestId;

  console.log('[renderAttendance] Called with', rows.length, 'rows for request #' + currentRenderRequestId);

  // Find the table in the new attendance card structure
  const table = document.querySelector('[id="section-attendance"] .data-table')
    || document.querySelector('.data-table')
    || document.querySelector('.attendance-table');
  if (!table) {
    console.warn('[renderAttendance] Could not find table element');
    return;
  }
  const tbody = table.querySelector('tbody');
  if (!tbody) {
    console.warn('[renderAttendance] Could not find tbody');
    return;
  }

  // Clear and mark this render
  tbody.innerHTML = '';
  tbody.dataset.lastRequestId = currentRenderRequestId;

  if (!Array.isArray(rows) || rows.length === 0) {
    const tr = document.createElement('tr');
    tr.id = 'attendance-empty-row';
    tr.innerHTML = '<td colspan="6" style="text-align:center;color:var(--text-secondary);padding:24px;">No attendance records found. Try adjusting your filters or refresh to load attendance.</td>';
    tbody.appendChild(tr);
    return;
  }
  for (const r of rows) {
    const tr = document.createElement('tr');
    tr.dataset.employeeId = r.employee_id;
    const name = r.employee_name || 'Unknown';
    const empid = r.employee_id || '';

    // Handle date formatting
    let dateStr = '-';
    if (r.date) {
      try {
        const dateObj = new Date(r.date + 'T00:00:00');
        dateStr = dateObj.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
      } catch (e) {
        dateStr = r.date;
      }
    }

    // Handle time_in
    let timeIn = r.time_in || '-';
    if (timeIn && timeIn !== '-') {
      timeIn = convertTo12Hour(timeIn);
    }
    // Handle time_out
    let timeOut = r.time_out || '-';
    if (timeOut && timeOut !== '-') {
      timeOut = convertTo12Hour(timeOut);
    }
    
    // Create button for viewing subject attendance (use r.date for API call)
    const viewButton = `<button class="btn-secondary" style="padding: 6px 12px; font-size: 12px; border: 1px solid var(--border-primary); background: var(--bg-secondary); cursor: pointer; border-radius: 4px;" onclick="window.openDeptSubjectAttendanceModal(${r.employee_id}, '${escapeHtml(name)}', '${r.date}')">View</button>`;
    
    tr.innerHTML = `<td>${escapeHtml(name)}</td><td>${escapeHtml(dateStr)}</td><td>${escapeHtml(empid)}</td><td>${escapeHtml(timeIn)}</td><td>${escapeHtml(timeOut)}</td><td>${viewButton}</td>`;
    tbody.appendChild(tr);
  }
}

function applyClientSideFilters() {
  // Get current filter values
  const employeeInput = document.getElementById('filter-employee');
  const statusSelect = document.getElementById('filter-status');
  // Note: date filtering is handled by re-fetching from backend, so these inputs trigger new fetch
  // But if we want to filter currently cached data by other means we could.
  // However, the original code filtered by name and status on cachedData, 
  // and Date range triggered a refetch.

  let filtered = [...cachedAttendanceData];

  // Filter by employee name/ID (real-time search)
  if (employeeInput?.value) {
    const searchTerm = employeeInput.value.toLowerCase();
    filtered = filtered.filter(record => {
      const name = (record.employee_name || '').toLowerCase();
      const empId = String(record.employee_id || '').toLowerCase();
      return name.includes(searchTerm) || empId.includes(searchTerm);
    });
  }

  // Filter by status (real-time)
  if (statusSelect?.value && statusSelect.value !== 'all') {
    const statusFilter = statusSelect.value.toLowerCase();
    filtered = filtered.filter(record => {
      const recordStatus = (record.status || 'present').toLowerCase();
      return recordStatus === statusFilter;
    });
  }

  renderAttendance(filtered, cacheRequestId);
}

export async function loadDepartmentAttendance() {
  try {
    const head = await fetchHeadInfo();
    const dept = head && head.department ? head.department : null;

    const filters = {};
    // Note: we could read current date inputs here if we want to respect them on reload
    const dateStartInput = document.getElementById('filter-date-start');
    const dateEndInput = document.getElementById('filter-date-end');
    if (dateStartInput?.value) filters.startDate = dateStartInput.value;
    if (dateEndInput?.value) filters.endDate = dateEndInput.value;

    // Reset latest request ID context if needed? No, increments are fine.

    const rows = await fetchAttendance(dept, filters);
    const requestIdAfterFetch = latestAttendanceRequestId;

    // Only render if this is still the latest request
    if (requestIdAfterFetch === latestAttendanceRequestId) {
      cachedAttendanceData = rows;
      cacheRequestId = requestIdAfterFetch;
      renderAttendance(rows, requestIdAfterFetch);
      updateChips(); // Update chips based on the rendered table
    }
  } catch (e) { console.warn('Department attendance load failed', e); }
}

export function initAttendance() {
  // wire Refresh button in summary card (if distinct from filter refresh)
  const summaryCard = document.querySelector('.attendance-card-left');
  if (summaryCard) {
    const refreshBtn = Array.from(summaryCard.querySelectorAll('button')).find(b => /refresh/i.test(b.textContent || ''));
    if (refreshBtn) { refreshBtn.addEventListener('click', loadDepartmentAttendance); }
  }

  // Wire filters
  const refreshBtn = document.getElementById('refresh-attendance-btn');
  const clearBtn = document.getElementById('clear-filters-btn');
  const dateStartInput = document.getElementById('filter-date-start');
  const dateEndInput = document.getElementById('filter-date-end');
  const employeeInput = document.getElementById('filter-employee');
  const statusSelect = document.getElementById('filter-status');

  // Real-time search: filter as user types in employee search
  if (employeeInput) {
    employeeInput.addEventListener('input', applyClientSideFilters);
  }

  // Real-time filtering: filter when status changes
  if (statusSelect) {
    statusSelect.addEventListener('change', applyClientSideFilters);
  }

  // Helper for date change
  const handleDateChange = async () => {
    const head = await fetchHeadInfo();
    const dept = head && head.department ? head.department : null; // Use current dept

    const filters = {
      startDate: dateStartInput?.value || '',
      endDate: dateEndInput?.value || '',
      employee: '',
      status: ''
    };

    const rows = await fetchAttendance(dept, filters);
    const requestIdAfterFetch = latestAttendanceRequestId;

    if (requestIdAfterFetch === latestAttendanceRequestId) {
      cachedAttendanceData = rows;
      cacheRequestId = requestIdAfterFetch;
      applyClientSideFilters(); // Re-apply name/status filters on new data
      updateChips();
    }
  };

  if (dateStartInput) dateStartInput.addEventListener('change', handleDateChange);
  if (dateEndInput) dateEndInput.addEventListener('change', handleDateChange);

  // Clear filters and reload all records
  if (clearBtn) {
    clearBtn.addEventListener('click', async function () {
      if (dateStartInput) dateStartInput.value = '';
      if (dateEndInput) dateEndInput.value = '';
      if (employeeInput) employeeInput.value = '';
      if (statusSelect) statusSelect.value = 'all';

      await loadDepartmentAttendance();
    });
  }

  if (refreshBtn) {
    refreshBtn.addEventListener('click', loadDepartmentAttendance);
  }

  // Mutation Observer to keep chips updated if table changes
  const table = document.querySelector('.wide-card .attendance-table') || document.querySelector('.attendance-table');
  if (table) {
    const tbody = table.querySelector('tbody');
    if (tbody) {
      const mo = new MutationObserver(() => {
        // Check if empty row is needed
        const emptyRow = document.getElementById('attendance-empty-row');
        const hasData = tbody.querySelectorAll('tr:not(#attendance-empty-row)').length > 0;
        if (emptyRow) {
          emptyRow.style.display = hasData ? 'none' : 'table-row';
        }
        updateChips();
      });
      mo.observe(tbody, { childList: true });

      // Add click listener for performance modal
      tbody.addEventListener('click', function (event) {
        const tr = event.target.closest('tr');
        // Ensure we don't trigger on empty row or if clicking an action button if any
        if (tr && tr.dataset.employeeId && tr.id !== 'attendance-empty-row') {
          const employeeId = tr.dataset.employeeId;
          const nameCell = tr.cells[0];
          const employeeName = nameCell ? nameCell.textContent : 'Employee';
          openPerformanceModal(employeeId, employeeName);
        }
      });
    }
  }

  // Modal close handlers
  const closeModalBtn = document.getElementById('modal-close-btn');
  if (closeModalBtn) {
    closeModalBtn.addEventListener('click', closePerformanceModal);
  }
  const modalOverlay = document.getElementById('performance-modal');
  if (modalOverlay) {
    modalOverlay.addEventListener('click', function (event) {
      if (event.target === modalOverlay) {
        closePerformanceModal();
      }
    });
  }
}

// Performance Modal Logic
function openPerformanceModal(employeeId, employeeName) {
  const modal = document.getElementById('performance-modal');
  const modalEmployeeName = document.getElementById('modal-employee-name');
  if (modal && modalEmployeeName) {
    modal.style.display = 'flex';
    modalEmployeeName.textContent = `Performance for ${employeeName}`;
    fetchAndRenderEmployeePerformance(employeeId);
  }
}

function closePerformanceModal() {
  const modal = document.getElementById('performance-modal');
  if (modal) {
    modal.style.display = 'none';
  }
}

async function fetchAndRenderEmployeePerformance(employeeId) {
  const apiBase = window.API_URL || window.__MOCK_API_BASE__ || '/api';

  try {
    const url = `${apiBase}/performance/${employeeId}`;
    const r = await window.fetchWithAuth(url, {});
    if (r.ok) {
      const data = await r.json();
      const absEl = document.getElementById('summary-absences');
      const latesEl = document.getElementById('summary-lates');
      const underEl = document.getElementById('summary-undertime');

      if (absEl) absEl.textContent = data.absences || 0;
      if (latesEl) latesEl.textContent = data.lates || 0;
      if (underEl) underEl.textContent = data.undertime || 0;
    } else {
      console.error('Failed to fetch performance data');
    }
  } catch (e) {
    console.error('fetchAndRenderEmployeePerformance failed', e);
  }
}
