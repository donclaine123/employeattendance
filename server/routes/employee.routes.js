/**
 * Employee Routes
 * Employee-specific operations
 */

const express = require('express');
const router = express.Router();

const { requireAuth } = require('../middleware/auth');
const { catchAsync, AppError } = require('../middleware/errorHandler');
const { attendanceService, hrService } = require('../services');

/**
 * GET /api/employee/by-email
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
 * GET /api/employee/:id
 * Get employee details
 */
router.get('/:id', requireAuth(['employee', 'hr', 'superadmin', 'head_dept']), catchAsync(async (req, res) => {
  const employee = await hrService.getEmployee(req.params.id);
  res.json({ success: true, data: employee });
}));

module.exports = router;
