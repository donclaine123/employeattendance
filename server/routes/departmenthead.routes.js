/**
 * Department Head Routes
 * Department-specific operations and reporting
 */

const express = require('express');
const router = express.Router();

const { requireAuth } = require('../middleware/auth');
const { catchAsync, AppError } = require('../middleware/errorHandler');
const { hrService, reportDownloadService, attendanceService } = require('../services');

async function resolveDepartmentId(req, departmentIdFromQuery = null) {
  if (req.auth.role === 'head_dept') {
    const employee = await hrService.getEmployee(req.auth.employee_id);
    return employee.dept_id || employee.department?.dept_id || null;
  }

  return departmentIdFromQuery || null;
}

function buildDateKeys(dayCount) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const dateKeys = [];

  for (let index = dayCount - 1; index >= 0; index--) {
    const date = new Date(today);
    date.setDate(today.getDate() - index);
    dateKeys.push(date.toISOString().split('T')[0]);
  }

  return dateKeys;
}

function classifyHourlyRound(round) {
  const subjects = Array.isArray(round?.subjects) ? round.subjects : [];

  if (subjects.length === 0) {
    return 'pending';
  }

  let hasVerified = false;
  let hasPending = false;

  for (const subject of subjects) {
    const status = String(subject?.verified_status || '').toLowerCase();

    if (status === 'absent') {
      return 'absent';
    }

    if (status === 'late') {
      return 'late';
    }

    if (status === 'verified' || status === 'present') {
      hasVerified = true;
    } else {
      hasPending = true;
    }
  }

  if (hasPending) {
    return 'pending';
  }

  if (hasVerified) {
    return 'verified';
  }

  return 'pending';
}

function createEmptyAnalyticsPayload(teamSize = 0) {
  return {
    teamSize,
    campusToday: { present: 0, absent: 0 },
    hourlyToday: { verified: 0, late: 0, absent: 0, pending: 0 },
    campusTrend: [],
    hourlyTrend: [],
    reviewItems: []
  };
}

/**
 * GET /api/departmenthead/dashboard
 * Get team attendance statistics
 */
router.get('/dashboard', requireAuth(['head_dept', 'superadmin']), catchAsync(async (req, res) => {
  const { departmentId, date = new Date().toISOString().split('T')[0] } = req.query;

  let targetDeptId = departmentId;

  if (req.auth.role === 'head_dept') {
    try {
      const employee = await hrService.getEmployee(req.auth.employee_id);
      if (employee.dept_id) {
        targetDeptId = employee.dept_id;
      }
    } catch (error) {
      console.error('Error fetching department for dashboard:', error);
    }
  }

  // Get department employees
  const { data: employees } = await hrService.listEmployees({ departmentId: targetDeptId }, 1, 1000);
  const employeeList = Array.isArray(employees) ? employees : [];

  // Get today's attendance for department employees
  const { supabase } = require('../conn-supabase');
  let campusPresent = 0;
  let campusLate = 0;
  let campusAbsent = 0;
  let hourlyLate = 0;
  let hourlyAbsent = 0;

  if (employeeList.length > 0) {
    const employeeIds = employeeList.map(emp => emp.employee_id || emp.id);

    const { data: attendanceRecords } = await supabase
      .from('attendance')
      .select('employee_id, status')
      .in('employee_id', employeeIds)
      .eq('attendance_type', 'in_person')
      .eq('date', date);

    const attendanceByEmployee = new Map();
    const statusPriority = {
      on_leave: 3,
      absent: 2,
      late: 1,
      present: 0,
    };

    (attendanceRecords || []).forEach(record => {
      const employeeKey = String(record.employee_id || '');
      if (!employeeKey) return;

      const status = (record.status || '').toLowerCase();
      const existingStatus = attendanceByEmployee.get(employeeKey);
      const existingPriority = existingStatus ? (statusPriority[existingStatus] ?? -1) : -1;
      const nextPriority = statusPriority[status] ?? -1;

      if (!existingStatus || nextPriority > existingPriority) {
        attendanceByEmployee.set(employeeKey, status);
      }
    });

    employeeIds.forEach(employeeKey => {
      const status = attendanceByEmployee.get(String(employeeKey));

      if (status === 'present') {
        campusPresent++;
      } else if (status === 'late') {
        campusPresent++;
        campusLate++;
      } else {
        campusAbsent++;
      }
    });

    const departmentEmployeeIds = new Set(employeeIds.map(id => String(id)));
    const hourlyRounds = await attendanceService.getHourlyRoundsWithSchedules(date);
    const hourlyLateEmployees = new Set();
    const hourlyAbsentEmployees = new Set();

    (hourlyRounds || []).forEach(round => {
      if (!departmentEmployeeIds.has(String(round.employee_id))) return;

      const subjects = Array.isArray(round.subjects) ? round.subjects : [];
      const hasLate = subjects.some(subject => String(subject.verified_status || '').toLowerCase() === 'late');
      const hasAbsent = subjects.some(subject => String(subject.verified_status || '').toLowerCase() === 'absent');

      if (hasLate) hourlyLateEmployees.add(String(round.employee_id));
      if (hasAbsent) hourlyAbsentEmployees.add(String(round.employee_id));
    });

    hourlyLate = hourlyLateEmployees.size;
    hourlyAbsent = hourlyAbsentEmployees.size;
  }

  res.json({
    success: true,
    teamSize: employeeList.length,
    campusPresent,
    campusLate,
    campusAbsent,
    totalPresent: campusPresent,
    totalLate: campusLate,
    totalAbsent: campusAbsent,
    hourlyLate,
    hourlyAbsent,
  });
}));

