/**
 * HR Routes
 * HR Dashboard, QR management, employee management, attendance reports
 */

const express = require('express');
const router = express.Router();

const { requireAuth } = require('../middleware/auth');
const { catchAsync, AppError } = require('../middleware/errorHandler');
const { hrService, adminService, attendanceService } = require('../services');



// QR Management
router.get('/qr/current', requireAuth(['hr', 'superadmin']), catchAsync(async (req, res) => {
  // Get the current global active QR session (for HR dashboard display)
  const session = await hrService.getCurrentQRSession();
  if (!session) {
    return res.status(404).json({ success: false, message: 'No active QR session' });
  }
  res.json({ success: true, data: session });
}));

router.get('/qr/status', requireAuth(['hr', 'superadmin']), catchAsync(async (req, res) => {
  const { qrSessionId } = req.query;
  if (!qrSessionId) throw new AppError('QR Session ID required', 400);
  const status = await hrService.getQRSessionStatus(qrSessionId);
  res.json({ success: true, data: status });
}));

router.get('/qr/history', requireAuth(['hr', 'superadmin']), catchAsync(async (req, res) => {
  const { employeeId, startDate, endDate, has_scans, status, _page = 1, _limit = 20 } = req.query;
  const filters = { employeeId, startDate, endDate };

  // Add has_scans filter if provided
  if (has_scans === 'true') {
    filters.hasScans = true;
  } else if (has_scans === 'false') {
    filters.hasScans = false;
  }

  // Add status filter if provided (active, paused, expired)
  if (status) {
    filters.status = status;
  }

  const result = await hrService.getQRHistory(filters, parseInt(_page), parseInt(_limit));
  // Set X-Total-Count header for pagination
  res.set('X-Total-Count', result.pagination.total.toString());
  res.json({ success: true, ...result });
}));

/**
 * Display QR endpoints
 */
router.get('/display/qr', requireAuth(['display']), catchAsync(async (req, res) => {
  const session = await hrService.getCurrentQRSession();
  if (!session) {
    throw new AppError('No active QR session', 404);
  }
  res.json({ success: true, data: session });
}));

router.get('/display/qr/public', catchAsync(async (req, res) => {
  const session = await hrService.getCurrentQRSession();
  if (!session) {
    throw new AppError('No active QR session', 404);
  }
  res.json(session);
}));

// Departments
router.get('/departments', requireAuth(['hr', 'superadmin']), catchAsync(async (req, res) => {
  const departments = await hrService.getDepartments();
  res.json({ success: true, data: departments });
}));

// Employee Management
router.get('/employees', requireAuth(['hr', 'superadmin']), catchAsync(async (req, res) => {
  const { departmentId, search, excludeRoles, _page = 1, _limit = 20 } = req.query;
  const filters = { departmentId, search };
  if (excludeRoles) {
    filters.excludeRoles = Array.isArray(excludeRoles) ? excludeRoles : excludeRoles.split(',');
  }
  const result = await hrService.listEmployees(filters, parseInt(_page), parseInt(_limit));
  res.json({ success: true, ...result });
}));

router.get('/employees/:id', requireAuth(['hr', 'superadmin']), catchAsync(async (req, res) => {
  const employee = await hrService.getEmployee(req.params.id);
  res.json({ success: true, data: employee });
}));

router.put('/employees/:id', requireAuth(['hr', 'superadmin']), catchAsync(async (req, res) => {
  const updated = await hrService.updateEmployee(req.params.id, req.body, req.auth.id);
  res.json({ success: true, data: updated });
}));

router.delete('/employees/:id', requireAuth(['hr', 'superadmin']), catchAsync(async (req, res) => {
  const result = await hrService.updateEmployee(req.params.id, { status: 'inactive' }, req.auth.id);
  res.json({ success: true, message: 'Employee deleted' });
}));

// Attendance Management
router.get('/attendance', requireAuth(['hr', 'superadmin']), catchAsync(async (req, res) => {
  const { departmentId, startDate, endDate, status, _page = 1, _limit = 20 } = req.query;
  const filters = { departmentId, startDate, endDate, status };
  const result = await hrService.getAttendanceReport(filters, parseInt(_page), parseInt(_limit));
  res.json({ success: true, ...result });
}));

