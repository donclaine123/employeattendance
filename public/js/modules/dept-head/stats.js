
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

function toNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function getLocalISODate(date = new Date()) {
  const localDate = new Date(date);
  const year = localDate.getFullYear();
  const month = String(localDate.getMonth() + 1).padStart(2, '0');
  const day = String(localDate.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function formatRequestType(type) {
  const normalized = String(type || 'request').replace(/_/g, ' ').trim();
  if (!normalized) return 'Request';
  return normalized.charAt(0).toUpperCase() + normalized.slice(1);
}

function formatActivityTime(value) {
  if (!value) return 'Just now';

  if (value instanceof Date) {
    const hours = value.getHours();
    const minutes = String(value.getMinutes()).padStart(2, '0');
    const period = hours >= 12 ? 'PM' : 'AM';
    const hour12 = hours % 12 || 12;
    return `${String(hour12).padStart(2, '0')}:${minutes} ${period}`;
  }

  if (typeof value === 'string') {
    const trimmed = value.trim();

    if (/^\d{1,2}:\d{2}(:\d{2})?$/.test(trimmed)) {
      return convertTo12Hour(trimmed.length === 5 ? `${trimmed}:00` : trimmed);
    }

    const parsed = new Date(trimmed);
    if (!Number.isNaN(parsed.getTime())) {
      const hours = parsed.getHours();
      const minutes = String(parsed.getMinutes()).padStart(2, '0');
      const period = hours >= 12 ? 'PM' : 'AM';
      const hour12 = hours % 12 || 12;
      const timeString = `${String(hour12).padStart(2, '0')}:${minutes} ${period}`;

      if (getLocalISODate(parsed) === getLocalISODate()) {
        return timeString;
      }

      return `${parsed.toLocaleDateString([], { month: 'short', day: 'numeric' })} ${timeString}`;
    }
  }

  return String(value);
}

function getActivityIndicatorIcon(type = 'primary') {
  if (type === 'warning') {
    return `
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <circle cx="12" cy="12" r="9"></circle>
        <path d="M12 7v5l3 2"></path>
      </svg>
    `;
  }

  return `
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <path d="M4 7h4V3"></path>
      <path d="M20 7h-4V3"></path>
      <path d="M4 17h4v4"></path>
      <path d="M20 17h-4v4"></path>
      <path d="M8 12h8"></path>
    </svg>
  `;
}

function normalizeRecentActivityItem(item) {
  const source = item || {};
  const employeeName = source.employeeName
    || source.employee_name
    || source.name
    || source.employee?.full_name
    || source.employee?.name
    || 'Unknown';
  const rawAction = typeof source.action === 'string' ? source.action.trim() : '';
  const isAttendanceRecord = Boolean(source.time_in || source.attendance_type === 'in_person');
  const fallbackType = isAttendanceRecord
    ? 'Campus scan'
    : formatRequestType(source.type || source.request_type || 'activity');
  const action = rawAction || fallbackType;

  let indicator = source.indicator || '';
  if (!indicator) {
    const actionText = action.toLowerCase();
    if (actionText.includes('late')) {
      indicator = 'warning';
    } else if (actionText.includes('request')) {
      indicator = 'primary';
    } else {
      indicator = 'success';
    }
  }

  return {
    name: employeeName,
    action,
    time: source.createdAt || source.created_at || source.time || source.updatedAt || source.updated_at || null,
    indicator,
  };
}

function normalizeRecentActivities(payload) {
  const rawItems = Array.isArray(payload)
    ? payload
    : Array.isArray(payload && payload.activities)
      ? payload.activities
      : Array.isArray(payload && payload.data)
        ? payload.data
        : Array.isArray(payload && payload.requests)
          ? payload.requests
          : [];

  return rawItems.map(normalizeRecentActivityItem);
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
    // Set hero date
    const heroDate = document.getElementById('heroDate');
    if (heroDate) {
      const options = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' };
      const dateStr = new Date().toLocaleDateString('en-US', options);
      heroDate.textContent = dateStr;
    }

    // Set user name greeting
    const userNameHero = document.getElementById('userNameHero');
    if (userNameHero && window.AuthGuard && window.AuthGuard.getCurrentUser) {
      const user = window.AuthGuard.getCurrentUser();
      const firstName = user?.full_name?.split(' ')[0] || 'Department Head';
      const hour = new Date().getHours();
      const greeting = hour < 12 ? 'Good Morning' : hour < 18 ? 'Good Afternoon' : 'Good Evening';
      userNameHero.textContent = `${greeting}, ${firstName}`;
    }

    const apiBase = window.API_URL || window.__MOCK_API_BASE__ || '/api';

    const response = await window.fetchWithAuth(`${apiBase}/departmenthead/dashboard`, {});
    if (!response.ok) {
      console.warn('[loadDashboardStats] Response not ok:', response.status);
      return;
    }

    const stats = await response.json();
    console.log('[loadDashboardStats] Received stats:', stats);

    const teamSize = toNumber(stats.teamSize);
    const campusPresent = toNumber(stats.campusPresent ?? stats.totalPresent);
    const hourlyLate = toNumber(stats.hourlyLate ?? stats.totalLate);
    const hourlyAbsent = toNumber(stats.hourlyAbsent ?? stats.totalAbsent);

    // Update stat cards with dynamic values
    const statCampusPresent = document.getElementById('statTotalPresent');
    const statHourlyLate = document.getElementById('statHourlyLate');
    const statHourlyAbsent = document.getElementById('statHourlyAbsent');
    const statTeamSizeElements = document.querySelectorAll('[id="statTeamSize"]');

    const statCampusPresentChange = document.getElementById('statTotalPresentChange');
    const statHourlyLateChange = document.getElementById('statHourlyLateChange');
    const statHourlyAbsentChange = document.getElementById('statHourlyAbsentChange');
    const statTeamSizeChangeElements = document.querySelectorAll('[id="statTeamSizeChange"]');

    if (statCampusPresent) statCampusPresent.textContent = campusPresent;
    if (statHourlyLate) statHourlyLate.textContent = hourlyLate;
    if (statHourlyAbsent) statHourlyAbsent.textContent = hourlyAbsent;
    
    // Update all Team Size value elements (desktop and mobile)
    statTeamSizeElements.forEach(el => {
      el.textContent = teamSize;
    });

    if (statCampusPresentChange) statCampusPresentChange.textContent = 'Today\'s record';
    if (statHourlyLateChange) statHourlyLateChange.textContent = 'According to hourly rounds';
    if (statHourlyAbsentChange) statHourlyAbsentChange.textContent = 'According to hourly rounds';
    
    // Update all Team Size label elements (desktop and mobile)
    statTeamSizeChangeElements.forEach(el => {
      el.textContent = 'Active employees';
    });

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

    if (teamStatPresent) teamStatPresent.textContent = toNumber(data.campusPresent ?? data.totalPresent);
    if (teamStatLate) teamStatLate.textContent = toNumber(data.hourlyLate ?? data.totalLate);
    if (teamStatAbsent) teamStatAbsent.textContent = toNumber(data.hourlyAbsent ?? data.totalAbsent);

    console.log('[loadTeamAttendanceStats] Updated team stats:', {
      campusPresent: data.campusPresent ?? data.totalPresent,
      hourlyLate: data.hourlyLate ?? data.totalLate,
      hourlyAbsent: data.hourlyAbsent ?? data.totalAbsent
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
  const activities = normalizeRecentActivities(data);
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
      activityList.innerHTML = `
        <div class="activity-empty-state">
          <div class="activity-empty-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M4 7h4V3"></path>
              <path d="M20 7h-4V3"></path>
              <path d="M4 17h4v4"></path>
              <path d="M20 17h-4v4"></path>
              <path d="M8 12h8"></path>
            </svg>
          </div>
          <div class="activity-empty-copy">
            <p class="activity-empty-title">No recent scan attendance yet</p>
            <p class="activity-empty-text">Scan records will appear here as employees check in.</p>
          </div>
        </div>
      `;
      return;
    }

    // Render each activity
    activities.forEach(activity => {
      const activityItem = document.createElement('div');
      const indicatorType = activity.indicator || 'primary';
      activityItem.className = `activity-item activity-item--${indicatorType}`;

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
      timeSpan.textContent = formatActivityTime(activity.time);

      activityItem.appendChild(details);
      activityItem.appendChild(timeSpan);

      activityList.appendChild(activityItem);
    });

  } catch (error) {
    console.error('[loadRecentActivity] Error:', error);
  }
}
