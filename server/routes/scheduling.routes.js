/**
 * Scheduling Routes
 * Handles schedules and shift types management
 */

const express = require('express');
const router = express.Router();

const { requireAuth } = require('../middleware/auth');
const { catchAsync, AppError } = require('../middleware/errorHandler');
const { schedulingService } = require('../services');

// Schedules
router.get('/', requireAuth(['hr', 'superadmin', 'head_dept', 'employee']), catchAsync(async (req, res) => {
  const { start_date, startDate, end_date, endDate, dept_id, departmentId, employee_id, employeeId } = req.query;
  const employeeId_auth = req.auth.employee_id;
  const userId = req.auth.id;
  const userRole = req.auth.role;
  
  // Use snake_case parameter names (frontend sends these)
  const start = start_date || startDate;
  const end = end_date || endDate;
  
  if (!start || !end) {
    throw new AppError('start_date and end_date are required', 400);
  }
  
  // Role-based filtering (match original behavior)
  let deptFilter = dept_id || departmentId;
  let employeeFilter = employee_id || employeeId;
  
  if (userRole === 'employee') {
    // Employees can only see their own schedule
    employeeFilter = employeeId_auth;
  } else if (userRole === 'head_dept') {
    // Department heads can only see their department
    const { supabase } = require('../conn-supabase');
    const { data: deptHeadData } = await supabase
      .from('departments')
      .select('dept_id')
      .eq('head_id', userId)
      .single();
    
    if (!deptHeadData) {
      throw new AppError('Department not found for this user', 403);
    }
    deptFilter = deptHeadData.dept_id;
  }
  
  const filters = {
    startDate: start,
    endDate: end,
    departmentId: deptFilter ? parseInt(deptFilter) : null,
    employeeId: employeeFilter ? parseInt(employeeFilter) : null
  };
  
  console.log('[scheduling.routes] getSchedules filters:', filters);
  const result = await schedulingService.getSchedules(filters, parseInt(req.query._page || 1), parseInt(req.query._limit || 20));
  res.json({ success: true, ...result });
}));

router.post('/', requireAuth(['hr', 'superadmin', 'head_dept']), catchAsync(async (req, res) => {
  const schedule = await schedulingService.createSchedule(req.body, req.auth.id);
  res.json({ success: true, data: schedule });
}));

router.put('/:id', requireAuth(['hr', 'superadmin', 'head_dept']), catchAsync(async (req, res) => {
  const schedule = await schedulingService.updateSchedule(req.params.id, req.body, req.auth.id);
  res.json({ success: true, data: schedule });
}));

router.delete('/:id', requireAuth(['hr', 'superadmin', 'head_dept']), catchAsync(async (req, res) => {
  const result = await schedulingService.deleteSchedule(req.params.id, req.auth.id);
  res.json(result);
}));

router.post('/bulk', requireAuth(['hr', 'superadmin', 'head_dept']), catchAsync(async (req, res) => {
  const { schedules } = req.body;
  if (!schedules) throw new AppError('Schedules array required', 400);
  const created = await schedulingService.bulkCreateSchedules(schedules, req.auth.id);
  res.json({ success: true, data: created });
}));

router.post('/copy-week', requireAuth(['hr', 'superadmin', 'head_dept']), catchAsync(async (req, res) => {
  const { sourceScheduleId, weeks = 1 } = req.body;
  if (!sourceScheduleId) throw new AppError('Source schedule ID required', 400);
  const copied = await schedulingService.copyScheduleForWeeks(sourceScheduleId, weeks, req.auth.id);
  res.json({ success: true, data: copied });
}));

// Shift Types
router.get('/shift-types', requireAuth(['hr', 'superadmin']), catchAsync(async (req, res) => {
  const shifts = await schedulingService.listShiftTypes();
  res.json({ success: true, data: shifts });
}));

router.get('/shift-types/all', requireAuth(['hr', 'superadmin']), catchAsync(async (req, res) => {
  const shifts = await schedulingService.listAllShiftTypes(true);
  res.json({ success: true, data: shifts });
}));

router.post('/shift-types', requireAuth(['hr', 'superadmin']), catchAsync(async (req, res) => {
  const shift = await schedulingService.createShiftType(req.body, req.auth.id);
  res.json({ success: true, data: shift });
}));

router.put('/shift-types/:id', requireAuth(['hr', 'superadmin']), catchAsync(async (req, res) => {
  const shift = await schedulingService.updateShiftType(req.params.id, req.body, req.auth.id);
  res.json({ success: true, data: shift });
}));

router.post('/shift-types/:id/toggle', requireAuth(['hr', 'superadmin']), catchAsync(async (req, res) => {
  const shift = await schedulingService.toggleShiftTypeStatus(req.params.id, req.auth.id);
  res.json({ success: true, data: shift });
}));

router.delete('/shift-types/:id', requireAuth(['hr', 'superadmin']), catchAsync(async (req, res) => {
  const result = await schedulingService.deleteShiftType(req.params.id, req.auth.id);
  res.json(result);
}));

/**
 * GET /api/schedules/stats/overview
 * Get system statistics for HR overview
 */
router.get('/stats/overview', requireAuth(['hr', 'superadmin']), catchAsync(async (req, res) => {
  const stats = await schedulingService.getStatsOverview();
  res.json({ success: true, data: stats });
}));

module.exports = router;
