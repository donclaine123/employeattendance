/**
 * Attendance Module
 * Shows employee their scheduled subjects for a given date with verification status from HR hourly rounds
 * Also manages dashboard recent attendance display
 */

let currentDate = new Date(); // Track current date being viewed
let currentAttendanceState = null; // Will hold: { employee_id, time_in, time_out, status }
let currentEmployeeInfo = null; // Will hold employee info
let determinedActionType = 'check-in'; // Will hold the action type (check-in or check-out)

export function initAttendance(user) {
  if (!user || !user.employee_id) return;

  // Initialize with today's data
  currentDate = new Date();
  loadAttendance(user, currentDate);

  // Setup date navigation
  setupDateNavigation(user);

  // Load recent attendance for dashboard
  loadDashboardAttendance(user);

  // Setup attendance action modal
  setupAttendanceActionModal();

  // Expose functions globally
  window.refreshAttendance = () => {
    loadAttendance(user, currentDate);
  };
  
  window.refreshDashboardAttendance = () => {
    loadDashboardAttendance(user);
  };
  
  window.openAttendanceActionModal = async function () {
    openAttendanceActionModal();
  };
}

function setupDateNavigation(user) {
  const prevBtn = document.getElementById('prevDateBtn');
  const nextBtn = document.getElementById('nextDateBtn');
  const todayBtn = document.getElementById('todayBtn');

  if (prevBtn) {
    prevBtn.addEventListener('click', () => {
      const newDate = new Date(currentDate);
      newDate.setDate(newDate.getDate() - 1);
      currentDate = newDate;
      loadAttendance(user, currentDate);
    });
  }

  if (nextBtn) {
    nextBtn.addEventListener('click', () => {
      const newDate = new Date(currentDate);
      newDate.setDate(newDate.getDate() + 1);
      currentDate = newDate;
      loadAttendance(user, currentDate);
    });
  }

  if (todayBtn) {
    todayBtn.addEventListener('click', () => {
      currentDate = new Date();
      loadAttendance(user, currentDate);
    });
  }
}

