/**
 * Department Head Analytics Module
 * Optimized with Session Cache & ApexCharts
 */

import { fetchHeadInfo, escapeHtml } from './utils.js';

let departmentId = null;
let analyticsCache = null; // In-memory cache
const CACHE_DURATION = 5 * 60 * 1000; // 5 minutes
let currentTrendView = 7; // Default 7 days

/**
 * Modal Logic
 */
function setupModalHandlers() {
  // Attach to window so it can be called from HTML onclick
  window.openPerformanceModal = function (id, name, late, absent, rate) {
    const modal = document.getElementById('performance-modal');
    if (!modal) return;

    // Populate Data
    const nameEl = document.getElementById('modal-employee-name');
    if (nameEl) nameEl.textContent = name;

    const absentEl = document.getElementById('summary-absences');
    if (absentEl) absentEl.textContent = absent;

    const lateEl = document.getElementById('summary-lates');
    if (lateEl) lateEl.textContent = late;

    // Tiny logic for 'undertime' (placeholder for now as logic doesn't exist yet)
    const undertimeEl = document.getElementById('summary-undertime');
    if (undertimeEl) undertimeEl.textContent = '-';

    // Show
    modal.style.display = 'flex';

    // Render Mini Chart (Future work)
    const chartContainer = document.getElementById('performance-chart-container');
    if (chartContainer) chartContainer.innerHTML = '<p style="color:var(--text-secondary); text-align:center; padding: 20px;">Detailed activity log coming soon.</p>';
  };

  // Close Logic
  const closeBtn = document.getElementById('modal-close-btn');
  const modal = document.getElementById('performance-modal');

  if (closeBtn && modal) {
    closeBtn.onclick = () => { modal.style.display = 'none'; };

    // Close on outside click
    window.onclick = (event) => {
      if (event.target === modal) {
        modal.style.display = 'none';
      }
    };
  }
}

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
    setupExportButton();
    setupModalHandlers();
    setupTrendNavigation();
    await loadAllAnalytics();
  } catch (error) {
    console.error('[Analytics] Initialization error:', error);
  }
}

/**
 * Load all analytics sections with caching
 */
async function loadAllAnalytics() {
  try {
    showLoadingState(true);

    // Check Cache
    const cachedData = getCachedAnalytics();
    if (cachedData) {
      console.log('[Analytics] Using cached data');
      renderAll(cachedData);
      showLoadingState(false);
      return;
    }

    // Fetch core data in parallel
    const [todayData, employees] = await Promise.all([
      fetchTodayAttendance(),
      fetchDepartmentEmployees()
    ]);

    // Render today's glance immediately
    if (todayData) {
      renderTodayGlance(todayData);
    }

    // Fetch attendance records for analytics
    if (employees && employees.length > 0) {
      const attendanceRecords = await fetchAttendanceRecords(employees);

      // Calculate derived data
      const comparisonData = calculateWeeklyComparison(attendanceRecords);
      // Trend Data is calculated dynamically now, but we pre-calc for initial load
      const trendData = calculateTrend(attendanceRecords, currentTrendView);
      const atRiskEmployees = calculateAtRiskEmployees(employees, attendanceRecords);

      const fullData = {
        todayData,
        employees,
        attendanceRecords,
        comparisonData,
        trendData,
        atRiskEmployees,
        timestamp: Date.now()
      };

      // Cache & Render
      setCachedAnalytics(fullData);
      renderAll(fullData);
    }

    showLoadingState(false);
  } catch (error) {
    console.error('[Analytics] Error loading analytics:', error);
    showLoadingState(false);
  }
}

function renderAll(data) {
  if (data.todayData) renderTodayGlance(data.todayData);
  if (data.comparisonData) renderWeeklyComparison(data.comparisonData);
  // Re-calc trend based on current view if records exist
  if (data.attendanceRecords) {
    const trendData = calculateTrend(data.attendanceRecords, currentTrendView);
    renderTrendChart(trendData);
  } else if (data.trendData) {
    renderTrendChart(data.trendData);
  }
  if (data.todayData) renderBreakdownChart(data.todayData);
  if (data.atRiskEmployees) renderAtRiskEmployees(data.atRiskEmployees);
}

// --- Caching Logic ---
function getCachedAnalytics() {
  try {
    const raw = sessionStorage.getItem(`dept_analytics_${departmentId}`);
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (Date.now() - data.timestamp > CACHE_DURATION) return null;
    return data;
  } catch (e) {
    return null;
  }
}

