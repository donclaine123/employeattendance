// Department head small helper: compute totals for Present / Late / Absent
(function(){
  function escapeHtml(s){ return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

  async function fetchHeadInfo(){
    try{
      const apiBase = window.API_URL || window.__MOCK_API_BASE__ || '/api';
      const tok = sessionStorage.getItem('workline_token');
      const headers = tok ? { Authorization: 'Bearer ' + tok } : {};
      const uRaw = sessionStorage.getItem('workline_user');
      let email = null;
      if (uRaw){ try{ email = JSON.parse(uRaw).email || null; }catch(e){} }
      // If there's no auth token, skip calling the protected endpoint
      if (!tok || !email) return null;
      const url = apiBase + '/employee/by-email?email=' + encodeURIComponent(email);
      const r = await fetch(url, { headers });
      if (!r.ok) {
        // treat 401/404 as 'not found / not authorized' and return null silently
        return null;
      }
      return await r.json();
    }catch(e){ return null; }
  }

  async function fetchAttendance(department, filters = {}){
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
      const token = sessionStorage.getItem('workline_token');
      const headers = {};
      if (token) {
        headers['Authorization'] = `Bearer ${token}`;
      }
      
      const r = await fetch(url, { headers });
      if (!r.ok) return [];
      const data = await r.json();
      console.log('fetchAttendance response:', data);
      return data;
    }catch(e){ console.warn('fetchAttendance failed', e); return []; }
  }

  function renderAttendance(rows){
    console.log('renderAttendance called with:', rows);
    const table = document.querySelector('.wide-card .attendance-table') || document.querySelector('.attendance-table');
    if (!table) return;
    const tbody = table.querySelector('tbody') || table.appendChild(document.createElement('tbody'));
    tbody.innerHTML = '';
    if (!Array.isArray(rows) || rows.length === 0){
      const tr = document.createElement('tr'); tr.id = 'attendance-empty-row';
      tr.innerHTML = '<td colspan="4" style="text-align:center;color:var(--muted-foreground);padding:24px;">No attendance records yet for the department. Use the live scanner or refresh to load attendance.</td>';
      tbody.appendChild(tr);
      return;
    }
    for (const r of rows){
      const tr = document.createElement('tr');
      tr.dataset.employeeId = r.employee_id;
      const name = r.employee_name || 'Unknown';
      const empid = r.employee_id || '';
      // Handle time parsing - timestamp is just time, need to combine with date
      let time = '';
      if (r.timestamp && r.date) {
        try {
          const dateStr = new Date(r.date).toISOString().split('T')[0];
          const fullTimestamp = `${dateStr}T${r.timestamp}`;
          time = new Date(fullTimestamp).toLocaleTimeString();
        } catch (e) {
          time = r.timestamp || '';
        }
      } else if (r.timestamp) {
        time = r.timestamp;
      }
      const status = (r.status || 'present').toLowerCase();
      const cls = status.includes('late') ? 'late' : 'on-time';
      tr.innerHTML = `<td>${escapeHtml(name)}</td><td>${escapeHtml(empid)}</td><td>${escapeHtml(time)}</td><td><span class="status ${cls}">${escapeHtml(status.charAt(0).toUpperCase() + status.slice(1))}</span></td>`;
      tbody.appendChild(tr);
    }
  }

  async function loadDepartmentAttendance(){
    try{
      const head = await fetchHeadInfo();
      console.log('fetchHeadInfo returned:', head);
      const dept = head && head.department ? head.department : null;
      console.log('Department extracted:', dept);

      const startDate = document.getElementById('filter-date-start').value;
      const endDate = document.getElementById('filter-date-end').value;
      const employee = document.getElementById('filter-employee').value;
      const status = document.getElementById('filter-status').value;

      const filters = { startDate, endDate, employee, status };
      
      const rows = await fetchAttendance(dept, filters);
      renderAttendance(rows);
      // update summary chips after rendering
      updateChips();
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
    const tok = sessionStorage.getItem('workline_token');
    const headers = tok ? { Authorization: 'Bearer ' + tok } : {};
    if (!tok) {
        console.log('No token found for approval requests');
        return [];
    }

    try {
        const url = `${apiBase}/requests/pending?department=${encodeURIComponent(department)}`;
        console.log('Fetching approval requests from:', url);
        const r = await fetch(url, { headers });
        console.log('Approval requests response status:', r.status);
        
        if (!r.ok) {
            console.log('Failed to fetch approval requests:', r.status, r.statusText);
            return [];
        }
        
        const data = await r.json();
        console.log('Approval requests data received:', data);
        return data;
    } catch (e) {
        console.warn('fetchApprovalRequests failed', e);
        return [];
    }
  }

  function renderApprovalRequests(requests) {
    const table = document.querySelector('.approval-table');
    if (!table) return;
    const tbody = table.querySelector('tbody');
    if (!tbody) return;
    tbody.innerHTML = ''; // Clear existing rows

    console.log('Rendering approval requests:', requests); // Debug log

    if (!Array.isArray(requests) || requests.length === 0) {
        const tr = document.createElement('tr');
        tr.id = 'approval-empty-row';
        tr.innerHTML = `
            <td colspan="5" class="approval-empty-state">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M9 12l2 2 4-4"></path>
                    <circle cx="12" cy="12" r="10"></circle>
                </svg>
                No pending approvals at this time.
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
  }

  async function handleApprovalAction(requestId, action) {
    const apiBase = window.API_URL || window.__MOCK_API_BASE__ || '/api';
    const tok = sessionStorage.getItem('workline_token');
    const headers = { 
        'Authorization': 'Bearer ' + tok,
        'Content-Type': 'application/json'
    };
    if (!tok) return;

    try {
        const url = `${apiBase}/requests/${requestId}/status`;
        const r = await fetch(url, {
            method: 'PUT',
            headers: headers,
            body: JSON.stringify({ status: action }) // 'approved' or 'declined'
        });

        if (r.ok) {
            // Refresh the list after action
            loadApprovalRequests();
        } else {
            console.error('Failed to update request status');
        }
    } catch (e) {
        console.error('handleApprovalAction failed', e);
    }
  }

  async function loadApprovalRequests() {
      try {
          console.log('Loading approval requests...');
          const head = await fetchHeadInfo();
          console.log('Head info:', head);
          const dept = head && head.department ? head.department : null;
          console.log('Department for approval requests:', dept);
          
          if (dept) {
              const requests = await fetchApprovalRequests(dept);
              console.log('Fetched requests, rendering:', requests);
              renderApprovalRequests(requests);
          } else {
              console.log('No department found, showing empty state');
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
          handleApprovalAction(requestId, 'declined');
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
    const tok = sessionStorage.getItem('workline_token');
    const headers = tok ? { Authorization: 'Bearer ' + tok } : {};
    if (!tok) return;

    try {
        const url = `${apiBase}/performance/${employeeId}`;
        const r = await fetch(url, { headers });
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

  document.addEventListener('DOMContentLoaded', function() {
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