/**
 * GET /api/departmenthead/analytics-overview
 * Lightweight attendance and hourly attendance trends for the current department
 */
router.get('/analytics-overview', requireAuth(['head_dept', 'superadmin']), catchAsync(async (req, res) => {
  const requestedDays = Math.max(3, Math.min(14, parseInt(req.query.days, 10) || 7));
  const targetDeptId = await resolveDepartmentId(req, req.query.departmentId);

  if (!targetDeptId) {
    throw new AppError('Department ID required', 400);
  }

  const { data: employees } = await hrService.listEmployees({ departmentId: targetDeptId }, 1, 1000);
  const employeeList = Array.isArray(employees) ? employees : [];
  const employeeIds = employeeList
    .map(emp => String(emp.employee_id || emp.id || ''))
    .filter(Boolean);

  if (employeeIds.length === 0) {
    return res.json({ success: true, data: createEmptyAnalyticsPayload(0) });
  }

  const employeeIdSet = new Set(employeeIds);
  const dateKeys = buildDateKeys(requestedDays);
  const startDate = dateKeys[0];
  const endDate = dateKeys[dateKeys.length - 1];
  const { supabase } = require('../conn-supabase');

  const { data: attendanceRows } = await supabase
    .from('attendance')
    .select('employee_id, status, date')
    .in('employee_id', employeeIds)
    .eq('attendance_type', 'in_person')
    .gte('date', startDate)
    .lte('date', endDate);

  const campusTrendMaps = new Map(dateKeys.map(date => [date, new Map(employeeIds.map(id => [id, false]))]));

  (attendanceRows || []).forEach(row => {
    const dateKey = row.date;
    const employeeKey = String(row.employee_id || '');
    const employeeStatusMap = campusTrendMaps.get(dateKey);

    if (!employeeStatusMap || !employeeKey) {
      return;
    }

    const status = String(row.status || '').toLowerCase();
    if (status === 'present' || status === 'late') {
      employeeStatusMap.set(employeeKey, true);
    }
  });

  const campusTrend = dateKeys.map(date => {
    const employeeStatusMap = campusTrendMaps.get(date) || new Map();
    let present = 0;

    employeeStatusMap.forEach(isPresent => {
      if (isPresent) {
        present++;
      }
    });

    return {
      date,
      present,
      absent: employeeIds.length - present
    };
  });

  const hourlyRoundsByDate = await Promise.all(dateKeys.map(async date => {
    const rounds = await attendanceService.getHourlyRoundsWithSchedules(date);
    return {
      date,
      rounds: Array.isArray(rounds) ? rounds : []
    };
  }));

  const hourlyTrend = hourlyRoundsByDate.map(({ date, rounds }) => {
    let verified = 0;
    let late = 0;
    let absent = 0;
    let pending = 0;

    (rounds || []).forEach(round => {
      if (!employeeIdSet.has(String(round.employee_id))) {
        return;
      }

      const state = classifyHourlyRound(round);

      if (state === 'verified') {
        verified++;
      } else if (state === 'late') {
        late++;
      } else if (state === 'absent') {
        absent++;
      } else {
        pending++;
      }
    });

    return {
      date,
      verified,
      late,
      absent,
      pending
    };
  });

  const campusToday = campusTrend[campusTrend.length - 1] || { date: endDate, present: 0, absent: employeeIds.length };
  const hourlyToday = hourlyTrend[hourlyTrend.length - 1] || { date: endDate, verified: 0, late: 0, absent: 0, pending: 0 };

  const reviewItems = [
    {
      title: 'On-campus absent',
      value: campusToday.absent,
      note: 'Today',
      tone: 'danger'
    },
    {
      title: 'Hourly late',
      value: hourlyToday.late,
      note: 'Today',
      tone: 'warning'
    },
    {
      title: 'Hourly absent',
      value: hourlyToday.absent,
      note: 'Today',
      tone: 'neutral'
    }
  ];

  res.json({
    success: true,
    data: {
      teamSize: employeeIds.length,
      campusToday,
      hourlyToday,
      campusTrend,
      hourlyTrend,
      reviewItems
    }
  });
}));

