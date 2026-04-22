/**
 * Department Head Reports Module
 * Handles report generation, formatting, and export
 */

let departmentId = null;
let reportCache = {};

/**
 * Initialize reports module
 */
export async function initializeReports() {
  try {
    // Get department info
    const headInfo = await fetchHeadInfo();
    if (headInfo && headInfo.dept_id) {
      departmentId = headInfo.dept_id;
    }

    setupReportEventListeners();
    console.log('[Reports] Module initialized');
  } catch (error) {
    console.error('[Reports] Initialization error:', error);
  }
}

/**
 * Setup event listeners for report generation
 */
function setupReportEventListeners() {
  const confirmBtn = document.getElementById('generateAttendanceReportConfirmBtn');

  if (confirmBtn) {
    confirmBtn.addEventListener('click', async () => {
      await handleAttendanceReportGeneration();
    });
  }
}

/**
 * Handle attendance report generation
 */
export async function handleAttendanceReportGeneration() {
  try {
    showReportLoadingState(true);

    // Get form values
    const timeline = document.querySelector('input[name="timeline"]:checked')?.value;
    const format = document.querySelector('input[name="format"]:checked')?.value;
    const dataTypes = Array.from(document.querySelectorAll('input[name="reportData"]:checked')).map(cb => cb.value);

    let dateRange = null;
    let refDate = new Date(); // Reference date for determining school year/semester

    if (timeline === 'custom') {
      const startDate = document.getElementById('reportStartDate')?.value;
      const endDate = document.getElementById('reportEndDate')?.value;

      if (!startDate || !endDate) {
        showReportErrorState('Please select both start and end dates');
        showReportLoadingState(false);
        return;
      }

      dateRange = { start: startDate, end: endDate };
      refDate = new Date(startDate); // Use custom start date to determine SY/semester
    }

    // Calculate school year and semester from the reference date
    const schoolInfo = calculateSchoolYearFromDate(refDate);

    // Fetch attendance data
    const attendanceData = await fetchAttendanceDataForReport(timeline, dateRange);

    if (!attendanceData || attendanceData.length === 0) {
      showReportErrorState('No attendance data found for the selected period');
      showReportLoadingState(false);
      return;
    }

    // Fetch employees to join with attendance data
    const employees = await fetchDepartmentEmployees();

    // Join employee details with attendance records
    const enrichedData = enrichAttendanceWithEmployees(attendanceData, employees);

    // Filter data by date range to ensure only selected timeline is included
    const filteredByDate = filterAttendanceByDateRange(enrichedData, timeline, dateRange);

    // Format data based on selected types
    const formattedData = formatAttendanceData(filteredByDate, dataTypes);

    // Always expand data with subjects (needed for both Excel sheets and PDF detailed format)
    const transformedData = expandAttendanceWithSubjects(formattedData);

    // Generate report based on format
    if (format === 'pdf') {
      generatePDFReport(transformedData, timeline, dateRange, schoolInfo);
    } else if (format === 'excel') {
      generateExcelReport(transformedData, timeline, dateRange, schoolInfo);
    }

    // Close modal
    const modal = document.getElementById('attendanceReportModal');
    if (modal) modal.style.display = 'none';

    console.log('[Reports] Report generated successfully');
  } catch (error) {
    console.error('[Reports] Error generating report:', error);
    showReportErrorState('Error generating report. Please try again.');
  } finally {
    showReportLoadingState(false);
  }
}
/**
 * Fetch attendance data for report
 */
async function fetchAttendanceDataForReport(timeline, dateRange) {
  try {
    const apiBase = window.API_URL || '/api';

    let queryParams = new URLSearchParams();

    // Set date range based on timeline
    const today = new Date();
    let startDate, endDate;

    if (timeline === 'daily') {
      startDate = new Date(today);
      startDate.setHours(0, 0, 0, 0);
      endDate = new Date(today);
      endDate.setHours(23, 59, 59, 999);
    } else if (timeline === 'weekly') {
      startDate = new Date(today);
      startDate.setDate(today.getDate() - 7);
      startDate.setHours(0, 0, 0, 0);
      endDate = new Date(today);
      endDate.setHours(23, 59, 59, 999);
    } else if (timeline === 'monthly') {
      startDate = new Date(today);
      startDate.setDate(today.getDate() - 30);
      startDate.setHours(0, 0, 0, 0);
      endDate = new Date(today);
      endDate.setHours(23, 59, 59, 999);
    } else if (timeline === 'custom' && dateRange) {
      startDate = new Date(dateRange.start + 'T00:00:00');
      endDate = new Date(dateRange.end + 'T23:59:59');
    }

    const startDateStr = startDate.toISOString().split('T')[0];
    const endDateStr = endDate.toISOString().split('T')[0];

    queryParams.append('date_from', startDateStr);
    queryParams.append('date_to', endDateStr);

    // Use new attendance-with-subjects endpoint for enriched data
    const response = await window.fetchWithAuth(`${apiBase}/departmenthead/attendance-with-subjects?${queryParams.toString()}`);

    if (!response.ok) {
      throw new Error(`API response: ${response.status}`);
    }

    const data = await response.json();
    return data.data || data || [];
  } catch (error) {
    console.error('[Reports] Error fetching attendance data:', error);
    throw error;
  }
}
/**
 * Fetch department employees
 */
async function fetchDepartmentEmployees() {
  try {
    const apiBase = window.API_URL || '/api';
    const response = await window.fetchWithAuth(`${apiBase}/departmenthead/employees?_limit=1000`);

    if (!response.ok) {
      console.warn('[Reports] Could not fetch employees');
      return [];
    }

    const data = await response.json();
    return data.data || data || [];
  } catch (error) {
    console.error('[Reports] Error fetching employees:', error);
    return [];
  }
}

/**
 * Fetch current school year and term from backend
 */
async function fetchCurrentSchoolInfo() {
  try {
    const apiBase = window.API_URL || '/api';
    const response = await window.fetchWithAuth(`${apiBase}/departmenthead/current-school-info`);

    if (!response.ok) {
      console.warn('[Reports] Could not fetch school info, using defaults');
      return {
        school_year: '2025-2026',
        term: 'Second Semester'
      };
    }

    const data = await response.json();
    return data.data || {
      school_year: '2025-2026',
      term: 'Second Semester'
    };
  } catch (error) {
    console.error('[Reports] Error fetching school info:', error);
    // Return default values on error
    return {
      school_year: '2025-2026',
      term: 'Second Semester'
    };
  }
}

/**
 * Calculate school year and semester from a given date
 * 1st Semester: August - December
 * 2nd Semester: January - May
 */
function calculateSchoolYearFromDate(date) {
  const month = date.getMonth() + 1; // 1-12
  const year = date.getFullYear();

  let schoolYear;
  let term;

  if (month >= 8) {
    // August-December: 1st Semester
    schoolYear = `${year}-${year + 1}`;
    term = '1st Semester';
  } else {
    // January-May: 2nd Semester
    schoolYear = `${year - 1}-${year}`;
    term = '2nd Semester';
  }

  return {
    school_year: schoolYear,
    term: term
  };
}

/**
 * Enrich attendance records with employee details
 */
function enrichAttendanceWithEmployees(attendanceRecords, employees) {
  if (!Array.isArray(attendanceRecords)) return [];

  // Create a map of employees by ID for quick lookup
  const employeeMap = {};
  if (Array.isArray(employees)) {
    employees.forEach(emp => {
      const empId = emp.employee_id || emp.id;
      employeeMap[empId] = emp;
    });
  }

  // Enrich attendance records with employee details
  return attendanceRecords.map(record => {
    const empId = record.employee_id;
    const employee = employeeMap[empId];

    return {
      ...record,
      employee: employee || {
        first_name: '',
        last_name: '',
        employee_id: empId
      }
    };
  });
}

/**
 * Format attendance data
 */
function formatAttendanceData(rawData, dataTypes) {
  if (!Array.isArray(rawData)) return [];

  // Filter by selected data types
  const filtered = rawData.filter(record => {
    const status = (record.status || '').toLowerCase();
    return dataTypes.includes(status);
  });

  // Sort by date and employee
  return filtered.sort((a, b) => {
    const dateA = new Date(a.date || 0);
    const dateB = new Date(b.date || 0);
    return dateB - dateA; // Most recent first
  });
}