router.post('/attendance/override', requireAuth(['hr', 'superadmin']), catchAsync(async (req, res) => {
  const { attendanceId, newStatus, reason } = req.body;
  if (!attendanceId || !newStatus) throw new AppError('Missing required fields', 400);
  const result = await hrService.overrideAttendance(attendanceId, newStatus, reason, req.auth.id);
  res.json(result);
}));

// Verify attendance status (mark as verified)
router.patch('/attendance/:id/verify', requireAuth(['hr', 'superadmin']), catchAsync(async (req, res) => {
  const { status, verified_by } = req.body;
  if (!status) throw new AppError('Status is required', 400);
  const result = await hrService.verifyAttendance(req.params.id, status, verified_by || req.auth.id);
  res.json({ success: true, data: result });
}));

router.get('/adjustments/history', requireAuth(['hr', 'superadmin']), catchAsync(async (req, res) => {
  const { startDate, endDate, _page = 1, _limit = 20 } = req.query;
  const filters = { startDate, endDate };
  const result = await hrService.getAdjustmentHistory(filters, parseInt(_page), parseInt(_limit));
  res.json({ success: true, ...result });
}));

// Hourly Rounds Verification - Subject-Based
router.get('/rounds/daily', requireAuth(['hr', 'superadmin']), catchAsync(async (req, res) => {
  const { date } = req.query;
  const targetDate = date || new Date().toISOString().split('T')[0];
  const rounds = await attendanceService.getHourlyRoundsWithSchedules(targetDate);
  res.json({ success: true, data: rounds });
}));

// Verify subject-based round (not hourly blocks anymore)
router.post('/rounds/verify', requireAuth(['hr', 'superadmin']), catchAsync(async (req, res) => {
  const { attendanceId, subjectCode, templateId, employeeId, date, status } = req.body;
  if (!subjectCode || !templateId || !employeeId || !date || !status) {
    throw new AppError('Missing required fields: subjectCode, templateId, employeeId, date, status', 400);
  }

  // Use subject info as verification key (status is stored as VALUE, not in key)
  const verifyKey = `${subjectCode}_${templateId}`;
  const result = await attendanceService.verifyHour(attendanceId, verifyKey, req.auth.id, employeeId, date, status);
  res.json({ success: true, data: result });
}));

/**
 * GET /api/hr/attendance-with-subjects
 * Get attendance records enriched with subject/schedule data (all departments)
 * Mirrors dept-head endpoint but without department scoping
 */
router.get('/attendance-with-subjects', requireAuth(['hr', 'superadmin']), catchAsync(async (req, res) => {
  const { date_from, date_to, department_id } = req.query;
  const { supabase } = require('../conn-supabase');

  if (!date_from || !date_to) {
    throw new AppError('date_from and date_to are required (YYYY-MM-DD format)', 400);
  }

  try {
    // Get employees (optionally filtered by department)
    const filters = department_id ? { departmentId: department_id } : {};
    const { data: employees } = await hrService.listEmployees(filters, 1, 10000);
    if (!employees || employees.length === 0) {
      return res.json({ success: true, data: [] });
    }

    const employeeIds = employees.map(emp => emp.employee_id || emp.id);

    // Get attendance records for date range
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

    // Enrich with subject data via getHourlyRoundsWithSchedules
    const uniqueDates = [...new Set(attendanceRecords.map(r => r.date))];
    const subjectsByDateAndEmployee = {};

    for (const date of uniqueDates) {
      const hourlyRounds = await attendanceService.getHourlyRoundsWithSchedules(date);
      hourlyRounds.forEach(round => {
        const key = `${date}_${round.employee_id}`;
        subjectsByDateAndEmployee[key] = round.subjects || [];
      });
    }

    // Build employee lookup for names/departments
    const empMap = {};
    employees.forEach(emp => { empMap[emp.employee_id || emp.id] = emp; });

    const enrichedData = attendanceRecords.map(record => {
      const key = `${record.date}_${record.employee_id}`;
      const emp = empMap[record.employee_id] || {};
      return {
        ...record,
        subjects: subjectsByDateAndEmployee[key] || [],
        employee: {
          first_name: emp.first_name || '',
          last_name: emp.last_name || '',
          employee_id: record.employee_id,
          department: emp.department || ''
        }
      };
    });

    res.json({ success: true, data: enrichedData });
  } catch (error) {
    console.error('[hr] Error fetching attendance with subjects:', error);
    throw new AppError('Error fetching attendance with subjects', 500);
  }
}));

module.exports = router;
