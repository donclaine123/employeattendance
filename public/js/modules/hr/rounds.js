import { fetchWithAuth, showLoading, hideLoading } from './utils.js';

let currentRoundsDate = new Date().toISOString().split('T')[0];

export function initHourlyRounds() {
  const container = document.getElementById('section-hourly-rounds');
  if (!container) return;

  // Initialize date display
  updateDateDisplay();

  // Attach event listeners
  document.getElementById('prevDayBtn')?.addEventListener('click', () => changeDate(-1));
  document.getElementById('nextDayBtn')?.addEventListener('click', () => changeDate(1));

  // Initial load
  loadHourlyRounds();
}

function updateDateDisplay() {
  const display = document.getElementById('currentDateDisplay');
  if (!display) return;

  const dateObj = new Date(currentRoundsDate);
  const today = new Date().toISOString().split('T')[0];

  if (currentRoundsDate === today) {
    display.textContent = 'Today';
  } else {
    display.textContent = dateObj.toLocaleDateString('en-US', {
      weekday: 'short',
      month: 'short',
      day: 'numeric'
    });
  }
}

function changeDate(days) {
  const date = new Date(currentRoundsDate);
  date.setDate(date.getDate() + days);
  currentRoundsDate = date.toISOString().split('T')[0];
  updateDateDisplay();
  loadHourlyRounds();
}

async function loadHourlyRounds() {
  const tbody = document.getElementById('hourlyRoundsTableBody');
  if (!tbody) return;

  tbody.innerHTML = '<tr><td colspan="16" class="no-records" style="padding: 3rem; text-align: center; color: var(--text-muted);">Loading...</td></tr>';

  try {
    const response = await fetchWithAuth(`/api/hr/rounds/daily?date=${currentRoundsDate}`);
    if (response.ok) {
      const json = await response.json();
      if (json.success) {
        renderRoundsTable(json.data);
      } else {
        tbody.innerHTML = `<tr><td colspan="16" class="no-records">Error: ${json.message}</td></tr>`;
      }
    } else {
      tbody.innerHTML = `<tr><td colspan="16" class="no-records">Server Error: ${response.status}</td></tr>`;
    }
  } catch (error) {
    console.error('Error loading rounds:', error);
    tbody.innerHTML = `<tr><td colspan="16" class="no-records">Connection Error</td></tr>`;
  }
}

function renderRoundsTable(records) {
  const tbody = document.getElementById('hourlyRoundsTableBody');
  if (!tbody) return;

  if (!records || records.length === 0) {
    tbody.innerHTML = '<tr><td colspan="16" class="no-records" style="padding: 3rem; text-align: center; color: var(--text-muted);">No check-ins found for this date.</td></tr>';
    return;
  }

  const hourBlocks = [
    '07:00-08:00', '08:00-09:00', '09:00-10:00', '10:00-11:00',
    '11:00-12:00', '12:00-01:00', '01:00-02:00', '02:00-03:00',
    '03:00-04:00', '04:00-05:00', '05:00-06:00', '06:00-07:00'
  ];

  tbody.innerHTML = records.map(record => {
    // Generate cells for each hour block
    const hourCells = hourBlocks.map(block => {
      const isVerified = record.verifiedHours && record.verifiedHours.includes(block);
      const cellClass = isVerified ? 'verified-cell' : 'unverified-cell';
      const icon = isVerified
        ? `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" style="color: var(--accent-primary);"><polyline points="20 6 9 17 4 12"></polyline></svg>`
        : `<div class="verify-dot"></div>`;

      return `
        <td class="${cellClass}" 
            onclick="verifyHour('${record.id}', '${block}', this)"
            style="text-align: center; cursor: pointer; transition: all 0.2s;"
            title="${isVerified ? 'Verified' : 'Click to Verify'}">
            ${icon}
        </td>
      `;
    }).join('');

    return `
      <tr style="border-bottom: 1px solid var(--border-primary);">
        <td style="padding: 12px 16px;">
            <div style="font-weight: 600; color: var(--text-primary);">${record.employeeName}</div>
            <div style="font-size: 11px; color: var(--text-muted);">ID: ${record.employee_id}</div>
        </td>
        <td style="padding: 12px 16px;">
            <div style="font-size: 13px; color: var(--text-secondary);">${record.role}</div>
            <div style="font-size: 11px; color: var(--text-muted);">${record.department}</div>
        </td>
        <td style="padding: 12px 16px;">
            <span class="status-badge status-${record.status}">${record.time_in ? record.time_in.substring(0, 5) : '-'}</span>
        </td>
        ${hourCells}
        <td style="padding: 12px 16px; text-align: center; font-weight: 700; color: var(--accent-primary);">
            ${record.verifiedHours ? record.verifiedHours.length : 0} hrs
        </td>
      </tr>
    `;
  }).join('');

  // Add global window function for inline onclick (if needed, but better to use delegation)
  // For now attaching to window to match inline onclick. Better approach is event delegation.
  window.verifyHour = handleVerifyHour;
}

async function handleVerifyHour(attendanceId, block, cellElement) {
  // Optimistic UI update
  const isCurrentlyVerified = cellElement.classList.contains('verified-cell');

  // Toggle visual state immediately
  if (isCurrentlyVerified) {
    // Assume un-verify logic if we implement toggle (API currently on supports add, but let's assume toggle for UX)
    // Since API logic I wrote does toggle (filter out if exists), this is safe.
    cellElement.classList.remove('verified-cell');
    cellElement.innerHTML = `<div class="verify-dot"></div>`;
  } else {
    cellElement.classList.add('verified-cell');
    cellElement.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" style="color: var(--accent-primary);"><polyline points="20 6 9 17 4 12"></polyline></svg>`;
  }

  try {
    const response = await fetchWithAuth('/api/hr/rounds/verify', {
      method: 'POST',
      body: JSON.stringify({ attendanceId, hourBlock: block })
    });

    if (response.ok) {
      const json = await response.json();
      if (!json.success) {
        // Revert on API failure
        console.error('Verification failed:', json.message);
        loadHourlyRounds(); // Reload to ensure consistent state
      } else {
        // Determine total count column index (last column)
        // We'd update the total count here if we want perfect local state
        loadHourlyRounds(); // Reload to update total count simply
      }
    } else {
      loadHourlyRounds(); // Revert
    }
  } catch (error) {
    console.error('Verify error:', error);
    loadHourlyRounds(); // Revert
  }
}
