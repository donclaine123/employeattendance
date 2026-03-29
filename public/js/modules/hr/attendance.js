/**
 * attendance.js
 * Real-time Attendance Monitoring for HR Dashboard
 */

import { fetchWithAuth } from './utils.js';
import { escapeHtml } from './utils.js';

// Store attendance records for modal access
const attendanceRecords = new Map();

// Current attendance record being viewed in modal
let currentModalAttendance = null;

/**
 * Format time string to HH:MM AM/PM format
 */
function formatTime(timeStr) {
  if (!timeStr || timeStr === '—') return '—';

  try {
    // Remove seconds if present (HH:MM:SS -> HH:MM)
    const parts = String(timeStr).split(':');
    if (parts.length >= 2) {
      const hours = parts[0];
      const minutes = parts[1];
      const hour = parseInt(hours, 10);
      const period = hour >= 12 ? 'PM' : 'AM';
      const displayHour = hour % 12 || 12;
      return `${displayHour}:${minutes} ${period}`;
    }
    return timeStr;
  } catch (error) {
    return timeStr;
  }
}

/**
 * Get department style class
 */
function getDeptClass(dept) {
  if (!dept) return 'default';
  const d = String(dept).toLowerCase();
  if (d.includes('computer') || d.includes('science') || d.includes('it') || d.includes('tech') || d.includes('information')) return 'tech';
  if (d.includes('operation') || d.includes('ops') || d.includes('admin')) return 'ops';
  if (d.includes('engineer') || d.includes('eng')) return 'eng';
  return 'default';
}

/**
 * Initialize Attendance Monitoring
 */
export function initAttendance() {
  console.log('[HR] Initializing Attendance Monitoring...');

  // Make closeModal globally available for onclick handlers
  window.closeModal = function (id) {
    const modal = document.getElementById(id);
    if (modal) {
      modal.classList.remove('visible');
      console.log(`[Attendance] Closed modal: ${id}`);
    }
  };

  // Load initial data
  loadAndRenderAttendance();

  // Wire refresh button
  const dashRefresh = document.getElementById('hr-refresh-btn');
  if (dashRefresh) dashRefresh.addEventListener('click', loadAndRenderAttendance);

  // Setup Filters
  setupAttendanceFilters();
}

/**
 * Fetch and render attendance data
 */
export async function loadAndRenderAttendance() {
  try {
    console.log('[HR] Loading attendance data...');

    const [empsResp, attResp] = await Promise.all([
      fetchWithAuth('/hr/employees', {}),
      fetchWithAuth('/hr/attendance', {})
    ]);

    if (!empsResp.ok || !attResp.ok) throw new Error('Failed to load data');

    const empsData = await empsResp.json();
    const attData = await attResp.json();

    const employees = empsData.data || empsData;
    const attendance = attData.data || attData;

    // Build map for quick lookups
    const empMap = new Map();
    if (Array.isArray(employees)) {
      for (const e of employees) {
        if (e.employee_id) empMap.set(e.employee_id, e.name || e.full_name);
        if (e.id) empMap.set(String(e.id), e.name || e.full_name);
      }
    }

    // Render Table
    renderAttendanceTable(attendance, empMap);

    // Setup Filters
    setupAttendanceFilters();

  } catch (e) {
    console.error('[HR] Failed to load attendance', e);
  }
}

/**
 * Render the attendance table
 */
function renderAttendanceTable(attendance, empMap) {
  let tbody = document.querySelector('#attendanceTable tbody');

  // Fallback search for table if ID not found
  if (!tbody) {
    const table = document.querySelector('.attendance-table');
    if (table) tbody = table.querySelector('tbody');
  }

  if (!tbody) return;

  tbody.innerHTML = '';
  const allRecords = Array.isArray(attendance) ? attendance : [];

  if (allRecords.length === 0) {
    const tr = document.createElement('tr');
    tr.innerHTML = '<td colspan="7" style="text-align:center;color:var(--text-secondary);padding:1rem;">No attendance records found.</td>';
    tbody.appendChild(tr);
    return;
  }

  // Sort: Newest first
  allRecords.sort((a, b) => {
    const dateComp = (b.date || '').localeCompare(a.date || '');
    if (dateComp !== 0) return dateComp;
    return (b.time_in || '').localeCompare(a.time_in || '');
  });

  allRecords.forEach(r => {
    const tr = document.createElement('tr');

    const name = r.employee_name || empMap.get(r.employee_id) || empMap.get(String(r.employee_id)) || 'Unknown';
    // Format Date: Feb 7, 2026
    const dateObj = r.date ? new Date(r.date) : null;
    const dateDisplay = dateObj ? dateObj.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—';

    // Format Time: 2:53:55 PM (use existing helper but strict format)
    const timeIn = r.time_in ? formatTime(r.time_in) : '—'; // formatTime is defined above
    const timeOut = r.time_out ? formatTime(r.time_out) : '--';

    const dept = r.employee_department || '—';
    const deptClass = getDeptClass(dept);

    // Subject "View" Button
    const subjectBtn = `<button class="btn-view-subject-attendance" data-attendance-id="${r.attendance_id || ''}">
        VIEW
    </button>`;

    tr.innerHTML = `
            <td class="id-cell">#${escapeHtml(String(r.employee_id || ''))}</td>
            <td>
                <span class="attendance-name-text">${escapeHtml(name)}</span>
            </td>
            <td class="date-cell">${escapeHtml(dateDisplay)}</td>
            <td><span class="time-badge in">${escapeHtml(timeIn)}</span></td>
            <td><span class="time-badge out">${escapeHtml(timeOut)}</span></td>
            <td><span class="dept-badge ${deptClass}">${escapeHtml(dept)}</span></td>
            <td style="text-align: center;">${subjectBtn}</td>
        `;
    tbody.appendChild(tr);

    // Store full attendance record for modal access
    if (r.attendance_id) {
      attendanceRecords.set(r.attendance_id, {
        attendance_id: r.attendance_id,
        employee_id: r.employee_id,
        employee_name: name,
        date: r.date,
        time_in: timeIn,
        time_out: timeOut,
        department: dept,
        metadata: r.metadata || {}
      });
    }
  });

  // Add event listeners to subject buttons
  const subjectButtons = document.querySelectorAll('.btn-view-subject-attendance');
  subjectButtons.forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      const attendanceId = btn.dataset.attendanceId;
      const attendance = attendanceRecords.get(parseInt(attendanceId) || attendanceId);
      if (attendance) {
        openSubjectAttendanceModal(attendance);
      }
    });
  });
}