function setCachedAnalytics(data) {
  try {
    sessionStorage.setItem(`dept_analytics_${departmentId}`, JSON.stringify(data));
  } catch (e) {
    console.warn('Session storage full, cannot cache analytics');
  }
}

/**
 * Fetch today's attendance summary
 */
// --- Helper: Get Local ISO Date (YYYY-MM-DD) ---
function getLocalISODate(d = new Date()) {
  const offset = d.getTimezoneOffset() * 60000;
  return new Date(d.getTime() - offset).toISOString().split('T')[0];
}

/**
 * Fetch today's attendance summary
 */
async function fetchTodayAttendance() {
  try {
    const apiBase = window.API_URL || '/api';
    const today = getLocalISODate();

    const response = await window.fetchWithAuth(
      `${apiBase}/departmenthead/dashboard?departmentId=${departmentId}&date=${today}`
    );

    if (!response.ok) return null;
    return await response.json();
  } catch (error) {
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
    if (!response.ok) return [];
    const data = await response.json();
    return data.data || [];
  } catch (error) {
    return [];
  }
}

/**
 * Fetch attendance records (Optimized Limit to 5000)
 */
async function fetchAttendanceRecords(employees) {
  try {
    const apiBase = window.API_URL || '/api';
    // Increased limit to 5000 to handle larger datasets
    const response = await window.fetchWithAuth(
      `${apiBase}/attendance?departmentId=${departmentId}&_limit=5000&_sort=date:desc`
    );

    if (!response.ok) return [];
    const data = await response.json();
    return data.data || (Array.isArray(data) ? data : []);
  } catch (error) {
    console.error('[Analytics] Error fetching records:', error);
    return [];
  }
}

/**
 * Render today's glance (4 stat cards)
 */
function renderTodayGlance(data) {
  const container = document.getElementById('todayGlanceContainer');
  if (!container) return;

  const teamSize = data.teamSize || 0;
  const present = data.totalPresent || 0;
  const late = data.totalLate || 0;
  const absent = data.totalAbsent || 0;
  const leave = 0; // TODO: Fetch leave data

  const getPct = (val) => teamSize > 0 ? Math.round((val / teamSize) * 100) : 0;

  container.innerHTML = `
    <div class="stat-card">
      <div class="stat-content">
        <div class="stat-info">
          <p class="stat-label">Present</p>
          <p class="stat-value">${present}/${teamSize}</p>
          <p class="stat-percentage">${getPct(present)}%</p>
        </div>
        <div class="stat-icon success">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" /><polyline points="22 4 12 14.01 9 11.01" /></svg>
        </div>
      </div>
    </div>
    <div class="stat-card">
      <div class="stat-content">
        <div class="stat-info">
          <p class="stat-label">Late</p>
          <p class="stat-value">${late}</p>
          <p class="stat-percentage">${getPct(late)}%</p>
        </div>
        <div class="stat-icon warning">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" /></svg>
        </div>
      </div>
    </div>
    <div class="stat-card">
      <div class="stat-content">
        <div class="stat-info">
          <p class="stat-label">Absent</p>
          <p class="stat-value">${absent}</p>
          <p class="stat-percentage">${getPct(absent)}%</p>
        </div>
        <div class="stat-icon danger">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" /></svg>
        </div>
      </div>
    </div>
  `;
}

/**
 * Calculate weekly comparison
 */
function calculateWeeklyComparison(attendanceRecords) {
  const today = getLocalISODate();

  // Create a quick lookup map for records
  const recordsByDate = {};
  attendanceRecords.forEach(r => {
    const d = r.date.split('T')[0];
    if (!recordsByDate[d]) recordsByDate[d] = [];
    recordsByDate[d].push(r);
  });

  // Get last 10 workdays (excluding weekends)
  const workDays = [];
  let d = new Date();
  let count = 0;

  // Go back 20 days to find 10 workdays
  for (let i = 0; i < 20 && count < 10; i++) {
    const dateStr = getLocalISODate(d);
    const dayNum = d.getDay();

    // If workday (Mon=1 to Fri=5)
    if (dayNum !== 0 && dayNum !== 6) {
      workDays.push(dateStr);
      count++;
    }
    d.setDate(d.getDate() - 1);
  }

  const thisWeek = workDays.slice(0, 5); // Recent 5
  const lastWeek = workDays.slice(5, 10); // Previous 5

  const calcRate = (dates) => {
    let presentCount = 0;
    let recordCount = 0;
    dates.forEach(date => {
      const dayRecs = recordsByDate[date] || [];
      recordCount += dayRecs.length;
      presentCount += dayRecs.filter(r => (r.status || '').toLowerCase() === 'present').length;
    });

    return recordCount > 0 ? Math.round((presentCount / recordCount) * 100) : 0;
  };

  const currentRate = calcRate(thisWeek);
  const lastWeekRate = calcRate(lastWeek);
  const change = currentRate - lastWeekRate;
  const changeDir = change > 0 ? '↑' : (change < 0 ? '↓' : '→');
  const changeClass = change > 0 ? 'positive' : (change < 0 ? 'negative' : 'neutral');

  return { currentRate, lastWeekRate, change, changeDir, changeClass };
}