/**
 * Filter attendance data by date range based on timeline
 */
function filterAttendanceByDateRange(rawData, timeline, dateRange) {
  if (!Array.isArray(rawData)) return [];

  const today = new Date();
  let minDate, maxDate;

  if (timeline === 'daily') {
    // Daily: only today's records
    minDate = new Date(today);
    minDate.setHours(0, 0, 0, 0);
    maxDate = new Date(today);
    maxDate.setHours(23, 59, 59, 999);
  } else if (timeline === 'weekly') {
    // Weekly: last 7 days
    minDate = new Date(today);
    minDate.setDate(today.getDate() - 7);
    minDate.setHours(0, 0, 0, 0);
    maxDate = new Date(today);
    maxDate.setHours(23, 59, 59, 999);
  } else if (timeline === 'monthly') {
    // Monthly: last 30 days
    minDate = new Date(today);
    minDate.setDate(today.getDate() - 30);
    minDate.setHours(0, 0, 0, 0);
    maxDate = new Date(today);
    maxDate.setHours(23, 59, 59, 999);
  } else if (timeline === 'custom' && dateRange) {
    // Custom: use provided date range
    minDate = new Date(dateRange.start + 'T00:00:00');
    maxDate = new Date(dateRange.end + 'T23:59:59');
  } else {
    return rawData; // No filtering if timeline not recognized
  }

  // Filter records to only include those within the date range
  return rawData.filter(record => {
    if (!record.date) return false;
    const recordDate = new Date(record.date + 'T00:00:00');
    return recordDate >= minDate && recordDate <= maxDate;
  });
}

/**
 * Transform data to summary format (one row per employee per date)
 * Aggregates subject status counts
 */
function transformToSummaryFormat(data) {
  const summaryMap = {};

  data.forEach(record => {
    const key = `${record.date}_${record.employee_id}`;

    if (!summaryMap[key]) {
      summaryMap[key] = {
        date: record.date,
        employee_id: record.employee_id,
        employee: record.employee,
        time_in: record.time_in,
        time_out: record.time_out,
        status: record.status,
        subjects: [],
        verified_count: 0,
        late_count: 0,
        absent_count: 0,
        unverified_count: 0
      };
    }

    // Track subject and its status
    if (record.subject_code) {
      const subjectStatus = (record.verified_status || '').toLowerCase();

      if (!isReportableAttendanceStatus(subjectStatus)) {
        return;
      }

      summaryMap[key].subjects.push({
        subject_code: record.subject_code,
        subject_name: record.subject_name,
        section_name: record.section_name,
        start_time: record.start_time,
        end_time: record.end_time,
        schedule: `${formatTime(record.start_time || '')} - ${formatTime(record.end_time || '')}`,
        room_name: record.room_name,
        verified_status: record.verified_status
      });

      // Count by individual subject's verified_status
      if (subjectStatus === 'verified' || subjectStatus === 'present') {
        summaryMap[key].verified_count++;
      } else if (subjectStatus === 'late') {
        summaryMap[key].late_count++;
      } else if (subjectStatus === 'absent') {
        summaryMap[key].absent_count++;
      }
    }
  });

  return Object.values(summaryMap).sort((a, b) => {
    // Sort by employee name, then by date
    const nameA = `${a.employee?.first_name || ''} ${a.employee?.last_name || ''}`;
    const nameB = `${b.employee?.first_name || ''} ${b.employee?.last_name || ''}`;

    if (nameA !== nameB) return nameA.localeCompare(nameB);
    return new Date(b.date) - new Date(a.date);
  });
}

function getEmployeeSummaryKey(record) {
  const employeeId = record.employee_id || record.employee?.employee_id || record.employee?.id || record.employee?.user_id;
  if (employeeId != null && employeeId !== '') {
    return String(employeeId);
  }

  return `${record.employee?.first_name || ''} ${record.employee?.last_name || ''}`.trim() || 'Unknown';
}

function buildEmployeeSummaryRows(summaryRows) {
  const employeeMap = new Map();

  (Array.isArray(summaryRows) ? summaryRows : []).forEach(record => {
    const employeeKey = getEmployeeSummaryKey(record);
    const employeeId = record.employee_id || record.employee?.employee_id || record.employee?.id || record.employee?.user_id || '-';
    const employeeName = `${record.employee?.first_name || ''} ${record.employee?.last_name || ''}`.trim() || 'Unknown';

    if (!employeeMap.has(employeeKey)) {
      employeeMap.set(employeeKey, {
        employee_id: employeeId,
        employee: record.employee || null,
        employee_name: employeeName,
        verified_count: 0,
        late_count: 0,
        absent_count: 0,
        totalMinutes: 0,
        absentMinutes: 0,
      });
    }

    const row = employeeMap.get(employeeKey);
    row.verified_count += Number(record.verified_count || 0);
    row.late_count += Number(record.late_count || 0);
    row.absent_count += Number(record.absent_count || 0);
    row.totalMinutes += getUniqueSubjectMinutes(record.subjects);
    row.absentMinutes += getUniqueSubjectMinutes(record.subjects, 'absent');
  });

  return Array.from(employeeMap.values())
    .map(row => {
      const netMinutes = Math.max(0, row.totalMinutes - row.absentMinutes);

      return {
        ...row,
        totalHoursText: formatMinutesAsHours(row.totalMinutes),
        absentHoursText: formatMinutesAsHours(row.absentMinutes),
        netHoursText: formatMinutesAsHours(netMinutes)
      };
    })
    .sort((left, right) => {
      const nameA = left.employee_name || '';
      const nameB = right.employee_name || '';
      if (nameA !== nameB) return nameA.localeCompare(nameB);

      return String(left.employee_id || '').localeCompare(String(right.employee_id || ''), undefined, {
        numeric: true,
        sensitivity: 'base'
      });
    });
}

function transformToEmployeeSummary(data) {
  return buildEmployeeSummaryRows(transformToSummaryFormat(data));
}

/**
 * Expand attendance records with subjects into report rows
 * Creates one row per subject per employee per day
 */
function expandAttendanceWithSubjects(data) {
  const expandedRows = [];

  data.forEach(record => {
    // If record has subjects array, create one row per subject
    const reportableSubjects = Array.isArray(record.subjects)
      ? record.subjects.filter(subject => isReportableAttendanceStatus(subject.verified_status))
      : [];

    if (reportableSubjects.length > 0) {
      reportableSubjects.forEach(subject => {
        expandedRows.push({
          ...record,
          subject_code: subject.subject_code,
          subject_name: subject.subject_name,
          section_name: subject.section_name,
          start_time: subject.start_time,
          end_time: subject.end_time,
          room_name: subject.room_name,
          verified_status: subject.verified_status
        });
      });
    } else if (isReportableAttendanceStatus(record.status)) {
      // If no subjects, add row as-is (for backward compatibility)
      expandedRows.push({
        ...record,
        subjects: []
      });
    }
  });

  return expandedRows;
}

function isReportableAttendanceStatus(status) {
  const normalized = String(status || '').toLowerCase();
  return normalized === 'verified' || normalized === 'present' || normalized === 'late' || normalized === 'absent';
}

function getSubjectDurationMinutes(subject) {
  if (!subject?.start_time || !subject?.end_time) return 0;

  const startParts = String(subject.start_time).split(':');
  const endParts = String(subject.end_time).split(':');
  const startHour = Number.parseInt(startParts[0], 10);
  const startMinute = Number.parseInt(startParts[1], 10);
  const endHour = Number.parseInt(endParts[0], 10);
  const endMinute = Number.parseInt(endParts[1], 10);

  if ([startHour, startMinute, endHour, endMinute].some(value => !Number.isFinite(value))) {
    return 0;
  }

  const startMinutes = startHour * 60 + startMinute;
  const endMinutes = endHour * 60 + endMinute;
  return Math.max(0, endMinutes - startMinutes);
}

function getUniqueSubjectMinutes(subjects, statusFilter = null) {
  const seenBlocks = new Set();
  let totalMinutes = 0;

  (Array.isArray(subjects) ? subjects : []).forEach(subject => {
    if (!subject?.start_time || !subject?.end_time) return;

    const subjectStatus = String(subject.verified_status || '').toLowerCase();
    if (statusFilter && subjectStatus !== statusFilter) return;

    const blockKey = `${subject.start_time}_${subject.end_time}`;
    if (seenBlocks.has(blockKey)) return;

    seenBlocks.add(blockKey);
    totalMinutes += getSubjectDurationMinutes(subject);
  });

  return totalMinutes;
}

