/**
 * Department Head Analytics Module
 * Focused dashboard with 4 sections:
 * 1. Today's Glance (4 stat cards)
 * 2. Weekly Comparison (This week vs Last week)
 * 3. Weekly Trend Chart (Combo: bars + line)
 * 4. At-Risk Employees (intervention list)
 */

import { fetchHeadInfo, escapeHtml } from './utils.js';

let departmentId = null;

/**
 * Initialize analytics with department info
 */
export async function initializeAnalytics() {
  try {
    const headInfo = await fetchHeadInfo();
    if (!headInfo) {
      console.warn('[Analytics] Could not fetch head info');
      return;
    }
    departmentId = headInfo.dept_id;
    await loadAllAnalytics();
  } catch (error) {
    console.error('[Analytics] Initialization error:', error);
  }
}

/**
 * Load all analytics sections
 */
async function loadAllAnalytics() {
  try {
    showLoadingState(true);
    
    // Fetch core data in parallel
    const [todayData, employees] = await Promise.all([
      fetchTodayAttendance(),
      fetchDepartmentEmployees()
    ]);

    // Render today's glance
    if (todayData) {
      renderTodayGlance(todayData);
    }

    // Fetch attendance records for analytics
    if (employees && employees.length > 0) {
      const attendanceRecords = await fetchAttendanceRecords(employees);
      
      // Render weekly comparison
      const comparisonData = calculateWeeklyComparison(attendanceRecords);
      renderWeeklyComparison(comparisonData);
      
      // Render weekly trend chart
      const trendData = calculateWeeklyTrend(attendanceRecords);
      renderTrendChart(trendData);
      
      // Render at-risk employees
      const atRiskEmployees = calculateAtRiskEmployees(employees, attendanceRecords);
      renderAtRiskEmployees(atRiskEmployees);
    }

    showLoadingState(false);
  } catch (error) {
    console.error('[Analytics] Error loading analytics:', error);
    showLoadingState(false);
  }
}

/**
 * Fetch today's attendance summary
 */
async function fetchTodayAttendance() {
  try {
    const apiBase = window.API_URL || '/api';
    const today = new Date().toISOString().split('T')[0];
    
    const response = await window.fetchWithAuth(
      `${apiBase}/departmenthead/dashboard?departmentId=${departmentId}&date=${today}`
    );
    
    if (!response.ok) {
      console.warn('[Analytics] Dashboard API error:', response.status);
      return null;
    }

    return await response.json();
  } catch (error) {
    console.error('[Analytics] Error fetching today attendance:', error);
    return null;
  }
}

/**
 * Fetch all department employees
 */
async function fetchDepartmentEmployees() {
  try {
    const apiBase = window.API_URL || '/api';
    
    const response = await window.fetchWithAuth(
      `${apiBase}/departmenthead/employees?departmentId=${departmentId}&_limit=999`
    );
    
    if (!response.ok) {
      console.warn('[Analytics] Employees API error:', response.status);
      return [];
    }

    const data = await response.json();
    return data.data || [];
  } catch (error) {
    console.error('[Analytics] Error fetching employees:', error);
    return [];
  }
}

/**
 * Fetch attendance records for analysis
 */
async function fetchAttendanceRecords(employees) {
  try {
    const apiBase = window.API_URL || '/api';
    
    const response = await window.fetchWithAuth(
      `${apiBase}/attendance?departmentId=${departmentId}&_limit=999`
    );
    
    if (!response.ok) {
      console.warn('[Analytics] Attendance API error:', response.status);
      return [];
    }

    const data = await response.json();
    const records = data.data || (Array.isArray(data) ? data : []);
    
    console.log('[Analytics] Fetched', records.length, 'attendance records');
    return records;
  } catch (error) {
    console.error('[Analytics] Error fetching attendance records:', error);
    return [];
  }
}

/**
 * Section 1: Render today's glance (4 stat cards)
 */
function renderTodayGlance(data) {
  const container = document.getElementById('todayGlanceContainer');
  if (!container) return;

  const teamSize = data.teamSize || 0;
  const present = data.totalPresent || 0;
  const late = data.totalLate || 0;
  const absent = data.totalAbsent || 0;
  const leave = 0;

  const presentPct = teamSize > 0 ? Math.round((present / teamSize) * 100) : 0;
  const latePct = teamSize > 0 ? Math.round((late / teamSize) * 100) : 0;
  const absentPct = teamSize > 0 ? Math.round((absent / teamSize) * 100) : 0;

  container.innerHTML = `
    <div class="stat-card">
      <div class="stat-content">
        <div class="stat-info">
          <p class="stat-label">Present</p>
          <p class="stat-value">${present}/${teamSize}</p>
          <p class="stat-percentage">${presentPct}%</p>
        </div>
        <div class="stat-icon success">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
            <polyline points="22 4 12 14.01 9 11.01" />
          </svg>
        </div>
      </div>
    </div>

    <div class="stat-card">
      <div class="stat-content">
        <div class="stat-info">
          <p class="stat-label">Late</p>
          <p class="stat-value">${late}</p>
          <p class="stat-percentage">${latePct}%</p>
        </div>
        <div class="stat-icon warning">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="12" cy="12" r="10" />
            <polyline points="12 6 12 12 16 14" />
          </svg>
        </div>
      </div>
    </div>

    <div class="stat-card">
      <div class="stat-content">
        <div class="stat-info">
          <p class="stat-label">Absent</p>
          <p class="stat-value">${absent}</p>
          <p class="stat-percentage">${absentPct}%</p>
        </div>
        <div class="stat-icon danger">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="8" x2="12" y2="12" />
            <line x1="12" y1="16" x2="12.01" y2="16" />
          </svg>
        </div>
      </div>
    </div>

    <div class="stat-card">
      <div class="stat-content">
        <div class="stat-info">
          <p class="stat-label">On Leave</p>
          <p class="stat-value">${leave}</p>
          <p class="stat-percentage">0%</p>
        </div>
        <div class="stat-icon primary">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
            <circle cx="12" cy="7" r="4" />
          </svg>
        </div>
      </div>
    </div>
  `;
}

