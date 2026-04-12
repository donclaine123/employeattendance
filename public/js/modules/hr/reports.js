/**
 * HR Reports Module
 * Handles report generation, formatting, and export for HR Dashboard
 * Reports: Daily Attendance, Custom Report, Monthly Summary, Employee Masterlist,
 *          Tardiness & Absenteeism, Adjustment History
 */

import { fetchWithAuth } from './utils.js';

// ============================================================
//  CONSTANTS & STATE
// ============================================================

const DAY_ORDER = { 'M': 1, 'T': 2, 'W': 3, 'TH': 4, 'F': 5, 'S': 6, 'SU': 7 };

const COLORS = {
    green: '#1B5E20',
    greenLt: '#4CAF50',
    greenBg: '#E8F5E9',
    red: '#C62828',
    redLt: '#EF5350',
    redBg: '#FFEBEE',
    gray: '#333333',
    grayMd: '#666666',
    grayLt: '#9E9E9E',
    grayBdr: '#E5E7EB',
    white: '#FFFFFF',
};

// ============================================================
//  INITIALISATION
// ============================================================

export function initReports() {
    console.log('[HR-Reports] Initializing reports module');
    setupReportCardListeners();
    setupModalListeners();
    populateDepartmentDropdowns();
    populateEmployeeDropdowns();
}

// ============================================================
//  EVENT WIRING
// ============================================================

function setupReportCardListeners() {
    // Daily Attendance
    bindBtn('btnDailyAttendancePDF', () => openReportModal('dailyAttendanceModal'));
    bindBtn('btnDailyAttendanceXlsx', () => openReportModal('dailyAttendanceModal', 'excel'));

    // Custom Report
    bindBtn('btnCustomReportPDF', () => openReportModal('customReportModal'));
    bindBtn('btnCustomReportXlsx', () => openReportModal('customReportModal', 'excel'));

    // Monthly Summary
    bindBtn('btnMonthlySummaryPDF', () => openReportModal('monthlySummaryModal'));
    bindBtn('btnMonthlySummaryXlsx', () => openReportModal('monthlySummaryModal', 'excel'));

    // Employee Masterlist
    bindBtn('btnEmployeeMasterPDF', () => openReportModal('employeeMasterModal'));
    bindBtn('btnEmployeeMasterXlsx', () => openReportModal('employeeMasterModal', 'excel'));

    // Tardiness & Absenteeism
    bindBtn('btnTardinessPDF', () => openReportModal('tardinessModal'));
    bindBtn('btnTardinessXlsx', () => openReportModal('tardinessModal', 'excel'));

    // Adjustment History
    bindBtn('btnAdjustmentPDF', () => openReportModal('adjustmentModal'));
    bindBtn('btnAdjustmentXlsx', () => openReportModal('adjustmentModal', 'excel'));
}

function setupModalListeners() {
    // Close buttons
    document.querySelectorAll('.hr-report-modal .modal-close').forEach(btn => {
        btn.addEventListener('click', () => closeAllModals());
    });
    document.querySelectorAll('.hr-report-modal .btn-cancel-report').forEach(btn => {
        btn.addEventListener('click', () => closeAllModals());
    });

    // Overlay click to close
    document.querySelectorAll('.hr-report-modal').forEach(modal => {
        modal.addEventListener('click', (e) => {
            if (e.target === modal) closeAllModals();
        });
    });

    // Generate buttons
    bindBtn('btnGenerateDailyAttendance', handleGenerateDailyAttendance);
    bindBtn('btnGenerateCustomReport', handleGenerateCustomReport);
    bindBtn('btnGenerateMonthlySummary', handleGenerateMonthlySummary);
    bindBtn('btnGenerateEmployeeMaster', handleGenerateEmployeeMaster);
    bindBtn('btnGenerateTardiness', handleGenerateTardiness);
    bindBtn('btnGenerateAdjustment', handleGenerateAdjustment);
}

// ============================================================
//  MODAL MANAGEMENT
// ============================================================

let pendingFormat = 'pdf'; // default

function openReportModal(modalId, format = 'pdf') {
    pendingFormat = format;
    const modal = document.getElementById(modalId);
    if (!modal) return;

    // Set format radio if exists
    const formatRadio = modal.querySelector(`input[name="format"][value="${format}"]`);
    if (formatRadio) formatRadio.checked = true;

    if (modalId === 'customReportModal') {
        const startInput = modal.querySelector('#customStart');
        const endInput = modal.querySelector('#customEnd');

        if (endInput && !endInput.value) {
            endInput.value = getLocalISODate();
        }

        if (startInput && !startInput.value) {
            const defaultStart = new Date();
            defaultStart.setMonth(defaultStart.getMonth() - 1);
            startInput.value = getLocalISODate(defaultStart);
        }
    }

    modal.style.display = 'flex';
    setTimeout(() => modal.classList.add('active'), 10);
}

function closeAllModals() {
    document.querySelectorAll('.hr-report-modal').forEach(modal => {
        modal.classList.remove('active');
        setTimeout(() => { modal.style.display = 'none'; }, 200);
    });
}

// ============================================================
//  DEPARTMENT DROPDOWN POPULATION
// ============================================================

async function populateDepartmentDropdowns() {
    try {
        const res = await fetchWithAuth('/api/hr/departments');
        if (!res.ok) return;
        const json = await res.json();
        const departments = json.data || [];

        document.querySelectorAll('.hr-report-dept-filter').forEach(select => {
            departments.forEach(dept => {
                const opt = document.createElement('option');
                opt.value = dept.id || dept.dept_id;
                opt.textContent = dept.name || dept.dept_name;
                select.appendChild(opt);
            });
        });
    } catch (err) {
        console.warn('[HR-Reports] Could not load departments:', err);
    }
}

async function populateEmployeeDropdowns() {
    try {
        const employees = await fetchAllEmployees();
        const employeeOptions = (employees || [])
            .slice()
            .sort((a, b) => {
                const nameA = `${a.last_name || ''} ${a.first_name || ''}`.trim();
                const nameB = `${b.last_name || ''} ${b.first_name || ''}`.trim();
                return nameA.localeCompare(nameB);
            });

        document.querySelectorAll('.hr-report-employee-filter').forEach(select => {
            employeeOptions.forEach(emp => {
                const opt = document.createElement('option');
                opt.value = emp.employee_id || emp.id;
                const displayName = `${emp.last_name || ''}, ${emp.first_name || ''}`.replace(/^,\s*/, '').trim() || emp.name || emp.full_name || `Employee ${opt.value}`;
                const department = emp.department || emp.department_name || emp.dept_name || 'N/A';
                opt.textContent = `${displayName} (${department})`;
                select.appendChild(opt);
            });
        });
    } catch (err) {
        console.warn('[HR-Reports] Could not load employees:', err);
    }
}

// ============================================================
//  REPORT GENERATION HANDLERS
// ============================================================

async function handleGenerateDailyAttendance() {
    const modal = document.getElementById('dailyAttendanceModal');
    const date = modal.querySelector('#dailyDate').value;
    const deptId = modal.querySelector('#dailyDept').value;
    const format = getSelectedFormat(modal);

    if (!date) { alert('Please select a date.'); return; }

    closeAllModals();
    showReportLoading(true);

    try {
        // Fetch subject-enriched data for combined Summary + Detailed report
        const enrichedData = await fetchAttendanceWithSubjects(date, date, deptId);
        const schoolInfo = getDefaultSchoolInfo();

        if (format === 'pdf') {
            await generateCombinedAttendancePDF(enrichedData, { date, deptId }, schoolInfo);
        } else {
            await generateCombinedAttendanceExcel(enrichedData, { date, deptId }, schoolInfo);
        }
    } catch (err) {
        console.error('[HR-Reports] Daily Attendance error:', err);
        showReportError('Failed to generate Daily Attendance report.');
    } finally {
        showReportLoading(false);
    }
}

