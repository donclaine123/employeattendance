/**
 * attendance.js
 * Real-time Attendance Monitoring for HR Dashboard
 */

import { fetchWithAuth } from './utils.js';
import { escapeHtml } from './utils.js';

/**
 * Initialize Attendance Monitoring
 */
export function initAttendance() {
  console.log('[HR] Initializing Attendance Monitoring...');

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

    // Update Statistics
    updateAttendanceStats(attendance);

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
    const date = r.date ? new Date(r.date).toLocaleDateString() : '—';
    const timeIn = r.time_in ? new Date(`${r.date}T${r.time_in}`).toLocaleTimeString() : '—';
    const timeOut = r.time_out ? new Date(`${r.date}T${r.time_out}`).toLocaleTimeString() : '—';
    const dept = r.employee_department || '—';
    const status = (r.status || 'Present');
    const statusClass = status.toLowerCase().includes('late') ? 'late' : 'on-time';

    tr.innerHTML = `
            <td>${escapeHtml(String(r.employee_id || ''))}</td>
            <td>${escapeHtml(name)}</td>
            <td>${escapeHtml(date)}</td>
            <td>${escapeHtml(timeIn)}</td>
            <td>${escapeHtml(timeOut)}</td>
            <td>${escapeHtml(dept)}</td>
            <td><span class="status ${statusClass}">${escapeHtml(status)}</span></td>
        `;
    tbody.appendChild(tr);
  });
}

/**
 * Update Dashboard Statistics
 */
function updateAttendanceStats(attendance) {
  const counts = { present: 0, late: 0, absent: 0 };

  if (Array.isArray(attendance)) {
    attendance.forEach(r => {
      const s = (r.status || '').toLowerCase();
      if (s.includes('late')) counts.late++;
      else if (s.includes('absent')) counts.absent++;
      else counts.present++;
    });
  }

  // Update Chips
  const chips = document.querySelectorAll('.stat-chip .num');
  if (chips.length >= 3) {
    chips[0].textContent = counts.present;
    chips[1].textContent = counts.late;
    chips[2].textContent = counts.absent;
  }

  // Update IDs if they exist
  const presentEl = document.getElementById('stat-present-today');
  const lateEl = document.getElementById('stat-late-arrivals');
  const absentEl = document.getElementById('stat-absent-today');

  if (presentEl) presentEl.textContent = counts.present;
  if (lateEl) lateEl.textContent = counts.late;
  if (absentEl) absentEl.textContent = counts.absent;
}

/**
 * Setup client-side filtering for attendance table
 */
function setupAttendanceFilters() {
  const deptFilter = document.getElementById('attendanceDeptFilter');
  const statusFilter = document.getElementById('attendanceStatusFilter');
  const searchFilter = document.getElementById('attendanceSearchFilter');

  if (!deptFilter || !statusFilter || !searchFilter) return;

  function applyFilters() {
    const selectedDept = deptFilter.value.toLowerCase();
    const selectedStatus = statusFilter.value.toLowerCase();
    const searchTerm = searchFilter.value.toLowerCase();

    const tbody = document.querySelector('#attendanceTable tbody');
    if (!tbody) return;

    const rows = tbody.querySelectorAll('tr');
    rows.forEach(row => {
      const cells = row.querySelectorAll('td');
      if (cells.length < 7) return;

      const name = cells[1].textContent.toLowerCase();
      const dept = cells[5].textContent.toLowerCase();
      const status = cells[6].textContent.toLowerCase();

      let show = true;
      if (selectedDept && !dept.includes(selectedDept)) show = false;
      if (selectedStatus && !status.includes(selectedStatus)) show = false;
      if (searchTerm && !name.includes(searchTerm)) show = false;

      row.style.display = show ? '' : 'none';
    });
  }

  deptFilter.addEventListener('change', applyFilters);
  statusFilter.addEventListener('change', applyFilters);
  searchFilter.addEventListener('input', applyFilters);
}
