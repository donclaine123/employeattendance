/**
 * attendance.js
 * Real-time Attendance Monitoring for SuperAdmin
 */

import { fetchWithAuth, escapeHtml, safeAdd } from './utils.js';

// Global API_URL is used in original script, assuming it's available on window
// or we can just use relative paths if the base is set correctly.
const API_URL = window.API_URL || '/api';

export async function loadAndRenderAttendanceSuperadmin() {
  try {
    console.log('[Superadmin] Loading all attendance data from:', API_URL);

    // fetch employees + attendance from server using HR endpoints (include credentials for cookie auth)
    const [empsResp, attResp] = await Promise.all([
      fetchWithAuth('/hr/employees', {}),
      fetchWithAuth('/hr/attendance', {})
    ]);
    console.log('[Superadmin] Employees response:', empsResp.status);
    console.log('[Superadmin] Attendance response:', attResp.status);

    if (!empsResp.ok || !attResp.ok) throw new Error('Failed to load data');
    const empsResult = await empsResp.json();
    const attResult = await attResp.json();

    // Extract data from response (API returns {success: true, data: [], pagination: {...}})
    const employees = empsResult.data || empsResult || [];
    const attendance = attResult.data || attResult || [];
    console.log('[Superadmin] Fetched employees:', employees?.length, 'attendance records:', attendance?.length);

    // build a map employee_id -> name
    const empMap = new Map();
    if (Array.isArray(employees)) {
      for (const e of employees) {
        if (e.employee_id) empMap.set(e.employee_id, e.name || e.full_name);
        if (e.id) empMap.set(String(e.id), e.name || e.full_name);
        if (e.email) empMap.set((e.email || '').toLowerCase(), e.name || e.full_name);
      }
    }

    // Get the attendance table for superadmin
    const attTable = document.getElementById('attendanceTableSuperadmin');
    if (!attTable) {
      console.warn('Could not find attendance table for superadmin');
      return;
    }

    const tbody = attTable.querySelector('tbody') || attTable.appendChild(document.createElement('tbody'));
    tbody.innerHTML = '';

    // Use all attendance records from server
    const allRecords = Array.isArray(attendance) ? attendance : [];

    if (allRecords.length === 0) {
      const tr = document.createElement('tr');
      tr.innerHTML = '<td colspan="7" style="text-align:center;color:var(--muted-foreground);padding:12px;">No attendance records found.</td>';
      tbody.appendChild(tr);
    } else {
      // render rows sorted by date and time (newest first)
      allRecords.sort((a, b) => {
        const dateComp = (b.date || '').localeCompare(a.date || '');
        if (dateComp !== 0) return dateComp;
        return (b.time_in || '').localeCompare(a.time_in || '');
      });
      for (const r of allRecords) {
        const tr = document.createElement('tr');
        const name = r.employee_name || empMap.get(r.employee_id) || empMap.get(String(r.employee_id)) || r.employee_id || r.email || 'Unknown';
        const idCell = String(r.employee_id || '');
        const date = r.date ? new Date(r.date).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: '2-digit' }) : '—';
        const timeIn = r.time_in ? new Date(`${r.date}T${r.time_in}`).toLocaleTimeString() : (r.timestamp ? new Date(r.timestamp).toLocaleTimeString() : '—');
        const timeOut = r.time_out ? new Date(`${r.date}T${r.time_out}`).toLocaleTimeString() : '—';
        const dept = r.employee_department || '—';
        const status = String(r.status || 'Present');
        tr.innerHTML = `<td>${escapeHtml(idCell)}</td><td>${escapeHtml(String(name))}</td><td>${escapeHtml(date)}</td><td>${escapeHtml(String(timeIn))}</td><td>${escapeHtml(String(timeOut))}</td><td>${escapeHtml(dept)}</td><td><span class="status ${status.toLowerCase().includes('late') ? 'late' : 'on-time'}">${escapeHtml(status)}</span></td>`;
        tbody.appendChild(tr);
      }
    }

    // compute overview counts from all attendance records
    const counts = { present: 0, late: 0, absent: 0 };
    for (const r of allRecords) {
      const s = (r.status || '').toLowerCase();
      if (s.includes('late')) counts.late += 1;
      else if (s.includes('absent')) counts.absent += 1;
      else counts.present += 1;
    }

    // update attendance section stat cards for superadmin
    try { const el = document.getElementById('presentCountSuperadmin'); if (el) el.textContent = String(counts.present); } catch (e) { }
    try { const el = document.getElementById('lateCountSuperadmin'); if (el) el.textContent = String(counts.late); } catch (e) { }
    try { const el = document.getElementById('absentCountSuperadmin'); if (el) el.textContent = String(counts.absent); } catch (e) { }

    // Re-apply filters if they exist
    setupAttendanceFilters();

  } catch (e) {
    console.error('[Superadmin] Failed to load attendance', e);
  }
}

