/**
 * Admin Routes
 * System administration: users, settings, audit logs, sessions
 */

const express = require('express');
const path = require('path');
const fs = require('fs');
const router = express.Router();

const { requireAuth } = require('../middleware/auth');
const { catchAsync, AppError } = require('../middleware/errorHandler');
const { userService, adminService, hrService, backupService } = require('../services');
const { calculateNextBackupRun, refreshBackupScheduler, executeBackupJob } = require('../services/backupScheduler');
const syncService = require('../utils/syncService');
const { supabase } = require('../conn-supabase');
const { logAuditEvent, AUDIT_ACTIONS } = require('../utils/audit');
const healthService = require('../services/healthService');

function parseBooleanSetting(value) {
  return value === true || value === 'true' || value === 1 || value === '1';
}
// User Management
router.get('/users', requireAuth(['superadmin']), catchAsync(async (req, res) => {
  const { q, role, _page = 1, _limit = 20 } = req.query;
  const filters = { role, search: q };
  const result = await userService.listUsers(filters, parseInt(_page), parseInt(_limit));
  res.set('X-Total-Count', result.pagination.total.toString());
  res.json({ success: true, ...result });
}));

router.get('/users/:id', requireAuth(['superadmin']), catchAsync(async (req, res) => {
  const user = await userService.getUserById(req.params.id);
  if (!user) {
    throw new AppError('User not found', 404);
  }
  res.json({ success: true, data: user });
}));

router.put('/users/:id', requireAuth(['superadmin']), catchAsync(async (req, res) => {
  const user = await userService.updateUser(req.params.id, req.body, req.auth.id);
  res.json({ success: true, data: user });
}));

router.put('/users/:id/role', requireAuth(['superadmin']), catchAsync(async (req, res) => {
  const { role } = req.body;
  if (!role) {
    throw new AppError('Role is required', 400);
  }
  const user = await userService.changeUserRole(req.params.id, role, req.auth.id);
  res.json({ success: true, data: user });
}));

router.put('/users/:id/department', requireAuth(['superadmin']), catchAsync(async (req, res) => {
  const { dept_id } = req.body;
  if (!dept_id) {
    throw new AppError('Department ID is required', 400);
  }
  const result = await userService.changeUserDepartment(req.params.id, dept_id, req.auth.id);
  res.json(result);
}));

router.put('/users/:id/permissions', requireAuth(['superadmin']), catchAsync(async (req, res) => {
  const { role, dept_id } = req.body;
  if (!role && !dept_id) {
    throw new AppError('At least one of role or dept_id must be provided', 400);
  }
  const user = await userService.updateUserPermissions(req.params.id, { role, dept_id }, req.auth.id);
  res.json({ success: true, data: user });
}));

router.put('/users/:id/reset-password', requireAuth(['superadmin']), catchAsync(async (req, res) => {
  const result = await userService.resetPassword(req.params.id, req.body.password, req.body.adminPassword, req.auth.id);
  res.json(result);
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

  const backupSettingsKeys = [
    'backup_schedule_enabled',
    'backup_schedule_frequency',
    'backup_schedule_time',
    'backup_retention_count',
  ];

  const hasBackupSettingChange = backupSettingsKeys.some((key) => Object.prototype.hasOwnProperty.call(req.body || {}, key));
  if (hasBackupSettingChange) {
    const settings = await adminService.getSystemSettings();
    const nextRunAt = calculateNextBackupRun(settings, new Date());

    await supabase
      .from('system_settings')
      .upsert(
        nextRunAt
          ? [{ setting_key: 'backup_next_run_at', setting_value: nextRunAt.toISOString() }]
          : [{ setting_key: 'backup_next_run_at', setting_value: '' }],
        { onConflict: 'setting_key' }
      );

    await refreshBackupScheduler();
  }

  const syncSettingsKeys = [
    'sync_interval_seconds',
    'sync_conflict_resolution',
    'sync_timeout_seconds',
  ];

  const hasSyncSettingChange = syncSettingsKeys.some((key) => Object.prototype.hasOwnProperty.call(req.body || {}, key));
  if (hasSyncSettingChange && typeof syncService.applyRuntimeSettings === 'function') {
    const settings = await adminService.getSystemSettings();
    syncService.applyRuntimeSettings(settings);
  }

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
  const { startDate, endDate, userId, userIds, actionType, actionTypes, ipAddress, _page = 1, _limit = 50 } = req.query;
  const filters = { startDate, endDate, userId, userIds, actionType, actionTypes, ipAddress };
  const result = await adminService.getAuditLogs(filters, parseInt(_page), parseInt(_limit));
  res.json({ success: true, ...result });
}));

router.get('/audit/suspicious', requireAuth(['superadmin']), catchAsync(async (req, res) => {
  const windowMinutes = Number.parseInt(req.query.windowMinutes, 10) || 15;
  const result = await adminService.getSuspiciousAuditSignals(windowMinutes);

  res.json({
    success: true,
    data: result
  });
}));