function renderWeeklyComparison(data) {
  const container = document.getElementById('weeklyComparisonContainer');
  if (!container) return;

  container.innerHTML = `
    <div class="stat-card">
      <div class="stat-content">
        <div class="stat-info">
          <p class="stat-label">This Week Attendance</p>
          <p class="stat-value">${data.currentRate}%</p>
          <p class="stat-period">Recent 5 workdays</p>
        </div>
        <div class="stat-icon primary">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="23 6 13.5 15.5 8.5 10.5 1 18" /><polyline points="17 6 23 6 23 12" /></svg>
        </div>
      </div>
    </div>
    <div class="stat-card">
      <div class="stat-content">
        <div class="stat-info">
          <p class="stat-label">vs Last Week</p>
          <p class="stat-value ${data.changeClass}">${data.changeDir} ${Math.abs(data.change)}%</p>
          <p class="stat-period">Prev: ${data.lastWeekRate}%</p>
        </div>
        <div class="stat-icon ${data.changeClass}">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="23 6 13.5 15.5 8.5 10.5 1 18" /><polyline points="17 6 23 6 23 12" /></svg>
        </div>
      </div>
    </div>
  `;
}

/**
 * Calculate weekly trend Data for ApexCharts
 */
/**
 * Calculate trend Data for ApexCharts (Generic)
 */
function calculateTrend(attendanceRecords, days = 7) {
  // Pre-process records into Map for O(1) lookup
  const recordsMap = new Map();
  attendanceRecords.forEach(r => {
    const d = r.date.split('T')[0]; // ISO Date Key
    if (!recordsMap.has(d)) recordsMap.set(d, []);
    recordsMap.get(d).push(r);
  });

  const chartData = [];
  const today = new Date();

  // Loop backwards from today
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    const dateStr = getLocalISODate(d); // Matches Dictionary Key

    // Formatter: "Mon" (Weekly) or "DD" (Monthly)
    const dayLabel = days > 10 ? d.getDate().toString() : d.toLocaleDateString('en-US', { weekday: 'short' });

    // O(1) Lookup
    const recs = recordsMap.get(dateStr) || [];

    const present = recs.filter(r => (r.status || '').toLowerCase() === 'present').length;
    const late = recs.filter(r => (r.status || '').toLowerCase() === 'late').length;
    const absent = recs.filter(r => (r.status || '').toLowerCase() === 'absent').length;

    chartData.push({
      x: dayLabel,
      yPresent: present,
      yLate: late,
      yAbsent: absent
    });
  }
  return chartData;
}

/**
 * Render ApexChart with Theme Sync and Timezone fix
 */
let trendChartInstance = null;
let themeObserver = null;

function renderTrendChart(chartData) {
  const container = document.getElementById('trendChartContent');
  if (!container) return;

  // Clear previous HTML content
  container.innerHTML = '';

  // Destroy previous instance if exists
  if (trendChartInstance) {
    trendChartInstance.destroy();
  }

  // Cleanup old observer
  if (themeObserver) {
    themeObserver.disconnect();
  }

  const getThemeMode = () => document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark';

  const options = {
    series: [
      { name: 'Present', data: chartData.map(d => d.yPresent) },
      { name: 'Late', data: chartData.map(d => d.yLate) },
      { name: 'Absent', data: chartData.map(d => d.yAbsent) }
    ],
    chart: {
      type: 'bar',
      height: 300,
      stacked: true,
      toolbar: { show: false },
      fontFamily: 'inherit',
      background: 'transparent',
      animations: { enabled: true }
    },
    colors: ['#22c55e', '#eab308', '#ef4444'], // Green, Yellow, Red
    plotOptions: {
      bar: {
        borderRadius: 4,
        columnWidth: '40%',
      }
    },
    dataLabels: { enabled: false },
    stroke: { width: 0 },
    grid: {
      borderColor: getThemeMode() === 'light' ? 'rgba(0,0,0,0.1)' : 'rgba(255,255,255,0.05)',
      strokeDashArray: 4,
    },
    xaxis: {
      categories: chartData.map(d => d.x),
      labels: { style: { colors: 'var(--text-secondary)' } },
      axisBorder: { show: false },
      axisTicks: { show: false }
    },
    yaxis: {
      labels: { style: { colors: 'var(--text-secondary)' } }
    },
    legend: {
      position: 'top',
      horizontalAlign: 'right',
      labels: { colors: 'var(--text-secondary)' }
    },
    theme: { mode: getThemeMode() },
    tooltip: {
      theme: getThemeMode(),
      y: { formatter: (val) => Math.round(val) }
    }
  };

  trendChartInstance = new ApexCharts(container, options);
  trendChartInstance.render();

  // Watch for theme changes
  themeObserver = new MutationObserver((mutations) => {
    mutations.forEach((mutation) => {
      if (mutation.attributeName === 'data-theme') {
        const newMode = getThemeMode();
        trendChartInstance.updateOptions({
          theme: { mode: newMode },
          tooltip: { theme: newMode },
          grid: {
            borderColor: newMode === 'light' ? 'rgba(0,0,0,0.1)' : 'rgba(255,255,255,0.05)'
          }
        });
      }
    });
  });

  themeObserver.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['data-theme']
  });
  themeObserver.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['data-theme']
  });
}

