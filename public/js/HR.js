// Attendance Monitoring Team dashboard: Enhanced Manage Employees with pagination, bulk actions, and detail cards

(function(){
  function qs(sel, root=document) { return root.querySelector(sel); }
  function qsa(sel, root=document) { return Array.from(root.querySelectorAll(sel)); }

  function normalize(s){ return (s||'').toString().trim().toLowerCase(); }
  function escapeHtml(s){ return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

  document.addEventListener('DOMContentLoaded', function(){
    // QR generation wiring: handle display (generation is now automatic on server)
  const apiBase = window.API_URL || window.__MOCK_API_BASE__ || '/api';
    const qrBox = qs('#qr-box');
    let currentSessionId = null;
    let pollHandle = null;
  let autoShowOnPoll = false; // only show polled rotating session if this was set by a generate action
  let qrCountdownHandle = null;
  let socket = null;

    // Initialize WebSocket for real-time QR updates
    function initWebSocket() {
      try {
        socket = io();
        
        socket.on('connect', () => {
          console.log('[HR WebSocket] Connected');
        });

        socket.on('qr-updated', (data) => {
          console.log('[HR WebSocket] Real-time QR update received:', data.session_id);
          if (data.session_id) {
            // Simulate fetching the updated QR as a session object
            const session = {
              session_id: data.session_id,
              imageDataUrl: data.imageDataUrl,
              expires_at: data.expires_at,
              issued_at: data.created_at,
              type: 'rotating',
              status: data.status
            };
            showQr(session);
            // Ensure polling is active for rotation
            try { localStorage.setItem('qrPollingActivated', '1'); } catch(e) {}
            setupPolling();
          }
        });

        socket.on('qr-revoked', (data) => {
          console.log('[HR WebSocket] QR revoked notification received');
          currentSessionId = null;
          if (qrBox) qrBox.innerHTML = '<div style="color:var(--muted-foreground);">qr code</div>';
          autoShowOnPoll = false;
          try { localStorage.removeItem('qrPollingActivated'); } catch(e) {}
          if (pollHandle) { clearInterval(pollHandle); pollHandle = null; }
        });

        socket.on('disconnect', () => {
          console.log('[HR WebSocket] Disconnected, fallback to polling');
        });

      } catch (error) {
        console.warn('[HR WebSocket] Failed to initialize:', error.message);
      }
    }

    // Initialize WebSocket on page load
    initWebSocket();

    async function fetchCurrentQr(showIfFound = false){
      try{
        const resp = await fetchWithAuth(apiBase + '/hr/qr/current', {});
        if (!resp.ok) throw new Error('no current');
        const json = await resp.json();
        // Only display when explicitly requested or when a previous generate asked for auto-show
        if (showIfFound || autoShowOnPoll) showQr(json.session);
        return json.session;
      }catch(e){ return null; }
    }

    function showQr(session){
      if (!qrBox) return;
      currentSessionId = session && session.session_id;
      // clear any existing countdown
      if (qrCountdownHandle){ clearInterval(qrCountdownHandle); qrCountdownHandle = null; }

      if (!session || !session.imageDataUrl){
        qrBox.innerHTML = '<div style="color:var(--muted-foreground);">qr code</div>';
      } else {
        // build QR image and optional time badge
        const imgHtml = `<div class="qr-image-wrap"><img src="${session.imageDataUrl}" alt="QR" /></div>`;
        let timeHtml = '';
        if (session.type === 'rotating' && session.expires_at){
          const expiresAt = new Date(session.expires_at);
          const issuedAt = session.issued_at ? new Date(session.issued_at) : null;
          const now = new Date();
          // Calculate based on elapsed time from creation to ensure full 60-second display regardless of network delay
          let secs;
          if (issuedAt) {
            const totalDuration = expiresAt - issuedAt; // Total QR validity duration (60000ms = 60s)
            const elapsedTime = now - issuedAt;
            const msLeft = totalDuration - elapsedTime;
            secs = Math.max(0, Math.ceil(msLeft / 1000));
          } else {
            secs = Math.max(0, Math.floor((expiresAt - now)/1000));
          }
          const fmt = expiresAt.toLocaleTimeString();
          timeHtml = `<div class="qr-time"><div class="qr-time-line">Expires at <strong>${fmt}</strong></div><div class="qr-countdown">in <span class="qr-secs">${secs}</span>s</div></div>`;
          // start countdown
          qrCountdownHandle = setInterval(()=>{
            const now2 = new Date();
            // Calculate based on elapsed time to match display timer
            let s2;
            if (issuedAt) {
              const totalDuration = expiresAt - issuedAt;
              const elapsedTime = now2 - issuedAt;
              const msLeft = totalDuration - elapsedTime;
              s2 = Math.max(0, Math.ceil(msLeft / 1000));
            } else {
              s2 = Math.max(0, Math.floor((expiresAt - now2)/1000));
            }
            const el = qrBox.querySelector('.qr-secs'); if (el) el.textContent = s2;
            if (s2 <= 0){
              clearInterval(qrCountdownHandle); qrCountdownHandle = null;
              // QR expired - wait for automatic system refresh (every 60 seconds)
              currentSessionId = null;
              if (qrBox) qrBox.innerHTML = '<div style="color:var(--muted-foreground);">QR expired</div>';
            }
          }, 1000);
        }
        qrBox.innerHTML = imgHtml + timeHtml;
      }

      const expiresEl = qs('#qr-expires'); if (expiresEl && session && session.expires_at) expiresEl.textContent = new Date(session.expires_at).toLocaleString();
      const lastEl = qs('#qr-last'); if (lastEl && session && session.issued_at) lastEl.textContent = new Date(session.issued_at).toLocaleString();
      // ensure qr card visible (tab may be hidden)
      const qrCard = qs('.qr-main-card'); if (qrCard) qrCard.style.display = '';
    }

    function setupPolling(){
      // Polling is now always active since QR generation is automatic on server
      if (pollHandle) { clearInterval(pollHandle); pollHandle = null; }
      // Fetch current QR immediately, then poll every 5s (fallback if WebSocket fails)
      fetchCurrentQr(false);
      pollHandle = setInterval(() => fetchCurrentQr(false), 5*1000);
    }

    // Start polling for automatic QR updates from server
    setupPolling();

    // HR attendance rendering: fetch attendance and employees and render Attendance table
    async function loadAndRenderAttendance(){
      const apiBase = window.API_URL || window.__MOCK_API_BASE__ || '/api';
      try{
        console.log('[HR] Loading all attendance data from:', apiBase);
        
        // fetch employees + attendance from server using HR endpoints (include credentials for cookie auth)
        // NOTE: No date parameters passed - fetches ALL attendance records across all departments and dates
        const [empsResp, attResp] = await Promise.all([
          fetchWithAuth(apiBase + '/hr/employees', {}),
          fetchWithAuth(apiBase + '/hr/attendance', {})
        ]);
        console.log('[HR] Employees response:', empsResp.status);
        console.log('[HR] Attendance response:', attResp.status);
        
        if (!empsResp.ok || !attResp.ok) throw new Error('Failed to load data');
        const employees = await empsResp.json();
        const attendance = await attResp.json();
        console.log('[HR] Fetched employees:', employees?.length, 'attendance records:', attendance?.length);

        // build a map employee_id -> name
        const empMap = new Map();
        if (Array.isArray(employees)){
          for (const e of employees){ 
            if (e.employee_id) empMap.set(e.employee_id, e.name || e.full_name); 
            if (e.id) empMap.set(String(e.id), e.name || e.full_name); 
            if (e.email) empMap.set((e.email||'').toLowerCase(), e.name || e.full_name); 
          }
        }

        // ensure Real-time Attendance table exists (find the one with "Real-time Attendance" heading)
        // First try to find by ID (HRDashboard.html uses #attendanceTable)
        let hrTable = document.getElementById('attendanceTable');
        
        // If not found by ID, search in .wide-card containers (legacy structure)
        if (!hrTable) {
          const wideCards = document.querySelectorAll('.wide-card');
          for (const card of wideCards) {
            if (/Real-time Attendance/i.test(card.textContent)) {
              hrTable = card.querySelector('table.attendance-table');
              if (hrTable) break;
            }
          }
        }
        
        // If still not found, try .attendance-management-card (HRDashboard structure)
        if (!hrTable) {
          const attCard = document.querySelector('.attendance-management-card');
          if (attCard) {
            hrTable = attCard.querySelector('table.attendance-table');
          }
        }
        
        if (!hrTable) {
          console.warn('Could not find attendance table');
          return;
        }
        
        const tbody = hrTable.querySelector('tbody') || hrTable.appendChild(document.createElement('tbody'));
        // clear existing body
        tbody.innerHTML = '';

        // Use all attendance records from server (no date filtering - fetches all records)
        const allRecords = Array.isArray(attendance) ? attendance : [];

        if (allRecords.length === 0){
          const tr = document.createElement('tr');
          tr.innerHTML = '<td colspan="7" style="text-align:center;color:var(--muted-foreground);padding:12px;">No attendance records found.</td>';
          tbody.appendChild(tr);
        } else {
          // render rows sorted by date and time (newest first)
          allRecords.sort((a,b) => {
            const dateComp = (b.date || '').localeCompare(a.date || '');
            if (dateComp !== 0) return dateComp;
            return (b.time_in || '').localeCompare(a.time_in || '');
          });
          for (const r of allRecords){
            const tr = document.createElement('tr');
            const name = r.employee_name || empMap.get(r.employee_id) || empMap.get(String(r.employee_id)) || r.employee_id || r.email || 'Unknown';
            const idCell = String(r.employee_id || '');
            const date = r.date ? new Date(r.date).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: '2-digit' }) : '—';
            const timeIn = r.time_in ? new Date(`${r.date}T${r.time_in}`).toLocaleTimeString() : (r.timestamp ? new Date(r.timestamp).toLocaleTimeString() : '—');
            const timeOut = r.time_out ? new Date(`${r.date}T${r.time_out}`).toLocaleTimeString() : '—';
            const dept = r.employee_department || '—';
            const status = String(r.status || 'Present');
            tr.innerHTML = `<td>${escapeHtml(idCell)}</td><td>${escapeHtml(String(name))}</td><td>${escapeHtml(date)}</td><td>${escapeHtml(String(timeIn))}</td><td>${escapeHtml(String(timeOut))}</td><td>${escapeHtml(dept)}</td><td><span class="status ${status.toLowerCase().includes('late')? 'late':'on-time'}">${escapeHtml(status)}</span></td>`;
            tbody.appendChild(tr);
          }
        }

        // compute overview counts from all attendance records
        const counts = { present: 0, late: 0, absent: 0 };
        for (const r of allRecords){
          const s = (r.status || '').toLowerCase();
          if (s.includes('late')) counts.late += 1;
          else if (s.includes('absent')) counts.absent += 1;
          else counts.present += 1;
        }

        // update overview chips in the dashboard (first stat-chips on page)
        const chips = document.querySelectorAll('.attendance-card-left .stat-chips .stat-chip');
        if (chips && chips.length >= 3){
          try{ chips[0].querySelector('.num').textContent = String(counts.present); }catch(e){}
          try{ chips[1].querySelector('.num').textContent = String(counts.late); }catch(e){}
          try{ chips[2].querySelector('.num').textContent = String(counts.absent); }catch(e){}
        }
        
        // update attendance section stat cards (presentCount, lateCount, absentCount)
        try{ const el = document.getElementById('presentCount'); if (el) el.textContent = String(counts.present); }catch(e){}
        try{ const el = document.getElementById('lateCount'); if (el) el.textContent = String(counts.late); }catch(e){}
        try{ const el = document.getElementById('absentCount'); if (el) el.textContent = String(counts.absent); }catch(e){}
      }catch(e){ 
        console.error('[HR] Failed to load attendance', e); 
      }
    }

    // load initially
    loadAndRenderAttendance();
    // wire the dashboard-level Refresh button if present
    const dashRefresh = document.getElementById('hr-refresh-btn');
    if (dashRefresh) dashRefresh.addEventListener('click', loadAndRenderAttendance);

    // Attendance table filtering
    (function(){
      const deptFilter = document.getElementById('attendanceDeptFilter');
      const statusFilter = document.getElementById('attendanceStatusFilter');
      const searchFilter = document.getElementById('attendanceSearchFilter');
      const tbody = document.querySelector('#attendanceTable tbody');

      if (!deptFilter || !statusFilter || !searchFilter || !tbody) return;

      // Store all rows for filtering
      let allRows = [];

      // Intercept the original loadAndRenderAttendance to save rows
      const originalLoad = window.loadAndRenderAttendance || loadAndRenderAttendance;
      window.attendanceFilterState = { allRows: [] };

      function applyFilters() {
        const selectedDept = deptFilter.value.toLowerCase();
        const selectedStatus = statusFilter.value.toLowerCase();
        const searchTerm = searchFilter.value.toLowerCase();

        // Get all data rows (not the loading row)
        const rows = tbody.querySelectorAll('tr');
        let visibleCount = 0;

        rows.forEach(row => {
          if (row.querySelector('.attendance-loading-cell')) return; // Skip loading row

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

        // Populate department filter dropdown if empty
        if (deptFilter.options.length === 1) {
          const depts = new Set();
          rows.forEach(row => {
            const cells = row.querySelectorAll('td');
            if (cells.length > 5) {
              const dept = cells[5]?.textContent.trim();
              if (dept && dept !== '—') depts.add(dept);
            }
          });
          depts.forEach(dept => {
            const option = document.createElement('option');
            option.value = dept;
            option.textContent = dept;
            deptFilter.appendChild(option);
          });
        }
      }

      // Wire filter event listeners
      deptFilter.addEventListener('change', applyFilters);
      statusFilter.addEventListener('change', applyFilters);
      searchFilter.addEventListener('input', applyFilters);
    })();


    // listen for toggle changes to adjust polling
    document.addEventListener('qrSettingsChange', function(){ setupPolling(); });

    // Legacy department population for old table structure
    const input = qs('#hr-search');
    const deptSelect = qs('#hr-dept');
    const table = qs('.wide-card table.attendance-table');
    if (deptSelect && table){
      // populate unique departments
      const tbody = table.querySelector('tbody');
      const rows = qsa('tbody tr', table).filter(r => r.id !== 'hr-empty-row');
      const depts = new Set();
      for (const r of rows){
        const cells = r.querySelectorAll('td');
        const d = normalize(cells[2] && cells[2].textContent);
        if (d) depts.add(d);
      }
      // add options
      Array.from(depts).sort().forEach(d => {
        const opt = document.createElement('option'); opt.value = d; opt.textContent = d.charAt(0).toUpperCase() + d.slice(1);
        deptSelect.appendChild(opt);
      });

      // Event delegation for Edit / Deactivate actions on Manage Employees table
      document.addEventListener('click', function(e){
        const btn = e.target.closest('button');
        if (!btn) return;
        const tr = btn.closest('tr');
        if (!tr) return;

        // Edit button (matches text or class)
        if (btn.textContent && btn.textContent.trim().toLowerCase() === 'edit'){
          openEditModal(tr);
          return;
        }

        // Deactivate / Reactivate toggle
        if (btn.textContent && (/deactivate|reactivate/i).test(btn.textContent)){
          const isDeactivate = /deactivate/i.test(btn.textContent);
          
          // Get employee ID from the row
          const employeeId = btn.dataset.employeeId || tr.dataset.employeeId;
          if (!employeeId) {
            console.error('Employee ID not found for status update');
            return;
          }
          
          if (isDeactivate){
            // Get employee name from the name column (column 1, not 0 which is checkbox)
            const name = (tr.children[1] && tr.children[1].textContent) || 'this employee';
            if (!confirm(`Are you sure you want to deactivate ${name.trim()}?`)) return;
            
            // Update backend
            updateEmployeeStatus(employeeId, 'inactive').then(() => {
              // Update UI on success - Status is column 8 (9th column)
              const statusCell = tr.children[8];
              if (statusCell){
                const span = statusCell.querySelector('.status') || statusCell.querySelector('span') || document.createElement('span');
                span.className = 'status inactive';
                span.textContent = 'INACTIVE';
                statusCell.innerHTML = '';
                statusCell.appendChild(span);
              }
              // change button label to Reactivate
              btn.textContent = 'Reactivate';
              btn.classList.add('danger');
            }).catch(error => {
              alert('Failed to deactivate employee: ' + error.message);
            });
            return;
          } else {
            // Reactivate
            updateEmployeeStatus(employeeId, 'active').then(() => {
              // Update UI on success - Status is column 8 (9th column)
              const statusCell = tr.children[8];
              if (statusCell){
                const span = statusCell.querySelector('.status') || document.createElement('span');
                span.className = 'status active';
                span.textContent = 'ACTIVE';
                statusCell.innerHTML = '';
                statusCell.appendChild(span);
              }
              btn.textContent = 'Deactivate';
              btn.classList.remove('danger');
            }).catch(error => {
              alert('Failed to reactivate employee: ' + error.message);
            });
            return;
          }
        }
      });

      // openEditModal: reuse much of add modal UI but pre-fill and update row on save
      // openEditModal: Edit existing employee with proper API integration
      async function openEditModal(row){
        if (!row) return;
        // prevent duplicate
        if (qs('.hr-edit-modal')) { qs('.hr-edit-modal .first-name').focus(); return; }

        // Extract employee ID from the row to fetch full data
        // Employee ID is stored in the row dataset, not in a cell
        const employee_id = parseInt(row.dataset.employeeId);
        if (!employee_id || isNaN(employee_id)) {
          alert('Could not extract valid employee ID from row');
          return;
        }
        
        // Fetch full employee data from API
        let employeeData;
        try {
          const response = await fetchWithAuth(`${window.API_URL || '/api'}/hr/employees/${employee_id}`, {});
          
          if (!response.ok) throw new Error('Failed to fetch employee data');
          employeeData = await response.json();
        } catch (error) {
          alert('Failed to load employee data: ' + error.message);
          return;
        }

        const backdrop = document.createElement('div'); backdrop.className = 'modal-backdrop hr-edit-modal-backdrop';
        const modal = document.createElement('div'); modal.className = 'reset-modal hr-edit-modal';
        modal.innerHTML = `
          <div class="modal-card">
            <button class="modal-close-btn" aria-label="Close">✕</button>
            <div class="modal-header"><h3 class="modal-title">Edit Employee</h3></div>
            <div class="modal-body">
              <label style="display:block;font-weight:600;margin-bottom:6px;">First name *</label>
              <input class="first-name" type="text" placeholder="e.g. John" required />
              
              <label style="display:block;font-weight:600;margin:10px 0 6px;">Last name *</label>
              <input class="last-name" type="text" placeholder="e.g. Doe" required />
              
              <label style="display:block;font-weight:600;margin:10px 0 6px;">Email Address *</label>
              <input class="email" type="email" placeholder="e.g. john.doe@company.com" required />
              
              <label style="display:block;font-weight:600;margin:10px 0 6px;">Phone</label>
              <input class="phone" type="tel" placeholder="e.g. +63xxxxxxxxxx" pattern="^\\+63[0-9]{10}$" title="Format: +63xxxxxxxxxx" />
              
              <label style="display:block;font-weight:600;margin:10px 0 6px;">Position</label>
              <input class="position" type="text" placeholder="e.g. Software Engineer" />
              
              <label style="display:block;font-weight:600;margin:10px 0 6px;">Department</label>
              <select class="dept-select">
                <option value="">Select Department</option>
              </select>
              
              <label style="display:block;font-weight:600;margin:10px 0 6px;">Employee Status *</label>
              <select class="status-select" required>
                <option value="active">Active</option>
                <option value="inactive">Inactive</option>
                <option value="suspended">Suspended</option>
              </select>
              
              <label style="display:block;font-weight:600;margin:10px 0 6px;">Hire Date</label>
              <input class="hire-date" type="date" />
              
              <div style="margin:10px 0;padding:10px;background:var(--muted);border-radius:6px;font-size:0.9em;">
                <strong>Note:</strong> Role and password cannot be changed here. Contact system administrator for role changes.
              </div>
            </div>
            <div class="modal-footer">
              <div class="modal-actions">
                <button class="modal-send-btn">Update Employee</button>
                <button class="modal-cancel-btn" style="margin-left:10px;">Cancel</button>
              </div>
            </div>
          </div>
        `;
        document.body.appendChild(backdrop);
        document.body.appendChild(modal);

        // Get form elements
        const closeBtn = modal.querySelector('.modal-close-btn');
        const cancelBtn = modal.querySelector('.modal-cancel-btn');
        const sendBtn = modal.querySelector('.modal-send-btn');
        const firstNameInput = modal.querySelector('.first-name');
        const lastNameInput = modal.querySelector('.last-name');
        const emailInput = modal.querySelector('.email');
        const phoneInput = modal.querySelector('.phone');
        const positionInput = modal.querySelector('.position');
        const statusSelect = modal.querySelector('.status-select');
        const deptSelect = modal.querySelector('.dept-select');
        const hireDateInput = modal.querySelector('.hire-date');

        // Load departments
        await loadDepartments(deptSelect);

        // Pre-fill form with current employee data
        firstNameInput.value = employeeData.first_name || '';
        lastNameInput.value = employeeData.last_name || '';
        emailInput.value = employeeData.email || '';
        phoneInput.value = employeeData.phone || '';
        positionInput.value = employeeData.position || '';
        statusSelect.value = employeeData.status || 'active';
        if (employeeData.dept_id) deptSelect.value = employeeData.dept_id;
        if (employeeData.hire_date) hireDateInput.value = employeeData.hire_date;

        // Phone number formatting
        function formatPhoneNumber(input) {
          let value = input.value.replace(/\D/g, '');
          if (value.startsWith('63')) {
            value = '+' + value;
          } else if (value.startsWith('0') && value.length === 11) {
            value = '+63' + value.substring(1);
          } else if (value.length === 10) {
            value = '+63' + value;
          }
          input.value = value;
        }

        phoneInput.addEventListener('blur', () => formatPhoneNumber(phoneInput));

        function cleanup(){ modal.remove(); backdrop.remove(); }
        closeBtn.addEventListener('click', cleanup);
        cancelBtn.addEventListener('click', cleanup);
        backdrop.addEventListener('click', cleanup);

        sendBtn.addEventListener('click', async () => {
          const firstName = (firstNameInput.value||'').trim();
          const lastName = (lastNameInput.value||'').trim();
          const email = (emailInput.value||'').trim();
          const phone = (phoneInput.value||'').trim();
          const position = (positionInput.value||'').trim();
          const status = statusSelect.value;
          const dept_id = deptSelect.value ? parseInt(deptSelect.value) : null;
          const hire_date = hireDateInput.value || null;
          
          // Validation
          if (!firstName || !lastName || !email || !status){
            alert('Please provide first name, last name, email, and status');
            return;
          }

          // Phone validation
          if (phone && !/^\+63[0-9]{10}$/.test(phone)) {
            alert('Phone number must be in format: +63xxxxxxxxxx');
            return;
          }

          try {
            sendBtn.disabled = true;
            sendBtn.textContent = 'Updating...';

            // Call API to update employee
            const response = await fetchWithAuth(`${window.API_URL || '/api'}/hr/employees/${employee_id}`, {
              method: 'PUT',
              body: JSON.stringify({
                first_name: firstName,
                last_name: lastName,
                email,
                phone,
                position,
                status,
                dept_id,
                hire_date
              })
            });

            if (!response.ok) {
              const error = await response.json();
              throw new Error(error.error || 'Failed to update employee');
            }

            alert('Employee updated successfully!');
            cleanup();
            
            // Refresh employee list
            loadAndRenderEmployees();
          } catch (error) {
            console.error('Update error:', error);
            alert(`Error: ${error.message}`);
          } finally {
            sendBtn.disabled = false;
            sendBtn.textContent = 'Update Employee';
          }
        });

        firstNameInput.focus();
      }
    }
    // Enhanced employee management with pagination, bulk actions, and detail cards
    let currentEmployees = [];
    let filteredEmployees = [];
    let currentPage = 1;
    let rowsPerPage = 10;
    let selectedEmployees = new Set();

    async function loadAndRenderEmployees(){
      const apiBase = window.API_URL || window.__MOCK_API_BASE__ || '/api';
      try{
        const resp = await fetchWithAuth(apiBase + '/hr/employees', {});
        if (!resp.ok) throw new Error('failed');
        const employees = await resp.json();

        // Store employees data and filter out SuperAdmin and Human Resource positions
        currentEmployees = employees
          .filter(e => {
            const position = e.position || '';
            // HR cannot view SuperAdmin and Human Resource employees
            return position !== 'SuperAdmin' && position !== 'Human Resource' && position !== 'Monitoring';
          })
          .map(e => ({
            id: e.employee_id || e.id,
            name: e.name || e.full_name || '',
            employee_id: e.employee_id || (e.id ? String(e.id) : ''),
            position: e.position || 'Not specified',
            email: e.email || 'No email',
            department: e.department || e.dept_name || '',
            hire_date: e.hire_date || 'Not specified',
            last_login: e.last_login || 'Never',
            status: e.status || 'Active',
            phone: e.phone || 'Not provided',
            role: formatRoleDisplay(e.role)
          }));

        // Initialize filtered employees
        filteredEmployees = [...currentEmployees];
        
        // Populate department filter
        populateDepartmentFilter();
        
        // Render the table
        renderEmployeesTable();
        
        // Initialize event listeners
        initializeEmployeeManagement();

      }catch(e){
        console.error('Failed to load employees', e);
        showEmptyState();
      }
    }

    function populateDepartmentFilter() {
      const deptSelect = qs('#hr-dept');
      if (!deptSelect) return;

      // Clear existing options except first
      while (deptSelect.options.length > 1) deptSelect.remove(1);

      // Get unique departments
      const deptSet = new Set();
      currentEmployees.forEach(emp => {
        if (emp.department) deptSet.add(emp.department.trim());
      });

      // Add department options
      Array.from(deptSet).sort().forEach(dept => {
        const opt = document.createElement('option');
        opt.value = dept;
        opt.textContent = dept.charAt(0).toUpperCase() + dept.slice(1);
        deptSelect.appendChild(opt);
      });
    }

    function renderEmployeesTable() {
      const tbody = qs('#employeesTableBody');
      if (!tbody) return;

      // Clear existing rows
      tbody.innerHTML = '';

      if (filteredEmployees.length === 0) {
        showEmptyState();
        return;
      }

      // Calculate pagination
      const startIndex = (currentPage - 1) * rowsPerPage;
      const endIndex = startIndex + rowsPerPage;
      const pageEmployees = filteredEmployees.slice(startIndex, endIndex);

      // Render employees
      pageEmployees.forEach(emp => {
        const tr = document.createElement('tr');
        tr.dataset.employeeId = emp.id;
        tr.className = selectedEmployees.has(emp.id) ? 'selected' : '';

        // Format dates
        const hireDate = formatDate(emp.hire_date);
        const lastLogin = formatLastLogin(emp.last_login);
        
        // Status class
        const statusClass = emp.status.toLowerCase();

        tr.innerHTML = `
          <td class="checkbox-column">
            <input type="checkbox" class="row-checkbox" data-employee-id="${emp.id}" ${selectedEmployees.has(emp.id) ? 'checked' : ''}>
          </td>
          <td>${escapeHtml(emp.employee_id)}</td>
          <td class="employee-name" data-employee-id="${emp.id}">${escapeHtml(emp.name)}</td>
          <td>${escapeHtml(emp.email)}</td>
          <td>${escapeHtml(emp.department)}</td>
          <td>${escapeHtml(emp.role || 'Not specified')}</td>
          <td>${lastLogin}</td>
          <td><span class="status ${statusClass}">${escapeHtml(emp.status)}</span></td>
          <td class="actions-column">
            <div class="action-buttons">
              <button class="action-btn edit-btn" data-employee-id="${emp.id}" title="Edit Employee">
                <svg xmlns="http://www.w3.org/2000/svg" width="25" height="25" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="action-icon">
                  <path stroke="none" d="M0 0h24v24H0z" fill="none"/>
                  <path d="M7 7h-1a2 2 0 0 0 -2 2v9a2 2 0 0 0 2 2h9a2 2 0 0 0 2 -2v-1" />
                  <path d="M20.385 6.585a2.1 2.1 0 0 0 -2.97 -2.97l-8.415 8.385v3h3l8.385 -8.415z" />
                  <path d="M16 5l3 3" />
                </svg>
              </button>
              <button class="action-btn ${emp.status.toLowerCase() === 'active' ? 'deactivate-btn' : 'reactivate-btn'}" 
                      data-employee-id="${emp.id}" 
                      title="${emp.status.toLowerCase() === 'active' ? 'Deactivate Employee' : 'Reactivate Employee'}">
                ${emp.status.toLowerCase() === 'active' ? 
                  `<svg xmlns="http://www.w3.org/2000/svg" width="25" height="25" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="action-icon">
                    <path stroke="none" d="M0 0h24v24H0z" fill="none"/>
                    <path d="M17 22v-2" />
                    <path d="M9 15l6 -6" />
                    <path d="M11 6l.463 -.536a5 5 0 0 1 7.071 7.072l-.534 .464" />
                    <path d="M13 18l-.397 .534a5.068 5.068 0 0 1 -7.127 0a4.972 4.972 0 0 1 0 -7.071l.524 -.463" />
                    <path d="M20 17h2" />
                    <path d="M2 7h2" />
                    <path d="M7 2v2" />
                  </svg>` : 
                  `<svg xmlns="http://www.w3.org/2000/svg" width="25" height="25" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="action-icon">
                    <path stroke="none" d="M0 0h24v24H0z" fill="none"/>
                    <path d="M9 15l6 -6" />
                    <path d="M11 6l.463 -.536a5 5 0 0 1 7.071 7.072l-.534 .464" />
                    <path d="M13 18l-.397 .534a5.068 5.068 0 0 1 -7.127 0a4.972 4.972 0 0 1 0 -7.071l.524 -.463" />
                  </svg>`
                }
              </button>
            </div>
          </td>
        `;

        tbody.appendChild(tr);
      });

      // Update pagination
      updatePagination();
      updateBulkActions();
    }

    function showEmptyState() {
      const tbody = qs('#employeesTableBody');
      if (!tbody) return;

      tbody.innerHTML = `
        <tr id="hr-empty-row">
          <td colspan="9" style="text-align:center;color:var(--muted-foreground);padding:18px;">
            No employees found. ${filteredEmployees.length === 0 && currentEmployees.length > 0 ? 'Try adjusting your filters.' : 'Use the <strong>Invitations</strong> section to add new employees.'}
          </td>
        </tr>
      `;
      
      // Hide pagination if no data
      const tableFooter = qs('.employees-pagination-footer') || qs('.table-footer');
      if (tableFooter) tableFooter.style.display = 'none';
    }

    function formatDate(dateStr) {
      if (!dateStr || dateStr === 'Not specified') return 'Not specified';
      try {
        const date = new Date(dateStr);
        return date.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
      } catch {
        return 'Invalid date';
      }
    }

    function formatLastLogin(loginStr) {
      if (!loginStr || loginStr === 'Never') return 'Never';
      try {
        const date = new Date(loginStr);
        if (isNaN(date.getTime())) return 'Never';
        
        // Format like superadmin: "9/23/2025, 12:28:47 PM"
        return date.toLocaleString('en-US', {
          month: 'numeric',
          day: 'numeric', 
          year: 'numeric',
          hour: 'numeric',
          minute: '2-digit',
          second: '2-digit',
          hour12: true
        });
      } catch {
        return 'Never';
      }
    }

    function formatRoleDisplay(role) {
      if (!role) return 'Not specified';
      
      // Map database role names to user-friendly display names
      const roleMap = {
        'head_dept': 'Department Head',
        'employee': 'Employee',
        'superadmin': 'Super Admin',
        'hr': 'Attendance Monitoring Team'
      };
      
      return roleMap[role] || (role.charAt(0).toUpperCase() + role.slice(1));
    }

    function updatePagination() {
      const totalEmployees = filteredEmployees.length;
      const totalPages = Math.ceil(totalEmployees / rowsPerPage);
      
      // Update pagination info
      const paginationInfo = qs('#paginationInfo');
      if (paginationInfo) {
        const startIndex = (currentPage - 1) * rowsPerPage + 1;
        const endIndex = Math.min(startIndex + rowsPerPage - 1, totalEmployees);
        paginationInfo.textContent = `Showing ${startIndex}-${endIndex} of ${totalEmployees} employees`;
      }

      // Update page buttons
      const prevBtn = qs('#prevPage');
      const nextBtn = qs('#nextPage');
      
      if (prevBtn) {
        prevBtn.disabled = currentPage === 1;
      }
      
      if (nextBtn) {
        nextBtn.disabled = currentPage === totalPages || totalPages === 0;
      }

      // Update page numbers
      const pageNumbers = qs('#pageNumbers');
      if (pageNumbers) {
        pageNumbers.innerHTML = '';
        
        // Show max 5 page numbers
        const maxVisible = 5;
        let startPage = Math.max(1, currentPage - Math.floor(maxVisible / 2));
        let endPage = Math.min(totalPages, startPage + maxVisible - 1);
        
        if (endPage - startPage < maxVisible - 1) {
          startPage = Math.max(1, endPage - maxVisible + 1);
        }

        for (let i = startPage; i <= endPage; i++) {
          const pageBtn = document.createElement('button');
          pageBtn.className = `page-number ${i === currentPage ? 'active' : ''}`;
          pageBtn.textContent = i;
          pageBtn.addEventListener('click', () => goToPage(i));
          pageNumbers.appendChild(pageBtn);
        }
      }

      // Show/hide table footer
      const tableFooter = qs('.employees-pagination-footer') || qs('.table-footer');
      if (tableFooter) {
        tableFooter.style.display = totalEmployees > 0 ? 'flex' : 'none';
      }
    }

    function updateBulkActions() {
      const bulkActions = qs('#bulkActions');
      const selectedCount = qs('#selectedCount');
      
      if (bulkActions && selectedCount) {
        const count = selectedEmployees.size;
        if (count > 0) {
          bulkActions.style.display = 'flex';
          selectedCount.textContent = `${count} selected`;
        } else {
          bulkActions.style.display = 'none';
        }
      }
    }

    function goToPage(page) {
      currentPage = page;
      renderEmployeesTable();
    }

    function applyFilters() {
      const searchTerm = (qs('#hr-search')?.value || '').toLowerCase().trim();
      const deptFilter = qs('#hr-dept')?.value || '';

      filteredEmployees = currentEmployees.filter(emp => {
        const matchesSearch = !searchTerm || 
          (emp.name || '').toLowerCase().includes(searchTerm) ||
          String(emp.employee_id || '').toLowerCase().includes(searchTerm) ||
          (emp.department || '').toLowerCase().includes(searchTerm) ||
          (emp.email || '').toLowerCase().includes(searchTerm) ||
          (emp.position || '').toLowerCase().includes(searchTerm);

        const matchesDept = !deptFilter || emp.department === deptFilter;

        return matchesSearch && matchesDept;
      });

      // Reset to first page when filtering
      currentPage = 1;
      renderEmployeesTable();
    }

    function initializeEmployeeManagement() {
      // Search and filter event listeners
      const searchInput = qs('#hr-search');
      const deptSelect = qs('#hr-dept');
      const rowsSelect = qs('#rowsPerPage');

      if (searchInput) {
        searchInput.addEventListener('input', debounce(applyFilters, 300));
      }

      if (deptSelect) {
        deptSelect.addEventListener('change', applyFilters);
      }

      if (rowsSelect) {
        rowsSelect.addEventListener('change', (e) => {
          rowsPerPage = parseInt(e.target.value);
          currentPage = 1;
          renderEmployeesTable();
        });
      }

      // Pagination event listeners
      const prevBtn = qs('#prevPage');
      const nextBtn = qs('#nextPage');

      if (prevBtn) {
        prevBtn.addEventListener('click', () => {
          if (currentPage > 1) goToPage(currentPage - 1);
        });
      }

      if (nextBtn) {
        nextBtn.addEventListener('click', () => {
          const totalPages = Math.ceil(filteredEmployees.length / rowsPerPage);
          if (currentPage < totalPages) goToPage(currentPage + 1);
        });
      }

      // Select all checkbox
      const selectAllCheckbox = qs('#selectAll');
      if (selectAllCheckbox) {
        selectAllCheckbox.addEventListener('change', (e) => {
          const isChecked = e.target.checked;
          
          if (isChecked) {
            // Select all visible employees on current page
            const visibleEmployees = getVisibleEmployees();
            visibleEmployees.forEach(emp => {
              selectedEmployees.add(emp.id);
            });
          } else {
            // Deselect ALL employees (not just visible ones)
            selectedEmployees.clear();
          }

          renderEmployeesTable();
        });
      }

      // Event delegation for table interactions
      const tableContainer = qs('.employees-table-container') || qs('.table-container');
      if (tableContainer) {
        tableContainer.addEventListener('click', handleTableClick);
        tableContainer.addEventListener('mouseover', handleTableHover);
        tableContainer.addEventListener('mouseout', handleTableMouseOut);
      }

      // Bulk actions
      initializeBulkActions();
    }

    function getVisibleEmployees() {
      const startIndex = (currentPage - 1) * rowsPerPage;
      const endIndex = startIndex + rowsPerPage;
      return filteredEmployees.slice(startIndex, endIndex);
    }

    function handleTableClick(e) {
      const target = e.target;

      // Handle row checkbox
      if (target.classList.contains('row-checkbox')) {
        const employeeId = target.dataset.employeeId;
        if (target.checked) {
          selectedEmployees.add(employeeId);
        } else {
          selectedEmployees.delete(employeeId);
        }
        updateBulkActions();
        updateSelectAllCheckbox();
        return;
      }

      // Handle edit button click
      if (target.classList.contains('edit-btn') || target.closest('.edit-btn')) {
        const button = target.classList.contains('edit-btn') ? target : target.closest('.edit-btn');
        const employeeId = button.dataset.employeeId;
        editEmployee(employeeId);
        return;
      }

      // Handle deactivate/reactivate button click
      if (target.classList.contains('deactivate-btn') || target.classList.contains('reactivate-btn') || 
          target.closest('.deactivate-btn') || target.closest('.reactivate-btn')) {
        const button = target.classList.contains('deactivate-btn') || target.classList.contains('reactivate-btn') ? 
                      target : (target.closest('.deactivate-btn') || target.closest('.reactivate-btn'));
        const employeeId = button.dataset.employeeId;
        const action = button.classList.contains('deactivate-btn') ? 'deactivate' : 'reactivate';
        toggleEmployeeStatus(employeeId, action);
        return;
      }

      // Handle employee name click for detail card
      if (target.classList.contains('employee-name')) {
        const employeeId = target.dataset.employeeId;
        showEmployeeDetailCard(e, employeeId);
        return;
      }
    }

    function handleTableHover(e) {
      if (e.target.classList.contains('employee-name')) {
        e.target.style.cursor = 'pointer';
        e.target.style.textDecoration = 'underline';
      }
    }

    function handleTableMouseOut(e) {
      if (e.target.classList.contains('employee-name')) {
        e.target.style.textDecoration = 'none';
      }
    }

    function updateSelectAllCheckbox() {
      const selectAllCheckbox = qs('#selectAll');
      if (!selectAllCheckbox) return;

      const visibleEmployees = getVisibleEmployees();
      const visibleSelectedCount = visibleEmployees.filter(emp => selectedEmployees.has(emp.id)).length;

      if (visibleSelectedCount === 0) {
        selectAllCheckbox.checked = false;
        selectAllCheckbox.indeterminate = false;
      } else if (visibleSelectedCount === visibleEmployees.length) {
        selectAllCheckbox.checked = true;
        selectAllCheckbox.indeterminate = false;
      } else {
        selectAllCheckbox.checked = false;
        selectAllCheckbox.indeterminate = true;
      }
    }

    function showEmployeeDetailCard(event, employeeId) {
      // Convert to string for comparison since dataset returns strings
      const employee = currentEmployees.find(emp => String(emp.id) === String(employeeId));
      if (!employee) {
        console.error('Employee not found for detail card:', employeeId);
        return;
      }

      // Remove existing detail card
      const existingCard = qs('.employee-detail-card');
      if (existingCard) existingCard.remove();

      // Create detail card
      const card = document.createElement('div');
      card.className = 'employee-detail-card show';
      
      const initials = employee.name.split(' ').map(n => n[0]).join('').toUpperCase();
      
      card.innerHTML = `
        <div class="detail-card-header">
          <div class="detail-card-avatar">${initials}</div>
          <div>
            <h4 class="detail-card-name">${escapeHtml(employee.name)}</h4>
            <p class="detail-card-role">${escapeHtml(employee.position)}</p>
          </div>
        </div>
        <div class="detail-card-body">
          <div class="detail-row">
            <span class="detail-label">Email:</span>
            <span class="detail-value">${escapeHtml(employee.email)}</span>
          </div>
          <div class="detail-row">
            <span class="detail-label">Phone:</span>
            <span class="detail-value">${escapeHtml(employee.phone)}</span>
          </div>
          <div class="detail-row">
            <span class="detail-label">Department:</span>
            <span class="detail-value">${escapeHtml(employee.department)}</span>
          </div>
          <div class="detail-row">
            <span class="detail-label">Role:</span>
            <span class="detail-value">${escapeHtml(employee.role)}</span>
          </div>
          <div class="detail-row">
            <span class="detail-label">Hire Date:</span>
            <span class="detail-value">${formatDate(employee.hire_date)}</span>
          </div>
          <div class="detail-row">
            <span class="detail-label">Status:</span>
            <span class="detail-value">
              <span class="status ${employee.status.toLowerCase()}">${escapeHtml(employee.status)}</span>
            </span>
          </div>
        </div>
      `;

      // Position the card near the mouse
      const rect = event.target.getBoundingClientRect();
      card.style.left = `${rect.right + 10}px`;
      card.style.top = `${rect.top}px`;

      document.body.appendChild(card);

      // Auto-hide after 3 seconds or on click outside
      const hideCard = () => card.remove();
      setTimeout(hideCard, 3000);
      
      document.addEventListener('click', function clickOutside(e) {
        if (!card.contains(e.target)) {
          hideCard();
          document.removeEventListener('click', clickOutside);
        }
      });
    }

    function initializeBulkActions() {
      const bulkDeactivateBtn = qs('#bulkDeactivateBtn');
      const bulkMoveDeptBtn = qs('#bulkMoveDeptBtn');
      const bulkAssignRoleBtn = qs('#bulkAssignRoleBtn');

      if (bulkDeactivateBtn) {
        bulkDeactivateBtn.addEventListener('click', () => bulkDeactivateEmployees());
      }

      if (bulkMoveDeptBtn) {
        bulkMoveDeptBtn.addEventListener('click', () => bulkMoveDepartment());
      }

      if (bulkAssignRoleBtn) {
        bulkAssignRoleBtn.addEventListener('click', () => bulkAssignRole());
      }
    }

    function bulkDeactivateEmployees() {
      if (selectedEmployees.size === 0) return;
      
      const count = selectedEmployees.size;
      if (confirm(`Are you sure you want to deactivate ${count} employee${count > 1 ? 's' : ''}?`)) {
        // TODO: Implement bulk deactivation API call
        console.log('Bulk deactivating employees:', Array.from(selectedEmployees));
        alert('Bulk deactivation feature will be implemented with backend API.');
      }
    }

    function bulkMoveDepartment() {
      if (selectedEmployees.size === 0) return;
      
      // TODO: Show department selection modal
      console.log('Bulk moving employees to department:', Array.from(selectedEmployees));
      alert('Bulk department move feature will be implemented with backend API.');
    }

    function bulkAssignRole() {
      if (selectedEmployees.size === 0) return;
      
      // TODO: Show role selection modal
      console.log('Bulk assigning role to employees:', Array.from(selectedEmployees));
      alert('Bulk role assignment feature will be implemented with backend API.');
    }

    function editEmployee(employeeId) {
      // Convert to string for comparison since dataset returns strings
      const employee = currentEmployees.find(emp => String(emp.id) === String(employeeId));
      if (!employee) {
        console.error('Employee not found:', employeeId);
        alert(`Employee with ID ${employeeId} not found`);
        return;
      }
      
      // Find the row element in the table
      const row = document.querySelector(`tr[data-employee-id="${employeeId}"]`);
      if (!row) {
        console.error('Employee row not found in table:', employeeId);
        alert('Could not find employee row in table');
        return;
      }
      
      openEditModal(row);
    }

    function toggleEmployeeStatus(employeeId, action) {
      // Convert to string for comparison since dataset returns strings
      const employee = currentEmployees.find(emp => String(emp.id) === String(employeeId));
      if (!employee) {
        console.error('Employee not found for status toggle:', employeeId);
        alert(`Employee with ID ${employeeId} not found`);
        return;
      }
      
      const newStatus = action === 'deactivate' ? 'inactive' : 'active';
      const confirmMsg = `Are you sure you want to ${action} ${employee.name}?`;
      
      if (confirm(confirmMsg)) {
        // Use the existing backend API
        updateEmployeeStatus(employeeId, newStatus).then(() => {
          alert(`Employee ${action}d successfully!`);
          // Refresh the employee list to show updated status
          loadAndRenderEmployees();
        }).catch(error => {
          alert(`Failed to ${action} employee: ${error.message}`);
        });
      }
    }

    // Global openEditModal function
    async function openEditModal(row){
      if (!row) return;
      // prevent duplicate
      if (qs('.hr-edit-modal')) { qs('.hr-edit-modal .first-name').focus(); return; }

      // Extract employee ID from the row to fetch full data
      // Employee ID is stored in the row dataset, not in a cell
      const employee_id = parseInt(row.dataset.employeeId);
      if (!employee_id || isNaN(employee_id)) {
        alert('Could not extract valid employee ID from row');
        return;
      }
      
      // Fetch full employee data from API
      let employeeData;
      try {
        const response = await fetchWithAuth(`${window.API_URL || '/api'}/hr/employees/${employee_id}`, {});
        
        if (response.status === 403) {
          alert('Access denied: You do not have permission to view this employee.');
          return;
        }
        
        if (!response.ok) throw new Error('Failed to fetch employee data');
        employeeData = await response.json();
      } catch (error) {
        alert('Failed to load employee data: ' + error.message);
        return;
      }

      const backdrop = document.createElement('div'); backdrop.className = 'modal-backdrop hr-edit-modal-backdrop';
      const modal = document.createElement('div'); modal.className = 'reset-modal hr-edit-modal';
      modal.innerHTML = `
        <div class="modal-card">
          <button class="modal-close-btn" aria-label="Close">✕</button>
          <div class="modal-header"><h3 class="modal-title">Edit Employee</h3></div>
          <div class="modal-body">
            <label style="display:block;font-weight:600;margin-bottom:6px;">First name *</label>
            <input class="first-name" type="text" placeholder="e.g. John" required />
            
            <label style="display:block;font-weight:600;margin:10px 0 6px;">Last name *</label>
            <input class="last-name" type="text" placeholder="e.g. Doe" required />
            
            <label style="display:block;font-weight:600;margin:10px 0 6px;">Email Address *</label>
            <input class="email" type="email" placeholder="e.g. john.doe@company.com" required />
            
            <label style="display:block;font-weight:600;margin:10px 0 6px;">Phone</label>
            <input class="phone" type="tel" placeholder="e.g. +63xxxxxxxxxx" pattern="^\\+63[0-9]{10}$" title="Format: +63xxxxxxxxxx" />
            
            <label style="display:block;font-weight:600;margin:10px 0 6px;">Position</label>
            <input class="position" type="text" placeholder="e.g. Software Engineer" />
            
            <label style="display:block;font-weight:600;margin:10px 0 6px;">Department</label>
            <select class="dept-select">
              <option value="">Select Department</option>
            </select>
            
            <label style="display:block;font-weight:600;margin:10px 0 6px;">Employee Status *</label>
            <select class="status-select" required>
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
              <option value="suspended">Suspended</option>
            </select>
            
            <label style="display:block;font-weight:600;margin:10px 0 6px;">Hire Date</label>
            <input class="hire-date" type="date" />
            
            <div style="margin:10px 0;padding:10px;background:var(--muted);border-radius:6px;font-size:0.9em;">
              <strong>Note:</strong> Role and password cannot be changed here. Contact system administrator for role changes.
            </div>
          </div>
          <div class="modal-footer">
            <div class="modal-actions">
              <button class="modal-send-btn">Update Employee</button>
              <button class="modal-cancel-btn" style="margin-left:10px;">Cancel</button>
            </div>
          </div>
        </div>
      `;
      document.body.appendChild(backdrop);
      document.body.appendChild(modal);

      // Get form elements
      const closeBtn = modal.querySelector('.modal-close-btn');
      const cancelBtn = modal.querySelector('.modal-cancel-btn');
      const sendBtn = modal.querySelector('.modal-send-btn');
      const firstNameInput = modal.querySelector('.first-name');
      const lastNameInput = modal.querySelector('.last-name');
      const emailInput = modal.querySelector('.email');
      const phoneInput = modal.querySelector('.phone');
      const positionInput = modal.querySelector('.position');
      const statusSelect = modal.querySelector('.status-select');
      const deptSelect = modal.querySelector('.dept-select');
      const hireDateInput = modal.querySelector('.hire-date');

      // Load departments
      await loadDepartments(deptSelect);

      // Pre-fill form with current employee data
      firstNameInput.value = employeeData.first_name || '';
      lastNameInput.value = employeeData.last_name || '';
      emailInput.value = employeeData.email || '';
      phoneInput.value = employeeData.phone || '';
      positionInput.value = employeeData.position || '';
      statusSelect.value = employeeData.status || 'active';
      if (employeeData.dept_id) deptSelect.value = employeeData.dept_id;
      if (employeeData.hire_date) hireDateInput.value = employeeData.hire_date;

      // Phone number formatting
      function formatPhoneNumber(input) {
        let value = input.value.replace(/\D/g, '');
        if (value.startsWith('63')) {
          value = '+' + value;
        } else if (value.startsWith('0') && value.length === 11) {
          value = '+63' + value.substring(1);
        } else if (value.length === 10) {
          value = '+63' + value;
        }
        input.value = value;
      }

      phoneInput.addEventListener('blur', () => formatPhoneNumber(phoneInput));

      function cleanup(){ modal.remove(); backdrop.remove(); }
      closeBtn.addEventListener('click', cleanup);
      cancelBtn.addEventListener('click', cleanup);
      backdrop.addEventListener('click', cleanup);

      sendBtn.addEventListener('click', async () => {
        const firstName = (firstNameInput.value||'').trim();
        const lastName = (lastNameInput.value||'').trim();
        const email = (emailInput.value||'').trim();
        const phone = (phoneInput.value||'').trim();
        const position = (positionInput.value||'').trim();
        const status = statusSelect.value;
        const dept_id = deptSelect.value ? parseInt(deptSelect.value) : null;
        const hire_date = hireDateInput.value || null;
        
        // Validation
        if (!firstName || !lastName || !email || !status){
          alert('Please provide first name, last name, email, and status');
          return;
        }

        // Phone validation
        if (phone && !/^\+63[0-9]{10}$/.test(phone)) {
          alert('Phone number must be in format: +63xxxxxxxxxx');
          return;
        }

        try {
          sendBtn.disabled = true;
          sendBtn.textContent = 'Updating...';

          // Call API to update employee
          const response = await fetchWithAuth(`${window.API_URL || '/api'}/hr/employees/${employee_id}`, {
            method: 'PUT',
            body: JSON.stringify({
              first_name: firstName,
              last_name: lastName,
              email,
              phone,
              position,
              status,
              dept_id,
              hire_date
            })
          });

          if (!response.ok) {
            const error = await response.json();
            throw new Error(error.error || 'Failed to update employee');
          }

          alert('Employee updated successfully!');
          cleanup();
          
          // Refresh employee list
          loadAndRenderEmployees();
        } catch (error) {
          console.error('Update error:', error);
          alert(`Error: ${error.message}`);
        } finally {
          sendBtn.disabled = false;
          sendBtn.textContent = 'Update Employee';
        }
      });

      firstNameInput.focus();
    }

    // Utility function for debouncing
    function debounce(func, wait) {
      let timeout;
      return function executedFunction(...args) {
        const later = () => {
          clearTimeout(timeout);
          func(...args);
        };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
      };
    }

    // Function to load departments into a select element
    async function loadDepartments(selectElement) {
      try {
        const response = await fetchWithAuth(`${window.API_URL || '/api'}/hr/departments`, {});
        
        if (response.ok) {
          const departments = await response.json();
          departments.forEach(dept => {
            const option = document.createElement('option');
            option.value = dept.dept_id;
            option.textContent = dept.dept_name;
            selectElement.appendChild(option);
          });
        }
      } catch (error) {
        console.error('Error loading departments:', error);
      }
    }

    // Initialize enhanced employee management with a delay to ensure auth completes first
    // This prevents race condition with auth-guard profile fetch
    setTimeout(() => {
      console.log('[HR.js] Loading employees after auth delay');
      loadAndRenderEmployees();
    }, 500);

  });

  // Tab toggles: show/hide sections for Dashboard and Employees
  document.addEventListener('DOMContentLoaded', function(){
    const tabs = qsa('.hr-tabs .tab');
    if (!tabs || tabs.length === 0) return;
    const mainCard = qs('.main-card');
    const attendanceRow = qs('.attendance-row'); // contains attendance-card-left/right
    const manageEmployeesCard = qsa('.wide-card').find ? qsa('.wide-card').find(n=>/Manage Employees/i.test(n.textContent)) : null;
    // fallback: the first .wide-card after the manage employees heading
    const wideCards = qsa('.wide-card');
    let manageCard = null;
    for (const w of wideCards){ if (/Manage Employees/i.test(w.textContent)){ manageCard = w; break; } }

  // ensure qr card hidden on init
  const qrInit = qs('.qr-main-card'); if (qrInit) qrInit.style.display = 'none';

    function showOnlyDashboard(){
      // hide all wide-cards and other rows, then show main card + attendanceRow
      qsa('.wide-card').forEach(el => el.style.display = 'none');
      qsa('.attendance-row').forEach(el => el.style.display = 'none');
      // ensure qr card hidden
      const qrHide = qs('.qr-main-card'); if (qrHide) qrHide.style.display = 'none';
      if (mainCard) mainCard.style.display = '';
      if (attendanceRow) attendanceRow.style.display = '';
    }

    function showOnlyEmployees(){
      // hide everything except the manage employees wide-card
      qsa('.wide-card').forEach(el => el.style.display = 'none');
      qsa('.attendance-row').forEach(el => el.style.display = 'none');
      // ensure qr card hidden
      const qrHide = qs('.qr-main-card'); if (qrHide) qrHide.style.display = 'none';
      if (manageCard) manageCard.style.display = '';
      // ensure the rest of the page remains visible (header/nav/footer)
      if (mainCard) mainCard.style.display = 'none';
    }

    function showAll(){
      qsa('.wide-card').forEach(el => el.style.display = '');
      qsa('.attendance-row').forEach(el => el.style.display = '');
      // hide qr card by default when showing all
      const qrHide = qs('.qr-main-card'); if (qrHide) qrHide.style.display = 'none';
      if (mainCard) mainCard.style.display = '';
    }

    tabs.forEach(tab => {
      tab.addEventListener('click', function(){
        // manage active class
        tabs.forEach(t=>t.classList.remove('active'));
        this.classList.add('active');
        const txt = (this.textContent||'').trim().toLowerCase();
        if (txt === 'dashboard'){
          showOnlyDashboard();
          // Stop Live QR polling when leaving QR tab
          if (window.stopLiveQR) window.stopLiveQR();
        } else if (txt === 'employees'){
          showOnlyEmployees();
          // Stop Live QR polling when leaving QR tab
          if (window.stopLiveQR) window.stopLiveQR();
        } else if (txt === 'qr codes' || txt === 'qr' || txt === 'qr codes'){
          // show only the QR main card
          qsa('.wide-card').forEach(el => el.style.display = 'none');
          qsa('.attendance-row').forEach(el => el.style.display = 'none');
          if (mainCard) mainCard.style.display = 'none';
          const qr = qs('.qr-main-card'); if (qr) qr.style.display = '';
          // Initialize Live QR Dashboard when QR tab is activated
          if (window.initializeLiveQR) {
            console.log('[HR.js] Activating Live QR Dashboard');
            window.initializeLiveQR();
          }
        } else {
          // restore full view for other tabs
          showAll();
          // Stop Live QR polling when leaving QR tab
          if (window.stopLiveQR) window.stopLiveQR();
        }
      });
    });

    // initialize: keep Dashboard active view
    const active = qs('.hr-tabs .tab.active');
    if (active && (active.textContent||'').trim().toLowerCase() === 'dashboard'){
      showOnlyDashboard();
    }
  });

})();

// Main tab and functionality initialization
document.addEventListener('DOMContentLoaded', function() {
    // Helper functions
    function qs(sel, root=document){ return root.querySelector(sel); }
    function qsa(sel, root=document) { return Array.from(root.querySelectorAll(sel)); }
    
    // Define tabs
    const tabs = qsa('.hr-tabs .tab');
    if (!tabs || tabs.length === 0) return;
    
    // Define sections for each tab
    const sections = {
        'Dashboard': ['dashboard-section', 'attendance-section'],
        'QR Codes': ['qr-section'],
        'Employees': ['employees-section'],
        'Reports': ['reports-section'],
        'Override': ['reports-section'] // Override is part of reports section
    };
    
    tabs.forEach((tab, index) => {
        tab.addEventListener('click', function() {
            // Remove active class from all tabs
            tabs.forEach(t => t.classList.remove('active'));
            // Add active class to clicked tab
            this.classList.add('active');
            
            const tabName = this.textContent.trim();
            console.log('Switching to tab:', tabName);
            
            // Hide all sections first
            Object.values(sections).flat().forEach(sectionId => {
                const section = document.getElementById(sectionId);
                if (section) {
                    section.style.display = 'none';
                }
            });
            
            // Show sections for the selected tab
            const sectionsToShow = sections[tabName] || [];
            sectionsToShow.forEach(sectionId => {
                const section = document.getElementById(sectionId);
                if (section) {
                    section.style.display = 'block';
                }
            });
            
            // Load data for specific tabs
            if (tabName === 'Employees') {
                loadEmployeesTable();
            } else if (tabName === 'Invitations') {
                // Load invitations when tab is activated
                if (window.hrInvitations) {
                    window.hrInvitations.loadInvitations();
                }
            } else if (tabName === 'QR Codes') {
                // Initialize QR functionality if needed
                console.log('QR Codes section loaded');
            }
        });
    });
    
    // Initialize with Dashboard tab active
    const dashboardTab = Array.from(tabs).find(tab => tab.textContent.trim() === 'Dashboard');
    if (dashboardTab) {
        dashboardTab.click();
    }
    
    // Load employees table function
    async function loadEmployeesTable() {
        console.log('Loading employees table...');
        // The existing employee loading logic should be triggered here
        // This will refresh the employee list when switching to Employees tab
        const searchInput = document.getElementById('hr-search');
        const deptSelect = document.getElementById('hr-dept');
        
        if (searchInput) {
            // Trigger the existing search/filter logic
            searchInput.dispatchEvent(new Event('input'));
        }
    }

    // Assign department head function (global so it can be called from modal)
    // Already defined globally outside IIFE at the top of this file
    // window.assignDepartmentHead is now just a reference to the global assignDepartmentHead

});

// Function to update employee status via API
async function updateEmployeeStatus(employeeId, status) {
    try {
        // First get current employee data
        const getResponse = await fetchWithAuth(`${window.API_URL || '/api'}/hr/employees/${employeeId}`, {});
        
        if (getResponse.status === 403) {
            throw new Error('Access denied: You do not have permission to modify this employee.');
        }
        
        if (!getResponse.ok) {
            throw new Error('Failed to fetch employee data');
        }
        
        const employeeData = await getResponse.json();
        
        // Update with new status
        const updateResponse = await fetchWithAuth(`${window.API_URL || '/api'}/hr/employees/${employeeId}`, {
            method: 'PUT',
            body: JSON.stringify({
                ...employeeData,
                status: status
            })
        });
        
        if (updateResponse.status === 403) {
            throw new Error('Access denied: You do not have permission to modify this employee.');
        }
        
        if (!updateResponse.ok) {
            const error = await updateResponse.json();
            throw new Error(error.error || 'Failed to update employee status');
        }
        
        return await updateResponse.json();
    } catch (error) {
        console.error('Error updating employee status:', error);
        throw error;
    }
}

// ============================================================================
// SCHEDULING MODULE FOR ATTENDANCE MONITORING TEAM
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
    let allEmployees = [];
    let filteredEmployees = [];
    let departments = [];
    let shiftTypes = [];
    let scheduleChanges = {};
    let currentDepartmentFilter = '';
    let currentSearchFilter = '';

    // DOM Elements
    const hrPrevWeekBtn = document.getElementById('hrPrevWeekBtn');
    const hrNextWeekBtn = document.getElementById('hrNextWeekBtn');
    const hrTodayBtn = document.getElementById('hrTodayBtn');
    const hrCurrentWeekDisplay = document.getElementById('hrCurrentWeekDisplay');
    const hrDepartmentFilter = document.getElementById('hrDepartmentFilter');
    const hrEmployeeSearch = document.getElementById('hrEmployeeSearch');
    const hrCopyLastWeekBtn = document.getElementById('hrCopyLastWeekBtn');
    const hrSaveScheduleBtn = document.getElementById('hrSaveScheduleBtn');
    const hrScheduleGridBody = document.getElementById('hrScheduleGridBody');
    const hrScheduleGridContainer = document.getElementById('hrScheduleGridContainer');
    const hrSchedulingLoading = document.getElementById('hrSchedulingLoading');
    const hrSchedulingEmpty = document.getElementById('hrSchedulingEmpty');

    /**
     * Initialize HR scheduling module
     */
    async function initHRScheduling() {
        try {
            // Load shift types
            shiftTypes = await getShiftTypes();

            // Load departments for filter
            await loadDepartments();

            // Set to current week
            const weekRange = getCurrentWeekRange();
            currentWeekStart = new Date(weekRange.startDate + 'T00:00:00');

            // Load all employees and schedules
            await loadAllEmployees();
            await loadSchedules();

        } catch (error) {
            console.error('[HR Scheduling] Init error:', error);
        }
    }

    /**
     * Load all departments for filter dropdown
     */
    async function loadDepartments() {
        try {
            const apiBase = window.API_URL || '/api';
            const response = await fetchWithAuth(`${apiBase}/departments`);
            
            if (!response.ok) {
                throw new Error('Failed to fetch departments');
            }

            const data = await response.json();
            departments = Array.isArray(data) ? data : (data.departments || []);

            // Populate department filter dropdown
            if (hrDepartmentFilter) {
                hrDepartmentFilter.innerHTML = '<option value="">All Departments</option>';
                departments.forEach(dept => {
                    const option = document.createElement('option');
                    option.value = dept.id || dept.dept_id;
                    option.textContent = dept.name || dept.dept_name;
                    hrDepartmentFilter.appendChild(option);
                });
            }

            console.log('[HR Scheduling] Loaded departments:', departments.length);

        } catch (error) {
            console.error('[HR Scheduling] Error loading departments:', error);
            departments = [];
        }
    }

    /**
     * Load all employees (HR can see all departments)
     */
    async function loadAllEmployees() {
        try {
            const apiBase = window.API_URL || '/api';
            // Use /hr/employees endpoint which returns data from Supabase
            const response = await fetchWithAuth(`${apiBase}/hr/employees`);
            
            if (!response.ok) {
                throw new Error('Failed to fetch employees');
            }

            const data = await response.json();
            // Handle both array and object response formats
            allEmployees = Array.isArray(data) ? data : (data.employees || data.data || []);

            console.log('[HR Scheduling] Loaded employees:', allEmployees.length);
            if (allEmployees.length > 0) {
                console.log('[HR Scheduling] Sample employee:', allEmployees[0]);
            }

            // Apply filters
            applyFilters();

        } catch (error) {
            console.error('[HR Scheduling] Error loading employees:', error);
            allEmployees = [];
            filteredEmployees = [];
        }
    }

    /**
     * Apply department and search filters
     */
    function applyFilters() {
        console.log('[HR Scheduling] applyFilters called - currentDepartmentFilter:', currentDepartmentFilter, 'currentSearchFilter:', currentSearchFilter);
        console.log('[HR Scheduling] Total employees before filter:', allEmployees.length);
        
        filteredEmployees = allEmployees.filter(emp => {
            // Department filter
            if (currentDepartmentFilter) {
                // Check multiple possible field names for department ID
                // HR endpoint returns: dept_id
                const empDeptId = emp.dept_id;
                console.log('[HR Scheduling] Checking employee:', emp.name || emp.full_name || emp.id, 'empDeptId:', empDeptId, 'filter:', currentDepartmentFilter);
                if (String(empDeptId) !== String(currentDepartmentFilter)) {
                    return false;
                }
            }

            // Search filter (name or employee_id)
            if (currentSearchFilter) {
                const searchLower = currentSearchFilter.toLowerCase();
                const name = (emp.name || emp.full_name || emp.employee_name || '').toLowerCase();
                const empId = String(emp.employee_id || emp.id || '').toLowerCase();
                if (!name.includes(searchLower) && !empId.includes(searchLower)) {
                    return false;
                }
            }

            return true;
        });

        console.log('[HR Scheduling] Filtered employees:', filteredEmployees.length);
        if (filteredEmployees.length > 0) {
            console.log('[HR Scheduling] Sample filtered employee:', filteredEmployees[0]);
        }
    }

    /**
     * Load schedules for current week
     */
    async function loadSchedules() {
        try {
            if (filteredEmployees.length === 0) {
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

            const schedules = await getSchedules(startDate, endDate, null, null);

            // Reset changes
            scheduleChanges = {};

            // Update week display
            updateWeekDisplay(weekDates);

            // Render grid
            renderScheduleGrid(weekDates, schedules);

            hideLoading();

        } catch (error) {
            console.error('[HR Scheduling] Error loading schedules:', error);
            hideLoading();
        }
    }

    /**
     * Update week display label
     */
    function updateWeekDisplay(weekDates) {
        if (!hrCurrentWeekDisplay || weekDates.length === 0) return;

        const startDate = new Date(weekDates[0] + 'T00:00:00');
        const endDate = new Date(weekDates[6] + 'T00:00:00');

        const options = { month: 'short', day: 'numeric', year: 'numeric' };
        const startStr = startDate.toLocaleDateString('en-US', options);
        const endStr = endDate.toLocaleDateString('en-US', options);

        hrCurrentWeekDisplay.textContent = `${startStr} - ${endStr}`;

        // Update header dates
        const dayHeaders = document.querySelectorAll('#hrScheduleGrid thead .day-col');
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
        if (!hrScheduleGridBody) return;

        hrScheduleGridBody.innerHTML = '';

        // Group schedules by employee
        const schedulesByEmployee = {};
        schedules.forEach(schedule => {
            if (!schedulesByEmployee[schedule.employee_id]) {
                schedulesByEmployee[schedule.employee_id] = {};
            }
            schedulesByEmployee[schedule.employee_id][schedule.schedule_date] = schedule;
        });

        // Render row for each filtered employee
        filteredEmployees.forEach(employee => {
            const tr = document.createElement('tr');
            const empId = employee.id || employee.employee_id;  // Handle both field names
            tr.dataset.employeeId = empId;

            // Employee name cell
            const nameCell = document.createElement('td');
            nameCell.className = 'employee-name-cell';
            nameCell.innerHTML = `
                <div class="employee-info">
                    <div class="employee-name">${employee.name || employee.full_name || 'Unknown'}</div>
                    <div class="employee-id">ID: ${employee.employee_id || employee.id}</div>
                </div>
            `;
            tr.appendChild(nameCell);

            // Department cell
            const deptCell = document.createElement('td');
            deptCell.className = 'dept-cell';
            deptCell.textContent = employee.department || employee.dept_name || 'N/A';
            tr.appendChild(deptCell);

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
                    }
                }

                // Event listener for changes
                select.addEventListener('change', function() {
                    handleShiftChange(empId, dateStr, this.value);
                });

                dayCell.appendChild(select);
                tr.appendChild(dayCell);
            });

            hrScheduleGridBody.appendChild(tr);
        });

        // Show grid
        if (hrScheduleGridContainer) hrScheduleGridContainer.style.display = 'block';
        if (hrSchedulingEmpty) hrSchedulingEmpty.style.display = 'none';
    }

    /**
     * Handle shift change in dropdown
     */
    function handleShiftChange(employeeId, date, shiftTypeId) {
        const changeKey = `${employeeId}_${date}`;
        
        console.log('[HR Scheduling] handleShiftChange called:', { employeeId, date, shiftTypeId, changeKey });

        if (shiftTypeId === '') {
            scheduleChanges[changeKey] = null;
            console.log('[HR Scheduling] Cleared shift for:', changeKey);
        } else {
            const parsedId = parseInt(shiftTypeId);
            scheduleChanges[changeKey] = parsedId;
            console.log('[HR Scheduling] Set shift:', changeKey, 'to', parsedId, 'type:', typeof parsedId);
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
        if (hrSaveScheduleBtn) {
            hrSaveScheduleBtn.disabled = false;
            hrSaveScheduleBtn.innerHTML = `
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <polyline points="20 6 9 17 4 12"></polyline>
                </svg>
                Save All Changes (${Object.keys(scheduleChanges).length})
            `;
        }

        console.log('[HR Scheduling] Change tracked:', changeKey, '=', scheduleChanges[changeKey]);
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

            if (hrSaveScheduleBtn) hrSaveScheduleBtn.disabled = true;

            // Build schedules array
            const schedulesToCreate = [];
            Object.keys(scheduleChanges).forEach(key => {
                const [employeeId, date] = key.split('_');
                const shiftTypeId = scheduleChanges[key];

                console.log('[HR Scheduling] Processing change:', { key, employeeId, date, shiftTypeId, isValid: !!shiftTypeId });

                if (shiftTypeId) {
                    const schedule = {
                        employee_id: parseInt(employeeId),
                        schedule_date: date,
                        shift_type: shiftTypeId
                    };
                    console.log('[HR Scheduling] Adding schedule:', schedule);
                    schedulesToCreate.push(schedule);
                }
            });

            console.log('[HR Scheduling] Total schedules to save:', schedulesToCreate.length);
            console.log('[HR Scheduling] Saving schedules:', schedulesToCreate);

            // Call bulk API
            const result = await bulkCreateSchedules(schedulesToCreate);

            alert(`Successfully saved ${schedulesToCreate.length} schedules!`);

            // Reset changes and reload
            scheduleChanges = {};
            await loadSchedules();

            if (hrSaveScheduleBtn) {
                hrSaveScheduleBtn.disabled = false;
                hrSaveScheduleBtn.innerHTML = `
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <polyline points="20 6 9 17 4 12"></polyline>
                    </svg>
                    Save All Changes
                `;
            }

        } catch (error) {
            console.error('[HR Scheduling] Save error:', error);
            alert('Failed to save schedules: ' + error.message);
            if (hrSaveScheduleBtn) hrSaveScheduleBtn.disabled = false;
        }
    }

    /**
     * Copy schedules from last week (for filtered department)
     */
    async function copyFromLastWeek() {
        try {
            const deptId = currentDepartmentFilter;
            if (!deptId) {
                alert('Please select a department first before copying schedules.');
                return;
            }

            if (!confirm('Copy all schedules from last week to this week for the selected department? This will overwrite existing schedules.')) {
                return;
            }

            if (hrCopyLastWeekBtn) hrCopyLastWeekBtn.disabled = true;

            // Calculate last week's Monday
            const lastWeekStart = new Date(currentWeekStart);
            lastWeekStart.setDate(currentWeekStart.getDate() - 7);

            const sourceDate = formatDateForAPI(lastWeekStart);
            const targetDate = formatDateForAPI(currentWeekStart);

            console.log('[HR Scheduling] Copying from', sourceDate, 'to', targetDate, 'for dept', deptId);

            const result = await copyWeekSchedules(sourceDate, targetDate, parseInt(deptId));

            alert(`Successfully copied ${result.count || 0} schedules from last week!`);

            // Reload schedules
            await loadSchedules();

            if (hrCopyLastWeekBtn) hrCopyLastWeekBtn.disabled = false;

        } catch (error) {
            console.error('[HR Scheduling] Copy error:', error);
            alert('Failed to copy schedules: ' + error.message);
            if (hrCopyLastWeekBtn) hrCopyLastWeekBtn.disabled = false;
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
     * Handle department filter change
     */
    function handleDepartmentFilterChange() {
        currentDepartmentFilter = hrDepartmentFilter.value;
        applyFilters();
        loadSchedules();
    }

    /**
     * Handle employee search
     */
    function handleEmployeeSearch() {
        currentSearchFilter = hrEmployeeSearch.value;
        applyFilters();
        loadSchedules();
    }

    /**
     * Show loading state
     */
    function showLoading() {
        if (hrSchedulingLoading) hrSchedulingLoading.style.display = 'flex';
        if (hrScheduleGridContainer) hrScheduleGridContainer.style.display = 'none';
        if (hrSchedulingEmpty) hrSchedulingEmpty.style.display = 'none';
    }

    /**
     * Hide loading state
     */
    function hideLoading() {
        if (hrSchedulingLoading) hrSchedulingLoading.style.display = 'none';
    }

    /**
     * Show empty state
     */
    function showEmptyState() {
        if (hrSchedulingLoading) hrSchedulingLoading.style.display = 'none';
        if (hrScheduleGridContainer) hrScheduleGridContainer.style.display = 'none';
        if (hrSchedulingEmpty) hrSchedulingEmpty.style.display = 'flex';
    }

    // Event listeners
    if (hrPrevWeekBtn) hrPrevWeekBtn.addEventListener('click', goToPreviousWeek);
    if (hrNextWeekBtn) hrNextWeekBtn.addEventListener('click', goToNextWeek);
    if (hrTodayBtn) hrTodayBtn.addEventListener('click', goToToday);
    if (hrCopyLastWeekBtn) hrCopyLastWeekBtn.addEventListener('click', copyFromLastWeek);
    if (hrSaveScheduleBtn) hrSaveScheduleBtn.addEventListener('click', saveSchedules);
    if (hrDepartmentFilter) hrDepartmentFilter.addEventListener('change', handleDepartmentFilterChange);
    if (hrEmployeeSearch) {
        // Debounce search input
        let searchTimeout;
        hrEmployeeSearch.addEventListener('input', function() {
            clearTimeout(searchTimeout);
            searchTimeout = setTimeout(handleEmployeeSearch, 300);
        });
    }

    // Initialize when section becomes active
    const schedulingSection = document.getElementById('section-scheduling');
    if (schedulingSection) {
        const observer = new MutationObserver((mutations) => {
            mutations.forEach((mutation) => {
                if (mutation.attributeName === 'class') {
                    if (schedulingSection.classList.contains('active') && allEmployees.length === 0) {
                        initHRScheduling();
                    }
                }
            });
        });

        observer.observe(schedulingSection, { attributes: true });

        // Also check on page load if already active
        if (schedulingSection.classList.contains('active')) {
            initHRScheduling();
        }
    }

    // Export for external access
    window.refreshHRScheduling = loadSchedules;

})();

