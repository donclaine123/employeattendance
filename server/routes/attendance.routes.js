/**
 * Attendance Routes
 * Handles attendance marking, QR validation, check-in/out, and history
 */

const express = require('express');
const router = express.Router();

const { requireAuth } = require('../middleware/auth');
const { catchAsync, AppError } = require('../middleware/errorHandler');
const { attendanceService } = require('../services');

/**
 * POST /api/attendance
 * Mark attendance manually
 */
router.post('/', requireAuth(['hr', 'superadmin']), catchAsync(async (req, res) => {
  const { employeeId, status = 'present' } = req.body;

  if (!employeeId) {
    throw new AppError('Employee ID is required', 400);
  }

  const result = await attendanceService.markAttendance(employeeId, status, 'manual');
  res.json({ success: true, data: result });
}));

/**
 * GET /api/attendance
 * Get filtered attendance records
 */
router.get('/', requireAuth(['hr', 'superadmin', 'head_dept', 'employee']), catchAsync(async (req, res) => {
  console.log('[GET /api/attendance] Query params:', req.query);
  const { startDate, endDate, employeeId, status, departmentId, department, attendanceType, _page = 1, _limit = 20 } = req.query;
  // Note: frontend sends 'department' (name), but backend might use 'departmentId'. We pass 'department' to allow name-based filtering.
  const filters = { startDate, endDate, employeeId, status, departmentId, department, attendanceType };

  console.log('[GET /api/attendance] Calling service with filters:', filters);

  const result = await attendanceService.getAttendanceRecords(
    filters,
    parseInt(_page),
    parseInt(_limit)
  );
  res.json({ success: true, ...result });
}));

/**
 * GET /api/attendance/history
 * Get attendance history
 */
router.get('/history', requireAuth(['employee', 'hr', 'superadmin']), catchAsync(async (req, res) => {
  const { employeeId, employee_id, employee, start, end, months } = req.query;

  console.log('[attendance.routes] /history called - query params:', req.query);
  console.log('[attendance.routes] req.auth:', req.auth);

  // Use provided ID or default to authenticated user's employee ID
  const id = employeeId || employee_id || employee || req.auth.employee_id;

  if (!id) {
    console.error('[attendance.routes] No employee ID found - query:', req.query, 'auth:', req.auth);
    throw new AppError('Employee ID is required', 400);
  }

  // If start/end dates provided, use date-based query
  if (start && end) {
    const data = await attendanceService.getAttendanceHistoryByDateRange(id, start, end);
    return res.json({ success: true, data });
  }

  // Otherwise use month-based approach
  const monthsBack = months ? parseInt(months) : 3;
  const data = await attendanceService.getAttendanceHistory(id, monthsBack);
  res.json({ success: true, data });
}));

/**
 * GET /api/attendance/stats
 * Get attendance statistics for current month
 */
router.get('/stats', requireAuth(['employee', 'hr', 'superadmin']), catchAsync(async (req, res) => {
  const { employeeId, employee_id } = req.query;
  const id = employeeId || employee_id;

  if (!id) {
    throw new AppError('Employee ID is required', 400);
  }

  // Calculate current month date range
  const now = new Date();
  const firstDay = new Date(now.getFullYear(), now.getMonth(), 1);
  const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0);

  const startDate = firstDay.toISOString().split('T')[0];
  const endDate = lastDay.toISOString().split('T')[0];

  const stats = await attendanceService.getAttendanceStats(id, startDate, endDate);
  res.json({ success: true, data: stats });
}));

/**
 * POST /api/attendance/checkin
 * Check-in using QR session
 */
router.post('/checkin', catchAsync(async (req, res) => {
  const { qrSessionId, location, employee_id } = req.body;

  if (!qrSessionId) {
    throw new AppError('QR session ID is required', 400);
  }

  if (!employee_id) {
    throw new AppError('Employee ID is required', 400);
  }

  const result = await attendanceService.checkIn(qrSessionId, employee_id, location);
  res.json(result);
}));

/**
 * POST /api/attendance/checkout
 * Check-out using QR session
 */
router.post('/checkout', catchAsync(async (req, res) => {
  const { qrSessionId, location, employee_id } = req.body;

  if (!qrSessionId) {
    throw new AppError('QR session ID is required', 400);
  }

  if (!employee_id) {
    throw new AppError('Employee ID is required', 400);
  }

  const result = await attendanceService.checkOut(qrSessionId, employee_id, location);
  res.json(result);
}));

/**
 * GET /api/attendance/by-email
 * Get employee info by email
 */
router.get('/by-email', catchAsync(async (req, res) => {
  const { email } = req.query;

  if (!email) {
    throw new AppError('Email is required', 400);
  }

  const data = await attendanceService.getEmployeeByEmail(email);
  res.json({ success: true, data });
}));

/**
 * GET /api/attendance/subject
 * Get employee's scheduled subjects with verification status for a given date
 * Accessible by the employee viewing their own data, or by HR/Department Head viewing their team's data
 * Query params:
 *   - date (required): YYYY-MM-DD format
 *   - employee_id (optional): If provided and user is HR/superadmin/head_dept, fetch that employee's data
 */
