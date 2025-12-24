/**
 * Department Head Routes
 * Department-specific operations and reporting
 */

const express = require('express');
const router = express.Router();

const { requireAuth } = require('../middleware/auth');
const { catchAsync, AppError } = require('../middleware/errorHandler');
const { hrService, requestService } = require('../services');

/**
 * GET /api/departmenthead/dashboard
 * Get team attendance statistics
 */
router.get('/dashboard', requireAuth(['head_dept', 'superadmin']), catchAsync(async (req, res) => {
  const { departmentId, date = new Date().toISOString().split('T')[0] } = req.query;
  
  // Get department employees
  const { data: employees } = await hrService.listEmployees({ departmentId }, 1, 1000);
  
  res.json({
    success: true,
    data: {
      teamSize: employees.length,
      message: 'Dashboard retrieved',
    },
  });
}));

/**
 * GET /api/departmenthead/employees
 * Get all employees in department
 */
router.get('/employees', requireAuth(['head_dept', 'superadmin']), catchAsync(async (req, res) => {
  const { departmentId, _page = 1, _limit = 20 } = req.query;
  const result = await hrService.listEmployees({ departmentId }, parseInt(_page), parseInt(_limit));
  res.json({ success: true, ...result });
}));

/**
 * GET /api/departmenthead/recent-activity
 * Get recent requests in department
 */
router.get('/recent-activity', requireAuth(['head_dept', 'superadmin']), catchAsync(async (req, res) => {
  const { departmentId, _page = 1, _limit = 20 } = req.query;
  const result = await requestService.getRequests({ departmentId, status: 'pending' }, parseInt(_page), parseInt(_limit));
  res.json({ success: true, ...result });
}));

module.exports = router;