/**
 * Render Today's Status Breakdown (Donut Chart)
 */
let breakdownChartInstance = null;

function renderBreakdownChart(data) {
  const container = document.getElementById('breakdownChartContent');
  if (!container) return;

  const present = data.totalPresent || 0;
  const late = data.totalLate || 0;
  const absent = data.totalAbsent || 0;

  if (present === 0 && late === 0 && absent === 0) {
    container.innerHTML = '<p style="color:var(--text-secondary); font-size: 0.9rem;">No data for today</p>';
    return;
  }

  // Clear previous
  container.innerHTML = '';
  if (breakdownChartInstance) breakdownChartInstance.destroy();

  const getThemeMode = () => document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark';

  const options = {
    series: [present, late, absent],
    labels: ['Present', 'Late', 'Absent'],
    chart: {
      type: 'donut',
      height: 320,
      fontFamily: 'inherit',
      background: 'transparent'
    },
    colors: ['#22c55e', '#eab308', '#ef4444'],
    plotOptions: {
      pie: {
        donut: {
          size: '70%',
          labels: {
            show: true,
            total: {
              show: true,
              label: 'Total',
              color: 'var(--text-primary)',
              formatter: function (w) {
                return w.globals.seriesTotals.reduce((a, b) => a + b, 0);
              }
            }
          }
        }
      }
    },
    dataLabels: { enabled: false },
    stroke: { show: false },
    legend: {
      position: 'bottom',
      labels: { colors: 'var(--text-secondary)' }
    },
    theme: { mode: getThemeMode() },
    tooltip: { theme: getThemeMode() }
  };

  breakdownChartInstance = new ApexCharts(container, options);
  breakdownChartInstance.render();
}

/**
 * Optimized "At-Risk" Calculation (O(N))
 */
function calculateAtRiskEmployees(employees, attendanceRecords) {
  // Map: Key = "EmpID:Date", Value = Status
  const statusMap = new Map();
  attendanceRecords.forEach(rec => {
    const dateStr = rec.date.split('T')[0];
    statusMap.set(`${rec.employee_id}:${dateStr}`, (rec.status || '').toLowerCase());
  });

  // Calculate workdays (Mon-Fri) for last 5 days
  const workDays = [];
  let d = new Date();

  for (let i = 0; i < 5; i++) {
    const dateStr = getLocalISODate(d);
    const dayNum = d.getDay();
    if (dayNum !== 0 && dayNum !== 6) { // Mon-Fri
      workDays.push(dateStr);
    }
    d.setDate(d.getDate() - 1);
  }

  const atRisk = [];

  employees.forEach(emp => {
    const empId = emp.employee_id || emp.id;
    if (!empId) return;

    let late = 0;
    let absent = 0;
    let present = 0;

    workDays.forEach(dateStr => {
      const key = `${empId}:${dateStr}`;
      const status = statusMap.get(key);

      if (status) {
        if (status === 'present') present++;
        else if (status === 'late') late++;
        else if (status === 'absent') absent++;
      } else {
        // NO RECORD found for a workday -> INFERRED ABSENT
        absent++;
      }
    });

    const total = workDays.length;
    if (total === 0) return;

    // Risk Formula: (Late + Absent*2) weighted
    const riskScore = (late * 1 + absent * 2);

    // Attendance Rate
    const attendanceRate = Math.round(((present + late) / total) * 100);

    // Threshold: Any absence or >2 lates in last week
    if (absent > 0 || late > 2) {
      atRisk.push({
        id: empId,
        name: emp.full_name || emp.name || 'Unknown',
        late,
        absent,
        attendanceRate,
        riskScore,
        riskLevel: absent > 1 ? 'high' : 'medium'
      });
    }
  });

  return atRisk.sort((a, b) => b.riskScore - a.riskScore).slice(0, 10);
}