router.get('/subject', requireAuth(['employee', 'hr', 'superadmin', 'head_dept']), catchAsync(async (req, res) => {
  const { date, employee_id } = req.query;
  let employeeId = req.auth.id; // Default: current user's ID

  if (!date) {
    throw new AppError('Date parameter is required (YYYY-MM-DD)', 400);
  }

  // If employee_id is provided and user is HR/superadmin/head_dept, use that instead
  if (employee_id && ['hr', 'superadmin', 'head_dept'].includes(req.auth.role)) {
    employeeId = parseInt(employee_id, 10);
  }

  // Use attendanceService to get hourly rounds data for this specific employee
  const result = await attendanceService.getHourlyRoundsWithSchedules(date);
  
  // Filter to only return the requested employee's data
  const employeeData = result.find(r => r.employee_id === parseInt(employeeId));
  
  if (!employeeData) {
    res.json({ success: true, data: [] });
    return;
  }

  res.json({ success: true, data: [employeeData] });
}));

/**
 * POST /api/attendance/qr/validate
 * Validate QR session
 */
router.post('/qr/validate', catchAsync(async (req, res) => {
  const { qrSessionId } = req.body;

  console.log('[attendance.routes] /qr/validate called. Body:', JSON.stringify(req.body, null, 2));

  if (!qrSessionId) {
    console.log('[attendance.routes] Missing qrSessionId in body');
    throw new AppError('QR session ID is required', 400);
  }

  const valid = await attendanceService.validateQRSession(qrSessionId);
  console.log('[attendance.routes] Validation result for', qrSessionId, ':', valid);

  res.json({ success: true, valid });
}));

/**
 * POST /api/attendance/online-attendance
 * Record online class attendance
 */
router.post('/online-attendance', requireAuth(['employee']), catchAsync(async (req, res) => {
  const { instructor_name, date, time_in, online_class_modal, class_period, program_year_section, subject, online_class_link } = req.body;
  const employeeId = req.auth.employee_id;

  // Validation
  if (!instructor_name || !date || !time_in || !online_class_modal || !class_period || !program_year_section || !subject) {
    throw new AppError('Missing required fields', 400);
  }

  const result = await attendanceService.recordOnlineAttendance({
    employee_id: employeeId,
    instructor_name,
    date,
    time_in,
    online_class_modal,
    class_period,
    program_year_section,
    subject,
    online_class_link
  });

  res.json({ success: true, data: result });
}));

/**
 * GET /api/attendance/online-records
 * Get employee's online attendance records
 */
router.get('/online-records', requireAuth(['employee']), catchAsync(async (req, res) => {
  const employeeId = req.auth.employee_id;
  const { startDate, endDate } = req.query;

  const records = await attendanceService.getOnlineAttendanceRecords(employeeId, startDate, endDate);
  res.json({ success: true, data: records });
}));

/**
 * GET /api/attendance/online-check-duplicate
 * Check if attendance already exists for date + subject
 */
router.get('/online-check-duplicate', requireAuth(['employee']), catchAsync(async (req, res) => {
  const { date, subject } = req.query;
  const employeeId = req.auth.employee_id;

  if (!date || !subject) {
    throw new AppError('Date and subject are required', 400);
  }

  const exists = await attendanceService.checkOnlineAttendanceDuplicate(employeeId, date, subject);
  res.json({ success: true, exists });
}));

/**
 * GET /api/hr/online-attendance/pending
 * Get pending online attendance submissions for HR review
 */
router.get('/hr/online-attendance/pending', requireAuth(['hr', 'superadmin']), catchAsync(async (req, res) => {
  const { startDate, endDate, limit = 50 } = req.query;
  
  const records = await attendanceService.getOnlineAttendancePending(startDate, endDate, parseInt(limit));
  res.json({ success: true, data: records });
}));

/**
 * GET /api/hr/online-attendance/done
 * Get processed online attendance records
 */
router.get('/hr/online-attendance/done', requireAuth(['hr', 'superadmin']), catchAsync(async (req, res) => {
  const { startDate, endDate, limit = 100 } = req.query;
  
  const records = await attendanceService.getOnlineAttendanceDoneRecords(startDate, endDate, parseInt(limit));
  res.json({ success: true, data: records });
}));

/**
 * POST /api/hr/online-attendance/done
 * Mark an online attendance submission as done
 */
router.post('/hr/online-attendance/done', requireAuth(['hr', 'superadmin']), catchAsync(async (req, res) => {
  const { attendanceId, notes } = req.body;
  // Use user_id with fallback to id, in case one is undefined
  const hrUserId = req.auth.user_id || req.auth.id;
  const hrUserEmail = req.auth.email;

  if (!attendanceId) {
    throw new AppError('Attendance ID is required', 400);
  }

  console.log('[Done Route] HR User ID:', hrUserId, 'Email:', hrUserEmail, 'req.auth:', req.auth);

  const result = await attendanceService.markOnlineAttendanceDone(
    attendanceId,
    hrUserId,
    hrUserEmail,
    notes
  );

  res.json({ success: true, data: result });
}));

/**
 * Legacy alias for clients still calling the old route.
 */
router.post('/hr/online-attendance/verify', requireAuth(['hr', 'superadmin']), catchAsync(async (req, res) => {
  const { attendanceId, notes } = req.body;
  const hrUserId = req.auth.user_id || req.auth.id;
  const hrUserEmail = req.auth.email;

  if (!attendanceId) {
    throw new AppError('Attendance ID is required', 400);
  }

  const result = await attendanceService.markOnlineAttendanceDone(
    attendanceId,
    hrUserId,
    hrUserEmail,
    notes
  );

  res.json({ success: true, data: result });
}));

/**
 * Legacy alias for the old history route.
 */
router.get('/hr/online-attendance/history', requireAuth(['hr', 'superadmin']), catchAsync(async (req, res) => {
  const { startDate, endDate, limit = 100 } = req.query;

  const records = await attendanceService.getOnlineAttendanceDoneRecords(startDate, endDate, parseInt(limit));
  res.json({ success: true, data: records });
}));

module.exports = router;
