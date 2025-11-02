// Department head small helper: compute totals for Present / Late / Absent
(function(){
  function escapeHtml(s){ return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

  async function fetchHeadInfo(){
    try{
      const apiBase = window.API_URL || window.__MOCK_API_BASE__ || '/api';
      const user = await window.fetchUserProfile();
      // Profiles may expose the email under different keys (email, username, user_email)
      let email = null;
      if (user) {
        email = user.email || user.username || user.user_email || (user.user && user.user.email) || null;
      }
      // If we don't have at least an email, we can't look up employee info
      if (!email) return null;
      const url = apiBase + '/employee/by-email?email=' + encodeURIComponent(email);
      // Support cookie-based auth using fetchWithAuth
      const r = await fetchWithAuth(url, {});
      if (!r.ok) {
        // treat 401/404 as 'not found / not authorized' and return null silently
        return null;
      }
      return await r.json();
    }catch(e){ return null; }
  }

  // Track the latest request to prevent race conditions
  let latestAttendanceRequestId = 0;

  async function fetchAttendance(department, filters = {}){
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
    
    try{
      const r = await fetchWithAuth(url, {});
      if (!r.ok) return [];
      const data = await r.json();
      
      // Only return data if this is still the latest request
      if (requestId === latestAttendanceRequestId) {
        console.log('[fetchAttendance] Request #' + requestId + ' completed with', data.length, 'records');
        return data;
      } else {
        console.log('[fetchAttendance] Request #' + requestId + ' ignored - newer request #' + latestAttendanceRequestId + ' in progress');
        return [];
      }
    }catch(e){ console.warn('fetchAttendance failed', e); return []; }
  }

  function renderAttendance(rows, requestId){
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
    
    if (!Array.isArray(rows) || rows.length === 0){
      const tr = document.createElement('tr'); 
      tr.id = 'attendance-empty-row';
      tr.innerHTML = '<td colspan="6" style="text-align:center;color:var(--text-secondary);padding:24px;">No attendance records found. Try adjusting your filters or refresh to load attendance.</td>';
      tbody.appendChild(tr);
      return;
    }
    for (const r of rows){
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
      const status = (r.status || 'present').toLowerCase();
      const statusLabel = status.charAt(0).toUpperCase() + status.slice(1);
      tr.innerHTML = `<td>${escapeHtml(name)}</td><td>${escapeHtml(dateStr)}</td><td>${escapeHtml(empid)}</td><td>${escapeHtml(timeIn)}</td><td>${escapeHtml(timeOut)}</td><td><span class="status-badge">${escapeHtml(statusLabel)}</span></td>`;
      tbody.appendChild(tr);
    }
  }

  async function loadDepartmentAttendance(){
    try{
      const head = await fetchHeadInfo();
      const dept = head && head.department ? head.department : null;

      const filters = {};
      const requestIdBeforeFetch = latestAttendanceRequestId;
      
      const rows = await fetchAttendance(dept, filters);
      const requestIdAfterFetch = latestAttendanceRequestId;
      
      // Only render if this is still the latest request
      if (requestIdAfterFetch === latestAttendanceRequestId) {
        cachedAttendanceData = rows;
        cacheRequestId = requestIdAfterFetch;
        renderAttendance(rows, requestIdAfterFetch);
        updateChips();
      }
    }catch(e){ console.warn('Department attendance load failed', e); }
  }
  function textOfStatusCell(cell){
    if(!cell) return '';
    const span = cell.querySelector('span');
    return (span ? span.textContent : cell.textContent || '').trim();
  }

  function computeTotals(){
    const table = document.querySelector('.wide-card .attendance-table') || document.querySelector('.attendance-table');
    const result = { present: 0, late: 0, absent: 0 };
    if (!table) return result;
    const tbody = table.querySelector('tbody');
    if (!tbody) return result;

    const rows = Array.from(tbody.querySelectorAll('tr'));
    for (const r of rows){
      // skip possible empty-state rows
      if (r.id === 'attendance-empty-row') continue;
      const cells = r.querySelectorAll('td');
      // expect status in last column
      const statusCell = cells[cells.length-1];
      const statusText = (textOfStatusCell(statusCell) || '').toLowerCase();
      const statusSpan = statusCell ? statusCell.querySelector('span') : null;
      const classList = statusSpan && statusSpan.className ? statusSpan.className : '';

      if (classList && classList.indexOf('late') !== -1) {
        result.late += 1;
      } else if (classList && classList.indexOf('on-time') !== -1) {
        result.present += 1;
      } else if (statusText.indexOf('late') !== -1) {
        result.late += 1;
      } else if (statusText.indexOf('absent') !== -1) {
        result.absent += 1;
      } else if (statusText.indexOf('present') !== -1 || statusText.indexOf('on time') !== -1) {
        result.present += 1;
      } else {
        // unknown -> count as present by default
        result.present += 1;
      }
    }

    return result;
  }

  function updateChips(){
    const chips = document.querySelectorAll('.stat-chips .stat-chip');
    if (!chips || chips.length < 3) return;
    const totals = computeTotals();
    try{
      const presentEl = chips[0].querySelector('.num');
      const lateEl = chips[1].querySelector('.num');
      const absentEl = chips[2].querySelector('.num');
      if (presentEl) presentEl.textContent = String(totals.present);
      if (lateEl) lateEl.textContent = String(totals.late);
      if (absentEl) absentEl.textContent = String(totals.absent);
    }catch(e){ console.warn('updateChips failed', e); }
  }

  document.addEventListener('DOMContentLoaded', function(){
    // initial load
    loadDepartmentAttendance();

    // wire Refresh button
    const summaryCard = document.querySelector('.attendance-card-left');
    if (summaryCard){
      const refreshBtn = Array.from(summaryCard.querySelectorAll('button')).find(b => /refresh/i.test(b.textContent||''));
      if (refreshBtn){ refreshBtn.addEventListener('click', loadDepartmentAttendance); }
    }

    // Load data for approval table
    loadApprovalRequests();

    updateChips();
  // expose a global updater so other inline scripts can trigger chip updates
  try{ window.updateDepartmentChips = updateChips; }catch(e){}
    // observe table for changes
    const table = document.querySelector('.wide-card .attendance-table') || document.querySelector('.attendance-table');
    if (!table) return;
    const tbody = table.querySelector('tbody');
    if (!tbody) return;
    const mo = new MutationObserver(updateChips);
    mo.observe(tbody, { childList: true, subtree: false });
  });

  async function fetchApprovalRequests(department) {
    const apiBase = window.API_URL || window.__MOCK_API_BASE__ || '/api';

    try {
        const url = `${apiBase}/requests/pending?department=${encodeURIComponent(department)}`;
        // Use fetchWithAuth for cookie-based session auth
        const r = await fetchWithAuth(url, {});
        if (!r.ok) {
          return [];
        }
        const data = await r.json();
        return data;
    } catch (e) {
        console.warn('❌ fetchApprovalRequests failed', e);
        return [];
    }
  }

  function renderApprovalRequests(requests) {
    const table = document.querySelector('.approval-table');
    if (!table) return;
    const tbody = table.querySelector('tbody');
    if (!tbody) return;
    tbody.innerHTML = ''; // Clear existing rows

  // Render approval requests into the approvals table

    if (!Array.isArray(requests) || requests.length === 0) {
        const tr = document.createElement('tr');
        tr.id = 'approval-empty-row';
        tr.innerHTML = `
            <td colspan="5" style="text-align: center; padding: 32px; border: none;">
                <div style="display: flex; flex-direction: column; align-items: center; justify-content: center;">
                    <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="margin-bottom: 8px; opacity: 0.5;">
                        <path d="M9 12l2 2 4-4"></path>
                        <circle cx="12" cy="12" r="10"></circle>
                    </svg>
                    <div style="font-size: 14px; color: var(--text-secondary);">No pending approvals at this time.</div>
                </div>
            </td>
        `;
        tbody.appendChild(tr);
        return;
    }

    for (const req of requests) {
        const tr = document.createElement('tr');
        tr.dataset.requestId = req.id;
        
        // Handle different possible field names and formats
        const employeeName = req.employee_name || req.employeeName || req.name || 'Unknown Employee';
        const requestType = req.request_type || req.requestType || req.type || 'Unknown';
        
        // Handle reason parsing from multiple sources
        let reason = req.reason || req.description || req.notes;
        
        // If no reason found, try parsing from details JSON
        if (!reason && req.details) {
            if (typeof req.details === 'string') {
                try {
                    const detailsObj = JSON.parse(req.details);
                    reason = detailsObj.reason || detailsObj.description || detailsObj.notes;
                } catch (e) {
                    console.error('Error parsing details JSON for reason:', e);
                }
            } else if (typeof req.details === 'object') {
                reason = req.details.reason || req.details.description || req.details.notes;
            }
        }
        
        reason = reason || 'No reason provided';
        
        // Format dates properly - handle multiple possible formats
        let dates = '';
        
        // Try to get dates from multiple sources
        let startDate = req.start_date || req.startDate;
        let endDate = req.end_date || req.endDate;
        
        // If not found, try from details object
        if (!startDate && req.details) {
            if (typeof req.details === 'object') {
                startDate = req.details.start_date || req.details.date || req.details.startDate;
                endDate = req.details.end_date || req.details.date || req.details.endDate;
            }
        }
        
        console.log('Processing dates for request:', req.id, 'startDate:', startDate, 'endDate:', endDate);
        
        if (startDate && startDate !== 'null' && startDate !== null) {
            try {
                const start = new Date(startDate).toLocaleDateString();
                // For single-day requests, only show one date
                if (endDate && endDate !== 'null' && endDate !== null && endDate !== startDate) {
                    const end = new Date(endDate).toLocaleDateString();
                    dates = `${start} to ${end}`;
                } else {
                    dates = start;
                }
            } catch (e) {
                console.error('Error parsing dates:', e, 'startDate:', startDate, 'endDate:', endDate);
                dates = 'Invalid date format';
            }
        } else {
            console.log('No valid start date found for request:', req.id);
            dates = 'No date specified';
        }

        // Determine request type badge class
        const badgeClass = requestType.toLowerCase() === 'leave' ? 'leave' : 'overtime';

        tr.innerHTML = `
            <td><span class="employee-name">${escapeHtml(employeeName)}</span></td>
            <td><span class="request-type-badge ${badgeClass}">${escapeHtml(requestType)}</span></td>
            <td><span class="date-range">${escapeHtml(dates)}</span></td>
            <td><span class="request-reason">${escapeHtml(reason)}</span></td>
            <td>
                <div class="approval-actions">
                    <button class="btn-approve">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M9 12l2 2 4-4"></path>
                            <circle cx="12" cy="12" r="10"></circle>
                        </svg>
                        Approve
                    </button>
                    <button class="btn-decline">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <circle cx="12" cy="12" r="10"></circle>
                            <line x1="15" y1="9" x2="9" y2="15"></line>
                            <line x1="9" y1="9" x2="15" y2="15"></line>
                        </svg>
                        Decline
                    </button>
                </div>
            </td>
        `;
        tbody.appendChild(tr);
    }
    // No debug diagnostics — rendering complete
  }

  async function handleApprovalAction(requestId, action) {
    const apiBase = window.API_URL || window.__MOCK_API_BASE__ || '/api';

    try {
        const url = `${apiBase}/requests/${requestId}/status`;
        const r = await fetchWithAuth(url, {
            method: 'PUT',
            body: JSON.stringify({ status: action })
        });

        if (r.ok) {
            // Refresh the list after action
            loadApprovalRequests();
        }
    } catch (e) {
        console.error('handleApprovalAction failed', e);
    }
  }

  async function loadApprovalRequests() {
      try {
          const head = await fetchHeadInfo();
          const dept = head && head.department ? head.department : null;
          
          if (dept) {
              const requests = await fetchApprovalRequests(dept);
              renderApprovalRequests(requests);
          } else {
              renderApprovalRequests([]);
          }
      } catch (e) {
          console.warn('loadApprovalRequests failed', e);
          renderApprovalRequests([]);
      }
  }

  document.querySelector('.approval-table tbody')?.addEventListener('click', function(event) {
      const target = event.target;
      const tr = target.closest('tr');
      if (!tr || !tr.dataset.requestId) return;

      const requestId = tr.dataset.requestId;
      if (target.classList.contains('btn-approve')) {
          handleApprovalAction(requestId, 'approved');
      } else if (target.classList.contains('btn-decline')) {
          handleApprovalAction(requestId, 'rejected');
      }
  });

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
        const r = await fetchWithAuth(url, {});
        if (r.ok) {
            const data = await r.json();
            document.getElementById('summary-absences').textContent = data.absences || 0;
            document.getElementById('summary-lates').textContent = data.lates || 0;
            document.getElementById('summary-undertime').textContent = data.undertime || 0;
        } else {
            console.error('Failed to fetch performance data');
        }
    } catch (e) {
        console.error('fetchAndRenderEmployeePerformance failed', e);
    }
  }

  // Load dashboard stats (present, late, absent, team size)
  async function loadDashboardStats() {
    try {
      const apiBase = window.API_URL || window.__MOCK_API_BASE__ || '/api';

      const response = await fetchWithAuth(`${apiBase}/departmenthead/dashboard`, {});
      if (!response.ok) {
        console.warn('[loadDashboardStats] Response not ok:', response.status);
        return;
      }

      const stats = await response.json();
      console.log('[loadDashboardStats] Received stats:', stats);

      // Update stat cards with dynamic values
      const statTotalPresent = document.getElementById('statTotalPresent');
      const statTotalLate = document.getElementById('statTotalLate');
      const statTotalAbsent = document.getElementById('statTotalAbsent');
      const statTeamSize = document.getElementById('statTeamSize');

      const statTotalPresentChange = document.getElementById('statTotalPresentChange');
      const statTotalLateChange = document.getElementById('statTotalLateChange');
      const statTotalAbsentChange = document.getElementById('statTotalAbsentChange');
      const statTeamSizeChange = document.getElementById('statTeamSizeChange');

      if (statTotalPresent) statTotalPresent.textContent = stats.totalPresent || 0;
      if (statTotalLate) statTotalLate.textContent = stats.totalLate || 0;
      if (statTotalAbsent) statTotalAbsent.textContent = stats.totalAbsent || 0;
      if (statTeamSize) statTeamSize.textContent = stats.teamSize || 0;

      if (statTotalPresentChange) statTotalPresentChange.textContent = 'Today\'s record';
      if (statTotalLateChange) statTotalLateChange.textContent = 'Today\'s record';
      if (statTotalAbsentChange) statTotalAbsentChange.textContent = 'Today\'s record';
      if (statTeamSizeChange) statTeamSizeChange.textContent = 'Active employees';

    } catch (error) {
      console.error('[loadDashboardStats] Error:', error);
    }
  }

  // Load recent activity feed
  async function loadRecentActivity() {
    try {
      const apiBase = window.API_URL || window.__MOCK_API_BASE__ || '/api';

      const response = await fetchWithAuth(`${apiBase}/departmenthead/recent-activity`, {});
      if (!response.ok) {
        console.warn('[loadRecentActivity] Response not ok:', response.status);
        return;
      }

      const data = await response.json();
      const activities = data.activities || [];
      console.log('[loadRecentActivity] Received activities:', activities);

      // Render activities in the activity list
      const activityList = document.getElementById('activityList');
      if (!activityList) {
        console.warn('[loadRecentActivity] Activity list container not found');
        return;
      }

      // Clear existing items
      activityList.innerHTML = '';

      if (activities.length === 0) {
        activityList.innerHTML = '<div style="text-align:center;color:var(--text-secondary);padding:24px;">No recent activity yet. Check back soon.</div>';
        return;
      }

      // Render each activity
      activities.forEach(activity => {
        const activityItem = document.createElement('div');
        activityItem.className = 'activity-item';
        
        const indicator = document.createElement('div');
        indicator.className = `activity-indicator ${activity.indicator || 'primary'}`;
        
        const details = document.createElement('div');
        details.className = 'activity-details';
        
        const nameP = document.createElement('p');
        nameP.className = 'activity-name';
        nameP.textContent = activity.name || 'Unknown';
        
        const actionP = document.createElement('p');
        actionP.className = 'activity-action';
        actionP.textContent = activity.action || 'Activity';
        
        details.appendChild(nameP);
        details.appendChild(actionP);
        
        const timeSpan = document.createElement('span');
        timeSpan.className = 'activity-time';
        // Convert time from 24-hour to 12-hour AM/PM format
        timeSpan.textContent = convertTo12Hour(activity.time);
        
        activityItem.appendChild(indicator);
        activityItem.appendChild(details);
        activityItem.appendChild(timeSpan);
        
        activityList.appendChild(activityItem);
      });

    } catch (error) {
      console.error('[loadRecentActivity] Error:', error);
    }
  }

  // Load Team Attendance Stats (Present/Late/Absent)
  async function loadTeamAttendanceStats() {
    try {
      const response = await fetch('/api/departmenthead/dashboard');
      if (!response.ok) {
        console.warn('[loadTeamAttendanceStats] Failed to fetch dashboard stats:', response.status);
        return;
      }

      const data = await response.json();
      
      // Update Team Summary stat chips
      const teamStatPresent = document.getElementById('teamStatPresent');
      const teamStatLate = document.getElementById('teamStatLate');
      const teamStatAbsent = document.getElementById('teamStatAbsent');
      
      if (teamStatPresent) teamStatPresent.textContent = data.totalPresent || 0;
      if (teamStatLate) teamStatLate.textContent = data.totalLate || 0;
      if (teamStatAbsent) teamStatAbsent.textContent = data.totalAbsent || 0;
      
      console.log('[loadTeamAttendanceStats] Updated team stats:', { 
        totalPresent: data.totalPresent, 
        totalLate: data.totalLate, 
        totalAbsent: data.totalAbsent 
      });
    } catch (error) {
      console.error('[loadTeamAttendanceStats] Error:', error);
    }
  }

  // Helper function to convert 24-hour time to 12-hour AM/PM format
  function convertTo12Hour(time24) {
    if (!time24) return 'Unknown time';
    
    // Parse HH:MM:SS or HH:MM format
    const timeParts = time24.split(':');
    let hour = parseInt(timeParts[0], 10);
    const minute = timeParts[1] || '00';
    
    const ampm = hour >= 12 ? 'PM' : 'AM';
    hour = hour % 12 || 12; // Convert 0 to 12 for 12 AM
    
    // Format with leading zero for single-digit hours
    const hourStr = hour < 10 ? '0' + hour : hour;
    
    return `${hourStr}:${minute} ${ampm}`;
  }

  // Export functions to window scope
  window.loadDashboardStats = loadDashboardStats;
  window.loadRecentActivity = loadRecentActivity;
  window.loadTeamAttendanceStats = loadTeamAttendanceStats;
  window.loadDepartmentAttendance = loadDepartmentAttendance;

  // ============================================
  // ATTENDANCE FILTER WIRING (REAL-TIME)
  // ============================================

  // Store the full attendance data for client-side filtering
  let cachedAttendanceData = [];
  let cacheRequestId = 0;

  function applyClientSideFilters() {
    // Get current filter values
    const employeeInput = document.getElementById('filter-employee');
    const statusSelect = document.getElementById('filter-status');
    const dateStartInput = document.getElementById('filter-date-start');
    const dateEndInput = document.getElementById('filter-date-end');

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

  function wireAttendanceFilters() {
    const refreshBtn = document.getElementById('refresh-attendance-btn');
    const clearBtn = document.getElementById('clear-filters-btn');
    const dateStartInput = document.getElementById('filter-date-start');
    const dateEndInput = document.getElementById('filter-date-end');
    const employeeInput = document.getElementById('filter-employee');
    const statusSelect = document.getElementById('filter-status');

    // Real-time search: filter as user types in employee search
    if (employeeInput) {
      employeeInput.addEventListener('input', function() {
        applyClientSideFilters();
      });
    }

    // Real-time filtering: filter when status changes
    if (statusSelect) {
      statusSelect.addEventListener('change', function() {
        applyClientSideFilters();
      });
    }

    // Real-time filtering: filter when date range changes
    if (dateStartInput) {
      dateStartInput.addEventListener('change', async function() {
        const department = document.getElementById('userScope')?.textContent || 'Registrar';
        const filters = {
          startDate: dateStartInput?.value || '',
          endDate: dateEndInput?.value || '',
          employee: '',
          status: ''
        };
        
        const requestIdBeforeFetch = latestAttendanceRequestId;
        cachedAttendanceData = await fetchAttendance(department, filters);
        const requestIdAfterFetch = latestAttendanceRequestId;
        
        if (requestIdAfterFetch === latestAttendanceRequestId) {
          cacheRequestId = requestIdAfterFetch;
          applyClientSideFilters();
        }
      });
    }

    if (dateEndInput) {
      dateEndInput.addEventListener('change', async function() {
        const department = document.getElementById('userScope')?.textContent || 'Registrar';
        const filters = {
          startDate: dateStartInput?.value || '',
          endDate: dateEndInput?.value || '',
          employee: '',
          status: ''
        };
        
        const requestIdBeforeFetch = latestAttendanceRequestId;
        cachedAttendanceData = await fetchAttendance(department, filters);
        const requestIdAfterFetch = latestAttendanceRequestId;
        
        if (requestIdAfterFetch === latestAttendanceRequestId) {
          cacheRequestId = requestIdAfterFetch;
          applyClientSideFilters();
        }
      });
    }

    // Clear filters and reload all records
    if (clearBtn) {
      clearBtn.addEventListener('click', async function() {
        dateStartInput.value = '';
        dateEndInput.value = '';
        employeeInput.value = '';
        statusSelect.value = 'all';
        
        const department = document.getElementById('userScope')?.textContent || 'Registrar';
        const requestIdBeforeFetch = latestAttendanceRequestId;
        cachedAttendanceData = await fetchAttendance(department, {});
        const requestIdAfterFetch = latestAttendanceRequestId;
        if (requestIdAfterFetch === latestAttendanceRequestId) {
          cacheRequestId = requestIdAfterFetch;
          renderAttendance(cachedAttendanceData, requestIdAfterFetch);
        }
      });
    }

    // Refresh attendance (fetch fresh data from server)
    if (refreshBtn) {
      refreshBtn.addEventListener('click', async function() {
        const department = document.getElementById('userScope')?.textContent || 'Registrar';
        const filters = {
          startDate: dateStartInput?.value || '',
          endDate: dateEndInput?.value || '',
          employee: '',
          status: ''
        };
        
        const requestIdBeforeFetch = latestAttendanceRequestId;
        cachedAttendanceData = await fetchAttendance(department, filters);
        const requestIdAfterFetch = latestAttendanceRequestId;
        if (requestIdAfterFetch === latestAttendanceRequestId) {
          cacheRequestId = requestIdAfterFetch;
          applyClientSideFilters();
        }
      });
    }
  }

  document.addEventListener('DOMContentLoaded', async function() {
      // First, fetch and set the user's actual department
      const head = await fetchHeadInfo();
      if (head && head.department) {
        const userScopeEl = document.getElementById('userScope');
        if (userScopeEl) {
          userScopeEl.textContent = head.department;
          console.log('[DOMContentLoaded] Set userScope to:', head.department);
        }
      }
      
      // Load dashboard stats and recent activity
      loadDashboardStats();
      loadRecentActivity();
      
      // Load initial department attendance data
      loadDepartmentAttendance();
      
      // Wire attendance filters
      wireAttendanceFilters();
      
      // ... existing DOMContentLoaded logic ...

      const attendanceTbody = document.querySelector('.attendance-table tbody');
      if (attendanceTbody) {
          attendanceTbody.addEventListener('click', function(event) {
              const tr = event.target.closest('tr');
              if (tr && tr.dataset.employeeId) {
                  const employeeId = tr.dataset.employeeId;
                  const employeeName = tr.cells[0].textContent;
                  openPerformanceModal(employeeId, employeeName);
              }
          });
      }

      const closeModalBtn = document.getElementById('modal-close-btn');
      if (closeModalBtn) {
          closeModalBtn.addEventListener('click', closePerformanceModal);
      }

      const modalOverlay = document.getElementById('performance-modal');
      if (modalOverlay) {
          modalOverlay.addEventListener('click', function(event) {
              if (event.target === modalOverlay) {
                  closePerformanceModal();
              }
          });
      }
  });

})();

