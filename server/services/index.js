/**
 * Services Index - Central export point for all business logic services
 */

module.exports = {
  // Authentication & User Management
  authService: require('./authService'),
  userService: require('./userService'),

  // Attendance & QR
  attendanceService: require('./attendanceService'),

  // HR Operations
  hrService: require('./hrService'),

  // Admin Operations
  adminService: require('./adminService'),

  // Scheduling
  schedulingService: require('./schedulingService'),

  // Leave/Absence Requests
  requestService: require('./requestService'),

  // Notifications
  notificationService: require('./notificationService')
};