async function loadAttendance(user, dateToLoad) {
  try {
    const apiBase = window.API_URL || '/api';
    
    // Format date as YYYY-MM-DD
    const dateStr = dateToLoad.toISOString().split('T')[0];
    
    // Fetch employee's attendance data from new endpoint
    const response = await fetch(
      `${apiBase}/attendance/subject?date=${dateStr}`,
      { 
        headers: { 
          'Accept': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('authToken') || ''}`
        }
      }
    );

    if (!response.ok) {
      console.error('[Attendance] API Error:', response.status);
      showEmptyState();
      return;
    }

    const data = await response.json();
    const records = Array.isArray(data.data) ? data.data : data;

    console.log('[loadAttendance] API data:', { data, records });

    if (!records || records.length === 0) {
      console.log('[loadAttendance] No records found, showing empty state');
      showEmptyState();
      return;
    }

    // Extract subjects from the first record (should only be one employee)
    const employeeRecord = Array.isArray(records) ? records[0] : records;
    const subjects = employeeRecord.subjects || [];

    console.log('[loadAttendance] Employee record:', employeeRecord);
    console.log('[loadAttendance] Subjects count:', subjects.length);
    console.log('[loadAttendance] time_in:', employeeRecord.time_in);

    updateDateDisplay(dateStr);
    renderSubjectTable(subjects, employeeRecord);
  } catch (error) {
    console.error('[Attendance] Error loading data:', error);
    showEmptyState();
  }
}

function updateDateDisplay(dateStr) {
  const dateEl = document.getElementById('attendanceDate');
  if (dateEl) {
    const date = new Date(dateStr + 'T00:00:00');
    const options = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' };
    dateEl.textContent = date.toLocaleDateString('en-US', options);
  }
}

function renderSubjectTable(subjects, employeeRecord) {
  const tbody = document.getElementById('subjectAttendanceList');
  const emptyState = document.getElementById('subject-attendance-empty-state');
  const checkInEl = document.getElementById('checkInTime');
  const checkOutEl = document.getElementById('checkOutTime');

  console.log('[renderSubjectTable] Called with subjects:', subjects?.length, 'employeeRecord:', employeeRecord);

  // Update check-in/check-out display ALWAYS (regardless of subjects)
  if (checkInEl) {
    const timeIn = employeeRecord.time_in ? formatTimeToAMPM(employeeRecord.time_in) : '--:--';
    console.log('[renderSubjectTable] Setting checkInTime to:', timeIn, 'from:', employeeRecord.time_in);
    checkInEl.textContent = timeIn;
  }
  if (checkOutEl) {
    const timeOut = employeeRecord.time_out ? formatTimeToAMPM(employeeRecord.time_out) : '--:--';
    console.log('[renderSubjectTable] Setting checkOutTime to:', timeOut, 'from:', employeeRecord.time_out);
    checkOutEl.textContent = timeOut;
  }

  // If no subjects, show empty state but keep the times visible
  if (!subjects || subjects.length === 0) {
    console.log('[renderSubjectTable] No subjects, showing empty state');
    if (emptyState) emptyState.style.display = 'block';
    if (tbody) tbody.innerHTML = '';
    return;
  }

  // If we have subjects, render them
  if (!tbody) return;

  // Group subjects by subject_code + start_time + end_time
  const groupedMap = {};
  subjects.forEach(subject => {
    const key = `${subject.subject_code}|${subject.start_time}|${subject.end_time}`;
    if (!groupedMap[key]) {
      groupedMap[key] = {
        subject_code: subject.subject_code,
        start_time: subject.start_time,
        end_time: subject.end_time,
        verified_status: subject.verified_status,
        sections: [],
        rooms: []
      };
    }
    groupedMap[key].sections.push(subject.section_name);
    groupedMap[key].rooms.push(subject.room_name);
  });

  const groupedSubjects = Object.values(groupedMap);

  // Sort by start time
  groupedSubjects.sort((a, b) => {
    const timeA = (a.start_time || '').split(':').slice(0, 2).join(':');
    const timeB = (b.start_time || '').split(':').slice(0, 2).join(':');
    return timeA.localeCompare(timeB);
  });

  const rowsHTML = groupedSubjects.map((group) => {
    const statusBadge = renderStatusBadge(group.verified_status);
    const timeRange = `${formatTimeToAMPM(group.start_time)} - ${formatTimeToAMPM(group.end_time)}`;
    
    // Combine sections: remove duplicates and sort
    const uniqueSections = [...new Set(group.sections)].sort();
    const sectionsText = uniqueSections.join(', ');
    
    // Get unique rooms: remove duplicates and sort
    const uniqueRooms = [...new Set(group.rooms)].filter(r => r);
    const roomsText = uniqueRooms.length > 0 ? uniqueRooms.join(', ') : '-';

    return `
      <tr>
        <td>
          <div style="font-weight: 500;">${group.subject_code}</div>
          <div style="font-size: var(--text-xs); color: var(--text-secondary); margin-top: 4px;">Sections: ${sectionsText}</div>
        </td>
        <td>${timeRange}</td>
        <td>${roomsText}</td>
        <td style="text-align: center;">
          ${statusBadge}
        </td>
      </tr>
    `;
  }).join('');

  tbody.innerHTML = rowsHTML;
  emptyState.style.display = 'none';
}

function renderStatusBadge(status) {
  if (!status) {
    return '<span class="status-empty">—</span>';
  }

  const statusClassMap = {
    'verified': 'status-verified',
    'late': 'status-late',
    'absent': 'status-absent',
    'unverified': 'status-unverified'
  };

  const className = statusClassMap[status] || 'status-unverified';
  const textMap = {
    'verified': 'Verified',
    'late': 'Late',
    'absent': 'Absent',
    'unverified': 'Unverified'
  };

  const text = textMap[status] || 'Unverified';

  return `<span class="status-badge ${className}">${text}</span>`;
}

function showEmptyState() {
  const tbody = document.getElementById('subjectAttendanceList');
  const emptyState = document.getElementById('subject-attendance-empty-state');

  if (tbody) tbody.innerHTML = '';
  if (emptyState) emptyState.style.display = 'block';
}

function formatTimeToAMPM(time) {
  if (!time) return '-';
  
  try {
    // Handle different time formats
    let timeStr = String(time).trim();
    
    // If it contains a T, it's likely an ISO timestamp
    if (timeStr.includes('T')) {
      timeStr = timeStr.split('T')[1];
    }
    
    // Remove milliseconds and Z if present
    timeStr = timeStr.split('.')[0].split('Z')[0];
    
    const parts = timeStr.split(':');
    const hours = parts[0];
    const minutes = parts[1] || '00';
    
    if (!hours) return '-';
    
    const hour = parseInt(hours, 10);
    if (isNaN(hour)) return '-';
    
    const period = hour >= 12 ? 'PM' : 'AM';
    const displayHour = hour % 12 || 12;
    
    const formatted = `${displayHour}:${minutes} ${period}`;
    console.log('[formatTimeToAMPM] Formatted:', { input: time, output: formatted });
    return formatted;
  } catch (error) {
    console.error('[formatTimeToAMPM] Error:', error, 'input:', time);
    return '-';
  }
}

// DEBUG: Element diagnostic
window.checkElementState = function() {
  const el = document.getElementById('checkInTime');
  console.log('=== CHECK IN TIME ELEMENT STATE ===');
  console.log('Element found:', !!el);
  console.log('Element HTML:', el?.outerHTML);
  console.log('textContent:', el?.textContent);
  console.log('innerHTML:', el?.innerHTML);
  console.log('innerText:', el?.innerText);
  console.log('children count:', el?.children?.length);
  console.log('childNodes:', Array.from(el?.childNodes || []).map(n => ({ type: n.nodeType, content: n.textContent })));
  console.log('Computed display:', window.getComputedStyle(el)?.display);
  console.log('Computed visibility:', window.getComputedStyle(el)?.visibility);
  console.log('Computed opacity:', window.getComputedStyle(el)?.opacity);
};

// ============================================================================
// DASHBOARD ATTENDANCE - Recent Attendance Card
// ============================================================================

async function loadDashboardAttendance(user) {
  try {
    if (!user || !user.employee_id) return;

    const apiBase = window.API_URL || '/api';
    const dateParam = new Date().toISOString().split('T')[0];

    // Fetch today's attendance
    const historyUrl = `${apiBase}/attendance/history?employee_id=${user.employee_id}&start=${dateParam}&end=${dateParam}`;
    const attResp = await fetch(historyUrl, {
      headers: { 'Authorization': `Bearer ${localStorage.getItem('authToken') || ''}` }
    });

    if (!attResp.ok) {
      console.error('[Attendance] History API error:', attResp.status);
      displayEmptyDashboardAttendance();
      return;
    }

    const attData = await attResp.json();
    const records = Array.isArray(attData) ? attData : (attData.data || []);

    if (!records || records.length === 0) {
      displayEmptyDashboardAttendance();
      return;
    }

    // Get the first record (today)
    const todayRecord = records[0];
    displayDashboardAttendance(todayRecord);
  } catch (error) {
    console.error('[Attendance] Error loading dashboard data:', error);
    displayEmptyDashboardAttendance();
  }
}

function displayDashboardAttendance(record) {
  const quickList = document.getElementById('quickAttendanceList');
  
  const checkInTime = record.time_in ? formatTimeToAMPM(record.time_in) : '--:--';
  const checkOutTime = record.time_out ? formatTimeToAMPM(record.time_out) : '--:--';
  const status = record.status || 'Pending';
  const statusClass = status.toLowerCase();

  // UPDATE STATUS TODAY CARD (Top Dashboard Card)
  const todayTimeInEl = document.getElementById('todayStatusTimeIn');
  const todayTimeOutEl = document.getElementById('todayStatusTimeOut');
  const todayStatusEl = document.getElementById('todayStatus');
  
  if (todayTimeInEl) {
    todayTimeInEl.textContent = checkInTime;
    console.log('[displayDashboardAttendance] Updated todayStatusTimeIn to:', checkInTime);
  }
  if (todayTimeOutEl) {
    todayTimeOutEl.textContent = checkOutTime;
    console.log('[displayDashboardAttendance] Updated todayStatusTimeOut to:', checkOutTime);
  }
  if (todayStatusEl) {
    todayStatusEl.textContent = status;
    todayStatusEl.className = `status-badge ${statusClass}`;
    console.log('[displayDashboardAttendance] Updated todayStatus to:', status);
  }

  // UPDATE RECENT ATTENDANCE CARD (Bottom Dashboard Card)
  if (!quickList) return;

  // Map status to icon
  const statusIconMap = {
    'present': '✓',
    'late': '⚠',
    'absent': '✕',
    'pending': '◯'
  };
  const statusIcon = statusIconMap[statusClass] || '◯';

  // Get today's date
  const today = new Date();
  const dateStr = today.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

  const html = `
    <div class="feed-item ${statusClass}">
      <div class="feed-left">
        <div class="status-icon ${statusClass}">${statusIcon}</div>
        <div>
          <span class="feed-date">Today • ${dateStr}</span>
          <span class="feed-time">${checkInTime} - ${checkOutTime}</span>
        </div>
      </div>
      <div class="feed-right">
        <span class="feed-status-badge ${statusClass}">${status}</span>
      </div>
    </div>
  `;

  quickList.innerHTML = html;
  const emptyState = document.getElementById('attendanceEmptyState');
  if (emptyState) emptyState.style.display = 'none';
}

function displayEmptyDashboardAttendance() {
  const quickList = document.getElementById('quickAttendanceList');
  const emptyState = document.getElementById('attendanceEmptyState');

  if (quickList) quickList.innerHTML = '';
  if (emptyState) emptyState.style.display = 'block';
}

/**
 * Attendance Action Modal Functions
 */
function setupAttendanceActionModal() {
  const attendanceActionBtn = document.getElementById('attendanceActionBtn');
  const attendanceActionClose = document.getElementById('attendanceActionClose');
  const attendanceActionCancel = document.getElementById('attendanceActionCancel');
  const attendanceActionBackdrop = document.getElementById('attendanceActionBackdrop');

  if (attendanceActionBtn) {
    attendanceActionBtn.addEventListener('click', handleAttendanceAction);
  }
  if (attendanceActionClose) {
    attendanceActionClose.addEventListener('click', closeAttendanceActionModal);
  }
  if (attendanceActionCancel) {
    attendanceActionCancel.addEventListener('click', closeAttendanceActionModal);
  }
  if (attendanceActionBackdrop) {
    attendanceActionBackdrop.addEventListener('click', closeAttendanceActionModal);
  }
}

async function openAttendanceActionModal() {
  const attendanceActionModal = document.getElementById('attendanceActionModal');
  const attendanceActionBackdrop = document.getElementById('attendanceActionBackdrop');
  const attendanceStatusMessage = document.getElementById('attendanceStatusMessage');
  const attendanceActionContainer = document.getElementById('attendanceActionContainer');
  const attendanceCurrentStatus = document.getElementById('attendanceCurrentStatus');

  if (!attendanceActionModal) return;

  attendanceActionModal.style.display = 'block';
  attendanceActionBackdrop.style.display = 'block';
  attendanceStatusMessage.style.display = 'none';
  attendanceStatusMessage.textContent = '';
  attendanceActionContainer.style.display = 'none';
  attendanceCurrentStatus.style.display = 'none';

  const attendanceActionBtn = document.getElementById('attendanceActionBtn');
  if (attendanceActionBtn) {
    attendanceActionBtn.disabled = false;
    attendanceActionBtn.textContent = '';
    attendanceActionBtn.style.display = 'none';
  }

  const actionTypeIndicator = document.getElementById('attendanceActionTypeIndicator');
  if (actionTypeIndicator) {
    actionTypeIndicator.style.display = 'none';
  }

  currentAttendanceState = null;
  currentEmployeeInfo = null;
  determinedActionType = 'check-in';

  // If we have a scanned employee ID from QR, pre-populate and fetch status
  if (window.scannedEmployeeId) {
    console.log('[Modal] Using scanned employee ID:', window.scannedEmployeeId);
    document.getElementById('attendanceEmployeeId').textContent = window.scannedEmployeeId;
    if (window.scannedEmployeeName) {
      document.getElementById('attendanceEmployeeName').textContent = window.scannedEmployeeName;
    }

    // Automatically fetch attendance status for this employee
    await fetchAttendanceStatusForScannedEmployee();
  } else {
    showActionButtons();
  }
}

async function fetchAttendanceStatusForScannedEmployee() {
  const employee_id = window.scannedEmployeeId;

  if (!employee_id) {
    showAttendanceMessage('No employee ID available', 'error');
    return;
  }

  try {
    showAttendanceMessage('Authenticating...', 'info');

    const apiBase = window.API_URL || '/api';
    const dateParam = new Date().toISOString().split('T')[0];
    const historyUrl = `${apiBase}/attendance/history?start=${dateParam}&end=${dateParam}`;

    console.log('[fetchAttendanceStatus] Fetching from URL:', historyUrl);
    console.log('[fetchAttendanceStatus] Looking for employee_id:', employee_id);

    const attResp = await fetch(historyUrl, {
      headers: { 'Accept': 'application/json' }
    });

    const attData = attResp.ok ? await attResp.json() : [];
    const records = (attData.data && Array.isArray(attData.data)) ? attData.data : (Array.isArray(attData) ? attData : []);

    console.log('[fetchAttendanceStatus] Records:', records);

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

    // Show action type indicator (Check In or Check Out)
    const actionTypeIndicator = document.getElementById('attendanceActionTypeIndicator');
    const actionTypeText = document.getElementById('attendanceActionTypeText');
    if (actionTypeIndicator && actionTypeText) {
      let actionLabel = 'Check In';
      determinedActionType = 'check-in';

      // Only show Check Out if: time_in exists AND time_out is null/empty
      if (currentAttendanceState.time_in && !currentAttendanceState.time_out) {
        actionLabel = 'Check Out';
        determinedActionType = 'check-out';
      }

      actionTypeText.textContent = actionLabel;
      actionTypeIndicator.style.display = 'block';
    }

    // Show action buttons after fetching status
    showActionButtons();

  } catch (error) {
    console.error('Error fetching attendance status:', error);
    showAttendanceMessage(`Error: ${error.message}`, 'error');
  }
}

function closeAttendanceActionModal() {
  const attendanceActionModal = document.getElementById('attendanceActionModal');
  const attendanceActionBackdrop = document.getElementById('attendanceActionBackdrop');

  if (attendanceActionModal) attendanceActionModal.style.display = 'none';
  if (attendanceActionBackdrop) attendanceActionBackdrop.style.display = 'none';

  currentAttendanceState = null;
  currentEmployeeInfo = null;
  window.scannedEmployeeId = null;
  window.scannedEmployeeName = null;
  window.scannedQRSessionId = null;
}

function showActionButtons() {
  const attendanceStatusMessage = document.getElementById('attendanceStatusMessage');
  const attendanceActionContainer = document.getElementById('attendanceActionContainer');
  const attendanceCurrentStatus = document.getElementById('attendanceCurrentStatus');
  const attendanceActionBtn = document.getElementById('attendanceActionBtn');

  if (!currentAttendanceState) return;

  let actionType = 'check-in';
  let actionText = 'Check In Today?';
  let actionIcon = '↙';
  let statusDetails = 'No time-in yet';

  const hasTimeIn = currentAttendanceState.time_in && (typeof currentAttendanceState.time_in === 'string' || typeof currentAttendanceState.time_in === 'object');
  const hasTimeOut = currentAttendanceState.time_out && (typeof currentAttendanceState.time_out === 'string' || typeof currentAttendanceState.time_out === 'object');

  if (hasTimeIn && !hasTimeOut) {
    actionType = 'check-out';
    actionText = 'Check Out Today?';
    actionIcon = '↗';
    statusDetails = `Time In: ${formatTimeToAMPM(currentAttendanceState.time_in)}`;
  } else if (hasTimeIn && hasTimeOut) {
    actionType = 'completed';
    actionText = 'Already Completed Today';
    actionIcon = '✓';
    statusDetails = `Time In: ${formatTimeToAMPM(currentAttendanceState.time_in)} | Time Out: ${formatTimeToAMPM(currentAttendanceState.time_out)}`;
  }

  attendanceStatusMessage.style.display = 'none';
  attendanceActionContainer.style.display = 'block';
  attendanceCurrentStatus.style.display = 'block';

  const actionIcon_el = document.getElementById('attendanceActionIcon');
  const actionText_el = document.getElementById('attendanceActionText');
  const actionTime_el = document.getElementById('attendanceActionTime');
  const statusDetails_el = document.getElementById('attendanceStatusDetails');

  if (actionIcon_el) actionIcon_el.textContent = actionIcon;
  if (actionText_el) actionText_el.textContent = actionText;
  if (actionTime_el) actionTime_el.textContent = formatTimeToAMPM(new Date().toTimeString().split(' ')[0]);
  if (statusDetails_el) statusDetails_el.textContent = statusDetails;

  if (attendanceActionBtn) {
    attendanceActionBtn.style.display = actionType === 'completed' ? 'none' : 'block';
    attendanceActionBtn.textContent = actionType === 'check-out' ? '✓ Check Out' : '→ Check In';
    attendanceActionBtn.dataset.actionType = actionType;
  }
}

async function handleAttendanceAction() {
  if (!currentAttendanceState || !currentEmployeeInfo) {
    showAttendanceMessage('Session expired. Please scan QR again.', 'error');
    return;
  }

  try {
    const attendanceActionBtn = document.getElementById('attendanceActionBtn');
    const actionType = attendanceActionBtn.dataset.actionType;

    attendanceActionBtn.disabled = true;
    const originalText = attendanceActionBtn.textContent;
    attendanceActionBtn.textContent = 'Processing...';

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

    if (response.ok && (result.ok || result.success)) {
      const actionLabel = actionType === 'check-out' ? 'Checked Out' : 'Checked In';

      attendanceActionBtn.disabled = true;
      attendanceActionBtn.textContent = `✓ ${actionLabel} Successfully!`;

      showAttendanceMessage(`✓ ${actionLabel} Successfully!`, 'success');

      setTimeout(() => {
        closeAttendanceActionModal();
        window.refreshDashboardAttendance?.();
      }, 1500);
    } else {
      let errorMessage = result.error || 'Unknown error';

      if (response.status === 409) {
        errorMessage = `Already ${actionType === 'check-out' ? 'checked out' : 'checked in'} today`;
      } else if (response.status === 404) {
        errorMessage = 'QR session not found. Please scan QR code again.';
      } else if (response.status === 410) {
        errorMessage = 'QR session expired. Please scan QR code again.';
      }

      showAttendanceMessage(errorMessage, 'error');
      attendanceActionBtn.disabled = false;
      attendanceActionBtn.textContent = originalText;
    }
  } catch (error) {
    console.error('Action error:', error);
    showAttendanceMessage(`Error: ${error.message}`, 'error');
    const attendanceActionBtn = document.getElementById('attendanceActionBtn');
    attendanceActionBtn.disabled = false;
  }
}

function showAttendanceMessage(message, type) {
  const attendanceStatusMessage = document.getElementById('attendanceStatusMessage');
  if (!attendanceStatusMessage) return;

  attendanceStatusMessage.textContent = message;
  attendanceStatusMessage.style.display = 'block';

  if (type === 'error') {
    attendanceStatusMessage.style.backgroundColor = 'var(--red-primary)';
    attendanceStatusMessage.style.color = 'white';
  } else if (type === 'success') {
    attendanceStatusMessage.style.backgroundColor = 'var(--green-primary)';
    attendanceStatusMessage.style.color = 'white';
  } else if (type === 'info') {
    attendanceStatusMessage.style.backgroundColor = 'var(--bg-hover)';
    attendanceStatusMessage.style.color = 'var(--text-secondary)';
  }
}



