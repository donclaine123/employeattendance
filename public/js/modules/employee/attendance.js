
import { formatTimeAMPM } from './utils.js';

let currentAttendanceState = null;
let currentEmployeeInfo = null;
let determinedActionType = 'check-in';

export function initAttendance(user) {
  if (!user) return;

  // Load initial data
  loadTodayStatus(user);
  fetchAndDisplayAttendance(user);

  // Refresh button
  const refreshBtn = document.getElementById('refreshBtn');
  if (refreshBtn) {
    refreshBtn.addEventListener('click', () => {
      loadTodayStatus(user);
      fetchAndDisplayAttendance(user);
    });
  }

  // Expose refresh function for other modules
  window.refreshDashboardAttendance = () => {
    console.log('[Dashboard] Refreshing attendance data...');
    loadTodayStatus(user);
    fetchAndDisplayAttendance(user);
  };

  // Initialize Action Modal Listeners
  initAttendanceActionModal();
}

// Load and display today's status
async function loadTodayStatus(user) {
  try {
    if (!user || !user.employee_id) return;

    const apiBase = window.API_URL || '/api';
    const dateParam = new Date().toISOString().split('T')[0];

    // Fetch today's attendance
    const historyUrl = `${apiBase}/attendance/history?employee_id=${user.employee_id}&start=${dateParam}&end=${dateParam}`;
    const attResp = await fetch(historyUrl, {
      headers: { 'Accept': 'application/json' }
    });

    if (!attResp.ok) {
      setTodayStatusUI('Not Logged In', '—:—', '—:—', 'Pending', 'pending');
      return;
    }

    const attData = await attResp.json();
    const records = (attData.data && Array.isArray(attData.data)) ? attData.data : (Array.isArray(attData) ? attData : []);
    const todayAttendance = records.length > 0 ? records[0] : null;

    if (!todayAttendance) {
      setTodayStatusUI('No attendance recorded today — please scan the QR code.', '—:—', '—:—', 'Pending', 'pending');
      return;
    }

    console.log('[Attendance] Today record:', todayAttendance);

    const timeIn = todayAttendance.time_in ? formatTimeAMPM(todayAttendance.time_in) : '—:—';

    // Check for valid time out
    const hasTimeOut = todayAttendance.time_out &&
      String(todayAttendance.time_out).toLowerCase() !== 'null';

    if (hasTimeOut) {
      const timeOut = formatTimeAMPM(todayAttendance.time_out);
      const statusStr = todayAttendance.status ? (todayAttendance.status.charAt(0).toUpperCase() + todayAttendance.status.slice(1)) : 'Completed';
      setTodayStatusUI(`You logged out at ${timeOut} — Status: ${statusStr}`, timeIn, timeOut, 'Completed', 'completed');
    } else {
      const statusStr = todayAttendance.status ? (todayAttendance.status.charAt(0).toUpperCase() + todayAttendance.status.slice(1)) : 'Pending';
      setTodayStatusUI(`You logged in at ${timeIn} — Status: ${statusStr}`, timeIn, '—:—', 'Active', 'active');
    }

  } catch (error) {
    console.error('[Attendance] loadTodayStatus Error:', error);
    setTodayStatusUI('Not Logged In', '—:—', '—:—', 'Pending', 'pending');
  }
}

function setTodayStatusUI(statusText, timeIn, timeOut, badgeText, badgeClass) {
  const textEl = document.getElementById('todayStatusText');
  const inEl = document.getElementById('todayStatusTimeIn');
  const outEl = document.getElementById('todayStatusTimeOut');
  const badgeEl = document.getElementById('todayStatus');

  if (textEl) textEl.textContent = statusText;
  if (inEl) inEl.textContent = timeIn;
  if (outEl) outEl.textContent = timeOut;
  if (badgeEl) {
    badgeEl.className = `status-badge ${badgeClass}`;
    badgeEl.textContent = badgeText;
  }
}