// ============================================
// SHIFT TYPES MANAGEMENT MODULE
// ============================================

(function() {
    let allShiftTypes = [];
    let currentEditingShiftTypeId = null;

    const shiftTypeModal = document.getElementById('shiftTypeModal');
    const shiftTypeForm = document.getElementById('shiftTypeForm');
    const shiftTypesTableBodyActive = document.getElementById('shiftTypesTableBodyActive');
    const shiftTypesTableBodyInactive = document.getElementById('shiftTypesTableBodyInactive');
    const shiftTypesEmptyStateActive = document.getElementById('shiftTypesEmptyStateActive');
    const shiftTypesEmptyStateInactive = document.getElementById('shiftTypesEmptyStateInactive');
    const addShiftTypeBtn = document.getElementById('addShiftTypeBtn');
    const saveShiftTypeBtn = document.getElementById('saveShiftTypeBtn');
    const shiftTypeModalTitle = document.getElementById('shiftTypeModalTitle');
    const shiftColorCode = document.getElementById('shiftColorCode');
    const shiftColorCodeText = document.getElementById('shiftColorCodeText');

    /**
     * Initialize Shift Types module
     */
    async function initShiftTypes() {
        try {
            closeShiftTypeModal();
            await loadShiftTypes();
        } catch (error) {
            console.error('[Shift Types] Init error:', error);
        }
    }

    /**
     * Load all shift types (including inactive for management)
     */
    async function loadShiftTypes() {
        try {
            const apiBase = window.API_URL || '/api';
            // Use /all endpoint to get all shifts including inactive ones
            const response = await fetchWithAuth(`${apiBase}/shift-types/all`);

            if (!response.ok) {
                throw new Error('Failed to fetch shift types');
            }

            const data = await response.json();
            allShiftTypes = Array.isArray(data) ? data : (data.data || []);

            // Sort: active first, then inactive at bottom
            allShiftTypes.sort((a, b) => {
                if (a.is_active === b.is_active) return 0;
                return a.is_active ? -1 : 1; // Active (true) comes first
            });

            console.log('[Shift Types] Loaded shift types:', allShiftTypes.length);
            renderShiftTypesTable();

        } catch (error) {
            console.error('[Shift Types] Error loading shift types:', error);
            allShiftTypes = [];
            renderShiftTypesTable();
        }
    }

    /**
     * Render shift types table
     */
    function renderShiftTypesTable() {
        // Separate active and inactive shifts
        const activeShifts = allShiftTypes.filter(s => s.is_active !== false);
        const inactiveShifts = allShiftTypes.filter(s => s.is_active === false);

        // Render Active Shifts
        renderShiftTable(activeShifts, shiftTypesTableBodyActive, shiftTypesEmptyStateActive);

        // Render Inactive Shifts
        renderShiftTable(inactiveShifts, shiftTypesTableBodyInactive, shiftTypesEmptyStateInactive);
    }

    /**
     * Render a single shift table (active or inactive)
     */
    function renderShiftTable(shifts, tableBody, emptyState) {
        if (!tableBody) return;

        tableBody.innerHTML = '';

        if (shifts.length === 0) {
            if (emptyState) emptyState.style.display = 'flex';
            return;
        }

        if (emptyState) emptyState.style.display = 'none';

        shifts.forEach(shift => {
            const tr = document.createElement('tr');

            const nameCell = document.createElement('td');
            nameCell.textContent = shift.shift_name || shift.name || 'N/A';

            const startTimeCell = document.createElement('td');
            startTimeCell.textContent = formatTime(shift.start_time || shift.shift_start_time) || 'N/A';

            const endTimeCell = document.createElement('td');
            endTimeCell.textContent = formatTime(shift.end_time || shift.shift_end_time) || 'N/A';

            const durationCell = document.createElement('td');
            const durationMinutes = shift.duration_minutes || shift.shift_duration || 0;
            const durationHours = (durationMinutes / 60).toFixed(1);
            durationCell.textContent = durationHours + 'h';

            const colorCell = document.createElement('td');
            const colorSwatch = document.createElement('div');
            colorSwatch.className = 'shift-type-color-swatch';
            colorSwatch.style.backgroundColor = shift.color_code || '#999999';
            colorSwatch.title = shift.color_code || '#999999';
            colorCell.appendChild(colorSwatch);

            const actionsCell = document.createElement('td');
            actionsCell.className = 'shift-type-actions';

            const editBtn = document.createElement('button');
            editBtn.className = 'btn-edit-shift';
            editBtn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg> Edit';
            editBtn.onclick = () => editShiftType(shift);

            const toggleBtn = document.createElement('button');
            const isActive = shift.is_active !== false;
            toggleBtn.className = isActive ? 'btn-deactivate-shift' : 'btn-activate-shift';
            toggleBtn.innerHTML = isActive 
                ? '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6L6 18M6 6l12 12"></path></svg> Deactivate'
                : '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 5v14m7-7H5"></path></svg> Activate';
            toggleBtn.onclick = () => toggleShiftTypeStatus(shift.shift_type_id || shift.id);

            const deleteBtn = document.createElement('button');
            deleteBtn.className = 'btn-delete-shift';
            deleteBtn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path><line x1="10" y1="11" x2="10" y2="17"></line><line x1="14" y1="11" x2="14" y2="17"></line></svg> Delete';
            deleteBtn.onclick = () => deleteShiftType(shift.shift_type_id || shift.id);

            actionsCell.appendChild(editBtn);
            actionsCell.appendChild(toggleBtn);
            actionsCell.appendChild(deleteBtn);

            tr.appendChild(nameCell);
            tr.appendChild(startTimeCell);
            tr.appendChild(endTimeCell);
            tr.appendChild(durationCell);
            tr.appendChild(colorCell);
            tr.appendChild(actionsCell);

            tableBody.appendChild(tr);
        });
    }

    /**
     * Format time from HH:MM:SS or HH:MM to readable format
     */
    function formatTime(timeStr) {
        if (!timeStr) return '';
        const parts = timeStr.split(':');
        if (parts.length >= 2) {
            let hours = parseInt(parts[0], 10);
            const minutes = parts[1];
            const period = hours >= 12 ? 'PM' : 'AM';
            hours = hours % 12 || 12; // Convert to 12-hour format
            return `${hours}:${minutes} ${period}`;
        }
        return timeStr;
    }

    /**
     * Open modal to add new shift type
     */
    function openAddShiftTypeModal() {
        currentEditingShiftTypeId = null;
        shiftTypeForm.reset();
        shiftTypeModalTitle.textContent = 'Add Shift Type';
        shiftColorCode.value = '#2196F3';
        shiftColorCodeText.value = '#2196F3';
        if (shiftTypeModal) shiftTypeModal.style.display = 'flex';
    }

    /**
     * Edit existing shift type
     */
    function editShiftType(shift) {
        const modal = document.getElementById('shiftTypeModal');
        const title = document.getElementById('shiftTypeModalTitle');
        const colorCode = document.getElementById('shiftColorCode');
        const colorCodeText = document.getElementById('shiftColorCodeText');
        
        currentEditingShiftTypeId = shift.shift_type_id || shift.id;
        
        document.getElementById('shiftTypeName').value = shift.shift_name || shift.name || '';
        document.getElementById('shiftStartTime').value = formatTimeForInput(shift.start_time || shift.shift_start_time) || '';
        document.getElementById('shiftEndTime').value = formatTimeForInput(shift.end_time || shift.shift_end_time) || '';
        document.getElementById('shiftDuration').value = shift.duration_minutes || shift.shift_duration || '';
        
        if (colorCode) colorCode.value = shift.color_code || '#2196F3';
        if (colorCodeText) colorCodeText.value = shift.color_code || '#2196F3';

        if (title) title.textContent = 'Edit Shift Type';
        if (modal) modal.style.display = 'flex';
    }

    /**
     * Format time for input field (HH:MM)
     */
    function formatTimeForInput(timeStr) {
        if (!timeStr) return '';
        const parts = timeStr.split(':');
        if (parts.length >= 2) {
            return `${parts[0]}:${parts[1]}`;
        }
        return timeStr;
    }

    /**
     * Close shift type modal
     */
    function closeShiftTypeModal() {
        if (shiftTypeModal) shiftTypeModal.style.display = 'none';
        shiftTypeForm.reset();
        currentEditingShiftTypeId = null;
    }

    /**
     * Save shift type (create or update)
     */
    async function saveShiftType() {
        try {
            if (!shiftTypeForm.checkValidity()) {
                shiftTypeForm.reportValidity();
                return;
            }

            const formData = {
                shift_name: document.getElementById('shiftTypeName').value,
                start_time: document.getElementById('shiftStartTime').value + ':00',
                end_time: document.getElementById('shiftEndTime').value + ':00',
                duration_minutes: parseInt(document.getElementById('shiftDuration').value),
                color_code: shiftColorCode.value
            };

            const apiBase = window.API_URL || '/api';

            if (currentEditingShiftTypeId) {
                // Update existing
                const response = await fetchWithAuth(`${apiBase}/shift-types/${currentEditingShiftTypeId}`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(formData)
                });

                if (!response.ok) {
                    throw new Error('Failed to update shift type');
                }

                console.log('[Shift Types] Shift type updated successfully');
            } else {
                // Create new
                const response = await fetchWithAuth(`${apiBase}/shift-types`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(formData)
                });

                if (!response.ok) {
                    throw new Error('Failed to create shift type');
                }

                console.log('[Shift Types] Shift type created successfully');
            }

            closeShiftTypeModal();
            await loadShiftTypes();

        } catch (error) {
            console.error('[Shift Types] Error saving shift type:', error);
            alert('Error saving shift type: ' + error.message);
        }
    }

    /**
     * Delete shift type
     */
    async function deleteShiftType(shiftTypeId) {
        if (!confirm('⚠️ PERMANENT DELETE:\n\nThis will permanently remove this shift type from the system.\n\nYou cannot undo this action!\n\nIf you want to temporarily hide it, use DEACTIVATE instead.\n\nProceed?')) {
            return;
        }

        try {
            const apiBase = window.API_URL || '/api';
            const response = await fetchWithAuth(`${apiBase}/shift-types/${shiftTypeId}`, {
                method: 'DELETE'
            });
            if (!response.ok) {
                throw new Error('Failed to delete shift type');
            }

            console.log('[Shift Types] Shift type permanently deleted');
            await loadShiftTypes();

        } catch (error) {
            console.error('[Shift Types] Error deleting shift type:', error);
            alert('Error deleting shift type: ' + error.message);
        }
    }

    /**
     * Toggle shift type active/inactive status
     */
    async function toggleShiftTypeStatus(shiftTypeId) {
        try {
            const apiBase = window.API_URL || '/api';
            const response = await fetchWithAuth(`${apiBase}/shift-types/${shiftTypeId}/toggle-status`, {
                method: 'PATCH'
            });

            if (!response.ok) {
                throw new Error('Failed to toggle shift type status');
            }

            const result = await response.json();
            console.log('[Shift Types]', result.message);
            // Show the result message
            if (result.message) {
                const isActivated = result.message.includes('activated');
                const message = isActivated 
                    ? '✅ Shift type reactivated and is now available for scheduling'
                    : '⏸️ Shift type deactivated and hidden from scheduling';
                alert(message);
            }
            await loadShiftTypes();

        } catch (error) {
            console.error('[Shift Types] Error toggling shift type status:', error);
            alert('Error toggling shift type status: ' + error.message);
        }
    }

    // Color picker sync
    if (shiftColorCode) {
        shiftColorCode.addEventListener('change', function() {
            shiftColorCodeText.value = this.value;
        });
    }

    // Event listeners
    if (addShiftTypeBtn) addShiftTypeBtn.addEventListener('click', openAddShiftTypeModal);

    // Make functions globally accessible
    window.closeShiftTypeModal = closeShiftTypeModal;
    window.saveShiftType = saveShiftType;
    window.openAddShiftTypeModal = openAddShiftTypeModal;
    window.editShiftType = editShiftType;
    window.deleteShiftType = deleteShiftType;
    window.toggleShiftTypeStatus = toggleShiftTypeStatus;

    // Initialize when shift types tab becomes active
    if (addShiftTypeBtn) {
        addShiftTypeBtn.addEventListener('click', openAddShiftTypeModal);
    }

    // Load shift types on init
    initShiftTypes();

})();

