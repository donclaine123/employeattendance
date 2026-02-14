/**
 * Performance Scorecard & Forecasting Module
 * Handles #4: Individual Performance Scorecard vs Department Baseline
 * Handles #7: Departmental Trend & Forecasting Analysis
 */

let performanceForecastCache = null;
const CACHE_DURATION = 5 * 60 * 1000; // 5 minutes

/**
 * Initialize performance & forecast analytics
 */
export async function initializePerformanceForecast() {
  try {
    setupPerformanceEventListeners();
    await loadPerformanceAndForecast();
  } catch (error) {
    console.error('[Performance Forecast] Init error:', error);
  }
}

function setupPerformanceEventListeners() {
  const metricSelect = document.getElementById('performanceFilterMetric');
  if (metricSelect) {
    metricSelect.addEventListener('change', async () => {
      await renderPerformanceScoreCard();
    });
  }
}

/**
 * Load all performance and forecast data
 */
async function loadPerformanceAndForecast() {
  try {
    showLoadingState(true);
    const cachedData = getCachedPerformanceData();
    if (cachedData) {
      console.log('[Performance] Using cached data');
      renderPerformanceScoreCard(cachedData);
      showLoadingState(false);
      return;
    }

    // Fetch data in parallel
    const [employees, attendanceData] = await Promise.all([
      fetchDepartmentEmployeesForPerformance(),
      fetchAttendanceDataForPerformance()
    ]);

    if (!employees || !attendanceData) {
      console.warn('[Performance] No data available');
      showLoadingState(false);
      return;
    }

    // Calculate performance metrics
    const performanceMetrics = calculatePerformanceMetrics(employees, attendanceData);

    const fullData = {
      employees,
      attendanceData,
      performanceMetrics,
      timestamp: Date.now()
    };

    setCachedPerformanceData(fullData);
    renderPerformanceScoreCard(fullData);

    showLoadingState(false);
  } catch (error) {
    console.error('[Performance] Load error:', error);
    showLoadingState(false);
  }
}

/**
 * Fetch department employees
 */
async function fetchDepartmentEmployeesForPerformance() {
  try {
    const apiBase = window.API_URL || '/api';
    const response = await window.fetchWithAuth(`${apiBase}/departmenthead/employees?_limit=500`);
    if (!response.ok) return null;
    const result = await response.json();
    return result.data || [];
  } catch (error) {
    console.error('[Performance] Fetch employees error:', error);
    return null;
  }
}

/**
 * Fetch attendance data for 12 weeks (previous)
 */
