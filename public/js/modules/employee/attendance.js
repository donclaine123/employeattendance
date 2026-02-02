/**
 * Attendance Module
 * Shows employee their scheduled subjects for a given date with verification status from HR hourly rounds
 * Also manages dashboard recent attendance display
 */

let currentDate = new Date(); // Track current date being viewed

export function initAttendance(user) {
  if (!user || !user.employee_id) return;

  // Initialize with today's data
  currentDate = new Date();
  loadAttendance(user, currentDate);

  // Setup date navigation
  setupDateNavigation(user);

  // Load recent attendance for dashboard
  loadDashboardAttendance(user);

  // Expose refresh function globally
  window.refreshAttendance = () => {
    loadAttendance(user, currentDate);
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

    if (!records || records.length === 0) {
      showEmptyState();
      return;
    }

    // Extract subjects from the first record (should only be one employee)
    const employeeRecord = Array.isArray(records) ? records[0] : records;
    const subjects = employeeRecord.subjects || [];

    if (subjects.length === 0) {
      showEmptyState();
      return;
    }

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

  if (!tbody) return;

  // Update check-in/check-out display
  if (checkInEl) {
    checkInEl.textContent = employeeRecord.time_in ? formatTimeToAMPM(employeeRecord.time_in) : '--:--';
  }
  if (checkOutEl) {
    checkOutEl.textContent = employeeRecord.time_out ? formatTimeToAMPM(employeeRecord.time_out) : '--:--';
  }

  if (!subjects || subjects.length === 0) {
    showEmptyState();
    return;
  }

  // Sort by start time
  subjects.sort((a, b) => {
    const timeA = (a.start_time || '').split(':').slice(0, 2).join(':');
    const timeB = (b.start_time || '').split(':').slice(0, 2).join(':');
    return timeA.localeCompare(timeB);
  });

  const rowsHTML = subjects.map((subject) => {
    const statusBadge = renderStatusBadge(subject.verified_status);
    const timeRange = `${formatTimeToAMPM(subject.start_time)} - ${formatTimeToAMPM(subject.end_time)}`;

    return `
      <tr>
        <td>
          <div style="font-weight: 500;">${subject.subject_code}</div>
          <div style="font-size: var(--text-xs); color: var(--text-secondary); margin-top: 4px;">Section ${subject.section_name || 'N/A'}</div>
        </td>
        <td>${timeRange}</td>
        <td>${subject.room_name || '-'}</td>
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
  
  const [hours, minutes] = time.split(':').slice(0, 2);
  const hour = parseInt(hours, 10);
  const min = minutes || '00';
  
  const period = hour >= 12 ? 'PM' : 'AM';
  const displayHour = hour % 12 || 12;
  
  return `${displayHour}:${min} ${period}`;
}

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
  if (!quickList) return;

  const checkInTime = record.time_in ? formatTimeToAMPM(record.time_in) : '--:--';
  const checkOutTime = record.time_out ? formatTimeToAMPM(record.time_out) : '--:--';
  const status = record.status || 'Pending';
  const statusClass = status.toLowerCase();

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