/**
 * GET /api/departmenthead/employees
 * Get all employees in department
 */
router.get('/employees', requireAuth(['head_dept', 'superadmin']), catchAsync(async (req, res) => {
  let { departmentId, _page = 1, _limit = 20 } = req.query;

  // For Department Head, enforce their department and exclude privileged roles
  let excludeRoles = [];
  if (req.auth.role === 'head_dept') {
    try {
      // Get the department head's employee record to find their department
      const employee = await hrService.getEmployee(req.auth.employee_id);

      // Use dept_id from the employee record (or department_id/department?.dept_id if mapped differently)
      // Based on schema, it is dept_id.
      if (employee.dept_id) {
        departmentId = employee.dept_id;
      } else if (employee.department && employee.department.dept_id) {
        departmentId = employee.department.dept_id;
      } else {
        // Fallback or error if no department found
        console.warn(`Department Head ${req.auth.email} has no department assigned.`);
        return res.json({ success: true, data: [], pagination: { total: 0 } });
      }

      // Exclude high-level roles from their view
      // They shouldn't see Superadmins, HRs, or other Department Heads (even though they shouldn't be in this dept anyway, this is a safety check)
      excludeRoles = ['superadmin', 'hr', 'head_dept'];

    } catch (error) {
      console.error('Error fetching department info for head:', error);
      throw new AppError('Could not verify department permissions', 500);
    }
  }

  const result = await hrService.listEmployees({ departmentId, excludeRoles }, parseInt(_page), parseInt(_limit));
  res.json({ success: true, ...result });
}));

/**
 * GET /api/departmenthead/recent-activity
 * Get recent scan attendance in department
 */