/**
 * Section 2: Calculate weekly comparison (this week vs last week)
 */
function calculateWeeklyComparison(attendanceRecords) {
  const today = new Date();
  
  // Current week (Mon-Fri)
  let currentWeekRecords = [];
  let lastWeekRecords = [];
  
  for (let i = 0; i < 35; i++) {
    const date = new Date(today);
    date.setDate(date.getDate() - i);
    const dayOfWeek = date.getDay();
    
    // Skip weekends
    if (dayOfWeek === 0 || dayOfWeek === 6) continue;
    
    const dateStr = date.toISOString().split('T')[0];
    const records = attendanceRecords.filter(r => {
      const recordDate = typeof r.date === 'string' ? r.date.split('T')[0] : r.date;
      return recordDate === dateStr;
    });
    
    // This week: last 5 workdays
    if (i < 5) {
      currentWeekRecords.push(...records);
    }
    // Last week: workdays 5-10 back
    else if (i >= 5 && i < 10) {
      lastWeekRecords.push(...records);
    }
  }

  const currentRate = currentWeekRecords.length > 0 
    ? Math.round((currentWeekRecords.filter(r => (r.status || '').toLowerCase() === 'present').length / currentWeekRecords.length) * 100)
    : 0;
  
  const lastWeekRate = lastWeekRecords.length > 0
    ? Math.round((lastWeekRecords.filter(r => (r.status || '').toLowerCase() === 'present').length / lastWeekRecords.length) * 100)
    : 0;
  
  const change = currentRate - lastWeekRate;
  const changeDir = change > 0 ? '↑' : (change < 0 ? '↓' : '→');
  const changeClass = change > 0 ? 'positive' : (change < 0 ? 'negative' : 'neutral');

  return {
    currentRate,
    lastWeekRate,
    change,
    changeDir,
    changeClass
  };
}

/**
 * Section 2: Render weekly comparison cards
 */
function renderWeeklyComparison(data) {
  const container = document.getElementById('weeklyComparisonContainer');
  if (!container) return;

  container.innerHTML = `
    <div class="stat-card">
      <div class="stat-content">
        <div class="stat-info">
          <p class="stat-label">This Week Attendance</p>
          <p class="stat-value">${data.currentRate}%</p>
          <p class="stat-period">Mon-Fri average</p>
        </div>
        <div class="stat-icon primary">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polyline points="23 6 13.5 15.5 8.5 10.5 1 18" />
            <polyline points="17 6 23 6 23 12" />
          </svg>
        </div>
      </div>
    </div>

    <div class="stat-card">
      <div class="stat-content">
        <div class="stat-info">
          <p class="stat-label">Last Week vs This Week</p>
          <p class="stat-value ${data.changeClass}">${data.changeDir} ${Math.abs(data.change)}%</p>
          <p class="stat-period">Last week: ${data.lastWeekRate}%</p>
        </div>
        <div class="stat-icon ${data.changeClass}">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polyline points="23 6 13.5 15.5 8.5 10.5 1 18" />
            <polyline points="17 6 23 6 23 12" />
          </svg>
        </div>
      </div>
    </div>
  `;
}

/**
 * Section 3: Calculate weekly trend (combo: bars + line)
 */
function calculateWeeklyTrend(attendanceRecords) {
  const today = new Date();
  const weekData = [];

  let daysAdded = 0;
  for (let i = 0; i < 7 && daysAdded < 5; i++) {
    const date = new Date(today);
    date.setDate(date.getDate() - i);
    
    const dayOfWeek = date.getDay();
    if (dayOfWeek === 0 || dayOfWeek === 6) continue;

    daysAdded++;
    const dateStr = date.toISOString().split('T')[0];
    const dayName = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][dayOfWeek];
    
    const records = attendanceRecords.filter(r => {
      const recordDate = typeof r.date === 'string' ? r.date.split('T')[0] : r.date;
      return recordDate === dateStr;
    });

    const present = records.filter(r => (r.status || '').toLowerCase() === 'present').length;
    const late = records.filter(r => (r.status || '').toLowerCase() === 'late').length;
    const absent = records.filter(r => (r.status || '').toLowerCase() === 'absent').length;
    const total = present + late + absent;
    const attendanceRate = total > 0 ? Math.round((present / total) * 100) : 0;

    weekData.push({
      date: dateStr,
      day: dayName,
      present,
      late,
      absent,
      total,
      attendanceRate
    });
  }

  return weekData.reverse();
}