function formatMinutesAsHours(totalMinutes) {
  const safeMinutes = Math.max(0, Number(totalMinutes) || 0);
  const hours = Math.floor(safeMinutes / 60);
  const minutes = safeMinutes % 60;
  return `${hours}h ${minutes}m`;
}

function calculateAttendanceSummaryTotals(summaryData) {
  return (Array.isArray(summaryData) ? summaryData : []).reduce((totals, record) => {
    totals.present += Number(record.verified_count || 0);
    totals.late += Number(record.late_count || 0);
    totals.absent += Number(record.absent_count || 0);
    totals.totalMinutes += getUniqueSubjectMinutes(record.subjects);
    totals.absentMinutes += getUniqueSubjectMinutes(record.subjects, 'absent');
    return totals;
  }, {
    present: 0,
    late: 0,
    absent: 0,
    totalMinutes: 0,
    absentMinutes: 0,
  });
}

/**
 * Helper: Get report header with college information
 */
function getReportHeader(schoolInfo = {}) {
  const schoolYear = schoolInfo.school_year || '2025-2026';
  const term = schoolInfo.term || 'Second Semester';

  return [
    { text: 'St. Clare College', style: 'headerCollege', alignment: 'center' },
    { text: 'Caloocan City, NCR', style: 'headerInfo', alignment: 'center' },
    { text: 'Philippines', style: 'headerInfo', alignment: 'center', marginBottom: 12 },
    { text: 'BACHELOR OF SCIENCE IN COMPUTER SCIENCE', style: 'headerProgram', alignment: 'center' },
    { text: `SY. ${schoolYear} | ${term.toUpperCase()}`, style: 'headerSemester', alignment: 'center', marginBottom: 15 }
  ];
}

/**
 * Generate PDF Report using pdfmake
 */
function generatePDFReport(data, timeline, dateRange, schoolInfo = {}) {
  try {
    // Check if pdfMake is available
    if (typeof pdfMake === 'undefined') {
      console.warn('[Reports] pdfmake not available, falling back to Excel');
      generateExcelReport(data, timeline, dateRange, schoolInfo);
      return;
    }

    // Generate combined PDF with Summary first, then Detailed
    const summaryData = transformToSummaryFormat(data);
    const docDefinition = generateCombinedPDF(summaryData, data, timeline, dateRange, schoolInfo);

    // Generate and download
    const filename = `attendance_report_${timeline}_${new Date().getTime()}.pdf`;
    pdfMake.createPdf(docDefinition).download(filename);

    // Log the download
    const dateRange_value = dateRange || { start: getDefaultStartDate(timeline), end: new Date().toISOString().split('T')[0] };
    logReportDownload('attendance', 'pdf', timeline, dateRange_value.start, dateRange_value.end);

    console.log('[Reports] PDF generated and downloaded with pdfmake');
  } catch (error) {
    console.error('[Reports] PDF generation error:', error);
    showReportErrorState('Error generating PDF. Falling back to Excel format.');
    generateExcelReport(data, timeline, dateRange, schoolInfo);
  }
}

/**
 * Generate Summary Format PDF (employee totals first, then the daily report)
 */
function generateSummaryPDF(data, timeline, dateRange, schoolInfo = {}) {
  const dailyRows = Array.isArray(data) ? data : [];
  const employeeTotals = buildEmployeeSummaryRows(dailyRows);

  const employeeTotalsBody = [[
    { text: 'EMPLOYEE NAME', style: 'tableHeader' },
    { text: 'PRESENT', style: 'tableHeader', alignment: 'center' },
    { text: 'LATE', style: 'tableHeader', alignment: 'center' },
    { text: 'ABSENT', style: 'tableHeader', alignment: 'center' },
    { text: 'TOTAL HOURS', style: 'tableHeader', alignment: 'center' },
    { text: 'ABSENT HOURS', style: 'tableHeader', alignment: 'center' },
    { text: 'NET HOURS', style: 'tableHeader', alignment: 'center' }
  ]];

  if (employeeTotals.length > 0) {
    employeeTotals.forEach((record) => {
      employeeTotalsBody.push([
        { text: record.employee_name || 'Unknown', style: 'tableCell', bold: true },
        { text: record.verified_count || '0', style: 'tableCell', alignment: 'center', color: '#2E7D32' },
        { text: record.late_count || '0', style: 'tableCell', alignment: 'center', color: '#EF6C00' },
        { text: record.absent_count || '0', style: 'tableCell', alignment: 'center', color: '#C62828' },
        { text: record.totalHoursText || '0h 0m', style: 'tableCell', alignment: 'center', color: '#1F4E78' },
        { text: record.absentHoursText || '0h 0m', style: 'tableCell', alignment: 'center', color: '#B91C1C' },
        { text: record.netHoursText || '0h 0m', style: 'tableCell', alignment: 'center', color: '#0F766E' }
      ]);
    });
  } else {
    employeeTotalsBody.push([
      { text: 'No employee totals available', style: 'tableCell', colSpan: 7, alignment: 'center', italics: true },
      {}, {}, {}, {}, {}, {}
    ]);
  }

  const dailyTableBody = [[
    { text: 'DATE', style: 'tableHeader' },
    { text: 'EMPLOYEE NAME', style: 'tableHeader' },
    { text: 'DEPARTMENT', style: 'tableHeader' },
    { text: 'TIME IN', style: 'tableHeader' },
    { text: 'PRESENT', style: 'tableHeader', alignment: 'center' },
    { text: 'LATE', style: 'tableHeader', alignment: 'center' },
    { text: 'ABSENT', style: 'tableHeader', alignment: 'center' },
    { text: 'TOTAL HOURS', style: 'tableHeader', alignment: 'center' }
  ]];

  dailyRows.forEach((record) => {
    const employeeName = `${record.employee?.first_name || ''} ${record.employee?.last_name || ''}`.trim() || record.employee_name || 'Unknown';
    const employeeDepartment = record.employee?.department || record.employee_department || '—';
    const totalHoursText = formatMinutesAsHours(getUniqueSubjectMinutes(record.subjects));

    dailyTableBody.push([
      { text: formatDate(record.date), style: 'tableCell' },
      { text: employeeName, style: 'tableCell', bold: true },
      { text: employeeDepartment, style: 'tableCell' },
      { text: formatTime(record.time_in) || '-', style: 'tableCell' },
      { text: record.verified_count || '0', style: 'tableCell', alignment: 'center', color: '#2E7D32' },
      { text: record.late_count || '0', style: 'tableCell', alignment: 'center', color: '#EF6C00' },
      { text: record.absent_count || '0', style: 'tableCell', alignment: 'center', color: '#C62828' },
      { text: totalHoursText, style: 'tableCell', alignment: 'center', color: '#1F4E78' }
    ]);
  });

  return {
    content: [
      ...getReportHeader(schoolInfo),
      {
        text: 'Employee Totals Across Selected Date Range',
        style: 'title',
        margin: [0, 0, 0, 5]
      },
      {
        columns: [
          {
            width: '*',
            stack: [
              { text: `Period: ${getTimelineLabel(timeline, dateRange)}`, style: 'info' },
              { text: `Total Employees: ${employeeTotals.length}`, style: 'info' }
            ]
          },
          {
            width: 'auto',
            stack: [
              { text: `Generated: ${new Date().toLocaleString()}`, style: 'info', alignment: 'right' },
              { text: `Daily rows: ${dailyRows.length}`, style: 'info', alignment: 'right' }
            ]
          }
        ],
        margin: [0, 0, 0, 20]
      },
      {
        table: {
          headerRows: 1,
          widths: ['28%', '12%', '12%', '12%', '14%', '11%', '11%'],
          body: employeeTotalsBody
        },
        layout: {
          hLineWidth: function (i, node) {
            return (i === 1) ? 1 : 1; // Line under header, and lines between rows
          },
          vLineWidth: function (i, node) {
            return 0;
          },
          hLineColor: function (i, node) {
            return (i === 1) ? '#CCCCCC' : '#EEEEEE'; // Darker under header, lighter between rows
          },
          paddingLeft: function (i) { return 4; },
          paddingRight: function (i) { return 4; },
          paddingTop: function (i) { return 8; },
          paddingBottom: function (i) { return 8; }
        }
      },
      { text: 'Attendance Report - Summary by Employee', style: 'title', margin: [0, 18, 0, 5], pageBreak: 'before' },
      {
        columns: [
          {
            width: '*',
            stack: [
              { text: `Period: ${getTimelineLabel(timeline, dateRange)}`, style: 'info' },
              { text: `Daily rows: ${dailyRows.length}`, style: 'info' }
            ]
          },
          {
            width: 'auto',
            stack: [
              { text: `Generated: ${new Date().toLocaleString()}`, style: 'info', alignment: 'right' },
              { text: `Total Employees: ${employeeTotals.length}`, style: 'info', alignment: 'right' }
            ]
          }
        ],
        margin: [0, 0, 0, 20]
      },
      {
        table: {
          headerRows: 1,
          widths: ['12%', '22%', '14%', '12%', '10%', '10%', '10%', '10%'],
          body: dailyTableBody
        },
        layout: {
          hLineWidth: function (i, node) {
            return (i === 1) ? 1 : 1; // Line under header, and lines between rows
          },
          vLineWidth: function (i, node) {
            return 0;
          },
          hLineColor: function (i, node) {
            return (i === 1) ? '#CCCCCC' : '#EEEEEE'; // Darker under header, lighter between rows
          },
          paddingLeft: function (i) { return 4; },
          paddingRight: function (i) { return 4; },
          paddingTop: function (i) { return 8; },
          paddingBottom: function (i) { return 8; }
        }
      }
    ],
    // Styles match Detailed Report
    styles: {
      headerCollege: {
        fontSize: 16,
        bold: true,
        color: '#1F2937' // Dark gray/blue
      },
      headerInfo: {
        fontSize: 10,
        color: '#6B7280' // Gray
      },
      headerProgram: {
        fontSize: 11,
        bold: true,
        color: '#1B5E20', // Dark Green
        margin: [0, 4, 0, 0]
      },
      headerSemester: {
        fontSize: 10,
        color: '#6B7280',
        margin: [0, 2, 0, 0]
      },
      title: {
        fontSize: 14,
        bold: true,
        color: '#333333',
        margin: [0, 0, 0, 5]
      },
      info: {
        fontSize: 9,
        color: '#666666'
      },
      tableHeader: {
        fontSize: 8,
        bold: true,
        color: '#9E9E9E',
        margin: [0, 0, 0, 4]
      },
      tableCell: {
        fontSize: 9,
        color: '#333333'
      }
    },
    defaultStyle: {
      fontSize: 9,
      font: 'Roboto'
    },
    pageOrientation: 'portrait',
    pageMargins: [30, 30, 30, 30]
  };
}