// Update dashboard attendance stats
function updateAttendanceStats(records) {
  if (!records) return;

  // Stats calculation logic...
  const today = new Date();
  const currentMonth = today.getMonth();
  const currentYear = today.getFullYear();
  const thisMonthRecords = records.filter(r => {
    const d = new Date(r.date);
    return d.getMonth() === currentMonth && d.getFullYear() === currentYear;
  });

  const daysPresent = thisMonthRecords.filter(r => r.status === 'present' || r.time_in).length;
  const lateArrivals = thisMonthRecords.filter(r => r.status === 'late').length;

  // Update both dashboard and attendance section stats
  const setStat = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };

  setStat('statDaysPresent', daysPresent);
  setStat('statDaysPresentAttendance', daysPresent);
  setStat('statLateArrivals', lateArrivals);
  setStat('statLateArrivalsAttendance', lateArrivals);
}

// Populate Quick Attendance List (Dashboard)
function updateQuickAttendanceList(records) {
  const list = document.getElementById('quickAttendanceList');
  if (!list) return;

  const emptyState = document.getElementById('attendanceEmptyState');

  // Clear list but preserve empty state element
  // (We do this by hiding empty state instead of wiping innerHTML completely if it's there)
  // Easier approach: Check if empty state exists, if not create it?? 
  // BETTER: Clear children EXCEPT empty state, or just rebuild.
  // Given we just added emptyState in HTML, let's use display toggling.

  // Actually, easiest is to wipe and re-append empty state if needed OR list.innerHTML = '' wipes the pre-written HTML.
  // Let's rewrite the innerHTML logic to include empty state structure if empty.

  list.innerHTML = ''; // Wipe everything

  // Re-add empty state markup (hidden by default)
  const emptyStateHTML = `
    <div class="dashboard-empty-state" id="attendanceEmptyState" style="display: none;">
        <div class="empty-icon">🕒</div>
        <p>No recent activity</p>
    </div>
  `;

  const recent = records.slice(0, 3);

  if (recent.length === 0) {
    list.innerHTML = emptyStateHTML;
    const el = list.querySelector('#attendanceEmptyState');
    if (el) el.style.display = 'flex';
    return;
  }

  // If we have records
  list.innerHTML = emptyStateHTML; // Keep it there but hidden

  recent.forEach(r => {
    // Format Date: "Mon, Jan 20"
    const d = new Date(r.date);
    const dateStr = d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
    
    // Format Time: "9:00 AM - 5:00 PM"
    const timeIn = r.time_in ? formatTimeAMPM(r.time_in) : '-';
    const timeOut = (r.time_out && r.time_out !== 'NULL') ? formatTimeAMPM(r.time_out) : '-';
    const timeRange = (timeIn !== '-' && timeOut !== '-') ? `${timeIn} - ${timeOut}` : (timeIn !== '-' ? `${timeIn} -` : 'No Time In');

    // Calculate Duration
    let duration = '';
    if (r.time_in && r.time_out && r.time_out !== 'NULL') {
        const t1 = new Date(`2000-01-01T${r.time_in}`);
        const t2 = new Date(`2000-01-01T${r.time_out}`);
        let diffMs = t2 - t1;
        if (diffMs < 0) diffMs += 24 * 60 * 60 * 1000;
        const diffHrs = Math.floor(diffMs / (1000 * 60 * 60));
        const diffMins = Math.round((diffMs % (1000 * 60 * 60)) / (1000 * 60));
        duration = `${diffHrs}h ${diffMins}m`;
    }

    const status = (r.status || 'pending').toLowerCase();
    const statusIcon = status === 'present' ? '✓' : (status === 'late' ? '!' : '−');

    const item = document.createElement('div');
    item.className = 'feed-item';
    item.innerHTML = `
        <div class="feed-left">
            <div class="status-icon ${status}">${statusIcon}</div>
            <div>
                <span class="feed-date">${dateStr}</span>
                <span class="feed-time">${timeRange}</span>
            </div>
        </div>
        <div class="feed-right">
             <span class="status-badge ${status}">${r.status || 'Pending'}</span>
             <span class="feed-duration" style="display:block; font-size:11px; margin-top:4px;">${duration}</span>
        </div>
    `;
    list.appendChild(item);
  });
}

