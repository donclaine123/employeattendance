
import { convertTo12Hour } from './utils.js';

// Helper to calculate totals from the rendered table
function computeTotals() {
  const table = document.querySelector('.wide-card .attendance-table') || document.querySelector('.attendance-table');
  const result = { present: 0, late: 0, absent: 0 };
  if (!table) return result;
  const tbody = table.querySelector('tbody');
  if (!tbody) return result;

  const rows = Array.from(tbody.querySelectorAll('tr'));
  for (const r of rows) {
    // skip possible empty-state rows
    if (r.id === 'attendance-empty-row') continue;
    const cells = r.querySelectorAll('td');
    // expect status in last column
    const statusCell = cells[cells.length - 1];
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

function textOfStatusCell(cell) {
  if (!cell) return '';
  const span = cell.querySelector('span');
  return (span ? span.textContent : cell.textContent || '').trim();
}

export function updateChips() {
  const chips = document.querySelectorAll('.stat-chips .stat-chip');
  if (!chips || chips.length < 3) return;
  const totals = computeTotals();
  try {
    const presentEl = chips[0].querySelector('.num');
    const lateEl = chips[1].querySelector('.num');
    const absentEl = chips[2].querySelector('.num');
    if (presentEl) presentEl.textContent = String(totals.present);
    if (lateEl) lateEl.textContent = String(totals.late);
    if (absentEl) absentEl.textContent = String(totals.absent);
  } catch (e) { console.warn('updateChips failed', e); }
}

// Load dashboard stats (present, late, absent, team size) from API
export async function loadDashboardStats() {
  try {
    const apiBase = window.API_URL || window.__MOCK_API_BASE__ || '/api';

    const response = await window.fetchWithAuth(`${apiBase}/departmenthead/dashboard`, {});
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

// Load Team Attendance Stats (Present/Late/Absent) for the Attendance Tab
export async function loadTeamAttendanceStats() {
  try {
    const apiBase = window.API_URL || window.__MOCK_API_BASE__ || '/api';
    const response = await window.fetchWithAuth(`${apiBase}/departmenthead/dashboard`, {}); // Reusing dashboard endpoint
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

// Load recent activity feed
export async function loadRecentActivity() {
  try {
    const apiBase = window.API_URL || window.__MOCK_API_BASE__ || '/api';

    const response = await window.fetchWithAuth(`${apiBase}/departmenthead/recent-activity`, {});
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