// ============================================
// TAB SWITCHING FOR SCHEDULING MANAGEMENT
// ============================================

(function() {
    const tabButtons = document.querySelectorAll('.scheduling-tab-btn');
    const tabContents = document.querySelectorAll('.scheduling-tab-content');

    if (tabButtons.length > 0) {
        tabButtons.forEach(btn => {
            btn.addEventListener('click', function() {
                const tabId = this.getAttribute('data-tab');

                // Remove active from all buttons and contents
                tabButtons.forEach(b => b.classList.remove('active'));
                tabContents.forEach(c => c.style.display = 'none');

                // Add active to clicked button
                this.classList.add('active');

                // Show corresponding content
                const tabContent = document.getElementById(tabId);
                if (tabContent) {
                    tabContent.style.display = 'block';

                    // Load data for specific tabs
                    if (tabId === 'overview-tab') {
                        loadOverviewStats();
                    }
                }
            });
        });
    }
})();

// ============================================
// OVERVIEW STATISTICS
// ============================================

(function() {
    async function loadOverviewStats() {
        try {
            const apiBase = window.API_URL || '/api';
            const response = await fetchWithAuth(`${apiBase}/stats/overview`);

            if (!response.ok) {
                throw new Error('Failed to load overview statistics');
            }

            const data = await response.json();
            if (data.success && data.data) {
                // Update stat cards
                document.getElementById('statTotalEmployees').textContent = data.data.totalEmployees || 0;
                document.getElementById('statActiveShifts').textContent = data.data.activeShifts || 0;
                document.getElementById('statTotalSchedules').textContent = data.data.totalSchedules || 0;
                document.getElementById('statTotalDepartments').textContent = data.data.totalDepartments || 0;

                console.log('[Overview] Statistics loaded successfully');
            }

        } catch (error) {
            console.error('[Overview] Error loading statistics:', error);
            // Show 0 values on error
            document.getElementById('statTotalEmployees').textContent = '0';
            document.getElementById('statActiveShifts').textContent = '0';
            document.getElementById('statTotalSchedules').textContent = '0';
            document.getElementById('statTotalDepartments').textContent = '0';
        }
    }

    window.loadOverviewStats = loadOverviewStats;

})();