/**
 * Section 3: Render combo chart (stacked bars + trend line)
 */
function renderTrendChart(weekData) {
  const container = document.getElementById('trendChartContent');
  if (!container) return;

  if (weekData.length === 0) {
    container.innerHTML = '<p style="text-align: center; color: var(--text-secondary); padding: 40px;">No data available</p>';
    return;
  }

  let html = '<div class="trend-chart">';
  
  for (const day of weekData) {
    const total = day.total || 1;
    const presentWidth = (day.present / total) * 100;
    const lateWidth = (day.late / total) * 100;
    const absentWidth = (day.absent / total) * 100;

    html += `
      <div class="trend-row">
        <span class="trend-day">${day.day}</span>
        <div class="trend-bars">
          <div class="trend-bar success" style="width: ${presentWidth}%" title="Present: ${day.present}"></div>
          <div class="trend-bar warning" style="width: ${lateWidth}%" title="Late: ${day.late}"></div>
          <div class="trend-bar danger" style="width: ${absentWidth}%" title="Absent: ${day.absent}"></div>
        </div>
        <div class="trend-values">
          <span class="value-success">${day.present}</span>
          <span class="value-warning">${day.late}</span>
          <span class="value-danger">${day.absent}</span>
        </div>
        <div class="trend-line" style="font-weight: 600; color: var(--accent-primary);">${day.attendanceRate}%</div>
      </div>
    `;
  }

  html += `
    </div>
    <div class="chart-legend">
      <div class="legend-item">
        <div class="legend-color success"></div>
        <span>Present</span>
      </div>
      <div class="legend-item">
        <div class="legend-color warning"></div>
        <span>Late</span>
      </div>
      <div class="legend-item">
        <div class="legend-color danger"></div>
        <span>Absent</span>
      </div>
      <div class="legend-item">
        <div class="legend-color primary"></div>
        <span>Attendance %</span>
      </div>
    </div>
  `;

  container.innerHTML = html;
}

/**
 * Section 4: Calculate at-risk employees
 */
function calculateAtRiskEmployees(employees, attendanceRecords) {
  const riskScores = {};

  for (const emp of employees) {
    const empId = emp.employee_id || emp.id;
    const empRecords = attendanceRecords.filter(r => r.employee_id === empId);
    
    if (empRecords.length === 0) continue;

    const late = empRecords.filter(r => (r.status || '').toLowerCase() === 'late').length;
    const absent = empRecords.filter(r => (r.status || '').toLowerCase() === 'absent').length;
    const total = empRecords.length;
    const attendanceRate = Math.round(((total - late - absent) / total) * 100);

    // Calculate risk score
    const riskScore = (late * 2 + absent * 3) / total;

    if (riskScore > 0.5 || absent > 2) {
      riskScores[empId] = {
        employee_id: empId,
        name: emp.full_name || emp.name || 'Unknown',
        late,
        absent,
        attendanceRate,
        risk: riskScore,
        riskLevel: absent > 2 ? 'high' : 'medium'
      };
    }
  }

  return Object.values(riskScores)
    .sort((a, b) => b.risk - a.risk)
    .slice(0, 10);
}

/**
 * Section 4: Render at-risk employees list
 */
function renderAtRiskEmployees(employees) {
  const container = document.getElementById('atRiskList');
  if (!container) return;

  if (!employees || employees.length === 0) {
    container.innerHTML = '<p style="padding: 24px; text-align: center; color: var(--text-secondary);">✓ No at-risk employees detected. Great work!</p>';
    return;
  }

  let html = '<div class="attention-list">';
  
  for (const emp of employees) {
    const severity = emp.riskLevel === 'high' ? 'high' : 'medium';
    
    html += `
      <div class="attention-item">
        <div>
          <p class="attention-name">${escapeHtml(emp.name)}</p>
          <p class="attention-issue">${emp.late} late, ${emp.absent} absent • ${emp.attendanceRate}% attendance</p>
        </div>
        <span class="severity-badge ${severity}">${emp.riskLevel}</span>
      </div>
    `;
  }

  html += '</div>';
  container.innerHTML = html;
}

/**
 * Show/hide loading state
 */
function showLoadingState(show) {
  const loading = document.getElementById('analytics-loading');
  if (!loading) return;
  loading.style.display = show ? 'block' : 'none';
}

/**
 * Setup export button (placeholder for future functionality)
 */
export function setupExportButton() {
  const exportBtn = document.getElementById('exportAnalyticsBtn');
  if (!exportBtn) return;

  exportBtn.addEventListener('click', () => {
    // TODO: Implement export functionality
    alert('Export functionality coming soon!');
  });
}