// ============================================================================
// SCHEDULING MODULE FOR DEPARTMENT HEAD
// ============================================================================

(async function() {
    // Import scheduling API functions
    const schedulingModule = await import('./scheduling-api.js');
    const {
        getSchedules,
        bulkCreateSchedules,
        copyWeekSchedules,
        getShiftTypes,
        formatDateForAPI,
        getCurrentWeekRange
    } = schedulingModule;

    // State
    let currentWeekStart = null;
    let employees = [];
    let shiftTypes = [];
    let scheduleChanges = {};
    let currentDepartment = null;

    // DOM Elements
    const prevWeekBtn = document.getElementById('prevWeekBtn');
    const nextWeekBtn = document.getElementById('nextWeekBtn');
    const todayBtn = document.getElementById('todayBtn');
    const currentWeekDisplay = document.getElementById('currentWeekDisplay');
    const copyLastWeekBtn = document.getElementById('copyLastWeekBtn');
    const saveScheduleBtn = document.getElementById('saveScheduleBtn');
    const scheduleGridBody = document.getElementById('scheduleGridBody');
    const scheduleGridContainer = document.getElementById('scheduleGridContainer');
    const schedulingLoading = document.getElementById('scheduling-loading');
    const schedulingEmpty = document.getElementById('scheduling-empty');

    /**
     * Initialize scheduling module
     */
    async function initScheduling() {
        try {
            // Get current user's department
            const user = await window.fetchUserProfile();
            if (!user || !user.department) {
                console.error('[Scheduling] No department found for user');
                return;
            }
            currentDepartment = user.department;

            // Load shift types
            shiftTypes = await getShiftTypes();

            // Set to current week
            const weekRange = getCurrentWeekRange();
            currentWeekStart = new Date(weekRange.startDate + 'T00:00:00');

            // Load employees and schedules
            await loadEmployees();
            await loadSchedules();

        } catch (error) {
            console.error('[Scheduling] Init error:', error);
        }
    }

    /**
     * Load employees in department
     */
    async function loadEmployees() {
        try {
            const apiBase = window.API_URL || '/api';
            const response = await fetchWithAuth(`${apiBase}/departmenthead/employees`);
            
            if (!response.ok) {
                throw new Error('Failed to fetch employees');
            }

            const data = await response.json();
            employees = Array.isArray(data?.data) ? data.data : (Array.isArray(data) ? data : []);

            console.log('[Scheduling] Loaded employees:', employees.length);

            if (employees.length === 0) {
                showEmptyState();
            }

        } catch (error) {
            console.error('[Scheduling] Error loading employees:', error);
            employees = [];
        }
    }

    /**
     * Load schedules for current week
     */
    async function loadSchedules() {
        try {
            if (employees.length === 0) {
                showEmptyState();
                return;
            }

            showLoading();

            // Calculate week dates
            const weekDates = [];
            for (let i = 0; i < 7; i++) {
                const date = new Date(currentWeekStart);
                date.setDate(currentWeekStart.getDate() + i);
                weekDates.push(formatDateForAPI(date));
            }

            // Fetch schedules for the week
            const startDate = weekDates[0];
            const endDate = weekDates[6];

            // Get department ID from currentDepartment (could be string or object)
            const deptId = typeof currentDepartment === 'object' ? currentDepartment.id : currentDepartment;
            
            const schedules = await getSchedules(startDate, endDate, deptId, null);

            // Reset changes
            scheduleChanges = {};

            // Update week display
            updateWeekDisplay(weekDates);

            // Render grid
            renderScheduleGrid(weekDates, schedules);

            hideLoading();

        } catch (error) {
            console.error('[Scheduling] Error loading schedules:', error);
            hideLoading();
        }
    }

    /**
     * Update week display label
     */
    function updateWeekDisplay(weekDates) {
        if (!currentWeekDisplay || weekDates.length === 0) return;

        const startDate = new Date(weekDates[0] + 'T00:00:00');
        const endDate = new Date(weekDates[6] + 'T00:00:00');

        const options = { month: 'short', day: 'numeric', year: 'numeric' };
        const startStr = startDate.toLocaleDateString('en-US', options);
        const endStr = endDate.toLocaleDateString('en-US', options);

        currentWeekDisplay.textContent = `${startStr} - ${endStr}`;

        // Update header dates
        const dayHeaders = document.querySelectorAll('.schedule-grid thead .day-col');
        weekDates.forEach((dateStr, index) => {
            if (dayHeaders[index]) {
                const date = new Date(dateStr + 'T00:00:00');
                const dayLabel = dayHeaders[index].querySelector('.date-label');
                if (dayLabel) {
                    const monthDay = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
                    dayLabel.textContent = monthDay;
                }
            }
        });
    }

    /**
     * Render schedule grid
     */
    function renderScheduleGrid(weekDates, schedules) {
        if (!scheduleGridBody) return;

        scheduleGridBody.innerHTML = '';

        // Group schedules by employee
        const schedulesByEmployee = {};
        schedules.forEach(schedule => {
            if (!schedulesByEmployee[schedule.employee_id]) {
                schedulesByEmployee[schedule.employee_id] = {};
            }
            schedulesByEmployee[schedule.employee_id][schedule.schedule_date] = schedule;
        });

        // Render row for each employee
        employees.forEach(employee => {
            const tr = document.createElement('tr');
            // Use employee_id if id is not available (comes from departmenthead/employees endpoint)
            const empId = employee.id || employee.employee_id;
            tr.dataset.employeeId = empId;

            // Employee name cell
            const nameCell = document.createElement('td');
            nameCell.className = 'employee-name-cell';
            nameCell.innerHTML = `
                <div class="employee-info">
                    <div class="employee-name">${employee.name || 'Unknown'}</div>
                    <div class="employee-id">ID: ${employee.employee_id || employee.id}</div>
                </div>
            `;
            tr.appendChild(nameCell);

            // Day cells (7 days)
            weekDates.forEach(dateStr => {
                const dayCell = document.createElement('td');
                dayCell.className = 'schedule-cell';
                dayCell.dataset.employeeId = empId;
                dayCell.dataset.date = dateStr;

                // Get existing schedule or check for pending change
                const changeKey = `${empId}_${dateStr}`;
                let currentShiftTypeId = null;
                let matchingShift = null;

                if (scheduleChanges[changeKey] !== undefined) {
                    currentShiftTypeId = scheduleChanges[changeKey];
                } else if (schedulesByEmployee[empId] && schedulesByEmployee[empId][dateStr]) {
                    const scheduleRecord = schedulesByEmployee[empId][dateStr];
                    // Try to get shift_type_id first, fallback to finding by shift_name
                    currentShiftTypeId = scheduleRecord.shift_type_id;
                    
                    // If shift_type_id is not available, try to match by shift_name
                    if (!currentShiftTypeId && scheduleRecord.shift_name) {
                        const shiftMatch = shiftTypes.find(s => s.shift_name === scheduleRecord.shift_name);
                        if (shiftMatch) {
                            currentShiftTypeId = shiftMatch.shift_type_id;
                        }
                    }
                    
                    matchingShift = scheduleRecord;
                    console.log(`[renderScheduleGrid] Found schedule for ${empId} on ${dateStr}: shift_type_id=${currentShiftTypeId}, shift_name=${scheduleRecord.shift_name}`);
                }

                // Create dropdown
                const select = document.createElement('select');
                select.className = 'shift-select';
                select.dataset.employeeId = empId;
                select.dataset.date = dateStr;

                // Add empty option
                const emptyOption = document.createElement('option');
                emptyOption.value = '';
                emptyOption.textContent = '';
                select.appendChild(emptyOption);

                // Add shift type options
                shiftTypes.forEach(shift => {
                    const option = document.createElement('option');
                    option.value = shift.shift_type_id;
                    option.textContent = shift.shift_name;
                    option.dataset.color = shift.color_code;
                    select.appendChild(option);
                });

                // Set the value AFTER all options are added
                if (currentShiftTypeId) {
                    select.value = currentShiftTypeId;
                    if (matchingShift) {
                        select.style.backgroundColor = matchingShift.color_code;
                        select.style.color = 'white';
                        console.log(`[renderScheduleGrid] Set dropdown to shift_type_id=${currentShiftTypeId}, color=${matchingShift.color_code}`);
                    }
                }

                // Event listener for changes
                select.addEventListener('change', function() {
                    handleShiftChange(empId, dateStr, this.value);
                });

                dayCell.appendChild(select);
                tr.appendChild(dayCell);
            });

            scheduleGridBody.appendChild(tr);
        });

        // Show grid
        if (scheduleGridContainer) scheduleGridContainer.style.display = 'block';
        if (schedulingEmpty) schedulingEmpty.style.display = 'none';
    }

    /**
     * Handle shift change in dropdown
     */
    function handleShiftChange(employeeId, date, shiftTypeId) {
        const changeKey = `${employeeId}_${date}`;
        
        if (shiftTypeId === '') {
            scheduleChanges[changeKey] = null; // Delete
        } else {
            scheduleChanges[changeKey] = parseInt(shiftTypeId);
        }

        // Update dropdown appearance
        const select = document.querySelector(`.shift-select[data-employee-id="${employeeId}"][data-date="${date}"]`);
        if (select) {
            const selectedOption = select.options[select.selectedIndex];
            if (selectedOption && selectedOption.dataset.color) {
                select.style.backgroundColor = selectedOption.dataset.color;
                select.style.color = 'white';
            } else {
                select.style.backgroundColor = '';
                select.style.color = '';
            }
        }

        // Enable save button
        if (saveScheduleBtn) {
            saveScheduleBtn.disabled = false;
            saveScheduleBtn.textContent = `Save All Changes (${Object.keys(scheduleChanges).length})`;
        }

        console.log('[Scheduling] Change tracked:', changeKey, shiftTypeId);
    }

    /**
     * Save all schedule changes
     */
    async function saveSchedules() {
        try {
            if (Object.keys(scheduleChanges).length === 0) {
                alert('No changes to save');
                return;
            }

            if (saveScheduleBtn) saveScheduleBtn.disabled = true;

            // Build schedules array
            const schedulesToCreate = [];
            Object.keys(scheduleChanges).forEach(key => {
                const [employeeId, date] = key.split('_');
                const shiftTypeId = scheduleChanges[key];

                if (shiftTypeId) {
                    schedulesToCreate.push({
                        employee_id: parseInt(employeeId),
                        schedule_date: date,
                        shift_type: shiftTypeId
                    });
                }
            });

            console.log('[Scheduling] Saving schedules:', schedulesToCreate);

            // Call bulk API
            const result = await bulkCreateSchedules(schedulesToCreate);

            alert(`Successfully saved ${schedulesToCreate.length} schedules!`);

            // Reset changes and reload
            scheduleChanges = {};
            await loadSchedules();

            if (saveScheduleBtn) {
                saveScheduleBtn.disabled = false;
                saveScheduleBtn.textContent = 'Save All Changes';
            }

        } catch (error) {
            console.error('[Scheduling] Save error:', error);
            alert('Failed to save schedules: ' + error.message);
            if (saveScheduleBtn) saveScheduleBtn.disabled = false;
        }
    }

    /**
     * Copy schedules from last week
     */
    async function copyFromLastWeek() {
        try {
            if (!confirm('Copy all schedules from last week to this week? This will overwrite existing schedules.')) {
                return;
            }

            if (copyLastWeekBtn) copyLastWeekBtn.disabled = true;

            // Calculate last week's Monday
            const lastWeekStart = new Date(currentWeekStart);
            lastWeekStart.setDate(currentWeekStart.getDate() - 7);

            const sourceDate = formatDateForAPI(lastWeekStart);
            const targetDate = formatDateForAPI(currentWeekStart);

            console.log('[Scheduling] Copying from', sourceDate, 'to', targetDate);

            // Get current user to find dept_id
            const apiBase = window.API_URL || '/api';
            const user = await window.fetchUserProfile();
            const email = user.email;
            
            // Fetch employee record to get dept_id
            const empResp = await fetchWithAuth(`${apiBase}/employee/by-email?email=${email}`);
            if (!empResp.ok) throw new Error('Failed to get employee info');
            const empData = await empResp.json();
            const deptId = empData.dept_id;

            const result = await copyWeekSchedules(sourceDate, targetDate, deptId);

            alert(`Successfully copied ${result.count || 0} schedules from last week!`);

            // Reload schedules
            await loadSchedules();

            if (copyLastWeekBtn) copyLastWeekBtn.disabled = false;

        } catch (error) {
            console.error('[Scheduling] Copy error:', error);
            alert('Failed to copy schedules: ' + error.message);
            if (copyLastWeekBtn) copyLastWeekBtn.disabled = false;
        }
    }

    /**
     * Navigate to previous week
     */
    function goToPreviousWeek() {
        currentWeekStart.setDate(currentWeekStart.getDate() - 7);
        loadSchedules();
    }

    /**
     * Navigate to next week
     */
    function goToNextWeek() {
        currentWeekStart.setDate(currentWeekStart.getDate() + 7);
        loadSchedules();
    }

    /**
     * Go to current week
     */
    function goToToday() {
        const weekRange = getCurrentWeekRange();
        currentWeekStart = new Date(weekRange.startDate + 'T00:00:00');
        loadSchedules();
    }

    /**
     * Show loading state
     */
    function showLoading() {
        if (schedulingLoading) schedulingLoading.style.display = 'flex';
        if (scheduleGridContainer) scheduleGridContainer.style.display = 'none';
        if (schedulingEmpty) schedulingEmpty.style.display = 'none';
    }

    /**
     * Hide loading state
     */
    function hideLoading() {
        if (schedulingLoading) schedulingLoading.style.display = 'none';
    }

    /**
     * Show empty state
     */
    function showEmptyState() {
        if (schedulingLoading) schedulingLoading.style.display = 'none';
        if (scheduleGridContainer) scheduleGridContainer.style.display = 'none';
        if (schedulingEmpty) schedulingEmpty.style.display = 'flex';
    }

    // Event listeners
    if (prevWeekBtn) prevWeekBtn.addEventListener('click', goToPreviousWeek);
    if (nextWeekBtn) nextWeekBtn.addEventListener('click', goToNextWeek);
    if (todayBtn) todayBtn.addEventListener('click', goToToday);
    if (copyLastWeekBtn) copyLastWeekBtn.addEventListener('click', copyFromLastWeek);
    if (saveScheduleBtn) saveScheduleBtn.addEventListener('click', saveSchedules);

    // Initialize when section becomes active
    const schedulingSection = document.getElementById('section-scheduling');
    if (schedulingSection) {
        const observer = new MutationObserver((mutations) => {
            mutations.forEach((mutation) => {
                if (mutation.attributeName === 'class') {
                    if (schedulingSection.classList.contains('active') && employees.length === 0) {
                        initScheduling();
                    }
                }
            });
        });

        observer.observe(schedulingSection, { attributes: true });

        // Also check on page load if already active
        if (schedulingSection.classList.contains('active')) {
            initScheduling();
        }
    }

    // Export for external access
    window.refreshScheduling = loadSchedules;

})();