/**
 * Generate Combined PDF with Summary first, then Detailed
 */
function generateCombinedPDF(summaryData, detailedData, timeline, dateRange, schoolInfo = {}) {
  // Get summary content
  const summaryDoc = generateSummaryPDF(summaryData, timeline, dateRange, schoolInfo);

  // Get detailed content
  const detailedDoc = generateDetailedPDF(detailedData, timeline, dateRange, schoolInfo);

  // Combine: Take header from summary, then all summary content, then add page break and detailed content
  const combinedContent = [
    ...summaryDoc.content,
    { text: '', pageBreak: 'before' }, // Page break before detailed section
    ...detailedDoc.content
  ];

  return {
    content: combinedContent,
    styles: summaryDoc.styles,
    defaultStyle: summaryDoc.defaultStyle,
    pageOrientation: summaryDoc.pageOrientation,
    pageMargins: summaryDoc.pageMargins
  };
}

/**
 * Generate Detailed Format PDF with 3-level hierarchy: Employee → Date → Subjects
 */
function generateDetailedPDF(data, timeline, dateRange, schoolInfo = {}) {
  // Group data by employee, then by date
  const employeeGroups = {};

  data.forEach(record => {
    const empId = record.employee_id || record.employee?.employee_id;
    const empName = `${record.employee?.first_name || ''} ${record.employee?.last_name || ''}`;
    const empKey = `${empId}_${empName}`;
    const dateKey = record.date || new Date().toISOString().split('T')[0];

    if (!employeeGroups[empKey]) {
      employeeGroups[empKey] = {
        employee_id: empId,
        employee_name: empName,
        dateGroups: {}
      };
    }

    if (!employeeGroups[empKey].dateGroups[dateKey]) {
      employeeGroups[empKey].dateGroups[dateKey] = [];
    }

    employeeGroups[empKey].dateGroups[dateKey].push(record);
  });

  const content = [
    ...getReportHeader(schoolInfo),
    {
      text: 'Attendance Report - Detailed by Subject',
      style: 'title',
      margin: [0, 0, 0, 5]
    },
    {
      columns: [
        { text: '', width: '*' },
        {
          width: 'auto',
          stack: [
            { text: `Generated: ${new Date().toLocaleString()}`, style: 'info', alignment: 'right' },
            { text: `Period: ${getTimelineLabel(timeline, dateRange)}`, style: 'info', alignment: 'right' }
          ]
        }
      ],
      margin: [0, 0, 0, 20]
    }
  ];

  // Build content for each employee
  Object.values(employeeGroups).forEach((empGroup, groupIdx) => {
    // Employee header - Styled with left green border
    content.push({
      margin: [0, groupIdx === 0 ? 0 : 25, 0, 15],
      table: {
        widths: ['*'],
        body: [
          [
            {
              text: `${empGroup.employee_name}  |  ${empGroup.department}`,
              fontSize: 12,
              bold: true,
              color: '#333333',
              fillColor: '#F8F9FA',
              border: [true, false, false, false],
              borderColor: ['#4CAF50', '', '', ''], // Left border green
              padding: [12, 8, 12, 8]
            }
          ]
        ]
      },
      layout: {
        defaultBorder: false,
        paddingLeft: function (i) { return 12; },
        paddingRight: function (i) { return 12; },
        paddingTop: function (i) { return 8; },
        paddingBottom: function (i) { return 8; }
      }
    });

    // Sort dates and iterate through each date
    const sortedDates = Object.keys(empGroup.dateGroups).sort();

    sortedDates.forEach((dateKey, dateIdx) => {
      const dateRecords = empGroup.dateGroups[dateKey];
      const dateFirstRecord = dateRecords[0];

      // Get date-specific status and times
      const dateCheckIn = formatTime(dateFirstRecord.time_in) || '-';
      const dateCheckOut = formatTime(dateFirstRecord.time_out) || '-';

      // Format the date nicely
      const dateObj = new Date(dateKey + 'T00:00:00');
      const formattedDate = dateObj.toLocaleDateString('en-US', {
        weekday: 'short',
        year: 'numeric',
        month: 'long',
        day: 'numeric'
      });

      // Date row layout
      content.push({
        margin: [0, dateIdx === 0 ? 0 : 15, 0, 8],
        columns: [
          {
            width: 'auto',
            text: formattedDate,
            bold: true,
            fontSize: 10,
            margin: [0, 2, 10, 0]
          },
          {
            width: '*',
            text: `Check In: ${dateCheckIn}   Check Out: ${dateCheckOut}`,
            alignment: 'right',
            fontSize: 9,
            color: '#666666',
            margin: [0, 2, 0, 0]
          }
        ]
      });

      // Subject details table header
      const subjectTableBody = [
        [
          { text: 'CODE', style: 'tableHeader' },
          { text: 'SUBJECT NAME', style: 'tableHeader' },
          { text: 'SECTION', style: 'tableHeader' },
          { text: 'SCHEDULE', style: 'tableHeader' },
          { text: 'ROOM', style: 'tableHeader' },
          { text: 'STATUS', style: 'tableHeader', alignment: 'right' }
        ]
      ];

      // Add subject rows for this date
      dateRecords.forEach((record) => {
        const subjectStatus = (record.verified_status || 'unverified').toLowerCase();
        let statusText = 'Unverified';
        let statusColor = '#9E9E9E'; // Gray
        let statusIcon = '●';

        if (subjectStatus === 'verified' || subjectStatus === 'present') {
          statusText = 'Verified';
          statusColor = '#4CAF50'; // Green
        } else if (subjectStatus === 'late') {
          statusText = 'Late';
          statusColor = '#FF9800'; // Orange
          statusIcon = '●';
        } else if (subjectStatus === 'absent') {
          statusText = 'Absent';
          statusColor = '#F44336'; // Red
          statusIcon = '●';
        }

        const schedule = record.start_time && record.end_time
          ? `${formatTime(record.start_time)} - ${formatTime(record.end_time)}`
          : '-';

        subjectTableBody.push([
          { text: record.subject_code || '-', style: 'tableCell' },
          { text: record.subject_name || '-', style: 'tableCell' },
          { text: record.section_name || '-', style: 'tableCell' },
          { text: schedule, style: 'tableCell' },
          { text: record.room_name || '-', style: 'tableCell' },
          {
            text: [
              { text: statusIcon + ' ', color: statusColor, fontSize: 8 },
              { text: statusText, color: statusColor, fontSize: 8, bold: true }
            ],
            style: 'tableCell',
            alignment: 'right'
          }
        ]);
      });

      content.push({
        table: {
          headerRows: 1,
          widths: ['12%', '28%', '10%', '25%', '10%', '15%'],
          body: subjectTableBody
        },
        layout: {
          hLineWidth: function (i, node) {
            return (i > 0) ? 1 : 0;
          },
          vLineWidth: function (i, node) {
            return 0;
          },
          hLineColor: function (i, node) {
            return '#EEEEEE';
          },
          paddingLeft: function (i) { return 0; },
          paddingRight: function (i) { return 0; },
          paddingTop: function (i) { return 8; },
          paddingBottom: function (i) { return 8; }
        }
      });
    });
  });

  return {
    content: content,
    styles: {
      headerCollege: {
        fontSize: 16,
        bold: true,
        color: '#1F2937' // Dark gray/blue
      },
      headerInfo: {
        fontSize: 10,
        color: '#6B7280' // Gray
      },
      headerProgram: {
        fontSize: 11,
        bold: true,
        color: '#1B5E20', // Dark Green
        margin: [0, 4, 0, 0]
      },
      headerSemester: {
        fontSize: 10,
        color: '#6B7280',
        margin: [0, 2, 0, 0]
      },
      title: {
        fontSize: 14,
        bold: true,
        color: '#333333',
        margin: [0, 0, 0, 5]
      },
      info: {
        fontSize: 9,
        color: '#666666'
      },
      tableHeader: {
        fontSize: 8,
        bold: true,
        color: '#9E9E9E',
        margin: [0, 0, 0, 4]
      },
      tableCell: {
        fontSize: 9,
        color: '#333333'
      }
    },
    defaultStyle: {
      fontSize: 9,
      font: 'Roboto'
    },
    pageOrientation: 'portrait',
    pageMargins: [30, 30, 30, 30]
  };
}

