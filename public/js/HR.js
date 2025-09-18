// HR dashboard: Manage Employees search/filter
(function(){
  function qs(sel, root=document) { return root.querySelector(sel); }
  function qsa(sel, root=document) { return Array.from(root.querySelectorAll(sel)); }

  function normalize(s){ return (s||'').toString().trim().toLowerCase(); }

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
        const resp = await fetch(apiBase + '/hr/qr/current');
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
        const body = useStatic ? { type:'static', ttlSeconds: 900 } : { type:'rotating' };
        // request generation and ask polling to auto-show the resulting rotating session
        autoShowOnPoll = !useStatic; // if rotating, let polling auto-show; for static, we'll show immediately
  const tok = sessionStorage.getItem('workline_token');
  const headers = {'Content-Type':'application/json'}; if (tok) headers['Authorization'] = 'Bearer ' + tok;
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
  const tok2 = sessionStorage.getItem('workline_token');
  const headers2 = {'Content-Type':'application/json'}; if (tok2) headers2['Authorization'] = 'Bearer ' + tok2;
  // Request hard deletion so the QR session is removed from the database as well
  const resp = await fetch(apiBase + '/hr/qr/revoke', { method:'POST', headers: headers2, body: JSON.stringify({ session_id: currentSessionId, hardDelete: true }) });
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
        // fetch employees + attendance from server
        const [empsResp, attResp] = await Promise.all([
          fetch(apiBase + '/employees'),
          fetch(apiBase + '/attendance')
        ]);
        if (!empsResp.ok || !attResp.ok) throw new Error('Failed to load data');
        const employees = await empsResp.json();
        const attendance = await attResp.json();

        // build a map employee_id -> name
        const empMap = new Map();
        if (Array.isArray(employees)){
          for (const e of employees){ if (e.employee_id) empMap.set(e.employee_id, e.name); if (e.id) empMap.set(String(e.id), e.name); if (e.email) empMap.set((e.email||'').toLowerCase(), e.name); }
        }

        // ensure table exists
        const hrTable = document.querySelector('.wide-card table.attendance-table');
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
            const idCell = r.employee_id || '';
            const time = r.timestamp ? new Date(r.timestamp).toLocaleTimeString() : (r.dateKey || '');
            const status = r.status || 'Present';
            tr.innerHTML = `<td>${escapeHtml(name)}</td><td>${escapeHtml(idCell)}</td><td>${escapeHtml(time)}</td><td><span class="status ${status.toLowerCase().includes('late')? 'late':'on-time'}">${escapeHtml(status)}</span></td>`;
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
          if (isDeactivate){
            const name = (tr.children[0] && tr.children[0].textContent) || 'this employee';
            if (!confirm(`Are you sure you want to deactivate ${name.trim()}?`)) return;
            // set status cell to Inactive
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
            return;
          } else {
            // Reactivate: restore to Active text and remove muted styling; we set to Active by default
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
            return;
          }
        }
      });

      // openEditModal: reuse much of add modal UI but pre-fill and update row on save
      function openEditModal(row){
        if (!row) return;
        // prevent duplicate
        if (qs('.hr-edit-modal')) { qs('.hr-edit-modal .name').focus(); return; }

        const nameCell = row.children[0];
        const idCell = row.children[1];
        const deptCell = row.children[2];
        const statusCell = row.children[3];

        const currentName = (nameCell && nameCell.textContent || '').trim();
        const currentId = (idCell && idCell.textContent || '').trim();
        const currentDept = (deptCell && deptCell.textContent || '').trim();
        const currentStatus = (statusCell && statusCell.textContent || '').trim();

        const backdrop = document.createElement('div'); backdrop.className = 'modal-backdrop hr-edit-modal-backdrop';
        const modal = document.createElement('div'); modal.className = 'reset-modal hr-edit-modal';
        modal.innerHTML = `
          <div class="modal-card">
            <button class="modal-close-btn" aria-label="Close">\u2715</button>
            <div class="modal-header"><h3 class="modal-title">Edit Employee</h3></div>
            <div class="modal-body">
              <label style="display:block;font-weight:600;margin-bottom:6px;">Full name</label>
              <input class="name" type="text" value="${escapeHtml(currentName)}" />
              <label style="display:block;font-weight:600;margin:10px 0 6px;">Employee ID</label>
              <input class="empid" type="text" value="${escapeHtml(currentId)}" />
              <label style="display:block;font-weight:600;margin:10px 0 6px;">Department</label>
              <input class="dept" type="text" value="${escapeHtml(currentDept)}" />
              <label style="display:block;font-weight:600;margin:10px 0 6px;">Status</label>
              <select class="status">
                <option value="on-time">Active</option>
                <option value="late">Probation</option>
                <option value="inactive">Inactive</option>
              </select>
            </div>
            <div class="modal-footer">
              <div class="modal-actions">
                <button class="modal-send-btn">Save</button>
              </div>
            </div>
          </div>
        `;
        document.body.appendChild(backdrop);
        document.body.appendChild(modal);

        const closeBtn = modal.querySelector('.modal-close-btn');
        const sendBtn = modal.querySelector('.modal-send-btn');
        const nameInput = modal.querySelector('.name');
        const idInput = modal.querySelector('.empid');
        const deptInput = modal.querySelector('.dept');
        const statusSelect = modal.querySelector('.status');

        // set select to current
        for (let i=0;i<statusSelect.options.length;i++){
          if (normalize(statusSelect.options[i].textContent) === normalize(currentStatus) || normalize(statusSelect.options[i].value) === normalize(currentStatus)){
            statusSelect.selectedIndex = i; break;
          }
        }

        function cleanup(){ modal.remove(); backdrop.remove(); }
        closeBtn.addEventListener('click', cleanup);
        backdrop.addEventListener('click', cleanup);

        sendBtn.addEventListener('click', () => {
          const name = (nameInput.value||'').trim();
          const empid = (idInput.value||'').trim();
          const dept = (deptInput.value||'').trim();
          const statusVal = statusSelect.value;
          const statusLabel = statusSelect.options[statusSelect.selectedIndex].textContent || '';
          if (!name || !empid){ alert('Please provide name and employee ID'); return; }

          // update the row cells
          if (nameCell) nameCell.textContent = name;
          if (idCell) idCell.textContent = empid;
          if (deptCell) deptCell.textContent = dept;
          if (statusCell){
            const statusSpan = document.createElement('span');
            const statusClass = statusVal === 'on-time' ? 'on-time' : (statusVal === 'late' ? 'late' : '');
            statusSpan.className = 'status ' + statusClass;
            statusSpan.textContent = statusLabel;
            statusCell.innerHTML = '';
            statusCell.appendChild(statusSpan);
          }

          // ensure actions cell has correct buttons
          const actionsCell = row.children[4];
          if (actionsCell){
            // prefer to keep existing buttons but normalize labels
            const editBtn = actionsCell.querySelector('button') || document.createElement('button');
            editBtn.textContent = 'Edit'; editBtn.className = 'btn-secondary';
            const otherBtn = actionsCell.querySelectorAll('button')[1] || document.createElement('button');
            otherBtn.textContent = (normalize(statusLabel) === 'inactive') ? 'Reactivate' : 'Deactivate'; otherBtn.className = 'btn-secondary';
            actionsCell.innerHTML = '';
            actionsCell.appendChild(editBtn);
            actionsCell.appendChild(document.createTextNode(' '));
            actionsCell.appendChild(otherBtn);
          }

          // update department select options if new dept
          const deptSelect = qs('#hr-dept');
          if (deptSelect){
            const val = normalize(dept);
            if (val && !Array.from(deptSelect.options).some(o => normalize(o.value) === val)){
              const opt = document.createElement('option'); opt.value = val; opt.textContent = dept.charAt(0).toUpperCase()+dept.slice(1);
              deptSelect.appendChild(opt);
            }
          }

          cleanup();
          refreshSearch();
        });

        nameInput.focus();
      }
      deptSelect.addEventListener('change', debounce(refreshSearch, 50));
    }
    // load Manage Employees from server and initialize search
    async function loadAndRenderEmployees(){
      const apiBase = window.__MOCK_API_BASE__ || '/api';
      try{
        const resp = await fetch(apiBase + '/employees');
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
          // render each employee
          for (const e of employees){
            const tr = document.createElement('tr');
            const name = e.name || '';
            const empid = e.employee_id || (e.id? String(e.id): '');
            const dept = e.department || '';
            const statusLabel = (e.status || 'Active');
            const statusClass = (/(inactive|inactive)/i.test(statusLabel) ? '' : (/(late|probation)/i.test(statusLabel) ? 'late' : 'on-time'));
            tr.innerHTML = `\n              <td>${escapeHtml(name)}</td>\n              <td>${escapeHtml(empid)}</td>\n              <td>${escapeHtml(dept)}</td>\n              <td><span class="status ${statusClass}">${escapeHtml(statusLabel)}</span></td>\n              <td><button class="btn-secondary">Edit</button> <button class="btn-secondary">Deactivate</button></td>\n            `;
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

    // Add Employee modal
    const addBtn = qs('#addEmployeeBtn');
    if (addBtn){
      addBtn.addEventListener('click', () => openAddModal());
    }
    function openAddModal(){
      // prevent duplicate
      if (qs('.hr-add-modal')) { qs('.hr-add-modal .name').focus(); return; }

      const backdrop = document.createElement('div'); backdrop.className = 'modal-backdrop hr-add-modal-backdrop';
      const modal = document.createElement('div'); modal.className = 'reset-modal hr-add-modal';
      modal.innerHTML = `
        <div class="modal-card">
          <button class="modal-close-btn" aria-label="Close">✕</button>
          <div class="modal-header"><h3 class="modal-title">Add Employee</h3></div>
          <div class="modal-body">
            <label style="display:block;font-weight:600;margin-bottom:6px;">Full name</label>
            <input class="name" type="text" placeholder="e.g. John Doe" />
            <label style="display:block;font-weight:600;margin:10px 0 6px;">Employee ID</label>
            <input class="empid" type="text" placeholder="e.g. EMP-0001" />
            <label style="display:block;font-weight:600;margin:10px 0 6px;">Department</label>
            <input class="dept" type="text" placeholder="e.g. Registrar" />
            <label style="display:block;font-weight:600;margin:10px 0 6px;">Status</label>
            <select class="status">
              <option value="on-time">Active</option>
              <option value="late">Probation</option>
              <option value="inactive">Inactive</option>
            </select>
          </div>
          <div class="modal-footer">
            <div class="modal-actions">
              <button class="modal-send-btn">Add</button>
            </div>
          </div>
        </div>
      `;
      document.body.appendChild(backdrop);
      document.body.appendChild(modal);

      const closeBtn = modal.querySelector('.modal-close-btn');
      const sendBtn = modal.querySelector('.modal-send-btn');
      const nameInput = modal.querySelector('.name');
      const idInput = modal.querySelector('.empid');
      const deptInput = modal.querySelector('.dept');
      const statusSelect = modal.querySelector('.status');

      function cleanup(){ modal.remove(); backdrop.remove(); }
      closeBtn.addEventListener('click', cleanup);
      backdrop.addEventListener('click', cleanup);

      sendBtn.addEventListener('click', () => {
        const name = (nameInput.value||'').trim();
        const empid = (idInput.value||'').trim();
        const dept = (deptInput.value||'').trim();
        const statusVal = statusSelect.value;
        const statusLabel = statusSelect.options[statusSelect.selectedIndex].textContent || '';
        if (!name || !empid){
          alert('Please provide name and employee ID');
          return;
        }
        // append row to Manage Employees table
        const table = qs('.wide-card table.attendance-table');
        if (!table) { alert('Table not found'); cleanup(); return; }
        const tbody = table.querySelector('tbody');
        const tr = document.createElement('tr');
        const statusClass = statusVal === 'on-time' ? 'on-time' : (statusVal === 'late' ? 'late' : '');
        tr.innerHTML = `
          <td>${escapeHtml(name)}</td>
          <td>${escapeHtml(empid)}</td>
          <td>${escapeHtml(dept)}</td>
          <td><span class="status ${statusClass}">${escapeHtml(statusLabel)}</span></td>
          <td><button class="btn-secondary">Edit</button> <button class="btn-secondary">Deactivate</button></td>
        `;
        tbody.appendChild(tr);
        // update department select
        const deptSelect = qs('#hr-dept');
        if (deptSelect){
          const val = normalize(dept);
          if (val && !Array.from(deptSelect.options).some(o => normalize(o.value) === val)){
            const opt = document.createElement('option'); opt.value = val; opt.textContent = dept.charAt(0).toUpperCase()+dept.slice(1);
            deptSelect.appendChild(opt);
          }
        }
        cleanup();
        refreshSearch();
      });

      nameInput.focus();
    }

    function escapeHtml(s){ return (s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
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
