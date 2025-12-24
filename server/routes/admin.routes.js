/**
 * Admin Routes
 * System administration: users, settings, audit logs, sessions
 */

const express = require('express');
const router = express.Router();

const { requireAuth } = require('../middleware/auth');
const { catchAsync, AppError } = require('../middleware/errorHandler');
const { userService, adminService, hrService } = require('../services');

// User Management
router.get('/users', requireAuth(['superadmin']), catchAsync(async (req, res) => {
  const { q, role, _page = 1, _limit = 20 } = req.query;
  const filters = { role, search: q };
  const result = await userService.listUsers(filters, parseInt(_page), parseInt(_limit));
  res.set('X-Total-Count', result.pagination.total.toString());
  res.json({ success: true, ...result });
}));

router.put('/users/:id', requireAuth(['superadmin']), catchAsync(async (req, res) => {
  const user = await userService.updateUser(req.params.id, req.body, req.auth.id);
  res.json({ success: true, data: user });
}));

router.delete('/users/:id', requireAuth(['superadmin']), catchAsync(async (req, res) => {
  if (req.params.id === req.auth.id) {
    throw new AppError('Cannot delete your own account', 403);
  }
  await userService.deleteUser(req.params.id, req.auth.id);
  res.json({ success: true, message: 'User deleted' });
}));

router.put('/users/:id/reactivate', requireAuth(['superadmin']), catchAsync(async (req, res) => {
  const user = await userService.reactivateUser(req.params.id, req.auth.id);
  res.json({ success: true, data: user });
}));

// System Settings
router.get('/settings', requireAuth(['superadmin']), catchAsync(async (req, res) => {
  const settings = await adminService.getSystemSettings();
  res.json({ success: true, data: settings });
}));

router.put('/settings', requireAuth(['superadmin']), catchAsync(async (req, res) => {
  const result = await adminService.updateSystemSettings(req.body, req.auth.id);
  res.json(result);
}));

// Department Management (Superadmin only)
router.get('/departments', requireAuth(['superadmin']), catchAsync(async (req, res) => {
  const departments = await adminService.listDepartments();
  res.json({ success: true, data: departments });
}));

router.get('/departments/:id', requireAuth(['superadmin']), catchAsync(async (req, res) => {
  const department = await adminService.getDepartment(req.params.id);
  res.json({ success: true, data: department });
}));

router.get('/department-heads', requireAuth(['superadmin']), catchAsync(async (req, res) => {
  const result = await hrService.listEmployees({}, 1, 1000); // Get all employees (1000 limit)
  const employees = result.data || [];
  // Return employees as potential department heads
  const heads = employees.map(emp => ({
    id: emp.employee_id,
    name: emp.full_name || `${emp.first_name} ${emp.last_name}`,
    email: emp.email
  }));
  res.json({ success: true, data: heads });
}));

router.post('/departments', requireAuth(['superadmin']), catchAsync(async (req, res) => {
  const { dept_name, description } = req.body;
  if (!dept_name) throw new AppError('Department name required', 400);
  const department = await adminService.createDepartment({ dept_name, description }, req.auth.id);
  res.status(201).json({ success: true, data: department });
}));

router.put('/departments/:id', requireAuth(['superadmin']), catchAsync(async (req, res) => {
  const { dept_name, description } = req.body;
  const department = await adminService.updateDepartment(req.params.id, { dept_name, description }, req.auth.id);
  res.json({ success: true, data: department });
}));

router.delete('/departments/:id', requireAuth(['superadmin']), catchAsync(async (req, res) => {
  await adminService.deleteDepartment(req.params.id, req.auth.id);
  res.json({ success: true, message: 'Department deleted successfully' });
}));

router.put('/departments/:id/head', requireAuth(['superadmin']), catchAsync(async (req, res) => {
  const { userId } = req.body;
  // userId can be null/undefined to remove the head
  const result = await adminService.assignDepartmentHead(req.params.id, userId, req.auth.id, userService);
  res.json(result);
}));


// Audit Logs
router.get('/audit-logs', requireAuth(['superadmin']), catchAsync(async (req, res) => {
  const { startDate, endDate, userId, actionType, _page = 1, _limit = 50 } = req.query;
  const filters = { startDate, endDate, userId, actionType };
  const result = await adminService.getAuditLogs(filters, parseInt(_page), parseInt(_limit));
  res.json({ success: true, ...result });
}));

// Active Sessions
router.get('/sessions', requireAuth(['superadmin']), catchAsync(async (req, res) => {
  const { _page = 1, _limit = 20 } = req.query;
  const result = await adminService.getActiveSessions(parseInt(_page), parseInt(_limit));
  res.json({ success: true, ...result });
}));

router.post('/sessions/:userId/logout', requireAuth(['superadmin']), catchAsync(async (req, res) => {
  const result = await adminService.forceLogout(req.params.userId, req.auth.id);
  res.json(result);
}));

// Invitations
router.get('/invitations', requireAuth(['superadmin', 'hr']), catchAsync(async (req, res) => {
  const { _page = 1, _limit = 20 } = req.query;
  const result = await adminService.listInvitations(parseInt(_page), parseInt(_limit));
  res.json({ success: true, ...result });
}));

router.post('/invitations', requireAuth(['superadmin', 'hr']), catchAsync(async (req, res) => {
  const { email, role } = req.body;
  if (!email || !role) throw new AppError('Email and role required', 400);
  const invitation = await adminService.createInvitation(email, role, req.auth.id);
  res.json({ success: true, data: invitation });
}));

router.get('/invitations/:id', requireAuth(['superadmin']), catchAsync(async (req, res) => {
  const invitation = await adminService.getInvitation(req.params.id);
  res.json({ success: true, data: invitation });
}));

router.post('/invitations/:id/resend', requireAuth(['superadmin']), catchAsync(async (req, res) => {
  const result = await adminService.resendInvitation(req.params.id, req.auth.id);
  res.json(result);
}));

router.delete('/invitations/:id', requireAuth(['superadmin']), catchAsync(async (req, res) => {
  const result = await adminService.deleteInvitation(req.params.id, req.auth.id);
  res.json(result);
}));

// Employees (Alias for HR/User service)
router.get('/employees', requireAuth(['superadmin', 'hr']), catchAsync(async (req, res) => {
  const { departmentId, search, _page = 1, _limit = 20 } = req.query;
  const filters = { departmentId, search };
  const result = await hrService.listEmployees(filters, parseInt(_page), parseInt(_limit));
  res.json({ success: true, ...result });
}));

module.exports = router;