// Fetch last 7 days details
async function fetchAndDisplayAttendance(user) {
  try {
    const employeeId = user && (user.employee_id || user.id);
    if (!employeeId) return;

    const today = new Date();
    const start = new Date(today.getTime() - 6 * 24 * 60 * 60 * 1000); // last 7 days
    const iso = (d) => d.toISOString().slice(0, 10);

    // Fetch enough history for stats (e.g., this month or last 30 days)
    // ideally backend handles "this month" - but sticking to current implementation
    const response = await window.AppApi.getAttendanceHistory({ employee: employeeId }); // fetch all/default
    const records = (response.data && Array.isArray(response.data)) ? response.data : (Array.isArray(response) ? response : []);

    // Update stats and quick view
    updateAttendanceStats(records);
    updateQuickAttendanceList(records);

    const tbody = document.querySelector('.attendance-table tbody');
    if (!tbody) return;

    const emptyRow = document.getElementById('attendance-empty-row');
    tbody.innerHTML = '';
    if (emptyRow) tbody.appendChild(emptyRow);

    const emptyState = document.getElementById('attendance-empty-state');

    if (Array.isArray(records) && records.length) {
      if (emptyState) emptyState.style.display = 'none';

      records.forEach(r => {
        const tr = document.createElement('tr');
        const date = r.date ? new Date(r.date).toISOString().split('T')[0] : (r.time_in ? String(r.time_in).slice(0, 10) : '');
        const dayName = new Date(date + 'T00:00:00').toLocaleDateString(undefined, { weekday: 'short' });

        const timeIn = r.time_in ? formatTimeAMPM(r.time_in) : '-';
        const timeOut = (r.time_out && r.time_out !== 'NULL') ? formatTimeAMPM(r.time_out) : '-';

        let totalHours = '—';
        if (r.time_in && r.time_out && r.time_out !== 'NULL' && String(r.time_out).toLowerCase() !== 'null') {
          try {
            const t1 = new Date(`2000-01-01T${r.time_in}`);
            const t2 = new Date(`2000-01-01T${r.time_out}`);

            let diffMs = t2 - t1;
            if (diffMs < 0) {
              diffMs += 24 * 60 * 60 * 1000; // Handle overnight crossing midnight
            }

            const diffHrs = Math.floor(diffMs / (1000 * 60 * 60));
            const diffMins = Math.round((diffMs % (1000 * 60 * 60)) / (1000 * 60));

            totalHours = `${diffHrs}h ${diffMins}m`;
          } catch (e) {
            console.warn('[Attendance] Error calculating duration:', e);
          }
        }

        const status = (r.status || 'present');

        tr.innerHTML = `
                    <td>${date}</td>
                    <td>${dayName}</td>
                    <td>${timeIn}</td>
                    <td>${timeOut}</td>
                    <td>${totalHours}</td> 
                    <td><span class="status ${status.toLowerCase() === 'late' ? 'late' : 'on-time'}">${status}</span></td>
                `;
        tbody.appendChild(tr);
      });
      if (emptyRow) emptyRow.style.display = 'none';
    } else {
      if (emptyState) emptyState.style.display = 'block';
      if (emptyRow) emptyRow.style.display = '';
    }

  } catch (e) {
    console.error('[Attendance] fetchAndDisplayAttendance Error:', e);
  }
}

// Action Modal Logic
function initAttendanceActionModal() {
  const closeBtn = document.getElementById('attendanceActionClose');
  const cancelBtn = document.getElementById('attendanceActionCancel');
  const backdrop = document.getElementById('attendanceActionBackdrop');
  const actionBtn = document.getElementById('attendanceActionBtn');

  if (closeBtn) closeBtn.addEventListener('click', closeAttendanceActionModal);
  if (cancelBtn) cancelBtn.addEventListener('click', closeAttendanceActionModal);
  if (backdrop) backdrop.addEventListener('click', closeAttendanceActionModal);

  if (actionBtn) actionBtn.addEventListener('click', handleActionClick);

  // Global opener
  window.openAttendanceActionModal = openAttendanceActionModal;
}