// Database Backup
router.get('/backup/download', requireAuth(['superadmin']), catchAsync(async (req, res, next) => {
  const settings = await adminService.getSystemSettings();
  const clientIP = (req.headers['x-forwarded-for']?.split(',')[0].trim()) || req.ip || req.connection?.remoteAddress;

  const result = await executeBackupJob({
    userId: req.auth.id,
    scheduled: false,
    now: new Date(),
    settings,
    clientIP,
  });

  res.set({
    'Cache-Control': 'no-store, no-cache, wmust-revalidate, proxy-revalidate',
    'Pragma': 'no-cache',
    'Expires': '0'
  });

  res.json({
    success: true,
    message: 'Backup created successfully on the server and saved to the backups folder.',
    data: result.backup
  });
}));

router.get('/backups', requireAuth(['superadmin']), catchAsync(async (req, res) => {
  const backups = backupService.listDatabaseBackups();
  const settings = await adminService.getSystemSettings();

  res.json({
    success: true,
    data: {
      backups,
      settings: {
        backup_schedule_enabled: parseBooleanSetting(settings.backup_schedule_enabled),
        backup_schedule_frequency: settings.backup_schedule_frequency || 'daily',
        backup_schedule_time: settings.backup_schedule_time || '02:00',
        backup_retention_count: Number(settings.backup_retention_count || 7),
        backup_last_run_at: settings.backup_last_run_at || null,
        backup_last_run_status: settings.backup_last_run_status || 'idle',
        backup_last_run_file: settings.backup_last_run_file || null,
        backup_last_run_error: settings.backup_last_run_error || null,
        backup_next_run_at: settings.backup_next_run_at || null,
      }
    }
  });
}));

router.get('/backups/:fileName/download', requireAuth(['superadmin']), catchAsync(async (req, res, next) => {
  const fileName = path.basename(req.params.fileName);
  const metadata = backupService.getBackupMetadata(fileName);

  if (!metadata) {
    throw new AppError('Backup file not found', 404);
  }

  res.set({
    'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
    'Pragma': 'no-cache',
    'Expires': '0'
  });

  res.download(metadata.filePath, metadata.fileName, (error) => {
    if (error) {
      console.error('[admin.backups.download] Failed to send backup:', error);
      if (!res.headersSent) {
        next(error);
      }
      return;
    }

    console.log(`[admin.backups.download] Backup sent: ${metadata.fileName}`);
  });
}));

router.delete('/backups/:fileName', requireAuth(['superadmin']), catchAsync(async (req, res) => {
  const fileName = path.basename(req.params.fileName);
  const metadata = backupService.getBackupMetadata(fileName);

  if (!metadata) {
    throw new AppError('Backup file not found', 404);
  }

  const deleted = backupService.deleteBackupFile(fileName);
  if (!deleted) {
    throw new AppError('Failed to delete backup', 500);
  }

  await logAuditEvent(req.auth.id, AUDIT_ACTIONS.BACKUP_DELETED, {
    fileName,
    sizeBytes: metadata.sizeBytes,
    ipAddress: (req.headers['x-forwarded-for']?.split(',')[0].trim()) || req.ip || req.connection?.remoteAddress,
    timestamp: new Date().toISOString()
  });

  res.json({ success: true, message: 'Backup deleted successfully' });
}));

// Invitations
router.get('/invitations', requireAuth(['superadmin', 'hr']), catchAsync(async (req, res) => {
  const { _page = 1, _limit = 20 } = req.query;
  const result = await adminService.listInvitations(parseInt(_page), parseInt(_limit));
  res.json({ success: true, ...result });
}));

router.post('/invitations', requireAuth(['superadmin', 'hr']), catchAsync(async (req, res) => {
  const { email, role_id, dept_id, expires_in_hours } = req.body;

  // Validate email
  if (!email || !email.trim()) {
    throw new AppError('Email is required', 400);
  }

  // Validate role_id (must be integer)
  if (!role_id || typeof role_id !== 'number') {
    throw new AppError('Role is required', 400);
  }

  // Get role name from role_id
  const { data: role, error: roleError } = await supabase
    .from('roles')
    .select('role_name')
    .eq('role_id', role_id)
    .single();

  if (roleError || !role) {
    throw new AppError('Invalid role ID', 400);
  }

  const invitation = await adminService.createInvitation(
    email.trim().toLowerCase(),
    role.role_name,
    req.auth.id,
    dept_id || null,
    expires_in_hours ? expires_in_hours * 60 * 60 * 1000 : 7 * 24 * 60 * 60 * 1000
  );

  res.json({ success: true, data: invitation, email_status: invitation.email_status });
}));

router.get('/invitations/:id', requireAuth(['superadmin']), catchAsync(async (req, res) => {
  const invitation = await adminService.getInvitation(req.params.id);
  res.json({ success: true, data: invitation });
}));

router.post('/invitations/:id/resend', requireAuth(['superadmin', 'hr']), catchAsync(async (req, res) => {
  const result = await adminService.resendInvitation(req.params.id, req.auth.id);
  res.json(result);
}));

router.delete('/invitations/:id', requireAuth(['superadmin', 'hr']), catchAsync(async (req, res) => {
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

// System Health
router.get('/system-health', requireAuth(['superadmin']), catchAsync(async (req, res) => {
  const health = await healthService.getFullHealth();
  res.json({ success: true, health });
}));

module.exports = router;