/**
 * Setup client-side filtering for attendance table
 */
function setupAttendanceFilters() {
  const deptFilter = document.getElementById('attendanceDeptFilter');
  const searchFilter = document.getElementById('attendanceSearchFilter');

  if (!deptFilter || !searchFilter) return;

  function applyFilters() {
    const selectedDept = deptFilter.value.toLowerCase();
    const searchTerm = searchFilter.value.toLowerCase();

    const tbody = document.querySelector('#attendanceTable tbody');
    if (!tbody) return;

    const rows = tbody.querySelectorAll('tr');
    rows.forEach(row => {
      const cells = row.querySelectorAll('td');
      if (cells.length < 7) return;

      const name = cells[1].textContent.toLowerCase();
      const dept = cells[6].textContent.toLowerCase();

      let show = true;
      if (selectedDept && !dept.includes(selectedDept)) show = false;
      if (searchTerm && !name.includes(searchTerm)) show = false;

      row.style.display = show ? '' : 'none';
    });
  }

  deptFilter.addEventListener('change', applyFilters);
  searchFilter.addEventListener('input', applyFilters);
}

/**
 * Open Subject Attendance Details Modal
 */
export function openSubjectAttendanceModal(attendance) {
  if (!attendance) return;

  const modal = document.getElementById('subjectAttendanceModal');
  if (!modal) return;

  // Populate modal fields
  document.getElementById('subjectAttendanceEmpID').textContent = escapeHtml(String(attendance.employee_id || '—'));
  document.getElementById('subjectAttendanceDate').textContent = escapeHtml(String(attendance.date || '—'));
  document.getElementById('subjectAttendanceEmpName').textContent = escapeHtml(String(attendance.employee_name || '—'));
  document.getElementById('subjectAttendanceTimeIn').textContent = formatTime(String(attendance.time_in || '—'));
  document.getElementById('subjectAttendanceTimeOut').textContent = formatTime(String(attendance.time_out || '—'));

  // Store current attendance for reference
  currentModalAttendance = attendance;

  // Load and display scheduled classes for this employee
  loadScheduledClassesForDate(attendance.employee_id, attendance.date);

  // Show modal using CSS class (consistent with closeModal)
  modal.classList.add('visible');
}

/**
 * Load scheduled classes for employee on given date
 * Uses the same /api/attendance/subject endpoint that employee page uses
 * This ensures consistent data with verified_status for all users
 */
async function loadScheduledClassesForDate(employeeId, date) {
  try {
    console.log(`[Attendance] Loading schedules for employee ${employeeId} on date ${date}`);

    // Query attendance/subject endpoint with employee_id parameter
    // This returns the same data structure as employee page, with subjects array containing verified_status
    const response = await fetchWithAuth(`/api/attendance/subject?date=${date}&employee_id=${employeeId}`, {});

    if (!response.ok) {
      console.warn('[Attendance] Could not fetch schedules:', response.status);
      renderEmptySchedules();
      return;
    }

    const data = await response.json();
    const records = data.data || data || [];

    if (!Array.isArray(records) || records.length === 0) {
      console.log('[Attendance] No records found for this employee/date');
      renderEmptySchedules();
      return;
    }

    // Extract subjects from the record (same structure as employee page)
    const record = records[0];
    const subjects = record.subjects || [];

    if (!Array.isArray(subjects) || subjects.length === 0) {
      renderEmptySchedules();
      return;
    }

    renderScheduleTable(subjects);
  } catch (error) {
    console.error('[Attendance] Error loading schedules:', error);
    renderEmptySchedules();
  }
}

