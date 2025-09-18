// Department head small helper: compute totals for Present / Late / Absent
(function(){
  function escapeHtml(s){ return (s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

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

  async function fetchAttendance(department){
    const apiBase = window.API_URL || window.__MOCK_API_BASE__ || '/api';
    const url = department ? (apiBase + '/attendance?department=' + encodeURIComponent(department)) : (apiBase + '/attendance');
    try{
      const r = await fetch(url);
      if (!r.ok) return [];
      return await r.json();
    }catch(e){ console.warn('fetchAttendance failed', e); return []; }
  }

  function renderAttendance(rows){
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
      const name = r.employee_name || 'Unknown';
      const empid = r.employee_id || '';
      const time = r.timestamp ? new Date(r.timestamp).toLocaleTimeString() : '';
      const status = (r.status || 'present').toLowerCase();
      const cls = status.includes('late') ? 'late' : 'on-time';
      tr.innerHTML = `<td>${escapeHtml(name)}</td><td>${escapeHtml(empid)}</td><td>${escapeHtml(time)}</td><td><span class="status ${cls}">${escapeHtml(status.charAt(0).toUpperCase() + status.slice(1))}</span></td>`;
      tbody.appendChild(tr);
    }
  }

  async function loadDepartmentAttendance(){
    try{
      const head = await fetchHeadInfo();
      const dept = head && head.department ? head.department : null;
      const rows = await fetchAttendance(dept);
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

})();
