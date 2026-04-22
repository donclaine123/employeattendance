/**
 * Attendance Module
 * Shows employee their scheduled subjects for a given date with verification status from HR hourly rounds
 * Also manages dashboard recent attendance display
 */

let currentDate = new Date(); // Track current date being viewed
let currentAttendanceState = null; // Will hold: { employee_id, time_in, time_out, status }
let currentEmployeeInfo = null; // Will hold employee info
let determinedActionType = 'check-in'; // Will hold the action type (check-in or check-out)
let digitalClockTimerId = null;

export function initAttendance(user) {
  if (!user || !user.employee_id) return;

  // Initialize with today's data
  currentDate = new Date();
  
  // Initialize date picker to today
  const datePickerInput = document.getElementById('attendanceDatePicker');
  if (datePickerInput) {
    updateDatePickerValue(currentDate);
  }
  
  startDigitalClock();
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

function startDigitalClock() {
  const updateClock = () => {
    const clockEl = document.getElementById('digitalClock');
    if (!clockEl) return;

    const now = new Date();
    const formattedTime = new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Asia/Manila',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: true
    }).format(now);

    clockEl.textContent = formattedTime;
  };

  if (digitalClockTimerId) {
    clearInterval(digitalClockTimerId);
  }

  updateClock();
  digitalClockTimerId = window.setInterval(updateClock, 1000);
}

function setupDateNavigation(user) {
  const prevBtn = document.getElementById('prevDateBtn');
  const nextBtn = document.getElementById('nextDateBtn');
  const todayBtn = document.getElementById('todayBtn');
  const datePickerInput = document.getElementById('attendanceDatePicker');

  if (prevBtn) {
    prevBtn.addEventListener('click', () => {
      const newDate = new Date(currentDate);
      newDate.setDate(newDate.getDate() - 1);
      currentDate = newDate;
      updateDatePickerValue(newDate);
      loadAttendance(user, currentDate);
    });
  }

  if (nextBtn) {
    nextBtn.addEventListener('click', () => {
      const newDate = new Date(currentDate);
      newDate.setDate(newDate.getDate() + 1);
      currentDate = newDate;
      updateDatePickerValue(newDate);
      loadAttendance(user, currentDate);
    });
  }

  if (todayBtn) {
    todayBtn.addEventListener('click', () => {
      currentDate = new Date();
      updateDatePickerValue(currentDate);
      loadAttendance(user, currentDate);
    });
  }

  // Handle date picker input changes
  if (datePickerInput) {
    datePickerInput.addEventListener('change', (e) => {
      const selectedDateStr = e.target.value; // Format: YYYY-MM-DD
      if (selectedDateStr) {
        const newDate = new Date(selectedDateStr + 'T00:00:00');
        currentDate = newDate;
        loadAttendance(user, currentDate);
      }
    });
  }
}

function updateDatePickerValue(date) {
  const datePickerInput = document.getElementById('attendanceDatePicker');
  if (datePickerInput) {
    const dateStr = formatLocalDate(date);
    datePickerInput.value = dateStr;
  }
}

async function loadAttendance(user, dateToLoad) {
  try {
    const apiBase = window.API_URL || '/api';
    
    // Format date as YYYY-MM-DD using local time to avoid timezone issues
    const dateStr = formatLocalDate(dateToLoad);
    
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
    
    // We want to be able to style Day and Date separately for mobile
    const dayName = date.toLocaleDateString('en-US', { weekday: 'long' });
    const fullDate = date.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
    
    // Insert structured HTML. 
    // On desktop: "Monday, February 23, 2026"
    // On mobile CSS: break lines or flex-col
    dateEl.innerHTML = `
      <span class="date-part-day">${dayName}</span><span class="date-part-sep">, </span>
      <span class="date-part-full">${fullDate}</span>
    `;
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
    let timeStr = String(time).trim();

    if (!timeStr) return '-';

    const formattedMatch = timeStr.match(/^(\d{1,2}):(\d{2})(?::\d{2})?\s*([AP]M)(?:\s*[AP]M)*$/i);
    if (formattedMatch) {
      const hour = parseInt(formattedMatch[1], 10);
      const minutes = formattedMatch[2];
      const period = formattedMatch[3].toUpperCase();
      const displayHour = hour % 12 || 12;
      return `${displayHour}:${minutes} ${period}`;
    }
    
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
    const today = new Date();
    const dateParam = formatLocalDate(today);

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
      updateDashboardStats(null, null, null);
      return;
    }

    // Get the first record (today)
    const todayRecord = records[0];
    displayDashboardAttendance(todayRecord);
    
    // Calculate stats
    calculateAndDisplayStats(user, today);
  } catch (error) {
    console.error('[Attendance] Error loading dashboard data:', error);
    displayEmptyDashboardAttendance();
    updateDashboardStats(null, null, null);
  }
}