/**
 * Generate Excel Report
 */
/**
 * Generate Excel Report using ExcelJS
 */
function generateExcelReport(data, timeline, dateRange, schoolInfo = {}) {
  try {
    // Check if ExcelJS is available
    if (typeof ExcelJS === 'undefined') {
      console.warn('[Reports] ExcelJS not available, falling back to CSV');
      generateCSVReport(data, timeline, dateRange);
      return;
    }

    // Create workbook with both Summary and Detailed sheets
    const workbook = new ExcelJS.Workbook();

    // Transform data to summary format for the summary sheet
    const summaryData = transformToEmployeeSummary(data);

    // Add Summary sheet
    generateSummaryExcel(workbook, summaryData, timeline, dateRange, schoolInfo);

    // Add Detailed sheet (use detailed/expanded data)
    generateDetailedExcel(workbook, data, timeline, dateRange, schoolInfo);

    // Generate and download
    const filename = `attendance_report_${timeline}_${new Date().getTime()}.xlsx`;
    workbook.xlsx.writeBuffer().then(buffer => {
      const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = filename;
      link.click();
      window.URL.revokeObjectURL(url);

      // Log the download
      const dateRange_value = dateRange || { start: getDefaultStartDate(timeline), end: new Date().toISOString().split('T')[0] };
      logReportDownload('attendance', 'excel', timeline, dateRange_value.start, dateRange_value.end, blob.size, filename);
    });

    console.log('[Reports] Excel generated with ExcelJS - Both Summary and Detailed sheets');
  } catch (error) {
    console.error('[Reports] Excel generation error:', error);
    showReportErrorState('Error generating Excel. Falling back to CSV format.');
    generateCSVReport(data, timeline, dateRange);
  }
}

/**
 * Generate Summary Format Excel (one row per employee per date)
 */
