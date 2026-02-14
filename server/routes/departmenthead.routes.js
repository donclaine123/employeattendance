/**
 * Department Head Routes
 * Department-specific operations and reporting
 */

const express = require('express');
const router = express.Router();

const { requireAuth } = require('../middleware/auth');
const { catchAsync, AppError } = require('../middleware/errorHandler');
const { hrService, requestService, reportDownloadService } = require('../services');

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

  // Get today's attendance for department employees
  const { supabase } = require('../conn-supabase');
  let totalPresent = 0;
  let totalLate = 0;
  let totalAbsent = 0;

  if (employees && employees.length > 0) {
    const employeeIds = employees.map(emp => emp.employee_id || emp.id);

    const { data: attendanceRecords } = await supabase
      .from('attendance')
      .select('status')
      .in('employee_id', employeeIds)
      .eq('date', date);

    if (attendanceRecords && attendanceRecords.length > 0) {
      attendanceRecords.forEach(record => {
        const status = (record.status || '').toLowerCase();
        if (status === 'present') {
          totalPresent++;
        } else if (status === 'late') {
          totalLate++;
        } else if (status === 'absent') {
          totalAbsent++;
        }
      });
    }
  }

  res.json({
    success: true,
    teamSize: employees.length,
    totalPresent,
    totalLate,
    totalAbsent,
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
 * Get recent requests in department
 */
router.get('/recent-activity', requireAuth(['head_dept', 'superadmin']), catchAsync(async (req, res) => {
  const { departmentId, _page = 1, _limit = 20 } = req.query;
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

  const result = await requestService.getRequests({ departmentId: targetDeptId, status: 'pending' }, parseInt(_page), parseInt(_limit));
  res.json({ success: true, ...result });
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
 * GET /api/departmenthead/report-stats
 * Get report generation statistics for department
 */
router.get('/report-stats', requireAuth(['head_dept', 'superadmin']), catchAsync(async (req, res) => {
  const { daysBack = 30 } = req.query;
  let targetDeptId = null;

  if (req.auth.role === 'head_dept') {
    try {
      const employee = await hrService.getEmployee(req.auth.employee_id);
      if (employee.dept_id) {
        targetDeptId = employee.dept_id;
      }
    } catch (error) {
      console.error('Error fetching department for stats:', error);
      throw new AppError('Could not determine your department', 500);
    }
  }

  if (!targetDeptId) {
    throw new AppError('Department ID required', 400);
  }

  const stats = await reportDownloadService.getDepartmentReportStats(
    targetDeptId,
    parseInt(daysBack)
  );

  res.json({ success: true, data: stats });
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
