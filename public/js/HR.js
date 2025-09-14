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
    // initialize
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

    function showOnlyDashboard(){
      // hide all wide-cards and other rows, then show main card + attendanceRow
      qsa('.wide-card').forEach(el => el.style.display = 'none');
      qsa('.attendance-row').forEach(el => el.style.display = 'none');
      if (mainCard) mainCard.style.display = '';
      if (attendanceRow) attendanceRow.style.display = '';
    }

    function showOnlyEmployees(){
      // hide everything except the manage employees wide-card
      qsa('.wide-card').forEach(el => el.style.display = 'none');
      qsa('.attendance-row').forEach(el => el.style.display = 'none');
      if (manageCard) manageCard.style.display = '';
      // ensure the rest of the page remains visible (header/nav/footer)
      if (mainCard) mainCard.style.display = 'none';
    }

    function showAll(){
      qsa('.wide-card').forEach(el => el.style.display = '');
      qsa('.attendance-row').forEach(el => el.style.display = '');
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