function setupAttendanceFilters() {
  const deptFilter = document.getElementById('attendanceDeptFilterSuperadmin');
  const statusFilter = document.getElementById('attendanceStatusFilterSuperadmin');
  const searchFilter = document.getElementById('attendanceSearchFilterSuperadmin');
  const tbody = document.querySelector('#attendanceTableSuperadmin tbody');

  if (!deptFilter || !statusFilter || !searchFilter || !tbody) return;

  // Remove existing listeners to avoid duplicates if called multiple times
  // (safeAdd could cover this, but here we just redefine the function)

  const applyFilters = () => {
    const selectedDept = deptFilter.value.toLowerCase();
    const selectedStatus = statusFilter.value.toLowerCase();
    const searchTerm = searchFilter.value.toLowerCase();

    // Get all data rows (not the loading row)
    const rows = tbody.querySelectorAll('tr');
    let visibleCount = 0;

    rows.forEach(row => {
      if (row.querySelector('.attendance-loading-cell')) return; // Skip loading row
      // Check if it's the "No records" row
      if (row.cells.length === 1 && row.cells[0].colSpan > 1) return;

      const cells = row.querySelectorAll('td');
      if (cells.length === 0) return;

      // Extract data: ID, Name, Date, TimeIn, TimeOut, Dept, Status
      const employeeId = cells[0]?.textContent.trim() || '';
      const name = cells[1]?.textContent.trim() || '';
      const dept = cells[5]?.textContent.trim() || '';
      const statusCell = cells[6]?.textContent.trim().toLowerCase() || '';

      let show = true;

      // Apply department filter
      if (selectedDept && !dept.toLowerCase().includes(selectedDept)) {
        show = false;
      }

      // Apply status filter
      if (selectedStatus && !statusCell.includes(selectedStatus)) {
        show = false;
      }

      // Apply search filter (name or ID)
      if (searchTerm && !name.toLowerCase().includes(searchTerm) && !employeeId.includes(searchTerm)) {
        show = false;
      }

      row.style.display = show ? '' : 'none';
      if (show) visibleCount++;
    });

    // Populate department filter dropdown if empty or has only one option
    if (deptFilter.options.length <= 1) {
      const depts = new Set();
      rows.forEach(row => {
        const cells = row.querySelectorAll('td');
        if (cells.length > 5) {
          const dept = cells[5]?.textContent.trim();
          if (dept && dept !== '—') depts.add(dept);
        }
      });
      // Clear existing except first
      deptFilter.innerHTML = '<option value="">All Departments</option>';
      depts.forEach(dept => {
        const option = document.createElement('option');
        option.value = dept;
        option.textContent = dept;
        deptFilter.appendChild(option);
      });
      // Restore selection if possible
      if (selectedDept) deptFilter.value = selectedDept; // might fail if case sensitive match not found, but it's ok
    }
  };

  // Wire filter event listeners
  // Using simple addEventListener here, but ensuring we don't duplicate logic if this runs multiple times
  // For safety, we can attach this only once in index.js, but keeping it here keeps logic colocated.
  // We'll use a flag on the element.
  if (!deptFilter.dataset.listenerAttached) {
    deptFilter.addEventListener('change', applyFilters);
    statusFilter.addEventListener('change', applyFilters);
    searchFilter.addEventListener('input', applyFilters);
    deptFilter.dataset.listenerAttached = 'true';
  }

  // Run once to populate filters
  applyFilters();
}
