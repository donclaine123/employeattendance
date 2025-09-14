// Department head small helper: compute totals for Present / Late / Absent
(function(){
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
    updateChips();
    // observe table for changes
    const table = document.querySelector('.wide-card .attendance-table') || document.querySelector('.attendance-table');
    if (!table) return;
    const tbody = table.querySelector('tbody');
    if (!tbody) return;
    const mo = new MutationObserver(updateChips);
    mo.observe(tbody, { childList: true, subtree: false });
  });

})();