/**
 * Get status display info for a given attendance status
 * Handles both subject-based verification status and general attendance status
 */
function getStatusDisplay(attendanceStatus) {
  const status = (attendanceStatus || 'pending').toLowerCase();

  // Subject-based verification statuses (from /api/attendance/subject endpoint)
  if (status === 'verified') {
    return { icon: '✓', text: 'VERIFIED', class: 'verified', color: '#4CAF50' };
  } else if (status === 'unverified') {
    return { icon: '◯', text: 'UNVERIFIED', class: 'unverified', color: '#9E9E9E' };
  } else if (status === 'absent') {
    return { icon: '✗', text: 'ABSENT', class: 'absent', color: '#F44336' };
  } else if (status === 'late') {
    return { icon: '⚠', text: 'LATE', class: 'late', color: '#FF9800' };
  }
  // General attendance statuses
  else if (status === 'present') {
    return { icon: '✓', text: 'PRESENT', class: 'present', color: '#4CAF50' };
  } else if (status === 'early_leave' || status === 'early leave') {
    return { icon: '→', text: 'EARLY LEAVE', class: 'early_leave', color: '#2196F3' };
  } else if (status === 'halfday' || status === 'half day') {
    return { icon: '◐', text: 'HALF DAY', class: 'halfday', color: '#9C27B0' };
  } else {
    return { icon: '○', text: 'PENDING', class: 'pending', color: '#9E9E9E' };
  }
}

/**
 * Render scheduled classes table
 * Groups subjects by code and time, combining sections
 * Subjects already come with verified_status field from attendance/subject endpoint
 */
function renderScheduleTable(subjects) {
  const tbody = document.getElementById('subjectScheduleList');
  if (!tbody) return;

  console.log('[renderScheduleTable] Rendering subjects:', subjects);

  // Group subjects by subject_code + start_time + end_time
  const groupedMap = {};
  subjects.forEach(subject => {
    const key = `${subject.subject_code}|${subject.start_time}|${subject.end_time}`;
    if (!groupedMap[key]) {
      groupedMap[key] = {
        subject_code: subject.subject_code,
        subject_name: subject.subject_name,
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

  tbody.innerHTML = groupedSubjects.map(group => {
    const subjectCode = escapeHtml(String(group.subject_code || '—'));
    const subjectName = escapeHtml(String(group.subject_name || '—'));
    const startTime = formatTime(String(group.start_time || '—'));
    const endTime = formatTime(String(group.end_time || '—'));
    
    // Combine sections: remove duplicates and sort
    const uniqueSections = [...new Set(group.sections)].sort();
    const sectionsText = uniqueSections.join(', ');
    
    // Get unique rooms: remove duplicates and sort
    const uniqueRooms = [...new Set(group.rooms)].filter(r => r && r.toLowerCase() !== 'tba').sort();
    const roomsText = uniqueRooms.length > 0 ? uniqueRooms.join(', ') : 'TBA';

    // Use the verified_status from the group
    const verifiedStatus = group.verified_status || 'pending';
    console.log(`[renderScheduleTable] Group ${subjectCode} ${startTime}-${endTime} status:`, verifiedStatus);

    const statusDisplay = getStatusDisplay(verifiedStatus);

    return `
      <tr style="border-bottom: 1px solid var(--border-primary);">
        <td style="padding: 12px; color: var(--text-primary); font-weight: 600;">
          ${subjectCode}
          <div style="font-size: 11px; color: var(--text-muted); margin-top: 2px;">${subjectName}</div>
        </td>
        <td style="padding: 12px; color: var(--text-primary); font-weight: 600;">
          ${sectionsText}
        </td>
        <td style="padding: 12px; color: var(--text-primary); font-weight: 600;">
          ${startTime} - ${endTime}
        </td>
        <td style="padding: 12px; color: var(--text-primary);">
          📍 ${roomsText}
        </td>
        <td style="padding: 12px;">
          <span style="display: inline-flex; align-items: center; gap: 4px; padding: 6px 10px; border-radius: 4px; font-size: 12px; font-weight: 600; border: 1.5px solid ${statusDisplay.color}; color: ${statusDisplay.color};">
            ${statusDisplay.icon} ${statusDisplay.text}
          </span>
        </td>
      </tr>
    `;
  }).join('');
}

/**
 * Render empty schedules state
 */
function renderEmptySchedules() {
  const tbody = document.getElementById('subjectScheduleList');
  if (!tbody) return;

  tbody.innerHTML = `
    <tr style="border-bottom: 1px solid var(--border-primary);">
      <td colspan="4" style="padding: 20px; text-align: center; color: var(--text-muted); font-size: 13px;">
        No scheduled classes found for this date
      </td>
    </tr>
  `;
}

/**
 * Mark attendance as verified with a specific status
 */
window.markAttendanceStatus = async function (verifyStatus) {
  // Verification functionality removed - to be implemented separately
  console.log('[Attendance] Verification deprecated:', verifyStatus);
};