export async function openAttendanceActionModal(scannedSessionId) {
  const modal = document.getElementById('attendanceActionModal');
  const backdrop = document.getElementById('attendanceActionBackdrop');
  const msg = document.getElementById('attendanceStatusMessage');
  const container = document.getElementById('attendanceActionContainer');
  const statusDiv = document.getElementById('attendanceCurrentStatus');
  const btn = document.getElementById('attendanceActionBtn');

  if (!modal || !backdrop) return;

  modal.style.display = 'block';
  backdrop.style.display = 'block';

  if (msg) { msg.style.display = 'none'; msg.textContent = ''; }
  if (container) container.style.display = 'none';
  if (statusDiv) statusDiv.style.display = 'none';

  if (btn) {
    btn.disabled = false;
    btn.textContent = '';
    btn.style.display = 'none';
  }

  currentAttendanceState = null;
  currentEmployeeInfo = null;
  determinedActionType = 'check-in';

  // If scanned ID exists (from QR)
  if (window.scannedEmployeeId) {
    const idEl = document.getElementById('attendanceEmployeeId');
    const nameEl = document.getElementById('attendanceEmployeeName');
    if (idEl) idEl.textContent = window.scannedEmployeeId;
    if (nameEl && window.scannedEmployeeName) nameEl.textContent = window.scannedEmployeeName;

    await fetchAttendanceStatusForScannedEmployee();
  } else {
    // Manual open? Should probably not happen often for Employees unless debugging
    // For now, assume this is mainly driven by QR scan success
  }
}

function closeAttendanceActionModal() {
  document.getElementById('attendanceActionModal').style.display = 'none';
  document.getElementById('attendanceActionBackdrop').style.display = 'none';

  currentAttendanceState = null;
  currentEmployeeInfo = null;
  window.scannedEmployeeId = null;
  window.scannedEmployeeName = null;
  window.scannedQRSessionId = null;
}

async function fetchAttendanceStatusForScannedEmployee() {
  const employee_id = window.scannedEmployeeId;
  if (!employee_id) return;

  try {
    const msg = document.getElementById('attendanceStatusMessage');
    if (msg) { msg.style.display = 'block'; msg.textContent = 'Authenticating...'; msg.className = 'status-message info'; }

    const apiBase = window.API_URL || '/api';
    const dateParam = new Date().toISOString().split('T')[0];
    const historyUrl = `${apiBase}/attendance/history?start=${dateParam}&end=${dateParam}`;

    const attResp = await fetch(historyUrl, { headers: { 'Accept': 'application/json' } });
    const attData = attResp.ok ? await attResp.json() : [];
    const records = (attData.data && Array.isArray(attData.data)) ? attData.data : (Array.isArray(attData) ? attData : []);

    const todayAttendance = records.find(a => String(a.employee_id) === String(employee_id));

    currentAttendanceState = todayAttendance || {
      employee_id: employee_id,
      time_in: null,
      time_out: null,
      status: 'pending'
    };

    currentEmployeeInfo = {
      employee_id: employee_id,
      name: window.scannedEmployeeName || 'Employee'
    };

    // UI Logic for buttons
    showActionButtons();

  } catch (e) {
    console.error('Error fetching status:', e);
    const msg = document.getElementById('attendanceStatusMessage');
    if (msg) { msg.textContent = `Error: ${e.message}`; msg.className = 'status-message error'; }
  }
}