router.get('/recent-activity', requireAuth(['head_dept', 'superadmin']), catchAsync(async (req, res) => {
  const { departmentId, _limit = 10 } = req.query;
  let targetDeptId = departmentId;

  if (req.auth.role === 'head_dept') {
    try {
      const employee = await hrService.getEmployee(req.auth.employee_id);
      if (employee.dept_id) {
        targetDeptId = employee.dept_id;
      }
    } catch (error) {
      console.error('Error fetching department for activity:', error);
    }
  }

  const feedLimit = Math.max(parseInt(_limit, 10) || 10, 1);

  const { supabase } = require('../conn-supabase');
  const { data: employees } = await hrService.listEmployees({ departmentId: targetDeptId }, 1, 1000);
  const employeeList = Array.isArray(employees) ? employees : [];
  const employeeIds = employeeList.map(emp => emp.employee_id || emp.id);
  const employeeMap = new Map(employeeList.map(emp => [String(emp.employee_id || emp.id), emp]));

  const { data: attendanceRows } = await supabase
    .from('attendance')
    .select('employee_id, status, time_in, time_out, attendance_type, date')
    .in('employee_id', employeeIds)
    .eq('attendance_type', 'in_person')
    .not('time_in', 'is', null)
    .order('date', { ascending: false })
    .order('time_in', { ascending: false })
    .limit(feedLimit);

  const activities = (attendanceRows || [])
    .map(record => {
      const employee = employeeMap.get(String(record.employee_id)) || {};
      const status = String(record.status || '').trim().toLowerCase();
      const statusLabel = status ? `${status.charAt(0).toUpperCase()}${status.slice(1)}` : 'Scanned';

      return {
        name: `${employee.first_name || ''} ${employee.last_name || ''}`.trim() || employee.full_name || 'Unknown',
        action: `Campus scan - ${statusLabel}`,
        time: record.date && record.time_in ? `${record.date}T${record.time_in}` : record.time_in,
        indicator: status === 'late' ? 'warning' : 'success'
      };
    });

  res.json({ success: true, activities });
}));

/**
 * GET /api/departmenthead/report-history
 * Get department head's report download history
 */
router.get('/report-history', requireAuth(['head_dept', 'superadmin']), catchAsync(async (req, res) => {
  const { _page = 1, _limit = 20 } = req.query;
  const userId = req.auth.user_id;

  const result = await reportDownloadService.getUserReportHistory(
    userId,
    parseInt(_limit),
    (parseInt(_page) - 1) * parseInt(_limit)
  );

  res.json({ success: true, ...result });
}));

/**
 * GET /api/departmenthead/department-reports
 * Get all reports generated in department (admin view)
 */
router.get('/department-reports', requireAuth(['head_dept', 'superadmin']), catchAsync(async (req, res) => {
  const { _page = 1, _limit = 50 } = req.query;
  let targetDeptId = null;

  if (req.auth.role === 'head_dept') {
    try {
      const employee = await hrService.getEmployee(req.auth.employee_id);
      if (employee.dept_id) {
        targetDeptId = employee.dept_id;
      }
    } catch (error) {
      console.error('Error fetching department:', error);
      throw new AppError('Could not determine your department', 500);
    }
  }

  if (!targetDeptId) {
    throw new AppError('Department ID required', 400);
  }

  const result = await reportDownloadService.getDepartmentReportHistory(
    targetDeptId,
    parseInt(_limit),
    (parseInt(_page) - 1) * parseInt(_limit)
  );

  res.json({ success: true, ...result });
}));

/**
 * POST /api/departmenthead/log-report-download
 * Log a report download
 */
router.post('/log-report-download', requireAuth(['head_dept', 'superadmin']), catchAsync(async (req, res) => {
  const { reportType, fileFormat, reportTimeline, dateFrom, dateTo, fileSizeBytes, fileName } = req.body;
  const userId = req.auth.user_id;
  
  let targetDeptId = null;

  // Get department ID
  if (req.auth.role === 'head_dept') {
    try {
      const employee = await hrService.getEmployee(req.auth.employee_id);
      if (employee.dept_id) {
        targetDeptId = employee.dept_id;
      }
    } catch (error) {
      console.error('Error fetching department:', error);
      throw new AppError('Could not determine your department', 500);
    }
  }

  if (!targetDeptId) {
    throw new AppError('Department ID required', 400);
  }

  // Record the download
  const result = await reportDownloadService.recordReportDownload({
    userId,
    deptId: targetDeptId,
    reportType,
    fileFormat,
    reportTimeline,
    dateFrom,
    dateTo,
    fileSizeBytes,
    fileName
  });

  res.json({ success: !!result, data: result });
}));