async function calculateAndDisplayStats(user, today) {
  try {
    const apiBase = window.API_URL || '/api';
    
    // Calculate week dates (Monday to Sunday)
    const dayOfWeek = today.getDay();
    const monday = new Date(today);
    monday.setDate(today.getDate() - (dayOfWeek === 0 ? 6 : dayOfWeek - 1));
    const sunday = new Date(monday);
    sunday.setDate(monday.getDate() + 6);
    
    const weekStart = formatLocalDate(monday);
    const weekEnd = formatLocalDate(sunday);
    
    // Get month dates
    const monthStart = formatLocalDate(new Date(today.getFullYear(), today.getMonth(), 1));
    const monthEnd = formatLocalDate(new Date(today.getFullYear(), today.getMonth() + 1, 0));
    
    // Fetch today's hours
    const todayDateStr = formatLocalDate(today);
    const todayUrl = `${apiBase}/attendance/history?employee_id=${user.employee_id}&start=${todayDateStr}&end=${todayDateStr}`;
    const todayResp = await fetch(todayUrl, {
      headers: { 'Authorization': `Bearer ${localStorage.getItem('authToken') || ''}` }
    });
    
    let todayHours = '--';
    if (todayResp.ok) {
      const todayData = await todayResp.json();
      const todayRecords = Array.isArray(todayData) ? todayData : (todayData.data || []);
      if (todayRecords.length > 0 && todayRecords[0].time_in && todayRecords[0].time_out) {
        todayHours = calculateHoursBetween(todayRecords[0].time_in, todayRecords[0].time_out);
      }
    }
    
    // Fetch this week's data
    const weekUrl = `${apiBase}/attendance/history?employee_id=${user.employee_id}&start=${weekStart}&end=${weekEnd}`;
    const weekResp = await fetch(weekUrl, {
      headers: { 'Authorization': `Bearer ${localStorage.getItem('authToken') || ''}` }
    });
    
    let weekHours = 0;
    if (weekResp.ok) {
      const weekData = await weekResp.json();
      const weekRecords = Array.isArray(weekData) ? weekData : (weekData.data || []);
      weekRecords.forEach(record => {
        if (record.time_in && record.time_out) {
          weekHours += parseFloat(calculateHoursBetween(record.time_in, record.time_out)) || 0;
        }
      });
    }
    weekHours = weekHours.toFixed(1);
    
    // Fetch this month's data for compliance calculation
    const monthUrl = `${apiBase}/attendance/history?employee_id=${user.employee_id}&start=${monthStart}&end=${monthEnd}`;
    const monthResp = await fetch(monthUrl, {
      headers: { 'Authorization': `Bearer ${localStorage.getItem('authToken') || ''}` }
    });
    
    let monthCompliance = '--';
    if (monthResp.ok) {
      const monthData = await monthResp.json();
      const monthRecords = Array.isArray(monthData) ? monthData : (monthData.data || []);
      
      // Count present days (days with both time_in and time_out)
      const presentDays = monthRecords.filter(r => r.time_in && r.time_out).length;
      
      // Get total working days in month (excluding weekends)
      let workingDays = 0;
      for (let d = new Date(monthStart); d <= new Date(monthEnd); d.setDate(d.getDate() + 1)) {
        if (d.getDay() !== 0 && d.getDay() !== 6) {
          workingDays++;
        }
      }
      
      if (workingDays > 0) {
        monthCompliance = Math.round((presentDays / workingDays) * 100);
      }
    }
    
    updateDashboardStats(todayHours, weekHours, monthCompliance);
  } catch (error) {
    console.error('[Stats] Error calculating stats:', error);
    updateDashboardStats(null, null, null);
  }
}

