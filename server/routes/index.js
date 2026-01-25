/**
 * Route Aggregator
 * Combines all API routes with proper backward compatibility
 */

const express = require('express');
const router = express.Router();

// Import route modules
const authRoutes = require('./auth.routes');
const attendanceRoutes = require('./attendance.routes');
const hrRoutes = require('./hr.routes');
const adminRoutes = require('./admin.routes');
const curriculumRoutes = require('./curriculum.routes');
const departmentHeadRoutes = require('./department-head.routes');

const departmentHeadLegacyRoutes = require('./departmenthead.routes');
const employeeRoutes = require('./employee.routes');
const requestRoutes = require('./requests.routes');
const notificationRoutes = require('./notifications.routes');
const syncRoutes = require('./sync.routes');

// ============================================================
// MOUNT ALL ROUTE MODULES WITH PROPER PATH PREFIXES
// This avoids routing conflicts with dynamic parameters
// ============================================================

// AUTH ROUTES - Mount at root to catch /login, /logout, /auth/*, etc.
// Routes defined in auth.routes.js:
//   POST /login, POST /logout, POST /auth/logout, POST /auth/refresh
//   GET /auth/profile, PUT /auth/profile, GET /auth/session-check
//   POST /change-first-login-password, PUT /account/password
//   POST /auth/accept-invite, GET /invitations/verify/:token
router.use(authRoutes);

// ATTENDANCE ROUTES - Mount at /attendance prefix
// Routes: /history, /stats, /checkin, /checkout, /:by-email, /qr/validate
router.use('/attendance', attendanceRoutes);

// EMPLOYEE ROUTES - Mount at /employee prefix
// Routes: GET /by-email, GET /:id
router.use('/employee', employeeRoutes);

// DEPARTMENT HEAD ROUTES - Mount at /departmenthead prefix
// Routes: GET /dashboard, GET /employees, GET /recent-activity
router.use('/departmenthead', departmentHeadLegacyRoutes);

// DEPARTMENT HEAD ROUTES - Mount at /department-head prefix
// Routes: GET /professors
router.use('/department-head', departmentHeadRoutes);

// ADMIN ROUTES - Mount at /admin prefix
// Routes: All /admin/* paths
router.use('/admin', adminRoutes);

// HR ROUTES - Mount at /hr prefix
// Routes: All /hr/* paths
router.use('/hr', hrRoutes);
// Also mount at root to support /employees and /attendance (HR view) legacy paths
router.use(hrRoutes);

// REQUEST ROUTES - Mount at /requests prefix
// Routes: GET /, POST /, GET /:id, PUT /:id, GET /pending, POST /:id/approve, etc.
router.use('/requests', requestRoutes);

// CURRICULUM ROUTES - Mount at /curriculum prefix
router.use('/curriculum', curriculumRoutes);

// NOTIFICATION ROUTES - Mount at /notifications prefix
// Routes: GET /, GET /unread-count, PUT /:id/read, PUT /mark-all-read, DELETE /:id, DELETE /clear-all
router.use('/notifications', notificationRoutes);

// SYNC ROUTES - Mount at /sync prefix
// Routes: GET /, POST /trigger
router.use('/sync', syncRoutes);

module.exports = router;
