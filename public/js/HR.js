// HR dashboard: Manage Employees search/filter
(function(){
  function qs(sel, root=document) { return root.querySelector(sel); }
  function qsa(sel, root=document) { return Array.from(root.querySelectorAll(sel)); }

  function normalize(s){ return (s||'').toString().trim().toLowerCase(); }
  function escapeHtml(s){ return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

  function rowMatches(row, query, deptFilter){
    const cells = row.querySelectorAll('td');
    const name = normalize(cells[0] && cells[0].textContent);
    const id = normalize(cells[1] && cells[1].textContent);
    const dept = normalize(cells[2] && cells[2].textContent);
    const matchesQuery = !query || name.includes(query) || id.includes(query) || dept.includes(query);
    const matchesDept = !deptFilter || dept === deptFilter;
    return matchesQuery && matchesDept;
  }

  function refreshSearch(){
    const input = qs('#hr-search');
    if (!input) return;
  const q = normalize(input.value);
  const deptSelect = qs('#hr-dept');
  const deptVal = deptSelect ? normalize(deptSelect.value) : '';
    const table = qs('.wide-card table.attendance-table');
    if (!table) return;
    const tbody = table.querySelector('tbody');
    if (!tbody) return;

    let any = false;
    const rows = qsa('tbody tr', table);
    for (const r of rows){
      if (r.id === 'hr-empty-row') continue;
  const ok = rowMatches(r, q, deptVal);
      r.style.display = ok ? '' : 'none';
      any = any || ok;
    }

    let emptyRow = qs('#hr-empty-row');
    if (!emptyRow){
      emptyRow = document.createElement('tr');
      emptyRow.id = 'hr-empty-row';
      emptyRow.innerHTML = `<td colspan="5" style="text-align:center;color:var(--muted-foreground);padding:18px;">No employees match your search.</td>`;
      tbody.appendChild(emptyRow);
    }
    emptyRow.style.display = any ? 'none' : '';
  }

  function debounce(fn, ms){
    let t = null;
    return function(...args){ clearTimeout(t); t = setTimeout(()=>fn.apply(this,args), ms); };
  }

  document.addEventListener('DOMContentLoaded', function(){
    // QR generation wiring: handle generate/revoke and display
  const apiBase = window.API_URL || window.__MOCK_API_BASE__ || '/api';
    const qrBox = qs('#qr-box');
    const genBtn = qs('#generateQrBtn');
    const revBtn = qs('#revokeQrBtn');
    let currentSessionId = null;
    let pollHandle = null;
  let autoShowOnPoll = false; // only show polled rotating session if this was set by a generate action
  let qrCountdownHandle = null;

    async function fetchCurrentQr(showIfFound = false){
      try{
        const token = sessionStorage.getItem('workline_token');
        const headers = {};
        if (token) headers['Authorization'] = 'Bearer ' + token;
        
        const resp = await fetch(apiBase + '/hr/qr/current', { headers });
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
          const secs = Math.max(0, Math.floor((expiresAt - now)/1000));
          const fmt = expiresAt.toLocaleTimeString();
          timeHtml = `<div class="qr-time"><div class="qr-time-line">Expires at <strong>${fmt}</strong></div><div class="qr-countdown">in <span class="qr-secs">${secs}</span>s</div></div>`;
          // start countdown
          qrCountdownHandle = setInterval(()=>{
            const now2 = new Date();
            const s2 = Math.max(0, Math.floor((expiresAt - now2)/1000));
            const el = qrBox.querySelector('.qr-secs'); if (el) el.textContent = s2;
            if (s2 <= 0){
              clearInterval(qrCountdownHandle); qrCountdownHandle = null;
              // Auto-rotate: if Rotation is ON, immediately generate the next rotating QR
              const rotToggle = qs('#toggle-rotation');
              const rotationOn = !!(rotToggle && rotToggle.classList.contains('on'));
              if (rotationOn){
                // keep activation so polling continues
                try{ localStorage.setItem('qrPollingActivated','1'); }catch(e){}
                // provide quick feedback while we rotate
                if (qrBox) qrBox.innerHTML = '<div style="color:var(--muted-foreground);">Refreshing QR…</div>';
                // schedule a tick to ensure we are in the next minute window
                setTimeout(() => { try{ generateQr(); }catch(e){} }, 100);
              } else {
                // rotation is off, just clear display
                currentSessionId = null;
                if (qrBox) qrBox.innerHTML = '<div style="color:var(--muted-foreground);">QR expired</div>';
              }
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

    async function generateQr(){
      try{
        // Ensure at least one of Rotation or Static is enabled before generating
        const rotationOn = !!(qs('#toggle-rotation') && qs('#toggle-rotation').classList.contains('on'));
        const staticOn = !!(qs('#toggle-static') && qs('#toggle-static').classList.contains('on'));
        if (!rotationOn && !staticOn){
          if (qrBox) qrBox.innerHTML = '<div style="color:var(--destructive);padding:12px;">Please enable either Rotation or Static mode before generating a QR.</div>';
          return;
        }
        const useStatic = staticOn;
        const body = useStatic ? { type:'static', duration_hours: 24 } : { type:'rotating', duration_minutes: 1 };
        // request generation and ask polling to auto-show the resulting rotating session
        autoShowOnPoll = !useStatic; // if rotating, let polling auto-show; for static, we'll show immediately
        const token = sessionStorage.getItem('workline_token');
        const headers = {'Content-Type':'application/json'};
        if (token) headers['Authorization'] = 'Bearer ' + token;
        
        const resp = await fetch(apiBase + '/hr/qr/generate', { method:'POST', headers, body: JSON.stringify(body) });
        if (!resp.ok) {
          const txt = await resp.text().catch(()=>null);
          if (qrBox) qrBox.innerHTML = `<div style="color:var(--destructive);padding:12px;">Failed to generate QR: ${resp.status}${txt?(' - '+txt):''}</div>`;
          return;
        }
        const json = await resp.json();
        // show immediate result for static, and for rotating show immediately as well
        showQr(json.session);
        // if rotating, keep autoShowOnPoll true so subsequent polls stay visible; if static, keep false
        if (useStatic) {
          autoShowOnPoll = false;
        } else {
          try{ localStorage.setItem('qrPollingActivated','1'); }catch(e){}
        }
        // try to switch the UI to the QR Codes tab if present
        const tabs = Array.from(document.querySelectorAll('.hr-tabs .tab'));
        for (const t of tabs){ if ((t.textContent||'').trim().toLowerCase().includes('qr')){ tabs.forEach(x=>x.classList.remove('active')); t.classList.add('active'); break; } }
        const qrCard = qs('.qr-main-card'); if (qrCard) qrCard.style.display = '';
        // if rotation is on, ensure polling
        setupPolling();
      }catch(e){ console.error(e); alert('Error generating QR'); }
    }

    async function revokeQr(){
      try{
        if (!currentSessionId) { alert('No active session'); return; }
        const token = sessionStorage.getItem('workline_token');
        const headers = {'Content-Type':'application/json'};
        if (token) headers['Authorization'] = 'Bearer ' + token;
        
        // Request revocation
        const resp = await fetch(apiBase + '/hr/qr/revoke', { method:'POST', headers, body: JSON.stringify({}) });
        if (!resp.ok) { alert('Failed to revoke'); return; }
        const json = await resp.json();
        // clear display
        currentSessionId = null; if (qrBox) qrBox.innerHTML = '<div style="color:var(--muted-foreground);">qr code</div>';
        // stop auto-show on poll
        autoShowOnPoll = false;
        try{ localStorage.removeItem('qrPollingActivated'); }catch(e){}
        // stop polling
        if (pollHandle) { clearInterval(pollHandle); pollHandle = null; }
      }catch(e){ console.error(e); alert('Error revoking QR'); }
    }

    function setupPolling(){
      // only poll when rotation toggle is ON
      const rotationOn = !!(qs('#toggle-rotation') && qs('#toggle-rotation').classList.contains('on'));
      if (pollHandle) { clearInterval(pollHandle); pollHandle = null; }
      if (!rotationOn) return;
      // require explicit activation (set when HR generated a rotating QR) to avoid polling on every reload
      let activated = false;
      try{ activated = !!localStorage.getItem('qrPollingActivated'); }catch(e){}
      if (!activated) return;
      // immediate (silent) fetch then every 60s; do not forcibly show unless autoShowOnPoll is set
      fetchCurrentQr(false);
      pollHandle = setInterval(() => fetchCurrentQr(false), 60*1000);
    }

    if (genBtn) genBtn.addEventListener('click', generateQr);
    if (revBtn) revBtn.addEventListener('click', revokeQr);

    // start polling according to toggle state
    setupPolling();

    // HR attendance rendering: fetch attendance and employees and render Real-time Attendance table
    async function loadAndRenderAttendance(){
      const apiBase = window.API_URL || window.__MOCK_API_BASE__ || '/api';
      try{
        const token = sessionStorage.getItem('workline_token');
        const headers = {};
        if (token) headers['Authorization'] = 'Bearer ' + token;
        
        // fetch employees + attendance from server using HR endpoints
        const [empsResp, attResp] = await Promise.all([
          fetch(apiBase + '/hr/employees', { headers }),
          fetch(apiBase + '/hr/attendance', { headers })
        ]);
        if (!empsResp.ok || !attResp.ok) throw new Error('Failed to load data');
        const employees = await empsResp.json();
        const attendance = await attResp.json();

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
        const wideCards = document.querySelectorAll('.wide-card');
        let hrTable = null;
        for (const card of wideCards) {
          if (/Real-time Attendance/i.test(card.textContent)) {
            hrTable = card.querySelector('table.attendance-table');
            break;
          }
        }
        if (!hrTable) return;
        const tbody = hrTable.querySelector('tbody') || hrTable.appendChild(document.createElement('tbody'));
        // clear existing body
        tbody.innerHTML = '';

        // filter today's records (server returns only today's rows already)
        const todays = Array.isArray(attendance) ? attendance : [];

        if (todays.length === 0){
          const tr = document.createElement('tr');
          tr.innerHTML = '<td colspan="4" style="text-align:center;color:var(--muted-foreground);padding:12px;">No attendance records for today.</td>';
          tbody.appendChild(tr);
        } else {
          // render rows newest first
          todays.sort((a,b) => (b.timestamp||'').localeCompare(a.timestamp||''));
          for (const r of todays){
            const tr = document.createElement('tr');
            const name = r.employee_name || empMap.get(r.employee_id) || empMap.get(String(r.employee_id)) || r.employee_id || r.email || 'Unknown';
            const idCell = String(r.employee_id || '');
            const time = r.timestamp ? new Date(r.timestamp).toLocaleTimeString() : (r.dateKey || '');
            const status = String(r.status || 'Present');
            tr.innerHTML = `<td>${escapeHtml(String(name))}</td><td>${escapeHtml(idCell)}</td><td>${escapeHtml(String(time))}</td><td><span class="status ${status.toLowerCase().includes('late')? 'late':'on-time'}">${escapeHtml(status)}</span></td>`;
            tbody.appendChild(tr);
          }
        }

        // compute overview counts from todays rows
        const counts = { present: 0, late: 0, absent: 0 };
        for (const r of todays){
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
      }catch(e){ console.error('Failed to load attendance', e); }
    }

    // wire Refresh button for HR attendance table (uses existing table-actions area)
    (function(){
      // try to find a Refresh button; if none, create one in the HR Real-time Attendance card
      const wideCards = document.querySelectorAll('.wide-card');
      let realTimeCard = null;
      for (const w of wideCards){ if (/Real-time Attendance/i.test(w.textContent)) { realTimeCard = w; break; } }
      if (!realTimeCard && wideCards.length) realTimeCard = wideCards[wideCards.length-1];
      if (realTimeCard){
        let actions = realTimeCard.querySelector('.table-actions');
        if (!actions){ actions = document.createElement('div'); actions.className = 'table-actions'; realTimeCard.appendChild(actions); }
        let refreshBtn = actions.querySelector('.btn-refresh');
        if (!refreshBtn){ refreshBtn = document.createElement('button'); refreshBtn.className = 'btn-secondary btn-refresh'; refreshBtn.textContent = 'Refresh'; actions.appendChild(refreshBtn); }
        refreshBtn.addEventListener('click', () => { loadAndRenderAttendance(); });
      }
      // load initially
      loadAndRenderAttendance();
      // wire the dashboard-level Refresh button if present
      const dashRefresh = document.getElementById('hr-refresh-btn');
      if (dashRefresh) dashRefresh.addEventListener('click', loadAndRenderAttendance);
    })();

    // listen for toggle changes to adjust polling
    document.addEventListener('qrSettingsChange', function(){ setupPolling(); });

    const input = qs('#hr-search');
    if (!input) return;
    input.addEventListener('input', debounce(refreshSearch, 200));
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
            const name = (tr.children[0] && tr.children[0].textContent) || 'this employee';
            if (!confirm(`Are you sure you want to deactivate ${name.trim()}?`)) return;
            
            // Update backend
            updateEmployeeStatus(employeeId, 'inactive').then(() => {
              // Update UI on success
              const statusCell = tr.children[3];
              if (statusCell){
                const span = statusCell.querySelector('.status') || statusCell.querySelector('span') || document.createElement('span');
                span.className = 'status';
                span.textContent = 'Inactive';
                span.style.background = 'var(--muted)';
                span.style.color = '#6b6b6b';
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
              // Update UI on success
              const statusCell = tr.children[3];
              if (statusCell){
                const span = statusCell.querySelector('.status') || document.createElement('span');
                span.className = 'status on-time';
                span.textContent = 'Active';
                span.style.background = '';
                span.style.color = '';
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
        const idCell = row.children[1];
        if (!idCell || !idCell.textContent) {
          alert('Could not extract employee ID from row');
          return;
        }
        
        const employee_id = parseInt(idCell.textContent.trim());
        
        // Fetch full employee data from API
        let employeeData;
        try {
          const token = sessionStorage.getItem('workline_token');
          const response = await fetch(`${window.API_URL || '/api'}/hr/employees/${employee_id}`, {
            headers: { 'Authorization': `Bearer ${token}` }
          });
          
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
            const token = sessionStorage.getItem('workline_token');
            const response = await fetch(`${window.API_URL || '/api'}/hr/employees/${employee_id}`, {
              method: 'PUT',
              headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
              },
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
      deptSelect.addEventListener('change', debounce(refreshSearch, 50));
    }
    // load Manage Employees from server and initialize search
    async function loadAndRenderEmployees(){
      const apiBase = window.API_URL || window.__MOCK_API_BASE__ || '/api';
      try{
        const token = sessionStorage.getItem('workline_token');
        const headers = {};
        if (token) headers['Authorization'] = 'Bearer ' + token;
        
        const resp = await fetch(apiBase + '/hr/employees', { headers });
        if (!resp.ok) throw new Error('failed');
        const employees = await resp.json();

        // find Manage Employees card and table
        const manageCard = Array.from(document.querySelectorAll('.wide-card')).find(w => /Manage Employees/i.test(w.textContent));
        if (!manageCard) return;
        const table = manageCard.querySelector('table.attendance-table');
        if (!table) return;
        const tbody = table.querySelector('tbody') || table.appendChild(document.createElement('tbody'));
        tbody.innerHTML = '';

        const deptSet = new Set();
        if (!Array.isArray(employees) || employees.length === 0){
          const tr = document.createElement('tr');
          tr.id = 'hr-empty-row';
          tr.innerHTML = '<td colspan="5" style="text-align:center;color:var(--muted-foreground);padding:18px;">No employees yet. Use the <strong>Add Employee</strong> button to create records.</td>';
          tbody.appendChild(tr);
        } else {
          // render each employee (map PostgreSQL field names)
          for (const e of employees){
            const tr = document.createElement('tr');
            const name = e.name || e.full_name || '';
            const empid = e.employee_id || (e.id? String(e.id): '');
            const dept = e.department || e.dept_name || '';
            const statusLabel = (e.status || 'Active');
            const statusClass = (/(inactive|inactive)/i.test(statusLabel) ? '' : (/(late|probation)/i.test(statusLabel) ? 'late' : 'on-time'));
            
            // Add employee ID as data attribute
            tr.dataset.employeeId = empid;
            
            tr.innerHTML = `\n              <td>${escapeHtml(String(name))}</td>\n              <td>${escapeHtml(String(empid))}</td>\n              <td>${escapeHtml(String(dept))}</td>\n              <td><span class="status ${statusClass}">${escapeHtml(String(statusLabel))}</span></td>\n              <td><button class="btn-secondary">Edit</button> <button class="btn-secondary">${statusLabel.toLowerCase() === 'active' ? 'Deactivate' : 'Reactivate'}</button></td>\n            `;
            tbody.appendChild(tr);
            if (dept) deptSet.add(dept.trim());
          }
        }

        // populate department select (keep first option as All)
        const deptSelect = qs('#hr-dept');
        if (deptSelect){
          // remove existing options except first
          while (deptSelect.options.length > 1) deptSelect.remove(1);
          Array.from(deptSet).sort().forEach(d => {
            const opt = document.createElement('option'); opt.value = d; opt.textContent = d.charAt(0).toUpperCase() + d.slice(1);
            deptSelect.appendChild(opt);
          });
        }

        // apply search/filter logic
        refreshSearch();
      }catch(e){
        console.error('Failed to load employees', e);
        // leave existing empty-state in place
      }
    }

    // initialize
    loadAndRenderEmployees();
    refreshSearch();

    // Function to load departments into a select element
    async function loadDepartments(selectElement) {
      try {
        const token = sessionStorage.getItem('workline_token');
        const response = await fetch(`${window.API_URL || '/api'}/hr/departments`, {
          headers: { 'Authorization': `Bearer ${token}` }
        });
        
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

    // Add Employee modal
    const addBtn = qs('#addEmployeeBtn');
    if (addBtn){
      addBtn.addEventListener('click', () => openAddModal());
    }
    function openAddModal(){
      // prevent duplicate
      if (qs('.hr-add-modal')) { qs('.hr-add-modal .first-name').focus(); return; }

      const backdrop = document.createElement('div'); backdrop.className = 'modal-backdrop hr-add-modal-backdrop';
      const modal = document.createElement('div'); modal.className = 'reset-modal hr-add-modal';
      modal.innerHTML = `
        <div class="modal-card">
          <button class="modal-close-btn" aria-label="Close">✕</button>
          <div class="modal-header"><h3 class="modal-title">Add Employee</h3></div>
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
            
            <label style="display:block;font-weight:600;margin:10px 0 6px;">Role *</label>
            <select class="role-select" required>
              <option value="">Select Role</option>
              <option value="employee">Employee</option>
              <option value="head_dept">Department Head</option>
            </select>
            
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
            
            <div style="border:1px solid #ddd;border-radius:6px;padding:12px;margin:10px 0;">
              <label style="display:block;font-weight:600;margin-bottom:10px;">Password Setup</label>
              
              <div style="margin-bottom:10px;">
                <label style="display:flex;align-items:center;margin-bottom:6px;">
                  <input type="radio" name="passwordType" value="manual" style="margin-right:8px;" checked />
                  Set initial password manually
                </label>
                <input class="password" type="password" placeholder="Temporary password (min 6 characters)" required />
              </div>
              
              <div>
                <label style="display:flex;align-items:center;margin-bottom:6px;">
                  <input type="radio" name="passwordType" value="generate" style="margin-right:8px;" />
                  Auto-generate secure password
                </label>
                <div class="generated-password" style="display:none;padding:8px;background:#f0f8ff;border-radius:4px;font-family:monospace;font-size:14px;"></div>
              </div>
            </div>
            
            <div style="margin:10px 0;padding:10px;background:var(--muted);border-radius:6px;font-size:0.9em;">
              <strong>Note:</strong> Employee will be forced to change password on first login.
            </div>
          </div>
          <div class="modal-footer">
            <div class="modal-actions">
              <button class="modal-send-btn">Add Employee</button>
              <button class="modal-cancel-btn" style="margin-left:10px;">Cancel</button>
            </div>
          </div>
        </div>
      `;
      document.body.appendChild(backdrop);
      document.body.appendChild(modal);

      // Populate department dropdown
      const deptSelect = modal.querySelector('.dept-select');
      loadDepartments(deptSelect);

      const closeBtn = modal.querySelector('.modal-close-btn');
      const cancelBtn = modal.querySelector('.modal-cancel-btn');
      const sendBtn = modal.querySelector('.modal-send-btn');
      const firstNameInput = modal.querySelector('.first-name');
      const lastNameInput = modal.querySelector('.last-name');
      const emailInput = modal.querySelector('.email');
      const phoneInput = modal.querySelector('.phone');
      const positionInput = modal.querySelector('.position');
      const roleSelect = modal.querySelector('.role-select');
      const statusSelect = modal.querySelector('.status-select');
      const hireDateInput = modal.querySelector('.hire-date');
      const passwordInput = modal.querySelector('.password');
      const passwordTypeRadios = modal.querySelectorAll('input[name="passwordType"]');
      const generatedPasswordDiv = modal.querySelector('.generated-password');

      // Password generation functionality
      function generatePassword() {
        const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789!@#$%&*';
        let password = '';
        for (let i = 0; i < 12; i++) {
          password += chars.charAt(Math.floor(Math.random() * chars.length));
        }
        return password;
      }

      function updatePasswordFields() {
        const isManual = modal.querySelector('input[name="passwordType"]:checked').value === 'manual';
        if (isManual) {
          passwordInput.style.display = 'block';
          passwordInput.required = true;
          generatedPasswordDiv.style.display = 'none';
        } else {
          passwordInput.style.display = 'none';
          passwordInput.required = false;
          const genPassword = generatePassword();
          generatedPasswordDiv.textContent = `Generated password: ${genPassword}`;
          generatedPasswordDiv.style.display = 'block';
          passwordInput.value = genPassword; // Store in hidden field for submission
        }
      }

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

      passwordTypeRadios.forEach(radio => {
        radio.addEventListener('change', updatePasswordFields);
      });

      phoneInput.addEventListener('blur', () => formatPhoneNumber(phoneInput));

      function cleanup(){ modal.remove(); backdrop.remove(); }
      closeBtn.addEventListener('click', cleanup);
      cancelBtn.addEventListener('click', cleanup);
      backdrop.addEventListener('click', cleanup);

      // Initialize password fields
      updatePasswordFields();

      sendBtn.addEventListener('click', async () => {
        const firstName = (firstNameInput.value||'').trim();
        const lastName = (lastNameInput.value||'').trim();
        const email = (emailInput.value||'').trim();
        const phone = (phoneInput.value||'').trim();
        const position = (positionInput.value||'').trim();
        const role = roleSelect.value;
        const status = statusSelect.value;
        const dept_id = deptSelect.value ? parseInt(deptSelect.value) : null;
        const hire_date = hireDateInput.value || null;
        const password = (passwordInput.value||'').trim();
        
        // Validation
        if (!firstName || !lastName || !email || !password || !role || !status){
          alert('Please provide first name, last name, email, password, role, and status');
          return;
        }

        if (password.length < 6) {
          alert('Password must be at least 6 characters long');
          return;
        }

        // Phone validation
        if (phone && !/^\+63[0-9]{10}$/.test(phone)) {
          alert('Phone number must be in format: +63xxxxxxxxxx');
          return;
        }

        try {
          sendBtn.disabled = true;
          sendBtn.textContent = 'Adding...';

          const requestBody = {
            first_name: firstName,
            last_name: lastName,
            email,
            phone,
            position,
            role,
            status,
            dept_id,
            hire_date,
            password // Initial password
          };

          console.log('Sending employee creation request:', requestBody);

          // Call API to create employee with user account
          const token = sessionStorage.getItem('workline_token');
          const response = await fetch(`${window.API_URL || '/api'}/hr/employees`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify(requestBody)
          });

          console.log('Response status:', response.status);
          console.log('Response headers:', response.headers);

          if (!response.ok) {
            const error = await response.json();
            console.error('Server error response:', error);
            throw new Error(error.error || 'Failed to create employee');
          }

          const result = await response.json();
          alert('Employee created successfully! They will be required to change their password on first login.');
          cleanup();
          
          // Refresh the employee list
          loadAndRenderEmployees();
        } catch (error) {
          console.error('Error creating employee:', error);
          alert(`Error: ${error.message}`);
        } finally {
          sendBtn.disabled = false;
          sendBtn.textContent = 'Add Employee';
        }
      });

      firstNameInput.focus();
    }
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
        } else if (txt === 'employees'){
          showOnlyEmployees();
        } else if (txt === 'qr codes' || txt === 'qr' || txt === 'qr codes'){
          // show only the QR main card
          qsa('.wide-card').forEach(el => el.style.display = 'none');
          qsa('.attendance-row').forEach(el => el.style.display = 'none');
          if (mainCard) mainCard.style.display = 'none';
          const qr = qs('.qr-main-card'); if (qr) qr.style.display = '';
        } else {
          // restore full view for other tabs
          showAll();
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

// QR toggle controls wiring (outside main IIFE to ensure available globally)
document.addEventListener('DOMContentLoaded', function(){
  function qs(sel, root=document){ return root.querySelector(sel); }

  function setToggleState(el, on){
    if (!el) return;
    if (on){ el.classList.remove('off'); el.classList.add('on'); el.setAttribute('aria-checked','true'); }
    else { el.classList.remove('on'); el.classList.add('off'); el.setAttribute('aria-checked','false'); }
  }

  function initToggle(id){
    const el = qs('#'+id);
    if (!el) return;
    el.addEventListener('click', function(){
      const isOn = el.classList.contains('on');
      // If turning this toggle ON, ensure mutually exclusive toggles are turned OFF
      if (!isOn){
        if (id === 'toggle-rotation'){
          // turn static off
          setToggleState(qs('#toggle-static'), false);
        } else if (id === 'toggle-static'){
          // turn rotation off
          setToggleState(qs('#toggle-rotation'), false);
        }
      }
      setToggleState(el, !isOn);
      persistAndEmit();
    });
  }

  function getStates(){
    return {
      rotation: !!qs('#toggle-rotation') && qs('#toggle-rotation').classList.contains('on'),
      "static": !!qs('#toggle-static') && qs('#toggle-static').classList.contains('on'),
      geofence: !!qs('#toggle-geofence') && qs('#toggle-geofence').classList.contains('on')
    };
  }

  function persistAndEmit(){
    const s = getStates();
    try{ localStorage.setItem('qrSettings', JSON.stringify(s)); }catch(e){}
    const ev = new CustomEvent('qrSettingsChange', { detail: s });
    document.dispatchEvent(ev);
  }

  // restore saved settings if any
  try{
    const saved = localStorage.getItem('qrSettings');
    if (saved){
      const s = JSON.parse(saved);
      // enforce exclusivity when restoring: if both set, prefer rotation
      if (s.rotation && s['static']){
        s['static'] = false;
      }
      setToggleState(qs('#toggle-rotation'), !!s.rotation);
      setToggleState(qs('#toggle-static'), !!s['static']);
      setToggleState(qs('#toggle-geofence'), !!s.geofence);
    }
  }catch(e){}

  // initialize toggles
  initToggle('toggle-rotation'); initToggle('toggle-static'); initToggle('toggle-geofence');

  // expose helper
  window.getQrSettings = getStates;
});

// Departments Management Tab functionality
document.addEventListener('DOMContentLoaded', function() {
    // Tab switching functionality
    const tabs = document.querySelectorAll('.hr-tabs .tab');
    
    // Define sections for each tab
    const sections = {
        'Dashboard': ['dashboard-section', 'attendance-section'],
        'QR Codes': ['qr-section'],
        'Employees': ['employees-section'],
        'Departments': ['departments-section'],
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
            if (tabName === 'Departments') {
                loadDepartmentsTable();
            } else if (tabName === 'Employees') {
                loadEmployeesTable();
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
    
    // Refresh departments button
    const refreshBtn = document.getElementById('refreshDepartmentsBtn');
    if (refreshBtn) {
        refreshBtn.addEventListener('click', loadDepartmentsTable);
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
    
    // Load departments table function
    async function loadDepartmentsTable() {
        try {
            const token = sessionStorage.getItem('workline_token');
            const [deptResponse, empResponse] = await Promise.all([
                fetch(`${window.API_URL || '/api'}/hr/departments`, {
                    headers: { 'Authorization': `Bearer ${token}` }
                }),
                fetch(`${window.API_URL || '/api'}/hr/employees`, {
                    headers: { 'Authorization': `Bearer ${token}` }
                })
            ]);
            
            if (deptResponse.ok && empResponse.ok) {
                const departments = await deptResponse.json();
                const employees = await empResponse.json();
                
                console.log('Departments loaded:', departments);
                console.log('All employees:', employees);
                
                // Filter employees with head_dept role
                const heads = employees.filter(emp => emp.role === 'head_dept');
                console.log('Department heads found:', heads);
                
                const tbody = document.querySelector('#departments-table tbody');
                tbody.innerHTML = '';
                
                departments.forEach(dept => {
                    const row = document.createElement('tr');
                    
                    const currentHead = dept.head_name || 'No head assigned';
                    
                    row.innerHTML = `
                        <td><strong>${dept.dept_name}</strong></td>
                        <td>${dept.description || 'N/A'}</td>
                        <td>${currentHead}</td>
                        <td>
                            <button class="btn-secondary assign-head-btn" data-dept-id="${dept.dept_id}" data-dept-name="${dept.dept_name}">
                                ${dept.head_id ? 'Change Head' : 'Assign Head'}
                            </button>
                        </td>
                    `;
                    
                    tbody.appendChild(row);
                });
                
                // Add event listeners to assign head buttons
                document.querySelectorAll('.assign-head-btn').forEach(btn => {
                    btn.addEventListener('click', function() {
                        showAssignHeadModal(this.dataset.deptId, this.dataset.deptName, heads);
                    });
                });
            }
        } catch (error) {
            console.error('Error loading departments:', error);
        }
    }
    
    // Show assign head modal
    function showAssignHeadModal(deptId, deptName, heads) {
        console.log('showAssignHeadModal called with:', { deptId, deptName, heads });
        
        const modal = document.createElement('div');
        modal.className = 'modal-overlay';
        modal.innerHTML = `
            <div class="modal-content">
                <div class="modal-header">
                    <h3>Assign Department Head - ${deptName}</h3>
                </div>
                <div class="modal-body" style="padding: 16px 0;">
                    <label for="head-select" style="display: block; margin-bottom: 8px; font-weight: 600;">Select Department Head:</label>
                    <select id="head-select" style="width: 100%; padding: 8px; margin: 8px 0; border: 1px solid #ddd; border-radius: 4px;">
                        <option value="">Remove current head</option>
                        ${heads.map(head => `<option value="${head.employee_id}">${head.name}</option>`).join('')}
                    </select>
                </div>
                <div class="modal-footer" style="border-top: 1px solid #eee; padding-top: 12px; text-align: right;">
                    <button class="btn-secondary" onclick="this.closest('.modal-overlay').remove()" style="margin-right: 8px;">Cancel</button>
                    <button class="btn-primary" onclick="assignDepartmentHead(${deptId}, document.getElementById('head-select').value)">Assign</button>
                </div>
            </div>
        `;
        
        document.body.appendChild(modal);
    }
    
    // Assign department head function (global so it can be called from modal)
    window.assignDepartmentHead = async function(deptId, headId) {
        try {
            const token = sessionStorage.getItem('workline_token');
            const response = await fetch(`${window.API_URL || '/api'}/hr/departments/${deptId}/head`, {
                method: 'PUT',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ head_id: headId || null })
            });
            
            if (response.ok) {
                // Close modal
                document.querySelector('.modal-overlay').remove();
                // Reload departments table
                loadDepartmentsTable();
                alert(headId ? 'Department head assigned successfully!' : 'Department head removed successfully!');
            } else {
                const error = await response.json();
                alert('Error: ' + (error.error || 'Failed to assign department head'));
            }
        } catch (error) {
            console.error('Error assigning department head:', error);
            alert('Error: Failed to assign department head');
        }
    };
});

// Function to update employee status via API
async function updateEmployeeStatus(employeeId, status) {
    try {
        const token = sessionStorage.getItem('workline_token');
        
        // First get current employee data
        const getResponse = await fetch(`${window.API_URL || '/api'}/hr/employees/${employeeId}`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        
        if (!getResponse.ok) {
            throw new Error('Failed to fetch employee data');
        }
        
        const employeeData = await getResponse.json();
        
        // Update with new status
        const updateResponse = await fetch(`${window.API_URL || '/api'}/hr/employees/${employeeId}`, {
            method: 'PUT',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                ...employeeData,
                status: status
            })
        });
        
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