async function handleGenerateMonthlySummary() {
    const modal = document.getElementById('monthlySummaryModal');
    const month = modal.querySelector('#summaryMonth').value;
    const deptId = modal.querySelector('#summaryDept').value;
    const format = getSelectedFormat(modal);

    if (!month) { alert('Please select a month.'); return; }

    closeAllModals();
    showReportLoading(true);

    try {
        // month = "2026-02" → startDate = 2026-02-01, endDate = 2026-02-28
        const [year, mon] = month.split('-').map(Number);
        const startDate = `${year}-${String(mon).padStart(2, '0')}-01`;
        const lastDay = new Date(year, mon, 0).getDate();
        const endDate = `${year}-${String(mon).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;

        const data = await fetchAttendanceWithSubjects(startDate, endDate, deptId);
        const employees = await fetchAllEmployees(deptId);
        const schoolInfo = getDefaultSchoolInfo();

        const summary = aggregateMonthlySummary(data, employees, startDate, endDate);

        if (format === 'pdf') {
            await generateMonthlySummaryPDF(summary, data, { month, deptId, startDate, endDate }, schoolInfo);
        } else {
            await generateMonthlySummaryExcel(summary, data, { month, deptId, startDate, endDate }, schoolInfo);
        }
    } catch (err) {
        console.error('[HR-Reports] Monthly Summary error:', err);
        showReportError('Failed to generate Monthly Summary report.');
    } finally {
        showReportLoading(false);
    }
}

async function handleGenerateEmployeeMaster() {
    const modal = document.getElementById('employeeMasterModal');
    const deptId = modal.querySelector('#masterDept').value;
    const status = modal.querySelector('#masterStatus').value;
    const format = getSelectedFormat(modal);

    closeAllModals();
    showReportLoading(true);

    try {
        const employees = await fetchAllEmployees(deptId, status);
        const schoolInfo = getDefaultSchoolInfo();

        if (employees.length === 0) {
            showReportError('No employees found with the selected filters.');
            return;
        }

        if (format === 'pdf') {
            await generateEmployeeMasterlistPDF(employees, { deptId, status }, schoolInfo);
        } else {
            await generateEmployeeMasterlistExcel(employees, { deptId, status }, schoolInfo);
        }
    } catch (err) {
        console.error('[HR-Reports] Employee Master error:', err);
        showReportError('Failed to generate Employee Masterlist report.');
    } finally {
        showReportLoading(false);
    }
}

async function handleGenerateTardiness() {
    const modal = document.getElementById('tardinessModal');
    const startDate = modal.querySelector('#tardinessStart').value;
    const endDate = modal.querySelector('#tardinessEnd').value;
    const deptId = modal.querySelector('#tardinessDept').value;
    const format = getSelectedFormat(modal);

    if (!startDate || !endDate) { alert('Please select a date range.'); return; }

    closeAllModals();
    showReportLoading(true);

    try {
        const data = await fetchAttendanceData(startDate, endDate, deptId);
        const schoolInfo = getDefaultSchoolInfo();

        const analysis = aggregateTardiness(data, startDate, endDate);

        if (format === 'pdf') {
            await generateTardinessPDF(analysis, { startDate, endDate, deptId }, schoolInfo);
        } else {
            await generateTardinessExcel(analysis, { startDate, endDate, deptId }, schoolInfo);
        }
    } catch (err) {
        console.error('[HR-Reports] Tardiness error:', err);
        showReportError('Failed to generate Tardiness report.');
    } finally {
        showReportLoading(false);
    }
}

async function handleGenerateAdjustment() {
    const modal = document.getElementById('adjustmentModal');
    const startDate = modal.querySelector('#adjustmentStart').value;
    const endDate = modal.querySelector('#adjustmentEnd').value;
    const format = getSelectedFormat(modal);

    if (!startDate || !endDate) { alert('Please select a date range.'); return; }

    closeAllModals();
    showReportLoading(true);

    try {
        const data = await fetchAdjustmentHistory(startDate, endDate);
        const schoolInfo = getDefaultSchoolInfo();

        if (data.length === 0) {
            showReportError('No adjustment records found for the selected date range.');
            return;
        }

        if (format === 'pdf') {
            await generateAdjustmentHistoryPDF(data, { startDate, endDate }, schoolInfo);
        } else {
            await generateAdjustmentHistoryExcel(data, { startDate, endDate }, schoolInfo);
        }
    } catch (err) {
        console.error('[HR-Reports] Adjustment History error:', err);
        showReportError('Failed to generate Adjustment History report.');
    } finally {
        showReportLoading(false);
    }
}

async function handleGenerateCustomReport() {
    const modal = document.getElementById('customReportModal');
    const startDate = modal.querySelector('#customStart').value;
    const endDate = modal.querySelector('#customEnd').value;
    const deptId = modal.querySelector('#customDept').value;
    const employeeId = modal.querySelector('#customEmployee').value;
    const format = getSelectedFormat(modal);

    if (!startDate || !endDate) { alert('Please select a date range.'); return; }
    if (startDate > endDate) { alert('Start date must be before end date.'); return; }

    closeAllModals();
    showReportLoading(true);

    try {
        const data = await fetchAttendanceWithSubjects(startDate, endDate, deptId, employeeId);
        const schoolInfo = getDefaultSchoolInfo();

        const filters = {
            startDate,
            endDate,
            deptId,
            reportTitle: 'Custom Report',
            fileBase: 'custom_report',
        };

        if (format === 'pdf') {
            await generateCombinedAttendancePDF(data, filters, schoolInfo);
        } else {
            await generateCombinedAttendanceExcel(data, filters, schoolInfo);
        }
    } catch (err) {
        console.error('[HR-Reports] Custom Report error:', err);
        showReportError('Failed to generate Custom Report.');
    } finally {
        showReportLoading(false);
    }
}

// ============================================================
//  DATA FETCHING
// ============================================================

async function fetchAttendanceData(startDate, endDate, departmentId = '') {
    let url = `/api/hr/attendance?startDate=${startDate}&endDate=${endDate}&_limit=9999`;
    if (departmentId) url += `&departmentId=${departmentId}`;

    const res = await fetchWithAuth(url);
    if (!res.ok) throw new Error('Failed to fetch attendance data');
    const json = await res.json();
    return json.data || [];
}

async function fetchAttendanceWithSubjects(dateFrom, dateTo, departmentId = '', employeeId = '') {
    let url = `/api/hr/attendance-with-subjects?date_from=${dateFrom}&date_to=${dateTo}`;
    if (departmentId) url += `&department_id=${departmentId}`;
    if (employeeId) url += `&employee_id=${employeeId}`;

    const res = await fetchWithAuth(url);
    if (!res.ok) throw new Error('Failed to fetch attendance with subjects');
    const json = await res.json();
    return json.data || [];
}

async function fetchAllEmployees(departmentId = '', status = '') {
    let url = `/api/hr/employees?_limit=9999&excludeRoles=hr,head_dept,superadmin`;
    if (departmentId) url += `&departmentId=${departmentId}`;
    if (status) url += `&status=${status}`;

    const res = await fetchWithAuth(url);
    if (!res.ok) throw new Error('Failed to fetch employees');
    const json = await res.json();
    return json.data || [];
}

async function fetchAdjustmentHistory(startDate, endDate) {
    const url = `/api/hr/adjustments/history?startDate=${startDate}&endDate=${endDate}&_limit=9999`;
    const res = await fetchWithAuth(url);
    if (!res.ok) throw new Error('Failed to fetch adjustment history');
    const json = await res.json();
    return json.data || [];
}

// ============================================================
//  DATA AGGREGATION
// ============================================================

function aggregateMonthlySummary(attendanceRecords, employees, startDate, endDate) {
    const empMap = {};

    // Initialize with all employees
    employees.forEach(emp => {
        const id = emp.id || emp.employee_id;
        empMap[id] = {
            id: id,
            name: `${emp.last_name || ''}, ${emp.first_name || ''}`.trim(),
            department: emp.department || emp.department_name || emp.dept_name || 'N/A',
            present: 0,
            absent: 0,
            late: 0,
            unverifiedCount: 0,
            verifiedMinutes: 0,
            unverifiedMinutes: 0,
            totalDays: 0,
        };
    });

    // Count by unique employee+date, and accumulate subject hours by verification status
    const dateSet = {};
    attendanceRecords.forEach(rec => {
        const empId = rec.employee_id;
        const empObj = rec.employee || {};
        const date = (rec.date || rec.attendance_date || '').split('T')[0];
        const key = `${empId}_${date}`;

        if (!empMap[empId]) {
            empMap[empId] = {
                id: empId,
                name: empObj.first_name
                    ? `${empObj.last_name || ''}, ${empObj.first_name || ''}`.trim()
                    : (rec.employee_name || `Employee ${empId}`),
                department: empObj.department || rec.department_name || rec.department || 'N/A',
                present: 0, absent: 0, late: 0, unverifiedCount: 0, verifiedMinutes: 0, unverifiedMinutes: 0, totalDays: 0,
            };
        }

        if (!dateSet[key]) {
            dateSet[key] = true;
            empMap[empId].totalDays++;

            const status = (rec.status || '').toLowerCase();
            if (status === 'present' || status === 'checked_in' || status === 'checked_out') {
                empMap[empId].present++;
            } else if (status === 'absent') {
                empMap[empId].absent++;
            } else if (status === 'late') {
                empMap[empId].late++;
                empMap[empId].present++;
            }
        }

        // Accumulate subject hours by verification status
        if (rec.subjects && Array.isArray(rec.subjects)) {
            rec.subjects.forEach(sub => {
                const mins = computeSubjectMinutes(sub.start_time, sub.end_time);
                const vs = (sub.verified_status || '').toLowerCase();
                if (vs === 'verified' || vs === 'present' || vs === 'late') {
                    empMap[empId].verifiedMinutes += mins;
                } else {
                    empMap[empId].unverifiedMinutes += mins;
                    empMap[empId].unverifiedCount++;
                }
            });
        }
    });

    // Convert minutes to display strings
    return Object.values(empMap).map(emp => ({
        ...emp,
        verifiedHours: formatMinutesToHM(emp.verifiedMinutes),
        unverifiedHours: formatMinutesToHM(emp.unverifiedMinutes),
    })).sort((a, b) => a.name.localeCompare(b.name));
}

// Helper: compute minutes from start/end time strings
function computeSubjectMinutes(startTime, endTime) {
    if (!startTime || !endTime) return 0;
    const sp = startTime.split(':');
    const ep = endTime.split(':');
    const startMin = parseInt(sp[0]) * 60 + parseInt(sp[1]);
    const endMin = parseInt(ep[0]) * 60 + parseInt(ep[1]);
    return Math.max(0, endMin - startMin);
}

function formatMinutesToHM(totalMinutes) {
    const h = Math.floor(totalMinutes / 60);
    const m = totalMinutes % 60;
    return h > 0 || m > 0 ? `${h}h ${m}m` : '0h 0m';
}

function aggregateTardiness(attendanceRecords, startDate, endDate) {
    const empMap = {};

    attendanceRecords.forEach(rec => {
        const empId = rec.employee_id;
        const date = (rec.date || rec.attendance_date || '').split('T')[0];
        const key = `${empId}_${date}`;
        const status = (rec.status || '').toLowerCase();

        if (!empMap[empId]) {
            empMap[empId] = {
                id: empId,
                name: rec.employee_name || `Employee ${empId}`,
                department: rec.department_name || 'N/A',
                lateCount: 0,
                absentCount: 0,
                totalRecords: 0,
                dates: new Set(),
            };
        }

        if (!empMap[empId].dates.has(date)) {
            empMap[empId].dates.add(date);
            empMap[empId].totalRecords++;

            if (status === 'late') empMap[empId].lateCount++;
            if (status === 'absent') empMap[empId].absentCount++;
        }
    });

    // Sort by worst offenders (late + absent) first
    return Object.values(empMap)
        .map(e => ({ ...e, dates: undefined, totalIssues: e.lateCount + e.absentCount }))
        .sort((a, b) => b.totalIssues - a.totalIssues);
}

// ============================================================
//  PDF REPORT GENERATORS (stubs — implemented in Phase 3-7)
// ============================================================

// ============================================================
//  REPORT HEADER HELPER (shared by PDF generators)
// ============================================================

function getHRReportHeader(schoolInfo = {}) {
    const schoolYear = schoolInfo.school_year || '2025-2026';
    const term = schoolInfo.term || 'Second Semester';
    return [
        { text: 'St. Clare College', style: 'headerCollege', alignment: 'center' },
        { text: 'Caloocan City, NCR', style: 'headerInfo', alignment: 'center' },
        { text: 'Philippines', style: 'headerInfo', alignment: 'center', marginBottom: 12 },
        { text: 'HUMAN RESOURCES DEPARTMENT', style: 'headerProgram', alignment: 'center' },
        { text: `SY. ${schoolYear} | ${term.toUpperCase()}`, style: 'headerSemester', alignment: 'center', marginBottom: 15 },
    ];
}

function getHRPDFStyles() {
    return {
        headerCollege: { fontSize: 16, bold: true, color: '#1F2937' },
        headerInfo: { fontSize: 10, color: '#6B7280' },
        headerProgram: { fontSize: 11, bold: true, color: '#1B5E20', margin: [0, 4, 0, 0] },
        headerSemester: { fontSize: 10, color: '#6B7280', margin: [0, 2, 0, 0] },
        title: { fontSize: 14, bold: true, color: '#333333', margin: [0, 0, 0, 5] },
        info: { fontSize: 9, color: '#666666' },
        tableHeader: { fontSize: 8, bold: true, color: '#9E9E9E', margin: [0, 0, 0, 4] },
        tableCell: { fontSize: 9, color: '#333333' },
    };
}

// Helper: normalize enriched data to flat format for summary
function normalizeToFlat(data) {
    return data.map(rec => ({
        ...rec,
        employee_name: rec.employee_name || (rec.employee ? `${rec.employee.first_name || ''} ${rec.employee.last_name || ''}`.trim() : '—'),
        employee_department: rec.employee_department || rec.employee?.department || '—',
        employee_id: rec.employee_id || rec.employee?.employee_id || '-',
    }));
}

// Helper: aggregate subject-level status counts per employee/date (mirrors dept-head transformToSummaryFormat)
function transformToHRSummary(data) {
    const summaryMap = {};

    data.forEach(record => {
        const empId = record.employee_id || record.employee?.employee_id;
        const key = `${record.date}_${empId}`;

        if (!summaryMap[key]) {
            const empName = record.employee
                ? `${record.employee.first_name || ''} ${record.employee.last_name || ''}`.trim()
                : (record.employee_name || 'Unknown');
            const empDept = record.employee?.department || record.employee_department || '—';

            summaryMap[key] = {
                date: record.date,
                employee_id: empId,
                employee_name: empName,
                employee_department: empDept,
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

        // Aggregate subjects and their verification statuses
        if (record.subjects && Array.isArray(record.subjects)) {
            record.subjects.forEach(subject => {
                summaryMap[key].subjects.push(subject);
                const subStatus = (subject.verified_status || '').toLowerCase();
                if (subStatus === 'verified' || subStatus === 'present') {
                    summaryMap[key].verified_count++;
                } else if (subStatus === 'late') {
                    summaryMap[key].late_count++;
                } else if (subStatus === 'absent') {
                    summaryMap[key].absent_count++;
                } else {
                    summaryMap[key].unverified_count++;
                }
            });
        }
    });

    return Object.values(summaryMap).sort((a, b) => {
        const dA = (a.employee_department || '').localeCompare(b.employee_department || '');
        if (dA !== 0) return dA;
        return (a.employee_name || '').localeCompare(b.employee_name || '');
    });
}

// Helper: calculate total hours from subject schedules (not time_in/time_out)
function computeSubjectHours(subjects) {
    let totalMinutes = 0;
    if (subjects && Array.isArray(subjects)) {
        subjects.forEach(subject => {
            if (subject.start_time && subject.end_time) {
                const startParts = subject.start_time.split(':');
                const endParts = subject.end_time.split(':');
                const startMin = parseInt(startParts[0]) * 60 + parseInt(startParts[1]);
                const endMin = parseInt(endParts[0]) * 60 + parseInt(endParts[1]);
                totalMinutes += Math.max(0, endMin - startMin);
            }
        });
    }
    const h = Math.floor(totalMinutes / 60);
    const m = totalMinutes % 60;
    return h > 0 || m > 0 ? `${h}h ${m}m` : '0h 0m';
}

function getAttendancePeriodLabel(filters = {}) {
    const startDate = filters.startDate || filters.date;
    const endDate = filters.endDate || filters.date;

    if (startDate && endDate) {
        const startLabel = formatDate(startDate);
        const endLabel = formatDate(endDate);
        return startDate === endDate ? startLabel : `${startLabel} — ${endLabel}`;
    }

    return 'N/A';
}

function getAttendanceSectionTitle(filters = {}, defaultTitle = '', sectionLabel = '') {
    if (!filters.reportTitle) return defaultTitle;
    return sectionLabel ? `${filters.reportTitle} - ${sectionLabel}` : filters.reportTitle;
}

function buildAttendanceFileName(filters = {}, baseName = 'daily_attendance') {
    const startDate = filters.startDate || filters.date;
    const endDate = filters.endDate || filters.date;

    if (startDate && endDate) {
        return startDate === endDate
            ? `${baseName}_${startDate}_${Date.now()}`
            : `${baseName}_${startDate}_${endDate}_${Date.now()}`;
    }

    return `${baseName}_${Date.now()}`;
}

function getLocalISODate(date = new Date()) {
    const localDate = new Date(date);
    const offsetMinutes = localDate.getTimezoneOffset() * 60000;
    return new Date(localDate.getTime() - offsetMinutes).toISOString().split('T')[0];
}

// ============================================================
//  COMBINED PDF (Summary + Detailed) — mirrors dept-head
// ============================================================

async function generateCombinedAttendancePDF(data, filters, schoolInfo) {
    console.log('[HR-Reports] Generating Combined Attendance PDF...', data.length, 'records');

    if (typeof pdfMake === 'undefined') {
        showReportError('pdfMake library not loaded. Cannot generate PDF.');
        return;
    }

    const summaryContent = buildSummaryPDFContent(data, filters, schoolInfo);
    const detailedContent = buildDetailedPDFContent(data, filters, schoolInfo);

    const combinedContent = [
        ...summaryContent,
        { text: '', pageBreak: 'before' },
        ...detailedContent
    ];

    const docDefinition = {
        content: combinedContent,
        styles: getHRPDFStyles(),
        defaultStyle: { fontSize: 9, font: 'Roboto' },
        pageOrientation: 'portrait',
        pageMargins: [30, 30, 30, 30],
    };

    const filename = `${buildAttendanceFileName(filters, filters.fileBase || 'daily_attendance')}.pdf`;
    pdfMake.createPdf(docDefinition).download(filename);
    console.log('[HR-Reports] Combined Attendance PDF downloaded');
}

// ============================================================
//  SUMMARY PDF CONTENT (Page 1)
// ============================================================

function buildSummaryPDFContent(data, filters, schoolInfo) {
    const reportDate = getAttendancePeriodLabel(filters);
    const summaryData = transformToHRSummary(data);
    const titleText = getAttendanceSectionTitle(filters, 'Attendance Report - Summary by Employee', 'Summary by Employee');

    const tableBody = [
        [
            { text: 'DATE', style: 'tableHeader' },
            { text: 'EMPLOYEE NAME', style: 'tableHeader' },
            { text: 'DEPARTMENT', style: 'tableHeader' },
            { text: 'ID', style: 'tableHeader' },
            { text: 'TIME IN', style: 'tableHeader' },
            { text: 'PRESENT', style: 'tableHeader', alignment: 'center' },
            { text: 'LATE', style: 'tableHeader', alignment: 'center' },
            { text: 'ABSENT', style: 'tableHeader', alignment: 'center' },
            { text: 'UNVERIFIED', style: 'tableHeader', alignment: 'center' },
            { text: 'TOTAL HOURS', style: 'tableHeader', alignment: 'center' },
        ]
    ];

    summaryData.forEach((rec) => {
        tableBody.push([
            { text: formatDate(rec.date), style: 'tableCell' },
            { text: rec.employee_name || '—', style: 'tableCell', bold: true },
            { text: rec.employee_department || '—', style: 'tableCell' },
            { text: rec.employee_id || '-', style: 'tableCell' },
            { text: formatTime(rec.time_in) || '-', style: 'tableCell' },
            { text: String(rec.verified_count || 0), style: 'tableCell', alignment: 'center', color: '#2E7D32' },
            { text: String(rec.late_count || 0), style: 'tableCell', alignment: 'center', color: '#EF6C00' },
            { text: String(rec.absent_count || 0), style: 'tableCell', alignment: 'center', color: '#C62828' },
            { text: String(rec.unverified_count || 0), style: 'tableCell', alignment: 'center', color: '#757575' },
            { text: computeSubjectHours(rec.subjects), style: 'tableCell', alignment: 'center', color: '#1F4E78' },
        ]);
    });

    return [
        ...getHRReportHeader(schoolInfo),
        { text: titleText, style: 'title', margin: [0, 0, 0, 5] },
        {
            columns: [
                {
                    width: '*',
                    stack: [
                        { text: `Date: ${reportDate}`, style: 'info' },
                        { text: `Total Employees: ${summaryData.length}`, style: 'info' },
                    ]
                },
                {
                    width: 'auto',
                    stack: [
                        { text: `Generated: ${new Date().toLocaleString()}`, style: 'info', alignment: 'right' },
                        { text: `Period: ${reportDate}`, style: 'info', alignment: 'right' },
                    ]
                }
            ],
            margin: [0, 0, 0, 20]
        },
        {
            table: {
                headerRows: 1,
                widths: ['9%', '16%', '12%', '7%', '9%', '8%', '8%', '8%', '9%', '10%'],
                body: tableBody
            },
            layout: {
                hLineWidth: function (i, node) { return (i === 1) ? 1 : 1; },
                vLineWidth: function (i, node) { return 0; },
                hLineColor: function (i, node) { return (i === 1) ? '#CCCCCC' : '#EEEEEE'; },
                paddingLeft: function (i) { return 4; },
                paddingRight: function (i) { return 4; },
                paddingTop: function (i) { return 8; },
                paddingBottom: function (i) { return 8; },
            }
        }
    ];
}

// ============================================================
//  DETAILED PDF CONTENT (Page 2+) — Employee → Date → Subjects
// ============================================================

function buildDetailedPDFContent(data, filters, schoolInfo) {
    const reportDate = getAttendancePeriodLabel(filters);
    const titleText = getAttendanceSectionTitle(filters, 'Attendance Report - Detailed by Subject', 'Detailed by Subject');

    // Group by employee, then by date
    const employeeGroups = {};
    data.forEach(record => {
        const empId = record.employee_id || record.employee?.employee_id;
        const empName = record.employee ? `${record.employee.first_name || ''} ${record.employee.last_name || ''}`.trim() : (record.employee_name || 'Unknown');
        const empDept = record.employee?.department || record.employee_department || '—';
        const empKey = `${empId}_${empName}`;
        const dateKey = record.date || filters.date;

        if (!employeeGroups[empKey]) {
            employeeGroups[empKey] = { employee_id: empId, employee_name: empName, department: empDept, dateGroups: {} };
        }
        if (!employeeGroups[empKey].dateGroups[dateKey]) {
            employeeGroups[empKey].dateGroups[dateKey] = [];
        }
        employeeGroups[empKey].dateGroups[dateKey].push(record);
    });

    const content = [
        ...getHRReportHeader(schoolInfo),
        { text: titleText, style: 'title', margin: [0, 0, 0, 5] },
        {
            columns: [
                { text: '', width: '*' },
                {
                    width: 'auto',
                    stack: [
                        { text: `Generated: ${new Date().toLocaleString()}`, style: 'info', alignment: 'right' },
                        { text: `Period: ${reportDate}`, style: 'info', alignment: 'right' }
                    ]
                }
            ],
            margin: [0, 0, 0, 20]
        }
    ];

    Object.values(employeeGroups).forEach((empGroup, groupIdx) => {
        // Employee header with green left border
        content.push({
            margin: [0, groupIdx === 0 ? 0 : 25, 0, 15],
            table: {
                widths: ['*'],
                body: [[
                    {
                        text: `${empGroup.employee_name}  ID: ${empGroup.employee_id}  |  ${empGroup.department}`,
                        fontSize: 12, bold: true, color: '#333333',
                        fillColor: '#F8F9FA',
                        border: [true, false, false, false],
                        borderColor: ['#4CAF50', '', '', ''],
                        padding: [12, 8, 12, 8]
                    }
                ]]
            },
            layout: {
                defaultBorder: false,
                paddingLeft: function (i) { return 12; },
                paddingRight: function (i) { return 12; },
                paddingTop: function (i) { return 8; },
                paddingBottom: function (i) { return 8; }
            }
        });

        const sortedDates = Object.keys(empGroup.dateGroups).sort();

        sortedDates.forEach((dateKey, dateIdx) => {
            const dateRecords = empGroup.dateGroups[dateKey];
            const firstRec = dateRecords[0];

            const dateCheckIn = formatTime(firstRec.time_in) || '-';
            const dateCheckOut = formatTime(firstRec.time_out) || '-';

            const dateObj = new Date(dateKey + 'T00:00:00');
            const formattedDate = dateObj.toLocaleDateString('en-US', {
                weekday: 'short', year: 'numeric', month: 'long', day: 'numeric'
            });

            content.push({
                margin: [0, dateIdx === 0 ? 0 : 15, 0, 8],
                columns: [
                    { width: 'auto', text: formattedDate, bold: true, fontSize: 10, margin: [0, 2, 10, 0] },
                    { width: '*', text: `Check In: ${dateCheckIn}   Check Out: ${dateCheckOut}`, alignment: 'right', fontSize: 9, color: '#666666', margin: [0, 2, 0, 0] }
                ]
            });

            // Subject table
            const subjectTableBody = [
                [
                    { text: 'CODE', style: 'tableHeader' },
                    { text: 'SUBJECT NAME', style: 'tableHeader' },
                    { text: 'SECTION', style: 'tableHeader' },
                    { text: 'SCHEDULE', style: 'tableHeader' },
                    { text: 'ROOM', style: 'tableHeader' },
                    { text: 'STATUS', style: 'tableHeader', alignment: 'right' },
                ]
            ];

            // Expand subjects from the first record (subjects array)
            const subjects = firstRec.subjects || [];
            if (subjects.length > 0) {
                subjects.forEach(subject => {
                    const subStatus = (subject.verified_status || 'unverified').toLowerCase();
                    let statusText = 'Unverified', statusColor = '#9E9E9E', statusIcon = '●';

                    if (subStatus === 'verified' || subStatus === 'present') {
                        statusText = 'Verified'; statusColor = '#4CAF50';
                    } else if (subStatus === 'late') {
                        statusText = 'Late'; statusColor = '#FF9800';
                    } else if (subStatus === 'absent') {
                        statusText = 'Absent'; statusColor = '#F44336';
                    }

                    const schedule = subject.start_time && subject.end_time
                        ? `${formatTime(subject.start_time)} - ${formatTime(subject.end_time)}`
                        : '-';

                    subjectTableBody.push([
                        { text: subject.subject_code || '-', style: 'tableCell' },
                        { text: subject.subject_name || '-', style: 'tableCell' },
                        { text: subject.section_name || '-', style: 'tableCell' },
                        { text: schedule, style: 'tableCell' },
                        { text: subject.room_name || '-', style: 'tableCell' },
                        {
                            text: [
                                { text: statusIcon + ' ', color: statusColor, fontSize: 8 },
                                { text: statusText, color: statusColor, fontSize: 8, bold: true }
                            ],
                            style: 'tableCell', alignment: 'right'
                        }
                    ]);
                });
            } else {
                // No subjects — show single row with overall status
                const overallStatus = (firstRec.status || 'N/A').toLowerCase();
                let statusText = firstRec.status || 'N/A', statusColor = '#9E9E9E';
                if (['present', 'checked_in', 'checked_out'].includes(overallStatus)) { statusText = 'Present'; statusColor = '#4CAF50'; }
                else if (overallStatus === 'late') { statusText = 'Late'; statusColor = '#FF9800'; }
                else if (overallStatus === 'absent') { statusText = 'Absent'; statusColor = '#F44336'; }

                subjectTableBody.push([
                    { text: '-', style: 'tableCell' },
                    { text: 'No subjects assigned', style: 'tableCell', italics: true, color: '#999999' },
                    { text: '-', style: 'tableCell' },
                    { text: '-', style: 'tableCell' },
                    { text: '-', style: 'tableCell' },
                    { text: [{ text: '● ', color: statusColor, fontSize: 8 }, { text: statusText, color: statusColor, fontSize: 8, bold: true }], style: 'tableCell', alignment: 'right' }
                ]);
            }

            content.push({
                table: { headerRows: 1, widths: ['12%', '28%', '10%', '25%', '10%', '15%'], body: subjectTableBody },
                layout: {
                    hLineWidth: function (i) { return (i > 0) ? 1 : 0; },
                    vLineWidth: function () { return 0; },
                    hLineColor: function () { return '#EEEEEE'; },
                    paddingLeft: function () { return 0; },
                    paddingRight: function () { return 0; },
                    paddingTop: function () { return 8; },
                    paddingBottom: function () { return 8; },
                }
            });
        });
    });

    return content;
}

// ============================================================
//  COMBINED EXCEL (Summary sheet + Detailed sheet)
// ============================================================

async function generateCombinedAttendanceExcel(data, filters, schoolInfo) {
    console.log('[HR-Reports] Generating Combined Attendance Excel...', data.length, 'records');

    if (typeof ExcelJS === 'undefined') {
        showReportError('ExcelJS library not loaded. Cannot generate Excel.');
        return;
    }

    const workbook = new ExcelJS.Workbook();

    // Sheet 1: Summary
    buildSummaryExcelSheet(workbook, data, filters, schoolInfo);

    // Sheet 2: Detailed by Subject
    buildDetailedExcelSheet(workbook, data, filters, schoolInfo);

    // Download
    const filename = `${buildAttendanceFileName(filters, filters.fileBase || 'daily_attendance')}.xlsx`;
    const buffer = await workbook.xlsx.writeBuffer();
    const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const url = window.URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.click();
    window.URL.revokeObjectURL(url);
    console.log('[HR-Reports] Combined Attendance Excel downloaded');
}

// ============================================================
//  SUMMARY EXCEL SHEET
// ============================================================

function buildSummaryExcelSheet(workbook, data, filters, schoolInfo) {
    const schoolYear = schoolInfo.school_year || '2025-2026';
    const term = schoolInfo.term || 'Second Semester';
    const reportDate = getAttendancePeriodLabel(filters);
    const titleText = getAttendanceSectionTitle(filters, 'Attendance Report - Summary by Employee', 'Summary by Employee');
    const lastCol = 'J'; // 10 columns A-J
    const centerStyle = { horizontal: 'center', vertical: 'middle' };
    const leftStyle = { horizontal: 'left', vertical: 'middle' };

    const summaryData = transformToHRSummary(data);

    const ws = workbook.addWorksheet('Summary');
    ws.columns = [
        { width: 15 },  // DATE
        { width: 25 },  // EMPLOYEE NAME
        { width: 18 },  // DEPARTMENT
        { width: 12 },  // ID
        { width: 15 },  // TIME IN
        { width: 12 },  // PRESENT
        { width: 12 },  // LATE
        { width: 12 },  // ABSENT
        { width: 12 },  // UNVERIFIED
        { width: 15 },  // TOTAL HOURS
    ];
    ws.getColumn(2).alignment = { wrapText: true, vertical: 'middle' };

    // Header
    const addMergedRow = (text, font, height = 18) => {
        const row = ws.addRow([text]);
        ws.mergeCells(`A${row.number}:${lastCol}${row.number}`);
        row.font = font; row.alignment = centerStyle; row.height = height;
        return row;
    };

    addMergedRow('St. Clare College', { bold: true, size: 17, color: { argb: 'FF1F2937' }, name: 'Arial' }, 24);
    addMergedRow('Caloocan City, NCR', { size: 11, color: { argb: 'FF6B7280' }, name: 'Arial' }, 16);
    addMergedRow('Philippines', { size: 11, color: { argb: 'FF6B7280' }, name: 'Arial' }, 16);
    addMergedRow('HUMAN RESOURCES DEPARTMENT', { bold: true, size: 12, color: { argb: 'FF1B5E20' }, name: 'Arial' }, 20);
    addMergedRow(`SY. ${schoolYear} | ${term.toUpperCase()}`, { size: 11, color: { argb: 'FF6B7280' }, name: 'Arial' }, 18);

    const dividerRow = ws.addRow(['']);
    dividerRow.height = 8;
    ws.mergeCells(`A${dividerRow.number}:${lastCol}${dividerRow.number}`);
    dividerRow.getCell(1).border = { bottom: { style: 'thin', color: { argb: 'FFE5E7EB' } } };
    ws.addRow([]);

    const titleRow = ws.addRow([titleText]);
    ws.mergeCells(`A${titleRow.number}:${lastCol}${titleRow.number}`);
    titleRow.font = { bold: true, size: 15, color: { argb: 'FF333333' }, name: 'Arial' };
    titleRow.alignment = leftStyle; titleRow.height = 24;

    const genRow = ws.addRow(['Generated:', new Date().toLocaleString()]);
    const perRow = ws.addRow(['Period:', reportDate]);
    [genRow, perRow].forEach(row => {
        row.getCell(1).font = { color: { argb: 'FF6B7280' }, size: 10, name: 'Arial' };
        row.getCell(2).font = { color: { argb: 'FF333333' }, size: 10, name: 'Arial' };
        row.alignment = leftStyle; row.height = 16;
    });
    ws.addRow([]);

    const headerRow = ws.addRow(['DATE', 'EMPLOYEE NAME', 'DEPARTMENT', 'ID', 'TIME IN', 'PRESENT', 'LATE', 'ABSENT', 'UNVERIFIED', 'TOTAL HOURS']);
    headerRow.height = 20;
    headerRow.eachCell(cell => {
        cell.font = { bold: true, size: 9, color: { argb: 'FF9CA3AF' }, name: 'Arial' };
        cell.alignment = centerStyle;
        cell.border = { bottom: { style: 'thin', color: { argb: 'FFE5E7EB' } } };
    });

    summaryData.forEach(rec => {
        const row = ws.addRow([
            formatDate(rec.date), rec.employee_name || '—', rec.employee_department || '—',
            rec.employee_id || '-', formatTime(rec.time_in) || '-',
            rec.verified_count || 0, rec.late_count || 0,
            rec.absent_count || 0, rec.unverified_count || 0,
            computeSubjectHours(rec.subjects),
        ]);
        row.height = 20;
        row.eachCell(cell => {
            cell.font = { size: 10, color: { argb: 'FF333333' }, name: 'Arial' };
            cell.border = { bottom: { style: 'thin', color: { argb: 'FFF3F4F6' } } };
            cell.alignment = centerStyle;
        });
        // Status count colors
        row.getCell(6).font = { size: 10, color: { argb: 'FF2E7D32' }, name: 'Arial' };   // Present Green
        row.getCell(7).font = { size: 10, color: { argb: 'FFEF6C00' }, name: 'Arial' };   // Late Orange
        row.getCell(8).font = { size: 10, color: { argb: 'FFC62828' }, name: 'Arial' };   // Absent Red
        row.getCell(10).font = { size: 10, color: { argb: 'FF1F4E78' }, name: 'Arial' };  // Total Hours Blue
    });
}

// ============================================================
//  DETAILED EXCEL SHEET — Employee → Date → Subjects
// ============================================================

function buildDetailedExcelSheet(workbook, data, filters, schoolInfo) {
    const schoolYear = schoolInfo.school_year || '2025-2026';
    const term = schoolInfo.term || 'Second Semester';
    const reportDate = getAttendancePeriodLabel(filters);
    const titleText = getAttendanceSectionTitle(filters, 'Attendance Report - Detailed by Subject', 'Detailed by Subject');
    const lastCol = 'F';
    const centerStyle = { horizontal: 'center', vertical: 'middle' };
    const leftStyle = { horizontal: 'left', vertical: 'middle' };

    const ws = workbook.addWorksheet('Detailed');
    ws.columns = [
        { width: 18 }, { width: 25 }, { width: 12 }, { width: 22 }, { width: 18 }, { width: 15 },
    ];
    ws.getColumn(2).alignment = { wrapText: true, vertical: 'middle' };
    ws.getColumn(4).alignment = { wrapText: true, vertical: 'middle' };

    // Header
    const addMergedRow = (text, font, height = 18) => {
        const row = ws.addRow([text]);
        ws.mergeCells(`A${row.number}:${lastCol}${row.number}`);
        row.font = font; row.alignment = centerStyle; row.height = height;
        return row;
    };

    addMergedRow('St. Clare College', { bold: true, size: 17, color: { argb: 'FF1F2937' }, name: 'Arial' }, 24);
    addMergedRow('Caloocan City, NCR', { size: 11, color: { argb: 'FF6B7280' }, name: 'Arial' }, 16);
    addMergedRow('Philippines', { size: 11, color: { argb: 'FF6B7280' }, name: 'Arial' }, 16);
    addMergedRow('HUMAN RESOURCES DEPARTMENT', { bold: true, size: 12, color: { argb: 'FF1B5E20' }, name: 'Arial' }, 20);
    addMergedRow(`SY. ${schoolYear} | ${term.toUpperCase()}`, { size: 11, color: { argb: 'FF6B7280' }, name: 'Arial' }, 18);

    const dividerRow = ws.addRow(['']);
    dividerRow.height = 8;
    ws.mergeCells(`A${dividerRow.number}:${lastCol}${dividerRow.number}`);
    dividerRow.getCell(1).border = { bottom: { style: 'thin', color: { argb: 'FFE5E7EB' } } };
    ws.addRow([]);

    const titleRow = ws.addRow([titleText]);
    ws.mergeCells(`A${titleRow.number}:${lastCol}${titleRow.number}`);
    titleRow.font = { bold: true, size: 15, color: { argb: 'FF333333' }, name: 'Arial' };
    titleRow.alignment = leftStyle; titleRow.height = 24;

    const genRow = ws.addRow(['Generated:', new Date().toLocaleString()]);
    const perRow = ws.addRow(['Period:', reportDate]);
    [genRow, perRow].forEach(row => {
        row.getCell(1).font = { color: { argb: 'FF6B7280' }, size: 10, name: 'Arial' };
        row.getCell(2).font = { color: { argb: 'FF333333' }, size: 10, name: 'Arial' };
        row.alignment = leftStyle; row.height = 16;
    });
    ws.addRow([]);

    // Group by employee then date
    const employeeGroups = {};
    data.forEach(record => {
        const empId = record.employee_id || record.employee?.employee_id;
        const empName = record.employee ? `${record.employee.first_name || ''} ${record.employee.last_name || ''}`.trim() : (record.employee_name || 'Unknown');
        const empDept = record.employee?.department || record.employee_department || '—';
        const empKey = `${empId}_${empName}`;
        const dateKey = record.date || filters.date;

        if (!employeeGroups[empKey]) {
            employeeGroups[empKey] = { employee_id: empId, employee_name: empName, department: empDept, dateGroups: {} };
        }
        if (!employeeGroups[empKey].dateGroups[dateKey]) {
            employeeGroups[empKey].dateGroups[dateKey] = [];
        }
        employeeGroups[empKey].dateGroups[dateKey].push(record);
    });

    Object.values(employeeGroups).forEach((empGroup, groupIdx) => {
        // Employee header row
        const empRow = ws.addRow([`${empGroup.employee_name}  ID: ${empGroup.employee_id}  |  ${empGroup.department}`, '', '', '', '', '']);
        ws.mergeCells(`A${empRow.number}:${lastCol}${empRow.number}`);
        empRow.height = 28;
        const empCell = empRow.getCell(1);
        empCell.font = { bold: true, size: 13, color: { argb: 'FF333333' }, name: 'Arial' };
        empCell.alignment = { vertical: 'middle', indent: 1 };
        empCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF9FAFB' } };
        empCell.border = { left: { style: 'medium', color: { argb: 'FF4CAF50' } } };

        const sortedDates = Object.keys(empGroup.dateGroups).sort();

        sortedDates.forEach(dateKey => {
            const dateRecords = empGroup.dateGroups[dateKey];
            const firstRec = dateRecords[0];
            const checkIn = formatTime(firstRec.time_in) || '-';
            const checkOut = formatTime(firstRec.time_out) || '-';

            const dateObj = new Date(dateKey + 'T00:00:00');
            const formattedDate = dateObj.toLocaleDateString('en-US', { weekday: 'short', year: 'numeric', month: 'long', day: 'numeric' });

            // Date header
            const dateRow = ws.addRow([formattedDate, '', '', `Check In: ${checkIn}   Check Out: ${checkOut}`, '', '']);
            ws.mergeCells(`A${dateRow.number}:B${dateRow.number}`);
            ws.mergeCells(`D${dateRow.number}:${lastCol}${dateRow.number}`);
            dateRow.height = 22;
            dateRow.getCell(1).font = { bold: true, size: 11, color: { argb: 'FF1F2937' }, name: 'Arial' };
            dateRow.getCell(1).alignment = leftStyle;
            dateRow.getCell(4).font = { size: 10, color: { argb: 'FF6B7280' }, name: 'Arial' };
            dateRow.getCell(4).alignment = { horizontal: 'right', vertical: 'middle' };

            // Subject headers
            const headerRow = ws.addRow(['CODE', 'SUBJECT NAME', 'SECTION', 'SCHEDULE', 'ROOM', 'STATUS']);
            headerRow.height = 20;
            headerRow.eachCell((cell, colNum) => {
                if (colNum <= 6) {
                    cell.font = { bold: true, size: 9, color: { argb: 'FF9CA3AF' }, name: 'Arial' };
                    cell.alignment = centerStyle;
                    cell.border = { bottom: { style: 'thin', color: { argb: 'FFE5E7EB' } } };
                }
            });

            // Subject rows
            const subjects = firstRec.subjects || [];
            if (subjects.length > 0) {
                subjects.forEach(subject => {
                    const subStatus = (subject.verified_status || 'unverified').toLowerCase();
                    let statusText = 'Unverified', statusColor = 'FF9E9E9E';
                    if (subStatus === 'verified' || subStatus === 'present') { statusText = 'Verified'; statusColor = 'FF4CAF50'; }
                    else if (subStatus === 'late') { statusText = 'Late'; statusColor = 'FFFF9800'; }
                    else if (subStatus === 'absent') { statusText = 'Absent'; statusColor = 'FFF44336'; }

                    const schedule = subject.start_time && subject.end_time
                        ? `${formatTime(subject.start_time)} - ${formatTime(subject.end_time)}` : '-';

                    const row = ws.addRow([subject.subject_code || '-', subject.subject_name || '-', subject.section_name || '-', schedule, subject.room_name || '-', statusText]);
                    row.height = 20;
                    row.eachCell((cell, colNum) => {
                        if (colNum <= 6) {
                            cell.font = { size: 10, color: { argb: 'FF333333' }, name: 'Arial' };
                            cell.alignment = centerStyle;
                            cell.border = { bottom: { style: 'thin', color: { argb: 'FFF3F4F6' } } };
                        }
                    });
                    row.getCell(6).font = { bold: true, size: 10, color: { argb: statusColor }, name: 'Arial' };
                    row.getCell(6).alignment = centerStyle;
                });
            } else {
                const row = ws.addRow(['-', 'No subjects assigned', '-', '-', '-', firstRec.status || 'N/A']);
                row.height = 20;
                row.eachCell((cell, colNum) => {
                    if (colNum <= 6) {
                        cell.font = { size: 10, color: { argb: 'FF999999' }, name: 'Arial', italic: colNum === 2 };
                        cell.alignment = centerStyle;
                        cell.border = { bottom: { style: 'thin', color: { argb: 'FFF3F4F6' } } };
                    }
                });
            }

            ws.addRow([]); // Spacer
        });

        if (groupIdx < Object.values(employeeGroups).length - 1) {
            ws.addRow([]);
        }
    });
}

async function generateMonthlySummaryPDF(summary, enrichedData, filters, schoolInfo) {
    console.log('[HR-Reports] Generating Monthly Summary PDF...', summary.length, 'employees');

    if (typeof pdfMake === 'undefined') {
        showReportError('pdfMake library not loaded.');
        return;
    }

    const schoolYear = schoolInfo.school_year || '2025-2026';
    const term = schoolInfo.term || 'Second Semester';
    const [year, mon] = (filters.month || '2026-01').split('-');
    const monthLabel = new Date(year, mon - 1).toLocaleDateString('en-US', { year: 'numeric', month: 'long' });

    // Sort by department then name
    const sorted = [...summary].sort((a, b) => {
        const dA = (a.department || '').localeCompare(b.department || '');
        return dA !== 0 ? dA : (a.name || '').localeCompare(b.name || '');
    });

    // Quick stats
    const totalPresent = sorted.reduce((s, e) => s + e.present, 0);
    const totalAbsent = sorted.reduce((s, e) => s + e.absent, 0);
    const totalLate = sorted.reduce((s, e) => s + e.late, 0);
    const totalDaysAll = sorted.reduce((s, e) => s + (e.totalDays || 1), 0);
    const avgRate = totalDaysAll > 0 ? ((totalPresent / totalDaysAll) * 100).toFixed(1) : '0.0';

    // Table
    const tableBody = [
        [
            { text: '#', style: 'tableHeader', alignment: 'center' },
            { text: 'EMPLOYEE NAME', style: 'tableHeader' },
            { text: 'DEPARTMENT', style: 'tableHeader' },
            { text: 'PRESENT', style: 'tableHeader', alignment: 'center' },
            { text: 'LATE', style: 'tableHeader', alignment: 'center' },
            { text: 'ABSENT', style: 'tableHeader', alignment: 'center' },
            { text: 'UNVERIFIED', style: 'tableHeader', alignment: 'center' },
            { text: 'VERIFIED HRS', style: 'tableHeader', alignment: 'center' },
            { text: 'UNVERIFIED HRS', style: 'tableHeader', alignment: 'center' },
            { text: 'RATE', style: 'tableHeader', alignment: 'center' },
        ]
    ];

    sorted.forEach((emp, idx) => {
        const days = emp.totalDays || 1;
        const rate = ((emp.present / days) * 100).toFixed(1);
        let rateColor = '#2E7D32';
        if (rate < 70) rateColor = '#C62828';
        else if (rate < 90) rateColor = '#EF6C00';

        tableBody.push([
            { text: String(idx + 1), style: 'tableCell', alignment: 'center' },
            { text: emp.name || '—', style: 'tableCell', bold: true },
            { text: emp.department || '—', style: 'tableCell' },
            { text: String(emp.present), style: 'tableCell', alignment: 'center', color: '#2E7D32' },
            { text: String(emp.late), style: 'tableCell', alignment: 'center', color: '#EF6C00' },
            { text: String(emp.absent), style: 'tableCell', alignment: 'center', color: '#C62828' },
            { text: String(emp.unverifiedCount || 0), style: 'tableCell', alignment: 'center', color: '#757575' },
            { text: emp.verifiedHours || '0h 0m', style: 'tableCell', alignment: 'center', color: '#1F4E78' },
            { text: emp.unverifiedHours || '0h 0m', style: 'tableCell', alignment: 'center', color: '#757575' },
            { text: `${rate}%`, style: 'tableCell', alignment: 'center', color: rateColor, bold: true },
        ]);
    });

    const docDefinition = {
        content: [
            { text: 'St. Clare College', style: 'headerCollege', alignment: 'center' },
            { text: 'Caloocan City, NCR', style: 'headerInfo', alignment: 'center' },
            { text: 'Philippines', style: 'headerInfo', alignment: 'center', margin: [0, 0, 0, 12] },
            { text: 'HUMAN RESOURCES DEPARTMENT', style: 'headerProgram', alignment: 'center' },
            { text: `SY. ${schoolYear} | ${term.toUpperCase()}`, style: 'headerSemester', alignment: 'center', margin: [0, 2, 0, 15] },

            { text: 'Monthly Attendance Summary', style: 'title', margin: [0, 0, 0, 5] },
            {
                columns: [
                    {
                        width: '*',
                        stack: [
                            { text: `Month: ${monthLabel}`, style: 'info' },
                            { text: `Total Employees: ${sorted.length}`, style: 'info' },
                        ]
                    },
                    {
                        width: 'auto',
                        stack: [
                            { text: `Avg. Attendance Rate: ${avgRate}%`, style: 'info', alignment: 'right' },
                            { text: `Generated: ${new Date().toLocaleString()}`, style: 'info', alignment: 'right' },
                        ]
                    }
                ],
                margin: [0, 0, 0, 20]
            },

            {
                table: {
                    headerRows: 1,
                    widths: ['4%', '16%', '12%', '7%', '7%', '7%', '9%', '11%', '12%', '8%'],
                    body: tableBody
                },
                layout: {
                    hLineWidth: (i) => (i === 1) ? 1 : 0.5,
                    vLineWidth: () => 0,
                    hLineColor: (i) => (i === 1) ? '#CCCCCC' : '#EEEEEE',
                    paddingLeft: () => 4,
                    paddingRight: () => 4,
                    paddingTop: () => 7,
                    paddingBottom: () => 7,
                }
            }
        ],
        styles: {
            headerCollege: { fontSize: 16, bold: true, color: '#1F2937' },
            headerInfo: { fontSize: 10, color: '#6B7280' },
            headerProgram: { fontSize: 11, bold: true, color: '#1B5E20', margin: [0, 4, 0, 0] },
            headerSemester: { fontSize: 10, color: '#6B7280', margin: [0, 2, 0, 0] },
            title: { fontSize: 14, bold: true, color: '#333333' },
            info: { fontSize: 9, color: '#666666' },
            tableHeader: { fontSize: 8, bold: true, color: '#9E9E9E', margin: [0, 0, 0, 4] },
            tableCell: { fontSize: 9, color: '#333333' },
        },
        defaultStyle: { fontSize: 9, font: 'Roboto' },
        pageOrientation: 'portrait',
        pageMargins: [30, 30, 30, 30],
    };

    // Build detailed content from enriched data
    const detailedContent = buildDetailedPDFContent(enrichedData, filters, schoolInfo);

    // Combine summary + detailed with page break
    const combinedContent = [
        ...docDefinition.content,
        { text: '', pageBreak: 'before' },
        ...detailedContent
    ];
    docDefinition.content = combinedContent;

    // Merge detailed styles into doc styles
    const hrStyles = getHRPDFStyles();
    Object.assign(docDefinition.styles, hrStyles);

    const filename = `monthly_summary_${filters.month}_${Date.now()}.pdf`;
    pdfMake.createPdf(docDefinition).download(filename);
    console.log('[HR-Reports] Monthly Summary PDF downloaded');
}

async function generateMonthlySummaryExcel(summary, enrichedData, filters, schoolInfo) {
    console.log('[HR-Reports] Generating Monthly Summary Excel...', summary.length, 'employees');

    if (typeof ExcelJS === 'undefined') {
        showReportError('ExcelJS library not loaded.');
        return;
    }

    const schoolYear = schoolInfo.school_year || '2025-2026';
    const term = schoolInfo.term || 'Second Semester';
    const [year, mon] = (filters.month || '2026-01').split('-');
    const monthLabel = new Date(year, mon - 1).toLocaleDateString('en-US', { year: 'numeric', month: 'long' });
    const lastCol = 'J'; // 10 columns A-J
    const centerStyle = { horizontal: 'center', vertical: 'middle' };
    const leftStyle = { horizontal: 'left', vertical: 'middle' };

    const sorted = [...summary].sort((a, b) => {
        const dA = (a.department || '').localeCompare(b.department || '');
        return dA !== 0 ? dA : (a.name || '').localeCompare(b.name || '');
    });

    const totalPresent = sorted.reduce((s, e) => s + e.present, 0);
    const totalDaysAll = sorted.reduce((s, e) => s + (e.totalDays || 1), 0);
    const avgRate = totalDaysAll > 0 ? ((totalPresent / totalDaysAll) * 100).toFixed(1) : '0.0';

    const workbook = new ExcelJS.Workbook();
    const ws = workbook.addWorksheet('Monthly Summary');

    ws.columns = [
        { width: 6 },   // #
        { width: 24 },  // Name
        { width: 18 },  // Department
        { width: 10 },  // Present
        { width: 10 },  // Late
        { width: 10 },  // Absent
        { width: 12 },  // Unverified
        { width: 15 },  // Verified Hours
        { width: 16 },  // Unverified Hours
        { width: 10 },  // Rate
    ];

    // --- HEADER ---
    const addMergedRow = (text, font, height = 18) => {
        const row = ws.addRow([text]);
        ws.mergeCells(`A${row.number}:${lastCol}${row.number}`);
        row.font = font;
        row.alignment = centerStyle;
        row.height = height;
        return row;
    };

    addMergedRow('St. Clare College', { bold: true, size: 17, color: { argb: 'FF1F2937' }, name: 'Arial' }, 24);
    addMergedRow('Caloocan City, NCR', { size: 11, color: { argb: 'FF6B7280' }, name: 'Arial' }, 16);
    addMergedRow('Philippines', { size: 11, color: { argb: 'FF6B7280' }, name: 'Arial' }, 16);
    addMergedRow('HUMAN RESOURCES DEPARTMENT', { bold: true, size: 12, color: { argb: 'FF1B5E20' }, name: 'Arial' }, 20);
    addMergedRow(`SY. ${schoolYear} | ${term.toUpperCase()}`, { size: 11, color: { argb: 'FF6B7280' }, name: 'Arial' }, 18);

    // Divider
    const divider = ws.addRow(['']);
    divider.height = 8;
    ws.mergeCells(`A${divider.number}:${lastCol}${divider.number}`);
    divider.getCell(1).border = { bottom: { style: 'thin', color: { argb: 'FFE5E7EB' } } };
    ws.addRow([]);

    // Title
    const titleRow = ws.addRow(['Monthly Attendance Summary']);
    ws.mergeCells(`A${titleRow.number}:${lastCol}${titleRow.number}`);
    titleRow.font = { bold: true, size: 15, color: { argb: 'FF333333' }, name: 'Arial' };
    titleRow.alignment = leftStyle;
    titleRow.height = 24;

    // Metadata
    const meta = [
        ['Month:', monthLabel],
        ['Total Employees:', String(sorted.length)],
        ['Avg. Attendance Rate:', `${avgRate}%`],
        ['Generated:', new Date().toLocaleString()],
    ];
    meta.forEach(([label, value]) => {
        const row = ws.addRow([label, value]);
        row.getCell(1).font = { color: { argb: 'FF6B7280' }, size: 10, name: 'Arial' };
        row.getCell(2).font = { color: { argb: 'FF333333' }, size: 10, name: 'Arial' };
        row.alignment = leftStyle;
        row.height = 16;
    });
    ws.addRow([]);

    // Table header
    const headerRow = ws.addRow(['#', 'EMPLOYEE NAME', 'DEPARTMENT', 'PRESENT', 'LATE', 'ABSENT', 'UNVERIFIED', 'VERIFIED HOURS', 'UNVERIFIED HOURS', 'RATE']);
    headerRow.height = 22;
    headerRow.eachCell(cell => {
        cell.font = { bold: true, size: 9, color: { argb: 'FF9CA3AF' }, name: 'Arial' };
        cell.alignment = centerStyle;
        cell.border = { bottom: { style: 'thin', color: { argb: 'FFE5E7EB' } } };
    });

    // Data rows
    sorted.forEach((emp, idx) => {
        const days = emp.totalDays || 1;
        const rate = ((emp.present / days) * 100).toFixed(1);
        let rateArgb = 'FF2E7D32';
        if (rate < 70) rateArgb = 'FFC62828';
        else if (rate < 90) rateArgb = 'FFEF6C00';

        const row = ws.addRow([
            idx + 1,
            emp.name || '—',
            emp.department || '—',
            emp.present,
            emp.late,
            emp.absent,
            emp.unverifiedCount || 0,
            emp.verifiedHours || '0h 0m',
            emp.unverifiedHours || '0h 0m',
            `${rate}%`,
        ]);

        row.height = 20;
        row.eachCell(cell => {
            cell.font = { size: 10, color: { argb: 'FF333333' }, name: 'Arial' };
            cell.border = { bottom: { style: 'thin', color: { argb: 'FFF3F4F6' } } };
            cell.alignment = centerStyle;
        });

        row.getCell(2).font = { size: 10, color: { argb: 'FF333333' }, name: 'Arial', bold: true };
        row.getCell(2).alignment = leftStyle;
        row.getCell(3).alignment = leftStyle;
        row.getCell(4).font = { size: 10, color: { argb: 'FF2E7D32' }, name: 'Arial' };  // Present green
        row.getCell(5).font = { size: 10, color: { argb: 'FFEF6C00' }, name: 'Arial' };  // Late orange
        row.getCell(6).font = { size: 10, color: { argb: 'FFC62828' }, name: 'Arial' };  // Absent red
        row.getCell(7).font = { size: 10, color: { argb: 'FF757575' }, name: 'Arial' };  // Unverified gray
        row.getCell(8).font = { size: 10, color: { argb: 'FF1F4E78' }, name: 'Arial' };  // Verified blue
        row.getCell(9).font = { size: 10, color: { argb: 'FF757575' }, name: 'Arial' };  // Unverified hrs gray
        row.getCell(10).font = { size: 10, color: { argb: rateArgb }, name: 'Arial', bold: true };
    });

    // Add Detailed sheet from enriched data
    buildDetailedExcelSheet(workbook, enrichedData, filters, schoolInfo);

    // Download
    const filename = `monthly_summary_${filters.month}_${Date.now()}.xlsx`;
    const buffer = await workbook.xlsx.writeBuffer();
    const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const url = window.URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.click();
    window.URL.revokeObjectURL(url);
    console.log('[HR-Reports] Monthly Summary Excel downloaded');
}

async function generateEmployeeMasterlistPDF(employees, filters, schoolInfo) {
    console.log('[HR-Reports] Generating Employee Masterlist PDF...', employees.length, 'employees');

    if (typeof pdfMake === 'undefined') { showReportError('pdfMake library not loaded.'); return; }

    const schoolYear = schoolInfo.school_year || '2025-2026';
    const term = schoolInfo.term || 'Second Semester';

    const sorted = [...employees].sort((a, b) => {
        const dA = (a.department || '').localeCompare(b.department || '');
        return dA !== 0 ? dA : (a.name || a.full_name || '').localeCompare(b.name || b.full_name || '');
    });

    const activeCount = sorted.filter(e => (e.status || '').toLowerCase() === 'active').length;

    const tableBody = [
        [
            { text: '#', style: 'tableHeader', alignment: 'center' },
            { text: 'EMPLOYEE NAME', style: 'tableHeader' },
            { text: 'DEPARTMENT', style: 'tableHeader' },
            { text: 'POSITION', style: 'tableHeader' },
            { text: 'EMAIL', style: 'tableHeader' },
            { text: 'STATUS', style: 'tableHeader', alignment: 'center' },
            { text: 'HIRE DATE', style: 'tableHeader', alignment: 'center' },
        ]
    ];

    sorted.forEach((emp, idx) => {
        const status = (emp.status || 'N/A').toLowerCase();
        const statusLabel = status.charAt(0).toUpperCase() + status.slice(1);
        const statusColor = status === 'active' ? '#2E7D32' : status === 'inactive' ? '#C62828' : '#9E9E9E';

        tableBody.push([
            { text: String(idx + 1), style: 'tableCell', alignment: 'center' },
            { text: emp.name || emp.full_name || '—', style: 'tableCell', bold: true },
            { text: emp.department || '—', style: 'tableCell' },
            { text: emp.position || '—', style: 'tableCell' },
            { text: emp.email || '—', style: 'tableCell', fontSize: 8 },
            { text: statusLabel, style: 'tableCell', alignment: 'center', color: statusColor, bold: true },
            { text: formatDate(emp.hire_date), style: 'tableCell', alignment: 'center' },
        ]);
    });

    const docDefinition = {
        content: [
            { text: 'St. Clare College', style: 'headerCollege', alignment: 'center' },
            { text: 'Caloocan City, NCR', style: 'headerInfo', alignment: 'center' },
            { text: 'Philippines', style: 'headerInfo', alignment: 'center', margin: [0, 0, 0, 12] },
            { text: 'HUMAN RESOURCES DEPARTMENT', style: 'headerProgram', alignment: 'center' },
            { text: `SY. ${schoolYear} | ${term.toUpperCase()}`, style: 'headerSemester', alignment: 'center', margin: [0, 2, 0, 15] },

            { text: 'Employee Masterlist', style: 'title', margin: [0, 0, 0, 5] },
            {
                columns: [
                    {
                        width: '*', stack: [
                            { text: `Total Employees: ${sorted.length}`, style: 'info' },
                            { text: `Active: ${activeCount}  |  Inactive: ${sorted.length - activeCount}`, style: 'info' },
                        ]
                    },
                    {
                        width: 'auto', stack: [
                            { text: `Generated: ${new Date().toLocaleString()}`, style: 'info', alignment: 'right' },
                        ]
                    }
                ],
                margin: [0, 0, 0, 20]
            },

            {
                table: { headerRows: 1, widths: ['4%', '18%', '14%', '14%', '20%', '10%', '12%'], body: tableBody },
                layout: {
                    hLineWidth: (i) => (i === 1) ? 1 : 0.5,
                    vLineWidth: () => 0,
                    hLineColor: (i) => (i === 1) ? '#CCCCCC' : '#EEEEEE',
                    paddingLeft: () => 4, paddingRight: () => 4, paddingTop: () => 7, paddingBottom: () => 7,
                }
            }
        ],
        styles: {
            headerCollege: { fontSize: 16, bold: true, color: '#1F2937' },
            headerInfo: { fontSize: 10, color: '#6B7280' },
            headerProgram: { fontSize: 11, bold: true, color: '#1B5E20', margin: [0, 4, 0, 0] },
            headerSemester: { fontSize: 10, color: '#6B7280', margin: [0, 2, 0, 0] },
            title: { fontSize: 14, bold: true, color: '#333333' },
            info: { fontSize: 9, color: '#666666' },
            tableHeader: { fontSize: 8, bold: true, color: '#9E9E9E', margin: [0, 0, 0, 4] },
            tableCell: { fontSize: 9, color: '#333333' },
        },
        defaultStyle: { fontSize: 9, font: 'Roboto' },
        pageOrientation: 'landscape',
        pageMargins: [30, 30, 30, 30],
    };

    const filename = `employee_masterlist_${Date.now()}.pdf`;
    pdfMake.createPdf(docDefinition).download(filename);
    console.log('[HR-Reports] Employee Masterlist PDF downloaded');
}

async function generateEmployeeMasterlistExcel(employees, filters, schoolInfo) {
    console.log('[HR-Reports] Generating Employee Masterlist Excel...', employees.length, 'employees');

    if (typeof ExcelJS === 'undefined') { showReportError('ExcelJS library not loaded.'); return; }

    const schoolYear = schoolInfo.school_year || '2025-2026';
    const term = schoolInfo.term || 'Second Semester';
    const lastCol = 'G';
    const centerStyle = { horizontal: 'center', vertical: 'middle' };
    const leftStyle = { horizontal: 'left', vertical: 'middle' };

    const sorted = [...employees].sort((a, b) => {
        const dA = (a.department || '').localeCompare(b.department || '');
        return dA !== 0 ? dA : (a.name || a.full_name || '').localeCompare(b.name || b.full_name || '');
    });

    const activeCount = sorted.filter(e => (e.status || '').toLowerCase() === 'active').length;

    const workbook = new ExcelJS.Workbook();
    const ws = workbook.addWorksheet('Employee Masterlist');
    ws.columns = [
        { width: 6 }, { width: 28 }, { width: 20 }, { width: 20 }, { width: 28 }, { width: 12 }, { width: 14 },
    ];

    const addMergedRow = (text, font, height = 18) => {
        const row = ws.addRow([text]);
        ws.mergeCells(`A${row.number}:${lastCol}${row.number}`);
        row.font = font; row.alignment = centerStyle; row.height = height;
        return row;
    };

    addMergedRow('St. Clare College', { bold: true, size: 17, color: { argb: 'FF1F2937' }, name: 'Arial' }, 24);
    addMergedRow('Caloocan City, NCR', { size: 11, color: { argb: 'FF6B7280' }, name: 'Arial' }, 16);
    addMergedRow('Philippines', { size: 11, color: { argb: 'FF6B7280' }, name: 'Arial' }, 16);
    addMergedRow('HUMAN RESOURCES DEPARTMENT', { bold: true, size: 12, color: { argb: 'FF1B5E20' }, name: 'Arial' }, 20);
    addMergedRow(`SY. ${schoolYear} | ${term.toUpperCase()}`, { size: 11, color: { argb: 'FF6B7280' }, name: 'Arial' }, 18);

    const divider = ws.addRow(['']); divider.height = 8;
    ws.mergeCells(`A${divider.number}:${lastCol}${divider.number}`);
    divider.getCell(1).border = { bottom: { style: 'thin', color: { argb: 'FFE5E7EB' } } };
    ws.addRow([]);

    const titleRow = ws.addRow(['Employee Masterlist']);
    ws.mergeCells(`A${titleRow.number}:${lastCol}${titleRow.number}`);
    titleRow.font = { bold: true, size: 15, color: { argb: 'FF333333' }, name: 'Arial' };
    titleRow.alignment = leftStyle; titleRow.height = 24;

    [['Total Employees:', String(sorted.length)], ['Active / Inactive:', `${activeCount} / ${sorted.length - activeCount}`], ['Generated:', new Date().toLocaleString()]].forEach(([l, v]) => {
        const row = ws.addRow([l, v]);
        row.getCell(1).font = { color: { argb: 'FF6B7280' }, size: 10, name: 'Arial' };
        row.getCell(2).font = { color: { argb: 'FF333333' }, size: 10, name: 'Arial' };
        row.alignment = leftStyle; row.height = 16;
    });
    ws.addRow([]);

    const headerRow = ws.addRow(['#', 'EMPLOYEE NAME', 'DEPARTMENT', 'POSITION', 'EMAIL', 'STATUS', 'HIRE DATE']);
    headerRow.height = 22;
    headerRow.eachCell(cell => {
        cell.font = { bold: true, size: 9, color: { argb: 'FF9CA3AF' }, name: 'Arial' };
        cell.alignment = centerStyle;
        cell.border = { bottom: { style: 'thin', color: { argb: 'FFE5E7EB' } } };
    });

    sorted.forEach((emp, idx) => {
        const status = (emp.status || '').toLowerCase();
        const statusLabel = status.charAt(0).toUpperCase() + status.slice(1);
        let statusArgb = 'FF9E9E9E';
        if (status === 'active') statusArgb = 'FF2E7D32';
        else if (status === 'inactive') statusArgb = 'FFC62828';

        const row = ws.addRow([
            idx + 1, emp.name || emp.full_name || '—', emp.department || '—',
            emp.position || '—', emp.email || '—', statusLabel, formatDate(emp.hire_date),
        ]);
        row.height = 20;
        row.eachCell(cell => {
            cell.font = { size: 10, color: { argb: 'FF333333' }, name: 'Arial' };
            cell.border = { bottom: { style: 'thin', color: { argb: 'FFF3F4F6' } } };
            cell.alignment = centerStyle;
        });
        row.getCell(2).font = { size: 10, color: { argb: 'FF333333' }, name: 'Arial', bold: true };
        row.getCell(2).alignment = leftStyle;
        row.getCell(3).alignment = leftStyle;
        row.getCell(4).alignment = leftStyle;
        row.getCell(5).alignment = leftStyle;
        row.getCell(6).font = { size: 10, color: { argb: statusArgb }, name: 'Arial', bold: true };
    });

    const filename = `employee_masterlist_${Date.now()}.xlsx`;
    const buffer = await workbook.xlsx.writeBuffer();
    const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const url = window.URL.createObjectURL(blob);
    const link = document.createElement('a'); link.href = url; link.download = filename; link.click();
    window.URL.revokeObjectURL(url);
    console.log('[HR-Reports] Employee Masterlist Excel downloaded');
}

async function generateTardinessPDF(analysis, filters, schoolInfo) {
    console.log('[HR-Reports] Generating Tardiness PDF...', analysis.length, 'employees');

    if (typeof pdfMake === 'undefined') { showReportError('pdfMake library not loaded.'); return; }

    const schoolYear = schoolInfo.school_year || '2025-2026';
    const term = schoolInfo.term || 'Second Semester';
    const periodLabel = `${formatDate(filters.startDate)} — ${formatDate(filters.endDate)}`;

    const sorted = [...analysis].sort((a, b) => b.totalIssues - a.totalIssues);

    const tableBody = [
        [
            { text: '#', style: 'tableHeader', alignment: 'center' },
            { text: 'EMPLOYEE NAME', style: 'tableHeader' },
            { text: 'DEPARTMENT', style: 'tableHeader' },
            { text: 'LATE', style: 'tableHeader', alignment: 'center' },
            { text: 'ABSENT', style: 'tableHeader', alignment: 'center' },
            { text: 'TOTAL ISSUES', style: 'tableHeader', alignment: 'center' },
            { text: 'TOTAL RECORDS', style: 'tableHeader', alignment: 'center' },
        ]
    ];

    sorted.forEach((emp, idx) => {
        let issueColor = '#2E7D32';
        if (emp.totalIssues >= 5) issueColor = '#C62828';
        else if (emp.totalIssues >= 3) issueColor = '#EF6C00';

        tableBody.push([
            { text: String(idx + 1), style: 'tableCell', alignment: 'center' },
            { text: emp.name || '—', style: 'tableCell', bold: true },
            { text: emp.department || '—', style: 'tableCell' },
            { text: String(emp.lateCount), style: 'tableCell', alignment: 'center', color: '#EF6C00' },
            { text: String(emp.absentCount), style: 'tableCell', alignment: 'center', color: '#C62828' },
            { text: String(emp.totalIssues), style: 'tableCell', alignment: 'center', color: issueColor, bold: true },
            { text: String(emp.totalRecords), style: 'tableCell', alignment: 'center' },
        ]);
    });

    const totalLate = sorted.reduce((s, e) => s + e.lateCount, 0);
    const totalAbsent = sorted.reduce((s, e) => s + e.absentCount, 0);

    const docDefinition = {
        content: [
            { text: 'St. Clare College', style: 'headerCollege', alignment: 'center' },
            { text: 'Caloocan City, NCR', style: 'headerInfo', alignment: 'center' },
            { text: 'Philippines', style: 'headerInfo', alignment: 'center', margin: [0, 0, 0, 12] },
            { text: 'HUMAN RESOURCES DEPARTMENT', style: 'headerProgram', alignment: 'center' },
            { text: `SY. ${schoolYear} | ${term.toUpperCase()}`, style: 'headerSemester', alignment: 'center', margin: [0, 2, 0, 15] },

            { text: 'Tardiness & Absenteeism Report', style: 'title', margin: [0, 0, 0, 5] },
            {
                columns: [
                    {
                        width: '*', stack: [
                            { text: `Period: ${periodLabel}`, style: 'info' },
                            { text: `Employees with Issues: ${sorted.filter(e => e.totalIssues > 0).length}`, style: 'info' },
                        ]
                    },
                    {
                        width: 'auto', stack: [
                            { text: `Total Late: ${totalLate}  |  Total Absent: ${totalAbsent}`, style: 'info', alignment: 'right' },
                            { text: `Generated: ${new Date().toLocaleString()}`, style: 'info', alignment: 'right' },
                        ]
                    }
                ],
                margin: [0, 0, 0, 20]
            },

            {
                table: { headerRows: 1, widths: ['5%', '22%', '18%', '12%', '12%', '14%', '12%'], body: tableBody },
                layout: {
                    hLineWidth: (i) => (i === 1) ? 1 : 0.5,
                    vLineWidth: () => 0,
                    hLineColor: (i) => (i === 1) ? '#CCCCCC' : '#EEEEEE',
                    paddingLeft: () => 4, paddingRight: () => 4, paddingTop: () => 7, paddingBottom: () => 7,
                }
            }
        ],
        styles: {
            headerCollege: { fontSize: 16, bold: true, color: '#1F2937' },
            headerInfo: { fontSize: 10, color: '#6B7280' },
            headerProgram: { fontSize: 11, bold: true, color: '#1B5E20', margin: [0, 4, 0, 0] },
            headerSemester: { fontSize: 10, color: '#6B7280', margin: [0, 2, 0, 0] },
            title: { fontSize: 14, bold: true, color: '#333333' },
            info: { fontSize: 9, color: '#666666' },
            tableHeader: { fontSize: 8, bold: true, color: '#9E9E9E', margin: [0, 0, 0, 4] },
            tableCell: { fontSize: 9, color: '#333333' },
        },
        defaultStyle: { fontSize: 9, font: 'Roboto' },
        pageOrientation: 'portrait',
        pageMargins: [30, 30, 30, 30],
    };

    const filename = `tardiness_report_${filters.startDate}_${filters.endDate}_${Date.now()}.pdf`;
    pdfMake.createPdf(docDefinition).download(filename);
    console.log('[HR-Reports] Tardiness PDF downloaded');
}

async function generateTardinessExcel(analysis, filters, schoolInfo) {
    console.log('[HR-Reports] Generating Tardiness Excel...', analysis.length, 'employees');

    if (typeof ExcelJS === 'undefined') { showReportError('ExcelJS library not loaded.'); return; }

    const schoolYear = schoolInfo.school_year || '2025-2026';
    const term = schoolInfo.term || 'Second Semester';
    const periodLabel = `${formatDate(filters.startDate)} — ${formatDate(filters.endDate)}`;
    const lastCol = 'G';
    const centerStyle = { horizontal: 'center', vertical: 'middle' };
    const leftStyle = { horizontal: 'left', vertical: 'middle' };

    const sorted = [...analysis].sort((a, b) => b.totalIssues - a.totalIssues);
    const totalLate = sorted.reduce((s, e) => s + e.lateCount, 0);
    const totalAbsent = sorted.reduce((s, e) => s + e.absentCount, 0);

    const workbook = new ExcelJS.Workbook();
    const ws = workbook.addWorksheet('Tardiness Report');
    ws.columns = [
        { width: 6 }, { width: 28 }, { width: 22 }, { width: 10 }, { width: 10 }, { width: 14 }, { width: 14 },
    ];

    const addMergedRow = (text, font, height = 18) => {
        const row = ws.addRow([text]);
        ws.mergeCells(`A${row.number}:${lastCol}${row.number}`);
        row.font = font; row.alignment = centerStyle; row.height = height;
        return row;
    };

    addMergedRow('St. Clare College', { bold: true, size: 17, color: { argb: 'FF1F2937' }, name: 'Arial' }, 24);
    addMergedRow('Caloocan City, NCR', { size: 11, color: { argb: 'FF6B7280' }, name: 'Arial' }, 16);
    addMergedRow('Philippines', { size: 11, color: { argb: 'FF6B7280' }, name: 'Arial' }, 16);
    addMergedRow('HUMAN RESOURCES DEPARTMENT', { bold: true, size: 12, color: { argb: 'FF1B5E20' }, name: 'Arial' }, 20);
    addMergedRow(`SY. ${schoolYear} | ${term.toUpperCase()}`, { size: 11, color: { argb: 'FF6B7280' }, name: 'Arial' }, 18);

    const divider = ws.addRow(['']); divider.height = 8;
    ws.mergeCells(`A${divider.number}:${lastCol}${divider.number}`);
    divider.getCell(1).border = { bottom: { style: 'thin', color: { argb: 'FFE5E7EB' } } };
    ws.addRow([]);

    const titleRow = ws.addRow(['Tardiness & Absenteeism Report']);
    ws.mergeCells(`A${titleRow.number}:${lastCol}${titleRow.number}`);
    titleRow.font = { bold: true, size: 15, color: { argb: 'FF333333' }, name: 'Arial' };
    titleRow.alignment = leftStyle; titleRow.height = 24;

    [['Period:', periodLabel], ['Total Late / Absent:', `${totalLate} / ${totalAbsent}`], ['Generated:', new Date().toLocaleString()]].forEach(([l, v]) => {
        const row = ws.addRow([l, v]);
        row.getCell(1).font = { color: { argb: 'FF6B7280' }, size: 10, name: 'Arial' };
        row.getCell(2).font = { color: { argb: 'FF333333' }, size: 10, name: 'Arial' };
        row.alignment = leftStyle; row.height = 16;
    });
    ws.addRow([]);

    const headerRow = ws.addRow(['#', 'EMPLOYEE NAME', 'DEPARTMENT', 'LATE', 'ABSENT', 'TOTAL ISSUES', 'TOTAL RECORDS']);
    headerRow.height = 22;
    headerRow.eachCell(cell => {
        cell.font = { bold: true, size: 9, color: { argb: 'FF9CA3AF' }, name: 'Arial' };
        cell.alignment = centerStyle;
        cell.border = { bottom: { style: 'thin', color: { argb: 'FFE5E7EB' } } };
    });

    sorted.forEach((emp, idx) => {
        let issueArgb = 'FF2E7D32';
        if (emp.totalIssues >= 5) issueArgb = 'FFC62828';
        else if (emp.totalIssues >= 3) issueArgb = 'FFEF6C00';

        const row = ws.addRow([
            idx + 1, emp.name || '—', emp.department || '—',
            emp.lateCount, emp.absentCount, emp.totalIssues, emp.totalRecords,
        ]);
        row.height = 20;
        row.eachCell(cell => {
            cell.font = { size: 10, color: { argb: 'FF333333' }, name: 'Arial' };
            cell.border = { bottom: { style: 'thin', color: { argb: 'FFF3F4F6' } } };
            cell.alignment = centerStyle;
        });
        row.getCell(2).font = { size: 10, color: { argb: 'FF333333' }, name: 'Arial', bold: true };
        row.getCell(2).alignment = leftStyle;
        row.getCell(3).alignment = leftStyle;
        row.getCell(4).font = { size: 10, color: { argb: 'FFEF6C00' }, name: 'Arial' };
        row.getCell(5).font = { size: 10, color: { argb: 'FFC62828' }, name: 'Arial' };
        row.getCell(6).font = { size: 10, color: { argb: issueArgb }, name: 'Arial', bold: true };
    });

    const filename = `tardiness_report_${filters.startDate}_${filters.endDate}_${Date.now()}.xlsx`;
    const buffer = await workbook.xlsx.writeBuffer();
    const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const url = window.URL.createObjectURL(blob);
    const link = document.createElement('a'); link.href = url; link.download = filename; link.click();
    window.URL.revokeObjectURL(url);
    console.log('[HR-Reports] Tardiness Excel downloaded');
}

async function generateAdjustmentHistoryPDF(data, filters, schoolInfo) {
    console.log('[HR-Reports] Generating Adjustment History PDF...', data.length, 'records');

    if (typeof pdfMake === 'undefined') { showReportError('pdfMake library not loaded.'); return; }

    const schoolYear = schoolInfo.school_year || '2025-2026';
    const term = schoolInfo.term || 'Second Semester';
    const periodLabel = `${formatDate(filters.startDate)} — ${formatDate(filters.endDate)}`;

    const tableBody = [
        [
            { text: '#', style: 'tableHeader', alignment: 'center' },
            { text: 'DATE / TIME', style: 'tableHeader' },
            { text: 'ACTION', style: 'tableHeader' },
            { text: 'DETAILS', style: 'tableHeader' },
            { text: 'PERFORMED BY', style: 'tableHeader' },
        ]
    ];

    data.forEach((rec, idx) => {
        const details = rec.details || {};
        let detailText = '';
        if (details.new_status) detailText = `Status → ${details.new_status}`;
        if (details.reason) detailText += detailText ? ` | ${details.reason}` : details.reason;
        if (details.employee_id) detailText += ` (Emp: ${details.employee_id})`;
        if (!detailText) detailText = JSON.stringify(details).substring(0, 60);

        tableBody.push([
            { text: String(idx + 1), style: 'tableCell', alignment: 'center' },
            { text: rec.timestamp ? new Date(rec.timestamp).toLocaleString() : '—', style: 'tableCell' },
            { text: (rec.action || '').replace(/_/g, ' '), style: 'tableCell', color: '#1B5E20', bold: true },
            { text: detailText || '—', style: 'tableCell', fontSize: 8 },
            { text: rec.performedBy || '—', style: 'tableCell' },
        ]);
    });

    const docDefinition = {
        content: [
            { text: 'St. Clare College', style: 'headerCollege', alignment: 'center' },
            { text: 'Caloocan City, NCR', style: 'headerInfo', alignment: 'center' },
            { text: 'Philippines', style: 'headerInfo', alignment: 'center', margin: [0, 0, 0, 12] },
            { text: 'HUMAN RESOURCES DEPARTMENT', style: 'headerProgram', alignment: 'center' },
            { text: `SY. ${schoolYear} | ${term.toUpperCase()}`, style: 'headerSemester', alignment: 'center', margin: [0, 2, 0, 15] },

            { text: 'Attendance Adjustment History', style: 'title', margin: [0, 0, 0, 5] },
            {
                columns: [
                    {
                        width: '*', stack: [
                            { text: `Period: ${periodLabel}`, style: 'info' },
                            { text: `Total Adjustments: ${data.length}`, style: 'info' },
                        ]
                    },
                    {
                        width: 'auto', stack: [
                            { text: `Generated: ${new Date().toLocaleString()}`, style: 'info', alignment: 'right' },
                        ]
                    }
                ],
                margin: [0, 0, 0, 20]
            },

            {
                table: { headerRows: 1, widths: ['5%', '18%', '18%', '38%', '16%'], body: tableBody },
                layout: {
                    hLineWidth: (i) => (i === 1) ? 1 : 0.5,
                    vLineWidth: () => 0,
                    hLineColor: (i) => (i === 1) ? '#CCCCCC' : '#EEEEEE',
                    paddingLeft: () => 4, paddingRight: () => 4, paddingTop: () => 7, paddingBottom: () => 7,
                }
            }
        ],
        styles: {
            headerCollege: { fontSize: 16, bold: true, color: '#1F2937' },
            headerInfo: { fontSize: 10, color: '#6B7280' },
            headerProgram: { fontSize: 11, bold: true, color: '#1B5E20', margin: [0, 4, 0, 0] },
            headerSemester: { fontSize: 10, color: '#6B7280', margin: [0, 2, 0, 0] },
            title: { fontSize: 14, bold: true, color: '#333333' },
            info: { fontSize: 9, color: '#666666' },
            tableHeader: { fontSize: 8, bold: true, color: '#9E9E9E', margin: [0, 0, 0, 4] },
            tableCell: { fontSize: 9, color: '#333333' },
        },
        defaultStyle: { fontSize: 9, font: 'Roboto' },
        pageOrientation: 'landscape',
        pageMargins: [30, 30, 30, 30],
    };

    const filename = `adjustment_history_${filters.startDate}_${filters.endDate}_${Date.now()}.pdf`;
    pdfMake.createPdf(docDefinition).download(filename);
    console.log('[HR-Reports] Adjustment History PDF downloaded');
}

async function generateAdjustmentHistoryExcel(data, filters, schoolInfo) {
    console.log('[HR-Reports] Generating Adjustment History Excel...', data.length, 'records');

    if (typeof ExcelJS === 'undefined') { showReportError('ExcelJS library not loaded.'); return; }

    const schoolYear = schoolInfo.school_year || '2025-2026';
    const term = schoolInfo.term || 'Second Semester';
    const periodLabel = `${formatDate(filters.startDate)} — ${formatDate(filters.endDate)}`;
    const lastCol = 'E';
    const centerStyle = { horizontal: 'center', vertical: 'middle' };
    const leftStyle = { horizontal: 'left', vertical: 'middle' };

    const workbook = new ExcelJS.Workbook();
    const ws = workbook.addWorksheet('Adjustment History');
    ws.columns = [
        { width: 6 }, { width: 22 }, { width: 24 }, { width: 46 }, { width: 18 },
    ];

    const addMergedRow = (text, font, height = 18) => {
        const row = ws.addRow([text]);
        ws.mergeCells(`A${row.number}:${lastCol}${row.number}`);
        row.font = font; row.alignment = centerStyle; row.height = height;
        return row;
    };

    addMergedRow('St. Clare College', { bold: true, size: 17, color: { argb: 'FF1F2937' }, name: 'Arial' }, 24);
    addMergedRow('Caloocan City, NCR', { size: 11, color: { argb: 'FF6B7280' }, name: 'Arial' }, 16);
    addMergedRow('Philippines', { size: 11, color: { argb: 'FF6B7280' }, name: 'Arial' }, 16);
    addMergedRow('HUMAN RESOURCES DEPARTMENT', { bold: true, size: 12, color: { argb: 'FF1B5E20' }, name: 'Arial' }, 20);
    addMergedRow(`SY. ${schoolYear} | ${term.toUpperCase()}`, { size: 11, color: { argb: 'FF6B7280' }, name: 'Arial' }, 18);

    const divider = ws.addRow(['']); divider.height = 8;
    ws.mergeCells(`A${divider.number}:${lastCol}${divider.number}`);
    divider.getCell(1).border = { bottom: { style: 'thin', color: { argb: 'FFE5E7EB' } } };
    ws.addRow([]);

    const titleRow = ws.addRow(['Attendance Adjustment History']);
    ws.mergeCells(`A${titleRow.number}:${lastCol}${titleRow.number}`);
    titleRow.font = { bold: true, size: 15, color: { argb: 'FF333333' }, name: 'Arial' };
    titleRow.alignment = leftStyle; titleRow.height = 24;

    [['Period:', periodLabel], ['Total Adjustments:', String(data.length)], ['Generated:', new Date().toLocaleString()]].forEach(([l, v]) => {
        const row = ws.addRow([l, v]);
        row.getCell(1).font = { color: { argb: 'FF6B7280' }, size: 10, name: 'Arial' };
        row.getCell(2).font = { color: { argb: 'FF333333' }, size: 10, name: 'Arial' };
        row.alignment = leftStyle; row.height = 16;
    });
    ws.addRow([]);

    const headerRow = ws.addRow(['#', 'DATE / TIME', 'ACTION', 'DETAILS', 'PERFORMED BY']);
    headerRow.height = 22;
    headerRow.eachCell(cell => {
        cell.font = { bold: true, size: 9, color: { argb: 'FF9CA3AF' }, name: 'Arial' };
        cell.alignment = centerStyle;
        cell.border = { bottom: { style: 'thin', color: { argb: 'FFE5E7EB' } } };
    });

    data.forEach((rec, idx) => {
        const details = rec.details || {};
        let detailText = '';
        if (details.new_status) detailText = `Status → ${details.new_status}`;
        if (details.reason) detailText += detailText ? ` | ${details.reason}` : details.reason;
        if (details.employee_id) detailText += ` (Emp: ${details.employee_id})`;
        if (!detailText) detailText = JSON.stringify(details).substring(0, 80);

        const row = ws.addRow([
            idx + 1,
            rec.timestamp ? new Date(rec.timestamp).toLocaleString() : '—',
            (rec.action || '').replace(/_/g, ' '),
            detailText || '—',
            rec.performedBy || '—',
        ]);
        row.height = 20;
        row.eachCell(cell => {
            cell.font = { size: 10, color: { argb: 'FF333333' }, name: 'Arial' };
            cell.border = { bottom: { style: 'thin', color: { argb: 'FFF3F4F6' } } };
            cell.alignment = leftStyle;
        });
        row.getCell(1).alignment = centerStyle;
        row.getCell(3).font = { size: 10, color: { argb: 'FF1B5E20' }, name: 'Arial', bold: true };
        row.getCell(4).font = { size: 9, color: { argb: 'FF666666' }, name: 'Arial' };
        row.getCell(4).alignment = { ...leftStyle, wrapText: true };
    });

    const filename = `adjustment_history_${filters.startDate}_${filters.endDate}_${Date.now()}.xlsx`;
    const buffer = await workbook.xlsx.writeBuffer();
    const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const url = window.URL.createObjectURL(blob);
    const link = document.createElement('a'); link.href = url; link.download = filename; link.click();
    window.URL.revokeObjectURL(url);
    console.log('[HR-Reports] Adjustment History Excel downloaded');
}

// ============================================================
//  SHARED HELPERS
// ============================================================

function getDefaultSchoolInfo() {
    return {
        school_year: '2025-2026',
        term: 'Second Semester',
    };
}

function getSelectedFormat(modal) {
    return pendingFormat || 'pdf';
}

function bindBtn(id, handler) {
    const el = document.getElementById(id);
    if (el) el.addEventListener('click', handler);
}

function formatDate(dateStr) {
    if (!dateStr) return 'N/A';
    try {
        return new Date(dateStr).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
    } catch { return dateStr; }
}

function formatTime(timeStr) {
    if (!timeStr) return '—';
    // Handle bare HH:MM or HH:MM:SS strings from the DB
    const parts = String(timeStr).split(':');
    if (parts.length >= 2) {
        const hours = parseInt(parts[0], 10);
        const minutes = parts[1] || '00';
        if (!isNaN(hours)) {
            const period = hours >= 12 ? 'PM' : 'AM';
            return `${hours % 12 || 12}:${minutes} ${period}`;
        }
    }
    // Fallback: try as full datetime
    const d = new Date(timeStr);
    if (!isNaN(d.getTime())) {
        return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
    }
    return timeStr;
}

function computeHours(timeIn, timeOut) {
    if (!timeIn || !timeOut) return null;
    const [hIn, mIn] = timeIn.split(':').map(Number);
    const [hOut, mOut] = timeOut.split(':').map(Number);
    if (isNaN(hIn) || isNaN(hOut)) return null;
    const diff = (hOut * 60 + (mOut || 0)) - (hIn * 60 + (mIn || 0));
    return diff > 0 ? (diff / 60).toFixed(1) : null;
}

// ============================================================
//  UI FEEDBACK
// ============================================================

function showReportLoading(show) {
    let overlay = document.getElementById('reportLoadingOverlay');
    if (show) {
        if (!overlay) {
            overlay = document.createElement('div');
            overlay.id = 'reportLoadingOverlay';
            overlay.style.cssText = `
        position: fixed; inset: 0; z-index: 9999;
        background: rgba(0,0,0,0.5); display: flex;
        align-items: center; justify-content: center;
      `;
            overlay.innerHTML = `
        <div style="background: var(--bg-secondary, #fff); padding: 32px 48px; border-radius: 12px;
                    text-align: center; box-shadow: 0 8px 32px rgba(0,0,0,0.3);">
          <div class="spinner" style="width: 40px; height: 40px; border: 3px solid #e5e7eb;
               border-top-color: #1B5E20; border-radius: 50%; animation: spin 0.8s linear infinite;
               margin: 0 auto 16px;"></div>
          <p style="color: var(--text-primary, #333); font-size: 14px; margin: 0;">Generating report...</p>
        </div>`;
            document.body.appendChild(overlay);
        }
        overlay.style.display = 'flex';
    } else {
        if (overlay) overlay.style.display = 'none';
    }
}

function showReportError(message) {
    showReportLoading(false);
    // Simple toast-style error
    const toast = document.createElement('div');
    toast.style.cssText = `
    position: fixed; bottom: 24px; right: 24px; z-index: 9999;
    background: #C62828; color: #fff; padding: 16px 24px;
    border-radius: 8px; font-size: 14px; box-shadow: 0 4px 12px rgba(0,0,0,0.3);
    animation: slideIn 0.3s ease;
  `;
    toast.textContent = message;
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 4000);
}