async function fetchAttendanceDataForPerformance() {
  try {
    const apiBase = window.API_URL || '/api';
    const endDate = new Date().toISOString().split('T')[0];
    const startDate = new Date(Date.now() - 12 * 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

    const response = await window.fetchWithAuth(
      `${apiBase}/attendance?date_start=${startDate}&date_end=${endDate}&_limit=5000`
    );
    if (!response.ok) return null;
    const result = await response.json();
    return result.data || [];
  } catch (error) {
    console.error('[Performance] Fetch attendance error:', error);
    return null;
  }
}

/**
 * Calculate performance metrics per employee
 */
function calculatePerformanceMetrics(employees, attendanceData) {
  const employeeMap = {};
  const now = new Date();
  const sixtyDaysAgo = new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

  // Filter 60-day window
  const recentAttendance = attendanceData.filter(record => {
    const recordDate = record.date ? record.date.split('T')[0] : null;
    return recordDate >= sixtyDaysAgo;
  });

  // Build lookup by employee_id
  const attendanceByEmployee = {};
  recentAttendance.forEach(record => {
    const empId = record.employee_id;
    if (!attendanceByEmployee[empId]) {
      attendanceByEmployee[empId] = [];
    }
    attendanceByEmployee[empId].push(record);
  });

  let totalAbsences = 0;
  let totalLates = 0;
  let totalRecords = 0;

  // Calculate per-employee metrics
  employees.forEach(emp => {
    const empId = emp.employee_id || emp.id;
    const records = attendanceByEmployee[empId] || [];

    const absences = records.filter(r => (r.status || '').toLowerCase() === 'absent').length;
    const lates = records.filter(r => (r.status || '').toLowerCase() === 'late').length;
    const onTime = records.filter(r => (r.status || '').toLowerCase() === 'present').length;

    const total = records.length;
    const absenceRate = total > 0 ? (absences / total) * 100 : 0;
    const lateRate = total > 0 ? (lates / total) * 100 : 0;
    const onTimeRate = total > 0 ? (onTime / total) * 100 : 0;

    employeeMap[empId] = {
      employee: emp,
      absences,
      lates,
      onTime,
      total,
      absenceRate: Math.round(absenceRate),
      lateRate: Math.round(lateRate),
      onTimeRate: Math.round(onTimeRate)
    };

    totalAbsences += absences;
    totalLates += lates;
    totalRecords += total;
  });

  // Calculate department baseline
  const deptAbsenceRate = totalRecords > 0 ? (totalAbsences / totalRecords) * 100 : 0;
  const deptLateRate = totalRecords > 0 ? (totalLates / totalRecords) * 100 : 0;

  // Add comparison flags
  Object.keys(employeeMap).forEach(empId => {
    const metric = employeeMap[empId];
    metric.absenceVsDept = metric.absenceRate - deptAbsenceRate;
    metric.lateVsDept = metric.lateRate - deptLateRate;
    metric.performanceStatus = getPerformanceStatus(metric, deptAbsenceRate, deptLateRate);
  });

  return {
    employees: employeeMap,
    departmentBaseline: {
      absenceRate: Math.round(deptAbsenceRate),
      lateRate: Math.round(deptLateRate),
      onTimeRate: Math.round(100 - deptAbsenceRate - deptLateRate)
    }
  };
}

/**
 * Determine performance status (color coding)
 */
function getPerformanceStatus(metric, deptAbsenceRate, deptLateRate) {
  const exceedsThreshold = 1.5; // 1.5x
  if (metric.absenceRate > deptAbsenceRate * exceedsThreshold) {
    return 'danger'; // Red - significantly above average
  } else if (metric.absenceRate > deptAbsenceRate * 1.1) {
    return 'warning'; // Yellow - slightly above average
  } else if (metric.absenceRate < deptAbsenceRate * 0.7) {
    return 'success'; // Green - well below average
  }
  return 'neutral'; // Gray - average
}

/**
 * Render Performance Scorecard Table
 */
async function renderPerformanceScoreCard(data = null) {
  const table = document.getElementById('performanceScoreCardTable');
  const tbody = document.getElementById('performanceScoreCardTableBody');

  if (!table || !tbody) return;

  const performanceData = data || performanceForecastCache;
  if (!performanceData || !performanceData.performanceMetrics) {
    tbody.innerHTML = `<tr><td colspan="8" style="text-align: center; padding: 40px; color: var(--text-muted);">No performance data available</td></tr>`;
    return;
  }

  const { employees: employeeMetrics, departmentBaseline } = performanceData.performanceMetrics;

  // Sort employees by absence rate (descending)
  const sortedEmployees = Object.values(employeeMetrics).sort((a, b) => b.absenceRate - a.absenceRate);

  tbody.innerHTML = sortedEmployees.map(metric => {
    const emp = metric.employee;
    const statusClass = metric.performanceStatus;
    const statusColor = getStatusColor(statusClass);
    const rateIndicator = metric.absenceVsDept > 0 ? `↑ +${Math.round(metric.absenceVsDept)}%` : `↓ ${Math.round(metric.absenceVsDept)}%`;

    return `
      <tr style="border-bottom: 1px solid var(--border-primary);">
        <td style="padding: 12px 24px; color: var(--text-primary); font-weight: 600;">
          ${emp.first_name} ${emp.last_name}
          <div style="font-size: 11px; color: var(--text-muted); margin-top: 2px;">ID: ${emp.employee_id || emp.id}</div>
        </td>
        <td style="padding: 12px; text-align: center; color: var(--text-primary); font-weight: 600;">${metric.absences}</td>
        <td style="padding: 12px; text-align: center;">
          <span style="padding: 4px 8px; border-radius: 4px; font-size: 11px; font-weight: 600; color: ${statusColor}; background: rgba(${parseHexRGB(statusColor)}, 0.1);">
            ${rateIndicator}
          </span>
        </td>
        <td style="padding: 12px; text-align: center;">
          <div style="width: 100%; background: var(--bg-hover); border-radius: 4px; height: 20px; overflow: hidden; position: relative;">
            <div style="height: 100%; width: ${metric.absenceRate}%; background: ${statusColor}; position: absolute; left: 0; top: 0;"></div>
            <div style="position: relative; z-index: 1; text-align: center; font-size: 10px; color: var(--text-primary); font-weight: 600; height: 100%; display: flex; align-items: center; justify-content: center;">${metric.absenceRate}%</div>
          </div>
        </td>
        <td style="padding: 12px; text-align: center; color: var(--text-primary); font-weight: 600;">${metric.lates}</td>
        <td style="padding: 12px; text-align: center;">
          <div style="width: 100%; background: var(--bg-hover); border-radius: 4px; height: 20px; overflow: hidden; position: relative;">
            <div style="height: 100%; width: ${metric.lateRate}%; background: #eab308; position: absolute; left: 0; top: 0;"></div>
            <div style="position: relative; z-index: 1; text-align: center; font-size: 10px; color: var(--text-primary); font-weight: 600; height: 100%; display: flex; align-items: center; justify-content: center;">${metric.lateRate}%</div>
          </div>
        </td>
        <td style="padding: 12px; text-align: center; color: #22c55e; font-weight: 600;">${metric.onTimeRate}%</td>
        <td style="padding: 12px; text-align: center;">
          <button style="padding: 4px 8px; font-size: 11px; background: var(--accent-primary); color: white; border: none; border-radius: 4px; cursor: pointer; font-weight: 600;">
            Review
          </button>
        </td>
      </tr>
    `;
  }).join('');

  // Add department baseline row
  const baselineRow = `
    <tr style="background: var(--bg-hover); border-top: 2px solid var(--border-primary); border-bottom: 2px solid var(--border-primary);">
      <td style="padding: 12px 24px; color: var(--text-primary); font-weight: 700;">Department Baseline</td>
      <td style="padding: 12px; text-align: center; color: var(--text-primary); font-weight: 600;">-</td>
      <td style="padding: 12px; text-align: center; color: var(--text-muted); font-weight: 600;">Avg</td>
      <td style="padding: 12px; text-align: center; font-weight: 700; color: var(--text-primary);">${departmentBaseline.absenceRate}%</td>
      <td style="padding: 12px; text-align: center; color: var(--text-primary); font-weight: 600;">-</td>
      <td style="padding: 12px; text-align: center; font-weight: 700; color: var(--text-primary);">${departmentBaseline.lateRate}%</td>
      <td style="padding: 12px; text-align: center; font-weight: 700; color: #22c55e;">${departmentBaseline.onTimeRate}%</td>
      <td></td>
    </tr>
  `;

  tbody.innerHTML += baselineRow;
}

/**
 * Helper: Convert hex to RGB
 */
function parseHexRGB(hex) {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return result ? `${parseInt(result[1], 16)},${parseInt(result[2], 16)},${parseInt(result[3], 16)}` : '37,99,235';
}

/**
 * Get color for status
 */
function getStatusColor(status) {
  switch (status) {
    case 'success': return '#22c55e';
    case 'warning': return '#eab308';
    case 'danger': return '#ef4444';
    default: return '#9ca3af';
  }
}

/**
 * Show/hide loading state
 */
function showLoadingState(show) {
  const loader = document.getElementById('analytics-loading');
  if (loader) {
    loader.style.display = show ? 'flex' : 'none';
  }
}

/**
 * Caching functions
 */
function getCachedPerformanceData() {
  try {
    const cached = performanceForecastCache;
    if (cached && Date.now() - cached.timestamp < CACHE_DURATION) {
      return cached;
    }
    return null;
  } catch (e) {
    return null;
  }
}

function setCachedPerformanceData(data) {
  try {
    performanceForecastCache = { ...data, timestamp: Date.now() };
  } catch (e) {
    console.warn('Cache failed:', e);
  }
}

// Export for manual refresh
export async function refreshPerformanceAnalytics() {
  performanceForecastCache = null;
  await loadPerformanceAndForecast();
}