function showActionButtons() {
  let actionType = 'check-in';
  let actionText = 'Check In Today?';
  let actionIcon = '→';
  let statusDetails = 'No time-in yet';

  const hasTimeIn = currentAttendanceState.time_in && typeof currentAttendanceState.time_in === 'string';
  const hasTimeOut = currentAttendanceState.time_out && typeof currentAttendanceState.time_out === 'string';

  if (hasTimeIn && !hasTimeOut) {
    actionType = 'check-out';
    actionText = 'Check Out Today?';
    actionIcon = '←';
    statusDetails = `Time In: ${formatTimeAMPM(currentAttendanceState.time_in)}`;
  } else if (hasTimeIn && hasTimeOut) {
    actionType = 'completed';
    actionText = 'Already Completed Today';
    actionIcon = '✓';
    statusDetails = `Time In: ${formatTimeAMPM(currentAttendanceState.time_in)} | Time Out: ${formatTimeAMPM(currentAttendanceState.time_out)}`;
  }

  const msg = document.getElementById('attendanceStatusMessage');
  const container = document.getElementById('attendanceActionContainer');
  const statusDiv = document.getElementById('attendanceCurrentStatus');
  const btn = document.getElementById('attendanceActionBtn');

  if (msg) msg.style.display = 'none';
  if (container) container.style.display = 'block';
  if (statusDiv) statusDiv.style.display = 'block';

  document.getElementById('attendanceActionIcon').textContent = actionIcon;
  document.getElementById('attendanceActionText').textContent = actionText;
  document.getElementById('attendanceActionTime').textContent = formatTimeAMPM(new Date());
  document.getElementById('attendanceStatusDetails').textContent = statusDetails;

  if (btn) {
    btn.style.display = actionType === 'completed' ? 'none' : 'block';
    btn.textContent = actionType === 'check-out' ? '✓ Check Out' : '→ Check In';
    btn.dataset.actionType = actionType;
  }

  // Type Indicator
  const ind = document.getElementById('attendanceActionTypeIndicator');
  const txt = document.getElementById('attendanceActionTypeText');
  if (ind && txt) {
    txt.textContent = actionType === 'check-out' ? 'Check Out' : 'Check In';
    ind.style.display = 'block';
  }
}

async function handleActionClick() {
  const btn = document.getElementById('attendanceActionBtn');
  const actionType = btn.dataset.actionType;

  if (!currentAttendanceState || !currentEmployeeInfo) {
    return;
    // TODO show error
  }

  try {
    btn.disabled = true;
    btn.innerHTML = `<div class="btn-spinner"></div>`;

    const apiBase = window.API_URL || '/api';
    const endpoint = actionType === 'check-out' ? 'attendance/checkout' : 'attendance/checkin';

    const body = {
      employee_id: currentAttendanceState.employee_id,
      qrSessionId: window.scannedQRSessionId || 'manual-checkin',
      location: { lat: 0, lon: 0 },
      deviceInfo: { qr_scanned: true }
    };

    const response = await fetch(apiBase + '/' + endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });

    const result = await response.json();

    if (response.ok && result.success) {
      // Success
      const msg = document.getElementById('attendanceStatusMessage');
      if (msg) {
        msg.style.display = 'block';
        msg.textContent = `Success! ${actionType === 'check-out' ? 'Checked out' : 'Checked in'} successfully.`;
        msg.className = 'status-message success';
      }

      // Hide buttons
      const container = document.getElementById('attendanceActionContainer');
      if (container) container.style.display = 'none';

      setTimeout(() => {
        closeAttendanceActionModal();
        if (window.refreshDashboardAttendance) window.refreshDashboardAttendance();
      }, 1500);

    } else {
      throw new Error(result.error || 'Operation failed');
    }

  } catch (e) {
    console.error('Action failed:', e);
    const msg = document.getElementById('attendanceStatusMessage');
    if (msg) {
      msg.style.display = 'block';
      msg.textContent = `Error: ${e.message}`;
      msg.className = 'status-message error';
    }
    btn.disabled = false;
    btn.textContent = actionType === 'check-out' ? '✓ Check Out' : '→ Check In';
  }
}
