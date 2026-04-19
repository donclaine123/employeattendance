/**
 * Constants
 * Centralized constants used throughout the application
 */

/**
 * User Roles
 */
const ROLES = {
  SUPERADMIN: 'superadmin',
  HR: 'hr',
  DEPARTMENT_HEAD: 'head_dept',
  EMPLOYEE: 'employee',
  DISPLAY: 'display',
};

/**
 * User Status
 */
const USER_STATUS = {
  ACTIVE: 'active',
  INACTIVE: 'inactive',
  PENDING: 'pending',
  LOCKED: 'locked',
  SUSPENDED: 'suspended',
};

/**
 * Attendance Status
 */
const ATTENDANCE_STATUS = {
  PRESENT: 'present',
  ABSENT: 'absent',
  LATE: 'late',
  EARLY_LEAVE: 'early_leave',
  HALFDAY: 'halfday',
};

/**
 * Request Status
 */
const REQUEST_STATUS = {
  PENDING: 'pending',
  APPROVED: 'approved',
  REJECTED: 'rejected',
  CANCELLED: 'cancelled',
};

/**
 * Request Types
 */
const REQUEST_TYPES = {
  LEAVE: 'leave',
  ABSENCE: 'absence',
  LATE_ARRIVAL: 'late_arrival',
  EARLY_DEPARTURE: 'early_departure',
  SHIFT_SWAP: 'shift_swap',
};

/**
 * Audit Actions
 */
const AUDIT_ACTIONS = {
  USER_CREATED: 'USER_CREATED',
  USER_UPDATED: 'USER_UPDATED',
  PROFILE_UPDATED: 'PROFILE_UPDATED',
  USER_LOGIN: 'USER_LOGIN',
  AUTH_LOGIN_FAILED: 'AUTH_LOGIN_FAILED',
  USER_LOGOUT: 'USER_LOGOUT',
  ATTENDANCE_MARKED: 'ATTENDANCE_MARKED',
  HOURLY_ROUNDS_VERIFIED: 'HOURLY_ROUNDS_VERIFIED',
  ONLINE_ATTENDANCE_SUBMITTED: 'ONLINE_ATTENDANCE_SUBMITTED',
  ONLINE_ATTENDANCE_VERIFIED: 'ONLINE_ATTENDANCE_VERIFIED',
  ONLINE_ATTENDANCE_REJECTED: 'ONLINE_ATTENDANCE_REJECTED',
  REPORT_DOWNLOADED: 'REPORT_DOWNLOADED',
  SCHEDULE_CREATED: 'SCHEDULE_CREATED',
  SCHEDULE_UPDATED: 'SCHEDULE_UPDATED',
  SCHEDULE_DELETED: 'SCHEDULE_DELETED',
  INVITATION_CANCELLED: 'INVITATION_CANCELLED',
  INVITATION_SENT: 'INVITATION_SENT',
  INVITATION_ACCEPTED: 'INVITATION_ACCEPTED',
  SETTINGS_UPDATED: 'SETTINGS_UPDATED',
  FORCE_LOGOUT: 'FORCE_LOGOUT',
  BACKUP_CREATED: 'BACKUP_CREATED',
  BACKUP_DOWNLOADED: 'BACKUP_DOWNLOADED',
  BACKUP_DELETED: 'BACKUP_DELETED',
};

/**
 * Error Messages
 */
const ERROR_MESSAGES = {
  INVALID_CREDENTIALS: 'Invalid email or password',
  USER_NOT_FOUND: 'User not found',
  USER_INACTIVE: 'User account is inactive',
  UNAUTHORIZED: 'Unauthorized access',
  FORBIDDEN: 'Access forbidden',
  INVALID_TOKEN: 'Invalid or expired token',
  MISSING_REQUIRED_FIELDS: 'Missing required fields',
  INVALID_EMAIL: 'Invalid email format',
  INVALID_PHONE: 'Invalid phone number format',
  PASSWORD_TOO_SHORT: 'Password must be at least 6 characters',
  EMPLOYEE_NOT_FOUND: 'Employee not found',
  DEPARTMENT_NOT_FOUND: 'Department not found',
  INVALID_DATE_RANGE: 'Invalid date range',
  SERVER_ERROR: 'An error occurred. Please try again.',
};

/**
 * HTTP Status Codes (for reference)
 */
const HTTP_STATUS = {
  OK: 200,
  CREATED: 201,
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  SERVER_ERROR: 500,
};

/**
 * Days of Week
 */
const DAYS_OF_WEEK = {
  SUNDAY: 0,
  MONDAY: 1,
  TUESDAY: 2,
  WEDNESDAY: 3,
  THURSDAY: 4,
  FRIDAY: 5,
  SATURDAY: 6,
};

/**
 * Pagination Defaults
 */
const PAGINATION = {
  DEFAULT_LIMIT: 10,
  DEFAULT_PAGE: 1,
  MAX_LIMIT: 100,
};

/**
 * QR Session Types
 */
const QR_SESSION_TYPES = {
  ROTATING: 'rotating',
  MANUAL: 'manual',
  STATIC: 'static',
};

module.exports = {
  ROLES,
  USER_STATUS,
  ATTENDANCE_STATUS,
  REQUEST_STATUS,
  REQUEST_TYPES,
  AUDIT_ACTIONS,
  ERROR_MESSAGES,
  HTTP_STATUS,
  DAYS_OF_WEEK,
  PAGINATION,
  QR_SESSION_TYPES,
};
