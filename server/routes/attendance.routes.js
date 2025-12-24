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
  const { startDate, endDate, employeeId, status, departmentId, _page = 1, _limit = 20 } = req.query;

  const filters = { startDate, endDate, employeeId, status, departmentId };
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
  const { qrSessionId, location } = req.body;

  if (!qrSessionId) {
    throw new AppError('QR session ID is required', 400);
  }

  const result = await attendanceService.checkIn(qrSessionId, location);
  res.json(result);
}));

/**
 * POST /api/attendance/checkout
 * Check-out using QR session
 */
router.post('/checkout', catchAsync(async (req, res) => {
  const { qrSessionId, location } = req.body;

  if (!qrSessionId) {
    throw new AppError('QR session ID is required', 400);
  }

  const result = await attendanceService.checkOut(qrSessionId, location);
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
 * POST /api/attendance/qr/validate
 * Validate QR session
 */
router.post('/qr/validate', catchAsync(async (req, res) => {
  const { qrSessionId } = req.body;

  if (!qrSessionId) {
    throw new AppError('QR session ID is required', 400);
  }

  const valid = await attendanceService.validateQRSession(qrSessionId);
  res.json({ success: true, valid });
}));

module.exports = router;