/**
 * GET /api/departmenthead/attendance-with-subjects
 * Get attendance records with subject enrollment and presence status
 * Query params:
 *   - date_from (required): YYYY-MM-DD format
 *   - date_to (required): YYYY-MM-DD format
 *   - department_id (optional): Filter by department
 */
router.get('/attendance-with-subjects', requireAuth(['head_dept', 'superadmin']), catchAsync(async (req, res) => {
  const { date_from, date_to, department_id: paramDeptId } = req.query;
  const { attendanceService } = require('../services');
  const { supabase } = require('../conn-supabase');

  if (!date_from || !date_to) {
    throw new AppError('date_from and date_to are required (YYYY-MM-DD format)', 400);
  }

  let targetDeptId = paramDeptId;

  // For Department Head, enforce their department
  if (req.auth.role === 'head_dept') {
    try {
      const employee = await hrService.getEmployee(req.auth.employee_id);
      if (employee.dept_id) {
        targetDeptId = employee.dept_id;
      }
    } catch (error) {
      console.error('Error fetching department:', error);
      throw new AppError('Could not determine your department', 500);
    }
  }

  if (!targetDeptId) {
    throw new AppError('Department ID required', 400);
  }

  try {
    // Parse dates
    const startDate = new Date(date_from + 'T00:00:00');
    const endDate = new Date(date_to + 'T23:59:59');

    // Get all employees in department
    const { data: employees } = await hrService.listEmployees({ departmentId: targetDeptId }, 1, 1000);
    if (!employees || employees.length === 0) {
      return res.json({ success: true, data: [] });
    }

    const employeeIds = employees.map(emp => emp.employee_id || emp.id);

    // Get all attendance records for the date range
    const { data: attendanceRecords } = await supabase
      .from('attendance')
      .select('*')
      .in('employee_id', employeeIds)
      .gte('date', date_from)
      .lte('date', date_to)
      .order('date', { ascending: false })
      .order('employee_id', { ascending: true });

    if (!attendanceRecords || attendanceRecords.length === 0) {
      return res.json({ success: true, data: [] });
    }

    // For each date, fetch subjects using getHourlyRoundsWithSchedules
    const uniqueDates = [...new Set(attendanceRecords.map(r => r.date))];
    const subjectsByDateAndEmployee = {};

    for (const date of uniqueDates) {
      const hourlyRounds = await attendanceService.getHourlyRoundsWithSchedules(date);
      
      hourlyRounds.forEach(round => {
        const key = `${date}_${round.employee_id}`;
        subjectsByDateAndEmployee[key] = round.subjects || [];
      });
    }

    // Enrich attendance records with subject data
    const enrichedData = attendanceRecords.map(record => {
      const key = `${record.date}_${record.employee_id}`;
      const subjects = subjectsByDateAndEmployee[key] || [];

      return {
        ...record,
        subjects: subjects
      };
    });

    res.json({ success: true, data: enrichedData });
  } catch (error) {
    console.error('[departmenthead] Error fetching attendance with subjects:', error);
    throw new AppError('Error fetching attendance with subjects', 500);
  }
}));

/**
 * GET /api/departmenthead/current-school-info
 * Get current active school year and term for report headers
 */
router.get('/current-school-info', requireAuth(['head_dept', 'superadmin']), catchAsync(async (req, res) => {
  const { supabase } = require('../conn-supabase');

  try {
    // Fetch the most recent active curriculum template to get school_year and term
    const { data: curriculum, error } = await supabase
      .from('curriculum_templates')
      .select('school_year, term')
      .eq('is_active', true)
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    if (error || !curriculum) {
      // Fallback to default values if no active curriculum found
      return res.json({ 
        success: true, 
        data: {
          school_year: '2025-2026',
          term: 'Second Semester'
        }
      });
    }

    res.json({ 
      success: true, 
      data: {
        school_year: curriculum.school_year,
        term: curriculum.term
      }
    });
  } catch (error) {
    console.error('[departmenthead] Error fetching school info:', error);
    // Fallback to default values on error
    res.json({ 
      success: true, 
      data: {
        school_year: '2025-2026',
        term: 'Second Semester'
      }
    });
  }
}));

module.exports = router;