function calculateHoursBetween(timeInStr, timeOutStr) {
  try {
    // Parse time strings (assuming HH:MM or HH:MM:SS format)
    const parseTime = (str) => {
      const parts = str.split(':');
      return parseInt(parts[0], 10) + parseInt(parts[1], 10) / 60 + (parseInt(parts[2], 10) || 0) / 3600;
    };
    
    const timeIn = parseTime(timeInStr);
    const timeOut = parseTime(timeOutStr);
    const hours = timeOut - timeIn;
    
    return hours > 0 ? hours.toFixed(1) : '0';
  } catch (error) {
    console.error('[Stats] Error calculating hours:', error);
    return '--';
  }
}

function updateDashboardStats(todayHours, weekHours, monthCompliance) {
  const DAILY_GOAL = 8;
  const WEEKLY_GOAL = 40;
  
  // ===== TODAY'S HOURS =====
  const todayHoursEl = document.getElementById('statTodayHoursDashboard');
  const todayProgressBar = document.getElementById('statTodayProgressBar');
  
  if (todayHoursEl && todayProgressBar) {
    if (todayHours === '--' || todayHours === null) {
      todayHoursEl.textContent = '--';
      todayProgressBar.style.width = '0%';
    } else {
      todayHoursEl.textContent = `${todayHours}h`;
      // Calculate progress: cap at 100% visually (no overflow bars)
      const todayProgress = Math.min((todayHours / DAILY_GOAL) * 100, 100);
      todayProgressBar.style.width = `${todayProgress}%`;
    }
  }
  
  // ===== THIS WEEK HOURS =====
  const weekHoursEl = document.getElementById('statWeekHoursDashboard');
  const weekProgressBar = document.getElementById('statWeekProgressBar');
  const weekSubtext = document.getElementById('statWeekSubtext');
  
  if (weekHoursEl && weekProgressBar) {
    if (weekHours === null || weekHours === '--') {
      weekHoursEl.textContent = '--/40';
      weekProgressBar.style.width = '0%';
    } else {
      weekHoursEl.textContent = `${weekHours}/40`;
      const weekProgress = Math.min((weekHours / WEEKLY_GOAL) * 100, 100);
      weekProgressBar.style.width = `${weekProgress}%`;
      
      // Generate smart subtext based on week progress
      if (weekSubtext) {
        const daysWorked = Math.ceil(weekHours / DAILY_GOAL);
        const expectedDailyAvg = WEEKLY_GOAL / 5; // 8 hours per day
        const percentOfGoal = (weekHours / WEEKLY_GOAL) * 100;
        
        if (weekHours >= WEEKLY_GOAL) {
          weekSubtext.textContent = 'Excellent! Beyond goal';
        } else if (percentOfGoal >= 80) {
          const remaining = WEEKLY_GOAL - weekHours;
          weekSubtext.textContent = `${remaining.toFixed(1)}h needed for goal`;
        } else if (percentOfGoal >= 50) {
          weekSubtext.textContent = 'On pace for 40h';
        } else {
          weekSubtext.textContent = 'Catch up to stay on track';
        }
      }
    }
  }
  
  // ===== THIS MONTH COMPLIANCE =====
  const monthComplianceEl = document.getElementById('statMonthComplianceDashboard');
  const monthProgressBar = document.getElementById('statMonthProgressBar');
  const monthSubtext = document.getElementById('statMonthSubtext');
  
  if (monthComplianceEl && monthProgressBar) {
    if (monthCompliance === '--' || monthCompliance === null) {
      monthComplianceEl.textContent = '--';
      monthProgressBar.style.width = '0%';
    } else {
      monthComplianceEl.textContent = `${monthCompliance}%`;
      const monthProgress = Math.min(monthCompliance, 100);
      monthProgressBar.style.width = `${monthProgress}%`;
      
      // Generate smart subtext based on compliance
      if (monthSubtext) {
        if (monthCompliance >= 95) {
          monthSubtext.textContent = 'Excellent attendance ✓';
        } else if (monthCompliance >= 85) {
          monthSubtext.textContent = 'Good attendance';
        } else if (monthCompliance >= 75) {
          monthSubtext.textContent = 'Needs improvement';
        } else {
          monthSubtext.textContent = 'Urgent: Address absences';
        }
      }
    }
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

  // Get today's date
  const today = new Date();
  const dateStr = today.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });

  // Create activity items for check-in and check-out
  let html = '';
  
  // Check-in item
  if (record.time_in) {
    html += `
      <div class="activity-item">
        <div class="activity-icon check-in">↙</div>
        <div class="activity-content">
          <p class="activity-title-text">Time In</p>
          <p class="activity-date">${dateStr}</p>
        </div>
        <div class="activity-right">
          <span class="activity-time">${checkInTime}</span>
          <span class="activity-status">On Time</span>
        </div>
      </div>
    `;
  }
  
  // Check-out item
  if (record.time_out) {
    html += `
      <div class="activity-item">
        <div class="activity-icon check-out">↗</div>
        <div class="activity-content">
          <p class="activity-title-text">Time Out</p>
          <p class="activity-date">${dateStr}</p>
        </div>
        <div class="activity-right">
          <span class="activity-time">${checkOutTime}</span>
          <span class="activity-status">On Time</span>
        </div>
      </div>
    `;
  }

  if (!html) {
    displayEmptyDashboardAttendance();
    return;
  }

  quickList.innerHTML = html;
}

