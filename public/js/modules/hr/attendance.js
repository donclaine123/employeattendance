/**
 * attendance.js
 * Real-time Attendance Monitoring for HR Dashboard
 */

import { fetchWithAuth } from './utils.js';
import { escapeHtml } from './utils.js';

// Store attendance records for modal access
const attendanceRecords = new Map();

const ATTENDANCE_PAGE_SIZE = 8;

// Current attendance record being viewed in modal
let currentModalAttendance = null;
let attendanceFiltersBound = false;
let attendancePaginationBound = false;
let attendanceAllRecords = [];
let attendanceFilteredRecords = [];
let attendanceEmployeeMap = new Map();
let attendanceCurrentPage = 1;

/**
 * Format time string to HH:MM AM/PM format
 */
function formatTime(timeStr) {
  if (!timeStr || timeStr === '—') return '—';

  try {
    let rawTime = String(timeStr).trim();
    if (!rawTime) return '—';

    const formattedMatch = rawTime.match(/^(\d{1,2}):(\d{2})(?::\d{2})?\s*([AP]M)(?:\s*[AP]M)*$/i);
    if (formattedMatch) {
      const hour = parseInt(formattedMatch[1], 10);
      const minutes = formattedMatch[2];
      const period = formattedMatch[3].toUpperCase();
      const displayHour = hour % 12 || 12;
      return `${displayHour}:${minutes} ${period}`;
    }

    if (rawTime.includes('T')) {
      rawTime = rawTime.split('T')[1];
    }

    rawTime = rawTime.split('.')[0].split('Z')[0];

    const parts = rawTime.split(':');
    if (parts.length < 2) return rawTime;

    const hour = parseInt(parts[0], 10);
    const minutes = parts[1] || '00';
    if (Number.isNaN(hour)) return rawTime;

    const period = hour >= 12 ? 'PM' : 'AM';
    const displayHour = hour % 12 || 12;
    return `${displayHour}:${minutes} ${period}`;
  } catch (error) {
    return String(timeStr);
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
 * Normalize text so schedule and attendance values can be compared safely.
 */
function normalizeComparisonText(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

/**
 * Normalize a time value to HH:MM for matching.
 */
function normalizeComparisonTime(value) {
  if (!value) return '';

  const raw = String(value).trim();
  if (!raw) return '';

  const ampmMatch = raw.match(/^(\d{1,2}):(\d{2})(?::\d{2})?\s*([AP]M)$/i);
  if (ampmMatch) {
    let hour = parseInt(ampmMatch[1], 10);
    const minutes = ampmMatch[2];
    const period = ampmMatch[3].toUpperCase();

    if (period === 'PM' && hour !== 12) hour += 12;
    if (period === 'AM' && hour === 12) hour = 0;

    return `${String(hour).padStart(2, '0')}:${minutes}`;
  }

  const plainMatch = raw.match(/^(\d{1,2}):(\d{2})/);
  if (plainMatch) {
    return `${String(parseInt(plainMatch[1], 10)).padStart(2, '0')}:${plainMatch[2]}`;
  }

  return normalizeComparisonText(raw);
}

/**
 * Normalize a time range so schedule and online attendance periods can be compared.
 */
function normalizeComparisonPeriod(value) {
  if (!value) return '';

  const raw = String(value).trim();
  if (!raw) return '';

  const rangeParts = raw.split('-').map(part => part.trim()).filter(Boolean);
  if (rangeParts.length === 2) {
    const start = normalizeComparisonTime(rangeParts[0]);
    const end = normalizeComparisonTime(rangeParts[1]);
    if (start && end) {
      return `${start}-${end}`;
    }
  }

  return normalizeComparisonTime(raw);
}

/**
 * Returns true when the attendance record is an online submission.
 */
function isOnlineAttendanceRecord(record) {
  if (!record) return false;

  const attendanceType = String(record.attendance_type || record._attendanceType || '').toLowerCase();
  if (attendanceType === 'online') return true;

  const modalType = String(record.metadata?.online_class_modal || '').toLowerCase();
  return modalType === 'online' || modalType === 'mooc';
}

/**
 * Normalize a raw attendance record for filtering and display.
 */
function normalizeAttendanceRecord(record, empMap) {
  const displayName = record.employee_name || empMap.get(record.employee_id) || empMap.get(String(record.employee_id)) || 'Unknown';
  const department = record.employee_department || '—';
  const subjectSearch = [
    record.subject,
    record.subject_name,
    record.subject_code,
    record.metadata?.subject,
    record.metadata?.subject_name,
    record.metadata?.subject_code
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();

  return {
    ...record,
    _attendanceDisplayName: displayName,
    _attendanceDate: String(record.date || '').slice(0, 10),
    _attendanceDept: String(department || '').toLowerCase(),
    _attendanceEmployeeId: String(record.employee_id || '').toLowerCase(),
    _attendanceSubjectSearch: subjectSearch
  };
}

/**
 * Format an attendance date for UI copy.
 */
function formatAttendanceDateLabel(dateValue) {
  if (!dateValue) return '';

  try {
    const date = new Date(`${dateValue}T00:00:00`);
    if (Number.isNaN(date.getTime())) return String(dateValue);

    return date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric'
    });
  } catch (error) {
    return String(dateValue);
  }
}

/**
 * Toggle the realtime attendance empty state.
 */
function setAttendanceEmptyState(visible, title, message) {
  const emptyState = document.getElementById('attendanceEmptyState');
  const emptyTitle = document.getElementById('attendanceEmptyStateTitle');
  const emptyMessage = document.getElementById('attendanceEmptyStateMessage');
  const table = document.getElementById('attendanceTable');
  const pagination = document.getElementById('attendancePaginationFooter');

  if (!emptyState || !table) return;

  if (emptyTitle && title) emptyTitle.textContent = title;
  if (emptyMessage && message) emptyMessage.textContent = message;

  emptyState.style.display = visible ? 'flex' : 'none';
  table.style.display = visible ? 'none' : '';
  if (visible && pagination) pagination.style.display = 'none';
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
  setupAttendancePagination();
}

async function fetchAllAttendanceRecords() {
  const pageSize = 200;
  const cacheBuster = Date.now();
  const records = [];
  let page = 1;
  let totalPages = 1;

  do {
    const response = await fetchWithAuth(`/hr/attendance?_page=${page}&_limit=${pageSize}&_t=${cacheBuster}`, {});

    if (!response.ok) {
      throw new Error('Failed to load attendance data');
    }

    const result = await response.json();
    const pageRecords = Array.isArray(result.data) ? result.data : (Array.isArray(result) ? result : []);
    records.push(...pageRecords);

    const reportedPages = Number(result?.pagination?.pages || 1);
    totalPages = Number.isFinite(reportedPages) && reportedPages > 0 ? reportedPages : 1;
    page += 1;
  } while (page <= totalPages);

  return records;
}

/**
 * Fetch and render attendance data
 */
export async function loadAndRenderAttendance() {
  try {
    console.log('[HR] Loading attendance data...');

    const [empsResp, attResp] = await Promise.all([
      fetchWithAuth('/hr/employees', {}),
      fetchAllAttendanceRecords()
    ]);

    if (!empsResp.ok) throw new Error('Failed to load data');

    const empsData = await empsResp.json();

    const employees = empsData.data || empsData;
    const attendance = attResp;

    // Build map for quick lookups
    const empMap = new Map();
    if (Array.isArray(employees)) {
      for (const e of employees) {
        if (e.employee_id) empMap.set(e.employee_id, e.name || e.full_name);
        if (e.id) empMap.set(String(e.id), e.name || e.full_name);
      }
    }

    attendanceEmployeeMap = empMap;
    attendanceAllRecords = (Array.isArray(attendance) ? attendance : [])
      .slice()
      .sort((a, b) => {
        const dateComp = (b.date || '').localeCompare(a.date || '');
        if (dateComp !== 0) return dateComp;
        return (b.time_in || '').localeCompare(a.time_in || '');
      })
      .map(record => normalizeAttendanceRecord(record, empMap));

    attendanceCurrentPage = 1;

    // Populate sidebar filters from the current dataset
    populateAttendanceSidebarFilters(attendanceAllRecords);

    // Keep any selected filters applied after the refresh
    applyAttendanceFilters();

    // Setup Filters
    setupAttendanceFilters();
    setupAttendancePagination();

  } catch (e) {
    console.error('[HR] Failed to load attendance', e);
  }
}

/**
 * Render the attendance table
 */
function renderAttendanceTable(attendancePageRecords, empMap) {
  let tbody = document.querySelector('#attendanceTable tbody');

  // Fallback search for table if ID not found
  if (!tbody) {
    const table = document.querySelector('.attendance-table');
    if (table) tbody = table.querySelector('tbody');
  }

  if (!tbody) return;

  tbody.innerHTML = '';
  const pageRecords = Array.isArray(attendancePageRecords) ? attendancePageRecords : [];

  pageRecords.forEach(r => {
    const tr = document.createElement('tr');

    const name = r._attendanceDisplayName || r.employee_name || empMap.get(r.employee_id) || empMap.get(String(r.employee_id)) || 'Unknown';
    // Format Date: Feb 7, 2026
    const dateObj = r.date ? new Date(r.date) : null;
    const dateDisplay = dateObj ? dateObj.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—';

    // Format Time: 2:53:55 PM (use existing helper but strict format)
    const timeIn = r.time_in ? formatTime(r.time_in) : '—'; // formatTime is defined above
    const timeOut = r.time_out ? formatTime(r.time_out) : '--';

    const dept = r.employee_department || '—';
    const deptClass = getDeptClass(dept);
    const rowDate = r._attendanceDate || String(r.date || '').slice(0, 10);

    // Subject "View" Button
    const subjectBtn = `<button class="btn-view-subject-attendance" data-attendance-id="${r.attendance_id || ''}">
        VIEW
    </button>`;

    tr.dataset.attendanceDate = rowDate;
    tr.dataset.attendanceDept = r._attendanceDept || String(dept || '').toLowerCase();
    tr.dataset.attendanceEmployeeId = r._attendanceEmployeeId || String(r.employee_id || '').toLowerCase();
    tr.dataset.attendanceEmployeeName = String(name || '').toLowerCase();

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
        attendance_type: r.attendance_type || null,
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
  if (attendanceFiltersBound) return;

  const deptFilter = document.getElementById('attendanceDeptFilter');
  const dateFilter = document.getElementById('attendanceDateFilter');
  const searchFilter = document.getElementById('attendanceSearchFilter');

  if (!deptFilter || !dateFilter || !searchFilter) return;

  deptFilter.addEventListener('change', () => {
    attendanceCurrentPage = 1;
    applyAttendanceFilters();
  });
  dateFilter.addEventListener('change', () => {
    attendanceCurrentPage = 1;
    applyAttendanceFilters();
  });
  dateFilter.addEventListener('input', () => {
    attendanceCurrentPage = 1;
    applyAttendanceFilters();
  });
  searchFilter.addEventListener('input', () => {
    attendanceCurrentPage = 1;
    applyAttendanceFilters();
  });

  attendanceFiltersBound = true;
}

/**
 * Setup attendance pagination controls.
 */
function setupAttendancePagination() {
  if (attendancePaginationBound) return;

  const prevBtn = document.getElementById('attendancePrevPage');
  const nextBtn = document.getElementById('attendanceNextPage');

  if (!prevBtn || !nextBtn) return;

  prevBtn.addEventListener('click', () => {
    if (attendanceCurrentPage > 1) {
      attendanceCurrentPage -= 1;
      applyAttendanceFilters();
    }
  });

  nextBtn.addEventListener('click', () => {
    const totalPages = Math.max(1, Math.ceil(attendanceFilteredRecords.length / ATTENDANCE_PAGE_SIZE));
    if (attendanceCurrentPage < totalPages) {
      attendanceCurrentPage += 1;
      applyAttendanceFilters();
    }
  });

  attendancePaginationBound = true;
}

/**
 * Populate attendance sidebar filters from the current dataset
 */
function populateAttendanceSidebarFilters(attendance) {
  const deptFilter = document.getElementById('attendanceDeptFilter');
  const dateFilter = document.getElementById('attendanceDateFilter');

  if (!deptFilter || !dateFilter) return;

  const currentDept = deptFilter.value;

  const departments = new Set();

  for (const record of (Array.isArray(attendance) ? attendance : [])) {
    const department = record.employee_department || record.department || '';
    if (department) {
      departments.add(String(department).trim());
    }
  }

  deptFilter.innerHTML = '<option value="">All Departments</option>';
  Array.from(departments).sort((a, b) => a.localeCompare(b)).forEach(dept => {
    const option = document.createElement('option');
    option.value = dept;
    option.textContent = dept;
    deptFilter.appendChild(option);
  });

  if (currentDept) deptFilter.value = currentDept;
}

/**
 * Apply all attendance sidebar filters
 */
function applyAttendanceFilters() {
  const deptFilter = document.getElementById('attendanceDeptFilter');
  const dateFilter = document.getElementById('attendanceDateFilter');
  const searchFilter = document.getElementById('attendanceSearchFilter');

  const selectedDept = deptFilter?.value.toLowerCase() || '';
  const selectedDate = dateFilter?.value || '';
  const searchTerm = searchFilter?.value.toLowerCase() || '';

  const tbody = document.querySelector('#attendanceTable tbody');
  if (!tbody) return;

  const hasVisibleInPersonRecords = attendanceAllRecords.some(record => !isOnlineAttendanceRecord(record));

  attendanceFilteredRecords = attendanceAllRecords.filter(record => {
    if (isOnlineAttendanceRecord(record)) return false;

    const rowDept = record._attendanceDept || String(record.employee_department || record.department || '').toLowerCase();
    const rowDate = record._attendanceDate || String(record.date || '').slice(0, 10);
    const rowName = (record._attendanceDisplayName || record.employee_name || '').toLowerCase();
    const rowEmployeeId = record._attendanceEmployeeId || String(record.employee_id || '').toLowerCase();
    const rowSubject = record._attendanceSubjectSearch || [
      record.subject,
      record.subject_name,
      record.subject_code,
      record.metadata?.subject,
      record.metadata?.subject_name,
      record.metadata?.subject_code
    ]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();

    let show = true;
    if (selectedDept && rowDept !== selectedDept) show = false;
    if (selectedDate && rowDate !== selectedDate) show = false;
    if (searchTerm && !rowName.includes(searchTerm) && !rowEmployeeId.includes(searchTerm) && !rowSubject.includes(searchTerm)) show = false;
    return show;
  });

  if (attendanceFilteredRecords.length === 0) {
    tbody.innerHTML = '';
    if (attendanceAllRecords.length === 0) {
      setAttendanceEmptyState(
        true,
        'No attendance records yet',
        'Attendance entries will appear here once check-ins are available.'
      );
    } else if (!hasVisibleInPersonRecords) {
      setAttendanceEmptyState(
        true,
        'No in-person attendance records yet',
        'Online attendance entries are hidden from this view.'
      );
    } else if (selectedDate) {
      const dateLabel = formatAttendanceDateLabel(selectedDate);
      setAttendanceEmptyState(
        true,
        `No attendance on ${dateLabel}`,
        selectedDept || searchTerm
          ? 'Try another date or clear the department and search filters.'
          : 'This date has no attendance records yet.'
      );
    } else {
      setAttendanceEmptyState(
        true,
        'No matching attendance records',
        selectedDept || searchTerm
          ? 'Try adjusting the department or search filter.'
          : 'Attendance entries will appear here once check-ins are available.'
      );
    }

    updateAttendancePagination(0);
    return;
  }

  setAttendanceEmptyState(false);

  const totalPages = Math.max(1, Math.ceil(attendanceFilteredRecords.length / ATTENDANCE_PAGE_SIZE));
  if (attendanceCurrentPage > totalPages) attendanceCurrentPage = totalPages;
  if (attendanceCurrentPage < 1) attendanceCurrentPage = 1;

  const startIndex = (attendanceCurrentPage - 1) * ATTENDANCE_PAGE_SIZE;
  const pageRecords = attendanceFilteredRecords.slice(startIndex, startIndex + ATTENDANCE_PAGE_SIZE);

  renderAttendanceTable(pageRecords, attendanceEmployeeMap);
  updateAttendancePagination(attendanceFilteredRecords.length);
}

/**
 * Update the realtime attendance pagination controls.
 */
function updateAttendancePagination(totalRecords) {
  const footer = document.getElementById('attendancePaginationFooter');
  const pageInfo = document.getElementById('attendancePaginationInfo');
  const prevBtn = document.getElementById('attendancePrevPage');
  const nextBtn = document.getElementById('attendanceNextPage');

  if (!footer || !pageInfo || !prevBtn || !nextBtn) return;

  if (totalRecords <= 0) {
    footer.style.display = 'none';
    pageInfo.textContent = '';
    prevBtn.disabled = true;
    nextBtn.disabled = true;
    return;
  }

  const totalPages = Math.max(1, Math.ceil(totalRecords / ATTENDANCE_PAGE_SIZE));
  attendanceCurrentPage = Math.min(Math.max(attendanceCurrentPage, 1), totalPages);

  const startIndex = (attendanceCurrentPage - 1) * ATTENDANCE_PAGE_SIZE + 1;
  const endIndex = Math.min(startIndex + ATTENDANCE_PAGE_SIZE - 1, totalRecords);

  pageInfo.textContent = totalRecords <= ATTENDANCE_PAGE_SIZE
    ? `Showing all ${totalRecords} records`
    : `Showing ${startIndex}-${endIndex} of ${totalRecords} records`;

  prevBtn.disabled = attendanceCurrentPage <= 1;
  nextBtn.disabled = attendanceCurrentPage >= totalPages;
  footer.style.display = 'flex';
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