function renderAtRiskEmployees(employees) {
  const container = document.getElementById('atRiskList');
  if (!container) return;

  if (!employees || employees.length === 0) {
    container.innerHTML = '<p style="padding: 24px; text-align: center; color: var(--text-secondary);">✓ No at-risk employees. Great Job!</p>';
    return;
  }

  let html = '<div class="attention-list">';
  employees.forEach(emp => {
    const severity = emp.riskLevel === 'high' ? 'high' : 'medium';
    // Escape single quotes for the onclick handler
    const safeName = (emp.name || '').replace(/'/g, "\\'");

    html += `
      <div class="attention-item" onclick="window.openPerformanceModal('${emp.id}', '${safeName}', ${emp.late}, ${emp.absent}, ${emp.attendanceRate})" style="cursor: pointer; transition: background 0.2s;">
        <div>
          <p class="attention-name">${escapeHtml(emp.name)}</p>
          <p class="attention-issue">${emp.late} late, ${emp.absent} absent • ${emp.attendanceRate}% att.</p>
        </div>
        <span class="severity-badge ${severity}">${emp.riskLevel}</span>
      </div>
    `;
  });
  html += '</div>';
  container.innerHTML = html;
}

function showLoadingState(show) {
  const loading = document.getElementById('analytics-loading');
  if (loading) loading.style.display = show ? 'block' : 'none';
}

/**
 * CSV Export Function
 */
export function setupExportButton() {
  const exportBtn = document.getElementById('exportAnalyticsBtn');
  if (!exportBtn) return;

  exportBtn.addEventListener('click', () => {
    try {
      const cached = getCachedAnalytics();
      if (!cached || !cached.attendanceRecords) {
        alert('No data available to export. Please allow analytics to load first.');
        return;
      }

      const records = cached.attendanceRecords;
      if (records.length === 0) {
        alert('No attendance records found to export.');
        return;
      }

      const headers = ['Employee ID', 'Name', 'Date', 'Time In', 'Time Out', 'Status', 'Department'];
      const rows = records.map(r => [
        r.employee_id || '',
        `"${(r.employee_name || 'Unknown').replace(/"/g, '""')}"`,
        r.date ? r.date.split('T')[0] : '',
        r.time_in || '',
        r.time_out || '',
        r.status || '',
        `"${(r.department_name || '').replace(/"/g, '""')}"`
      ]);

      const csvContent = [headers.join(','), ...rows.map(row => row.join(','))].join('\n');
      const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.setAttribute('href', url);
      link.setAttribute('download', `attendance_report_${getLocalISODate()}.csv`);
      link.style.visibility = 'hidden';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);

    } catch (e) {
      console.error('Export failed:', e);
      alert('Failed to export report.');
    }
  });
}

function setupTrendNavigation() {
  const btnWeekly = document.getElementById('btn-trend-weekly');
  const btnMonthly = document.getElementById('btn-trend-monthly');

  if (!btnWeekly || !btnMonthly) return;

  const setActive = (isWeekly) => {
    if (isWeekly) {
      btnWeekly.classList.add('active');
      btnWeekly.style.background = 'var(--bg-tertiary)';
      btnWeekly.style.color = 'var(--text-primary)';

      btnMonthly.classList.remove('active');
      btnMonthly.style.background = 'transparent';
      btnMonthly.style.color = 'var(--text-secondary)';

      currentTrendView = 7;
    } else {
      btnMonthly.classList.add('active');
      btnMonthly.style.background = 'var(--bg-tertiary)';
      btnMonthly.style.color = 'var(--text-primary)';

      btnWeekly.classList.remove('active');
      btnWeekly.style.background = 'transparent';
      btnWeekly.style.color = 'var(--text-secondary)';

      currentTrendView = 30;
    }

    // Re-render
    const cached = getCachedAnalytics();
    if (cached && cached.attendanceRecords) {
      const trendData = calculateTrend(cached.attendanceRecords, currentTrendView);
      renderTrendChart(trendData);
    }
  };

  btnWeekly.onclick = () => setActive(true);
  btnMonthly.onclick = () => setActive(false);
}