function displayEmptyDashboardAttendance() {
  const quickList = document.getElementById('quickAttendanceList');

  if (!quickList) return;

  quickList.innerHTML = `
    <div class="activity-empty-state" role="status" aria-live="polite">
      <div class="activity-empty-icon" aria-hidden="true">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="12" cy="12" r="9"></circle>
          <path d="M12 7v5l3 2"></path>
        </svg>
      </div>
      <div class="activity-empty-copy">
        <p class="activity-empty-title">No recent attendance yet</p>
        <p class="activity-empty-text">Your latest clock-in and clock-out activity will appear here after you submit attendance today.</p>
        <p class="activity-empty-hint">Open the Attendance tab to review your full history.</p>
      </div>
    </div>
  `;
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
    const dateParam = formatLocalDate(new Date());
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

    // Show action type indicator (Time In or Time Out)
    const actionTypeIndicator = document.getElementById('attendanceActionTypeIndicator');
    const actionTypeText = document.getElementById('attendanceActionTypeText');
    if (actionTypeIndicator && actionTypeText) {
      let actionLabel = 'Time In';
      determinedActionType = 'check-in';

      // Only show Time Out if: time_in exists AND time_out is null/empty
      if (currentAttendanceState.time_in && !currentAttendanceState.time_out) {
        actionLabel = 'Time Out';
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
  let actionText = 'Time In Today?';
  let actionIcon = '↙';
  let statusDetails = 'No time in yet';

  const hasTimeIn = currentAttendanceState.time_in && (typeof currentAttendanceState.time_in === 'string' || typeof currentAttendanceState.time_in === 'object');
  const hasTimeOut = currentAttendanceState.time_out && (typeof currentAttendanceState.time_out === 'string' || typeof currentAttendanceState.time_out === 'object');

  if (hasTimeIn && !hasTimeOut) {
    actionType = 'check-out';
    actionText = 'Time Out Today?';
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
    attendanceActionBtn.textContent = actionType === 'check-out' ? '✓ Time Out' : '→ Time In';
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




// Helper to format date as YYYY-MM-DD using local time
function formatLocalDate(date) {
  const offset = date.getTimezoneOffset();
  const localDate = new Date(date.getTime() - (offset * 60 * 1000));
  return localDate.toISOString().split('T')[0];
}