function generateSummaryExcel(workbook, data, timeline, dateRange, schoolInfo = {}) {
  const worksheet = workbook.addWorksheet('Summary');
  const schoolYear = schoolInfo.school_year || '2025-2026';
  const term = schoolInfo.term || 'Second Semester';
  const dailyRows = Array.isArray(data) ? data : [];
  const employeeTotals = buildEmployeeSummaryRows(dailyRows);
  const centerStyle = { horizontal: 'center', vertical: 'middle' };
  const leftStyle = { horizontal: 'left', vertical: 'middle' };

  worksheet.columns = [
    { width: 15 },
    { width: 25 },
    { width: 12 },
    { width: 12 },
    { width: 12 },
    { width: 12 },
    { width: 12 },
    { width: 15 }
  ];
  worksheet.getColumn(2).alignment = { wrapText: true, vertical: 'middle' };

  const addMergedRow = (text, font, height = 18) => {
    const row = worksheet.addRow([text]);
    worksheet.mergeCells(`A${row.number}:H${row.number}`);
    row.font = font;
    row.alignment = centerStyle;
    row.height = height;
    return row;
  };

  addMergedRow('St. Clare College', { bold: true, size: 17, color: { argb: 'FF1F2937' }, name: 'Arial' }, 24);
  addMergedRow('Caloocan City, NCR', { size: 11, color: { argb: 'FF6B7280' }, name: 'Arial' }, 16);
  addMergedRow('Philippines', { size: 11, color: { argb: 'FF6B7280' }, name: 'Arial' }, 16);
  addMergedRow('BACHELOR OF SCIENCE IN COMPUTER SCIENCE', { bold: true, size: 12, color: { argb: 'FF1B5E20' }, name: 'Arial' }, 20);
  addMergedRow(`SY. ${schoolYear} | ${term.toUpperCase()}`, { size: 11, color: { argb: 'FF6B7280' }, name: 'Arial' }, 18);

  const dividerRow = worksheet.addRow(['']);
  dividerRow.height = 8;
  worksheet.mergeCells(`A${dividerRow.number}:H${dividerRow.number}`);
  dividerRow.getCell(1).border = { bottom: { style: 'thin', color: { argb: 'FFE5E7EB' } } };

  worksheet.addRow([]);

  const titleRow = worksheet.addRow(['Employee Totals Across Selected Date Range']);
  worksheet.mergeCells(`A${titleRow.number}:I${titleRow.number}`);
  titleRow.font = { bold: true, size: 15, color: { argb: 'FF333333' }, name: 'Arial' };
  titleRow.alignment = leftStyle;
  titleRow.height = 24;

  const generatedRow = worksheet.addRow(['Generated:', new Date().toLocaleString()]);
  const periodRow = worksheet.addRow(['Period:', getTimelineLabel(timeline, dateRange)]);
  const scopeRow = worksheet.addRow(['Scope:', `Total employees: ${employeeTotals.length}`]);
  [generatedRow, periodRow, scopeRow].forEach(row => {
    row.getCell(1).font = { color: { argb: 'FF6B7280' }, size: 10, name: 'Arial' };
    row.getCell(2).font = { color: { argb: 'FF333333' }, size: 10, name: 'Arial' };
    row.alignment = leftStyle;
    row.height = 16;
  });

  worksheet.addRow([]);

  const totalsHeaderRow = worksheet.addRow(['EMPLOYEE NAME', 'PRESENT', 'LATE', 'ABSENT', 'TOTAL HOURS', 'ABSENT HOURS', 'NET HOURS']);
  totalsHeaderRow.height = 20;
  totalsHeaderRow.eachCell(cell => {
    cell.font = { bold: true, size: 9, color: { argb: 'FF9CA3AF' }, name: 'Arial' };
    cell.alignment = centerStyle;
    cell.border = { bottom: { style: 'thin', color: { argb: 'FFE5E7EB' } } };
  });

  if (employeeTotals.length > 0) {
    employeeTotals.forEach(record => {
      const row = worksheet.addRow([
        record.employee_name || 'Unknown',
        record.verified_count || 0,
        record.late_count || 0,
        record.absent_count || 0,
        record.totalHoursText || '0h 0m',
        record.absentHoursText || '0h 0m',
        record.netHoursText || '0h 0m'
      ]);

      row.height = 20;
      row.eachCell(cell => {
        cell.font = { size: 10, color: { argb: 'FF333333' }, name: 'Arial' };
        cell.border = { bottom: { style: 'thin', color: { argb: 'FFF3F4F6' } } };
        cell.alignment = centerStyle;
      });

      row.getCell(2).font = { size: 10, color: { argb: 'FF2E7D32' }, name: 'Arial' };
      row.getCell(3).font = { size: 10, color: { argb: 'FFEF6C00' }, name: 'Arial' };
      row.getCell(4).font = { size: 10, color: { argb: 'FFC62828' }, name: 'Arial' };
      row.getCell(5).font = { size: 10, color: { argb: 'FF1F4E78' }, name: 'Arial' };
      row.getCell(6).font = { size: 10, color: { argb: 'FFB91C1C' }, name: 'Arial' };
      row.getCell(7).font = { size: 10, color: { argb: 'FF0F766E' }, name: 'Arial' };
    });
  } else {
    const emptyTotalsRow = worksheet.addRow(['No employee totals available']);
    worksheet.mergeCells(`A${emptyTotalsRow.number}:H${emptyTotalsRow.number}`);
    emptyTotalsRow.getCell(1).alignment = centerStyle;
    emptyTotalsRow.getCell(1).font = { italic: true, color: { argb: 'FF6B7280' }, size: 10, name: 'Arial' };
  }

  worksheet.addRow([]);

  const dailyTitleRow = worksheet.addRow(['Attendance Report - Summary by Employee']);
  worksheet.mergeCells(`A${dailyTitleRow.number}:H${dailyTitleRow.number}`);
  dailyTitleRow.font = { bold: true, size: 15, color: { argb: 'FF333333' }, name: 'Arial' };
  dailyTitleRow.alignment = leftStyle;
  dailyTitleRow.height = 24;

  const dailyMetaLeft = worksheet.addRow(['Period:', getTimelineLabel(timeline, dateRange)]);
  const dailyMetaRight = worksheet.addRow(['Generated:', new Date().toLocaleString()]);
  const dailyRowsCount = worksheet.addRow(['Daily rows:', String(dailyRows.length)]);
  [dailyMetaLeft, dailyMetaRight, dailyRowsCount].forEach(row => {
    row.getCell(1).font = { color: { argb: 'FF6B7280' }, size: 10, name: 'Arial' };
    row.getCell(2).font = { color: { argb: 'FF333333' }, size: 10, name: 'Arial' };
    row.alignment = leftStyle;
    row.height = 16;
  });

  worksheet.addRow([]);

  const headerRow = worksheet.addRow(['DATE', 'EMPLOYEE NAME', 'DEPARTMENT', 'TIME IN', 'PRESENT', 'LATE', 'ABSENT', 'TOTAL HOURS']);
  headerRow.height = 20;
  headerRow.eachCell((cell) => {
    cell.font = { bold: true, size: 9, color: { argb: 'FF9CA3AF' }, name: 'Arial' };
    cell.alignment = centerStyle;
    cell.border = { bottom: { style: 'thin', color: { argb: 'FFE5E7EB' } } };
  });

  dailyRows.forEach((record) => {
    const totalHoursText = formatMinutesAsHours(getUniqueSubjectMinutes(record.subjects));
    const row = worksheet.addRow([
      formatDate(record.date),
      record.employee_name || `${record.employee?.first_name || ''} ${record.employee?.last_name || ''}`.trim() || 'Unknown',
      record.employee?.department || record.employee_department || '—',
      formatTime(record.time_in) || '-',
      record.verified_count || '0',
      record.late_count || '0',
      record.absent_count || '0',
      totalHoursText
    ]);

    row.height = 20;
    row.eachCell((cell) => {
      cell.font = { size: 10, color: { argb: 'FF333333' }, name: 'Arial' };
      cell.border = { bottom: { style: 'thin', color: { argb: 'FFF3F4F6' } } };
      cell.alignment = centerStyle;
    });

    row.getCell(5).font = { size: 10, color: { argb: 'FF2E7D32' }, name: 'Arial' };
    row.getCell(6).font = { size: 10, color: { argb: 'FFEF6C00' }, name: 'Arial' };
    row.getCell(7).font = { size: 10, color: { argb: 'FFC62828' }, name: 'Arial' };
    row.getCell(8).font = { size: 10, color: { argb: 'FF1F4E78' }, name: 'Arial' };
  });

  return workbook;
}

/**
 * Generate Detailed Format Excel with 3-level hierarchy: Employee → Date → Subjects
 */
function generateDetailedExcel(workbook, data, timeline, dateRange, schoolInfo = {}) {
  const worksheet = workbook.addWorksheet('Detailed');
  const schoolYear = schoolInfo.school_year || '2025-2026';
  const term = schoolInfo.term || 'Second Semester';

  // Set column widths
  const columns = [18, 25, 12, 22, 18, 15];
  worksheet.columns = columns.map(width => ({ width }));
  worksheet.getColumn(2).alignment = { wrapText: true, vertical: 'middle' };
  worksheet.getColumn(4).alignment = { wrapText: true, vertical: 'middle' };
  worksheet.getColumn(5).alignment = { wrapText: true, vertical: 'middle' };

  // Helper for centering text
  const centerStyle = { horizontal: 'center', vertical: 'middle' };
  const leftStyle = { horizontal: 'left', vertical: 'middle' };

  // --- HEADER SECTION ---

  // St. Clare College
  const collegeRowNum = worksheet.addRow(['St. Clare College']).number;
  worksheet.mergeCells(`A${collegeRowNum}:F${collegeRowNum}`);
  const collegeRow = worksheet.getRow(collegeRowNum);
  collegeRow.font = { bold: true, size: 17, color: { argb: 'FF1F2937' }, name: 'Arial' }; // Dark Gray
  collegeRow.alignment = centerStyle;
  collegeRow.height = 24;

  // Location
  const locationRowNum = worksheet.addRow(['Caloocan City, NCR']).number;
  worksheet.mergeCells(`A${locationRowNum}:F${locationRowNum}`);
  const locationRow = worksheet.getRow(locationRowNum);
  locationRow.font = { size: 11, color: { argb: 'FF6B7280' }, name: 'Arial' }; // Gray
  locationRow.alignment = centerStyle;
  locationRow.height = 16;

  // Country
  const countryRowNum = worksheet.addRow(['Philippines']).number;
  worksheet.mergeCells(`A${countryRowNum}:F${countryRowNum}`);
  const countryRow = worksheet.getRow(countryRowNum);
  countryRow.font = { size: 11, color: { argb: 'FF6B7280' }, name: 'Arial' };
  countryRow.alignment = centerStyle;
  countryRow.height = 16;

  // Program Name (Green)
  const programRowNum = worksheet.addRow(['BACHELOR OF SCIENCE IN COMPUTER SCIENCE']).number;
  worksheet.mergeCells(`A${programRowNum}:F${programRowNum}`);
  const programRow = worksheet.getRow(programRowNum);
  programRow.font = { bold: true, size: 12, color: { argb: 'FF1B5E20' }, name: 'Arial' }; // Dark Green
  programRow.alignment = centerStyle;
  programRow.height = 20;

  // Semester Info
  const semesterRowNum = worksheet.addRow([`SY. ${schoolYear} | ${term.toUpperCase()}`]).number;
  worksheet.mergeCells(`A${semesterRowNum}:F${semesterRowNum}`);
  const semesterRow = worksheet.getRow(semesterRowNum);
  semesterRow.font = { size: 11, color: { argb: 'FF6B7280' }, name: 'Arial' };
  semesterRow.alignment = centerStyle;
  semesterRow.height = 18;

  // Divider Line
  const dividerRow = worksheet.addRow(['']);
  dividerRow.height = 8;
  worksheet.mergeCells(`A${dividerRow.number}:F${dividerRow.number}`);
  dividerRow.getCell(1).border = { bottom: { style: 'thin', color: { argb: 'FFE5E7EB' } } };

  worksheet.addRow([]); // Gap

  // Report Title
  const titleRow = worksheet.addRow(['Attendance Report - Detailed by Subject']);
  worksheet.mergeCells(`A${titleRow.number}:F${titleRow.number}`);
  titleRow.font = { bold: true, size: 15, color: { argb: 'FF333333' }, name: 'Arial' };
  titleRow.alignment = leftStyle;
  titleRow.height = 24;

  // Metadata
  const generatedRow = worksheet.addRow(['Generated:', new Date().toLocaleString()]);
  const periodRow = worksheet.addRow(['Period:', getTimelineLabel(timeline, dateRange)]);

  [generatedRow, periodRow].forEach(row => {
    row.getCell(1).font = { color: { argb: 'FF6B7280' }, size: 10, name: 'Arial' };
    row.getCell(2).font = { color: { argb: 'FF333333' }, size: 10, name: 'Arial' };
    row.alignment = leftStyle;
    row.height = 16;
  });

  worksheet.addRow([]); // Gap

  // --- DATA PROCESSING ---

  // Group data by employee, then by date
  const employeeGroups = {};

  data.forEach(record => {
    const empId = record.employee_id || record.employee?.employee_id;
    const empName = `${record.employee?.first_name || ''} ${record.employee?.last_name || ''}`;
    const empKey = `${empId}_${empName}`;
    const dateKey = record.date || new Date().toISOString().split('T')[0];

    if (!employeeGroups[empKey]) {
      employeeGroups[empKey] = {
        employee_id: empId,
        employee_name: empName,
        dateGroups: {}
      };
    }

    if (!employeeGroups[empKey].dateGroups[dateKey]) {
      employeeGroups[empKey].dateGroups[dateKey] = [];
    }

    employeeGroups[empKey].dateGroups[dateKey].push(record);
  });

  // --- RENDER EMPLOYEE DATA ---

  Object.values(employeeGroups).forEach((empGroup, groupIdx) => {

    // Employee Header Row (Gray Background, Green Left Border)
    const empRow = worksheet.addRow([
      `${empGroup.employee_name}  |  ${empGroup.department}`,
      '', '', '', '', ''
    ]);

    worksheet.mergeCells(`A${empRow.number}:F${empRow.number}`);

    empRow.height = 28;
    const empCell = empRow.getCell(1);
    empCell.font = { bold: true, size: 13, color: { argb: 'FF333333' }, name: 'Arial' };
    empCell.alignment = { vertical: 'middle', indent: 1 };
    empCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF9FAFB' } }; // Light Gray
    // Border strategy: Thicker green left border
    empCell.border = { left: { style: 'medium', color: { argb: 'FF4CAF50' } } };

    // Sort dates
    const sortedDates = Object.keys(empGroup.dateGroups).sort();

    sortedDates.forEach((dateKey) => {
      const dateRecords = empGroup.dateGroups[dateKey];
      const firstRecord = dateRecords[0];
      const dateStatus = (firstRecord.status || 'UNKNOWN').toUpperCase();
      const checkIn = formatTime(firstRecord.time_in) || '-';
      const checkOut = formatTime(firstRecord.time_out) || '-';

      // Format Date
      const dateObj = new Date(dateKey + 'T00:00:00');
      const formattedDate = dateObj.toLocaleDateString('en-US', {
        weekday: 'short', year: 'numeric', month: 'long', day: 'numeric'
      });

      // Date Header Row
      const dateRow = worksheet.addRow([
        formattedDate,          // A: Date
        '',                     // B: (part of merge)
        '',                     // C: Empty
        `Check In: ${checkIn}   Check Out: ${checkOut}`, // D (Merged)
        '', ''
      ]);

      // Merge date cell across 2 columns (A:B) and check in/out (D:F)
      worksheet.mergeCells(`A${dateRow.number}:B${dateRow.number}`);
      worksheet.mergeCells(`D${dateRow.number}:F${dateRow.number}`);

      dateRow.height = 22;

      // Style Date (Col A) - merged with B
      const dateCell = dateRow.getCell(1);
      dateCell.font = { bold: true, size: 11, color: { argb: 'FF1F2937' }, name: 'Arial' };
      dateCell.alignment = leftStyle;

      // Style Check In/Out (Col D)
      const timeCell = dateRow.getCell(4);
      timeCell.font = { size: 10, color: { argb: 'FF6B7280' }, name: 'Arial' };
      timeCell.alignment = { horizontal: 'right', vertical: 'middle' };

      // Subject Headers
      const headerRow = worksheet.addRow([
        'CODE', 'SUBJECT NAME', 'SECTION', 'SCHEDULE', 'ROOM', 'STATUS'
      ]);
      headerRow.height = 20;

      headerRow.eachCell((cell, colNumber) => {
        if (colNumber <= 6) {
          cell.font = { bold: true, size: 9, color: { argb: 'FF9CA3AF' }, name: 'Arial' }; // Light Gray Text
          cell.alignment = centerStyle;
          cell.border = { bottom: { style: 'thin', color: { argb: 'FFE5E7EB' } } }; // Light border bottom
        }
      });
      // Fix header text for last column
      headerRow.getCell(6).value = 'STATUS';

      // Subject Rows
      dateRecords.forEach(record => {
        const subjectStatus = (record.verified_status || 'unverified').toLowerCase();
        let statusText = 'Unverified';
        let statusColor = 'FF9E9E9E'; // Gray

        if (subjectStatus === 'verified' || subjectStatus === 'present') {
          statusText = 'Verified';
          statusColor = 'FF4CAF50'; // Green
        } else if (subjectStatus === 'late') {
          statusText = 'Late';
          statusColor = 'FFFF9800'; // Orange
        } else if (subjectStatus === 'absent') {
          statusText = 'Absent';
          statusColor = 'FFF44336'; // Red
        }

        const schedule = record.start_time && record.end_time
          ? `${formatTime(record.start_time)} - ${formatTime(record.end_time)}`
          : '-';

        const row = worksheet.addRow([
          record.subject_code || '-',
          record.subject_name || '-',
          record.section_name || '-',
          schedule,
          record.room_name || '-',
          statusText // Status Text
        ]);

        row.height = 20;

        // Apply styles to row
        row.eachCell((cell, colNumber) => {
          if (colNumber <= 6) {
            cell.font = { size: 10, color: { argb: 'FF333333' }, name: 'Arial' };
            cell.alignment = centerStyle;
            cell.border = { bottom: { style: 'thin', color: { argb: 'FFF3F4F6' } } }; // Very light border
          }
        });

        // Specific style for Status cell
        const statusCell = row.getCell(6);
        statusCell.font = { bold: true, size: 10, color: { argb: statusColor }, name: 'Arial' };
        statusCell.alignment = centerStyle;
      });

      worksheet.addRow([]); // Spacer
    });

    // Add blank row between employee groups
    if (groupIdx < Object.values(employeeGroups).length - 1) {
      worksheet.addRow([]);
    }
  });

  // Auto-fit columns - properly iterate through worksheet rows
  const columnWidths = {};

  worksheet.eachRow((row, rowNum) => {
    // Skip header block (rows 1-12) to avoid over-wide columns
    const isHeaderBlock = rowNum <= 12;

    row.eachCell((cell, colNum) => {
      const cellValue = cell.value ? cell.value.toString() : "";
      const cellLength = cellValue.length;

      // Initialize if not exists
      if (!columnWidths[colNum]) {
        columnWidths[colNum] = { header: 0, body: 0 };
      }

      // Track separately for header and body
      if (isHeaderBlock) {
        columnWidths[colNum].header = Math.max(columnWidths[colNum].header, cellLength);
      } else {
        columnWidths[colNum].body = Math.max(columnWidths[colNum].body, cellLength);
      }
    });
  });

  // Apply widths to columns - fit content with reasonable bounds
  const minWidthByColDetailed = { 1: 12, 2: 16, 3: 10, 4: 14, 5: 10, 6: 10 };
  const maxWidthByColDetailed = { 1: 20, 2: 36, 3: 14, 4: 22, 5: 16, 6: 14 };

  worksheet.columns.forEach((column, colIndex) => {
    const colNum = colIndex + 1;
    const widthData = columnWidths[colNum] || { header: 0, body: 0 };
    const minWidth = minWidthByColDetailed[colNum] || 8;
    const maxWidth = maxWidthByColDetailed[colNum] || 30;

    // Use body length if available, otherwise use header (capped at 20)
    const effectiveLength = widthData.body > 0 ? widthData.body : Math.min(widthData.header, 20);
    const calculatedWidth = (effectiveLength * 1.1) + 1;

    column.width = Math.max(minWidth, Math.min(maxWidth, calculatedWidth));
  });

  return workbook;
}
function generateCSVReport(data, timeline, dateRange) {
  try {
    // Use summary format for CSV
    const headers = ['Date', 'Employee Name', 'Employee ID', 'Check In', 'Overall Status', 'Present', 'Late', 'Absent', 'Unverified'];

    const csvContent = [
      ['Attendance Report - Summary by Employee'].join(','),
      ['Generated:', new Date().toLocaleString()].join(','),
      ['Period:', getTimelineLabel(timeline, dateRange)].join(','),
      [],
      headers.join(','),
      ...data.map(record => [
        formatDate(record.date),
        `"${record.employee?.first_name || ''} ${record.employee?.last_name || ''}"`,
        record.employee_id || record.employee?.employee_id || '-',
        formatTime(record.time_in) || '-',
        record.status ? record.status.toUpperCase() : '',
        record.verified_count || '0',
        record.late_count || '0',
        record.absent_count || '0',
        record.unverified_count || '0'
      ].map(cell => `"${String(cell).replace(/"/g, '""')}"`)
        .join(','))
    ].join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `attendance_report_${timeline}_${new Date().getTime()}.csv`;
    link.click();
    window.URL.revokeObjectURL(url);

    console.log('[Reports] CSV generated and downloaded');
  } catch (error) {
    console.error('[Reports] CSV generation error:', error);
    showReportErrorState('Error generating report');
  }
}

/**
 * Helper: Format date
 */
function formatDate(dateStr) {
  if (!dateStr) return '-';
  try {
    const date = new Date(dateStr);
    return date.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
  } catch (e) {
    return dateStr;
  }
}

/**
 * Helper: Format time
 */
function formatTime(timeStr) {
  if (!timeStr) return '-';
  try {
    const parts = String(timeStr).split(':');
    const hours = parseInt(parts[0], 10);
    const minutes = parts[1] || '00';
    const period = hours >= 12 ? 'PM' : 'AM';
    const displayHours = hours % 12 || 12;
    return `${displayHours}:${minutes} ${period}`;
  } catch (e) {
    return timeStr;
  }
}

/**
 * Helper: Get timeline label
 */
function getTimelineLabel(timeline, dateRange) {
  const today = new Date();

  switch (timeline) {
    case 'daily':
      return today.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
    case 'weekly':
      const weekStart = new Date(today);
      weekStart.setDate(today.getDate() - 7);
      return `${weekStart.toLocaleDateString('en-US')} to ${today.toLocaleDateString('en-US')}`;
    case 'monthly':
      const monthStart = new Date(today);
      monthStart.setDate(today.getDate() - 30);
      return `${monthStart.toLocaleDateString('en-US')} to ${today.toLocaleDateString('en-US')}`;
    case 'custom':
      return `${dateRange?.start} to ${dateRange?.end}`;
    default:
      return 'N/A';
  }
}

/**
 * Show/hide loading state
 */
function showReportLoadingState(show) {
  // Create if doesn't exist
  let loader = document.getElementById('report-loading');
  if (!loader && show) {
    loader = document.createElement('div');
    loader.id = 'report-loading';
    loader.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      background: rgba(0,0,0,0.3);
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 9999;
    `;
    loader.innerHTML = `
      <div style="background: var(--bg-secondary); padding: 24px; border-radius: 8px; text-align: center;">
        <div class="spinner" style="margin-bottom: 12px;"></div>
        <p style="color: var(--text-primary); margin: 0;">Generating report...</p>
      </div>
    `;
    document.body.appendChild(loader);
  }

  if (loader) {
    loader.style.display = show ? 'flex' : 'none';
  }
}

/**
 * Show error state with modal
 */
function showReportErrorState(message) {
  // Create if doesn't exist
  let errorModal = document.getElementById('report-error');
  if (!errorModal) {
    errorModal = document.createElement('div');
    errorModal.id = 'report-error';
    errorModal.className = 'modal-overlay';
    errorModal.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      background: rgba(0,0,0,0.7);
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 9999;
    `;
    document.body.appendChild(errorModal);
  }

  // Update content with styled modal matching success modal
  errorModal.innerHTML = `
    <div class="modal-content" style="max-width: 400px; text-align: center;">
      <div class="modal-body" style="padding: 40px 30px; display: flex; flex-direction: column; align-items: center; gap: 20px;">
        <div style="width: 80px; height: 80px; background: #fbbf24; border-radius: 50%; display: flex; align-items: center; justify-content: center;">
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2z"></path>
            <line x1="12" y1="8" x2="12" y2="12"></line>
            <line x1="12" y1="16" x2="12.01" y2="16"></line>
          </svg>
        </div>
        <h3 style="margin: 0; font-size: 20px; font-weight: 700; color: var(--text-primary);">Alert</h3>
        <p style="margin: 0; font-size: 14px; color: var(--text-secondary); line-height: 1.5;">${message}</p>
        <button onclick="document.getElementById('report-error').style.display = 'none';" class="btn btn-primary" style="margin-top: 10px; min-width: 120px; cursor: pointer;">OK</button>
      </div>
    </div>
  `;
  errorModal.style.display = 'flex';
}

/**
 * Helper: Fetch head info
 */
async function fetchHeadInfo() {
  try {
    const apiBase = window.API_URL || '/api';
    const response = await window.fetchWithAuth(`${apiBase}/departmenthead/employees?_limit=1`);
    if (response.ok) {
      const data = await response.json();
      return { dept_id: data.dept_id };
    }
    return null;
  } catch (error) {
    console.error('[Reports] Error fetching head info:', error);
    return null;
  }
}

/**
 * Helper: Calculate default start date based on timeline
 */
function getDefaultStartDate(timeline) {
  const today = new Date();
  let startDate = new Date();

  switch (timeline) {
    case 'daily':
      startDate = new Date(today);
      break;
    case 'weekly':
      startDate = new Date(today);
      startDate.setDate(today.getDate() - 7);
      break;
    case 'monthly':
      startDate = new Date(today);
      startDate.setMonth(today.getMonth());
      startDate.setDate(1);
      break;
    case 'custom':
      return today.toISOString().split('T')[0];
  }

  return startDate.toISOString().split('T')[0];
}

/**
 * Log report download to backend
 */
async function logReportDownload(reportType, fileFormat, reportTimeline, dateFrom, dateTo, fileSizeBytes = null, fileName = null) {
  try {
    const apiBase = window.API_URL || '/api';

    // Ensure dates are in YYYY-MM-DD format
    const dateFromFormatted = dateFrom.split('T')[0];
    const dateToFormatted = dateTo.split('T')[0];

    const response = await window.fetchWithAuth(`${apiBase}/departmenthead/log-report-download`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        reportType,
        fileFormat,
        reportTimeline,
        dateFrom: dateFromFormatted,
        dateTo: dateToFormatted,
        fileSizeBytes,
        fileName
      })
    });

    if (!response.ok) {
      console.warn('[Reports] Failed to log download:', await response.text());
      return false;
    }

    console.log('[Reports] Download logged successfully');
    return true;
  } catch (error) {
    console.error('[Reports] Error logging download:', error);
    // Don't throw - logging failure shouldn't affect user experience
    return false;
  }
}

/**
 * Export functions for external use
 */
export async function refreshAttendanceReport() {
  await handleAttendanceReportGeneration();
}

export { showReportLoadingState, showReportErrorState, getReportHeader, fetchCurrentSchoolInfo };
