/**
 * SUPABASE CLIENT HUB
 * 
 * This is the main export file that aggregates all Supabase-related functions
 * from modular sub-files. The original monolithic supabaseClient.js has been
 * split into focused, maintainable modules organized by functional domain.
 * 
 * Module Organization:
 * - init.js: Client initialization & setup
 * - helpers.js: Core helper functions
 * - rpc.js: RPC (transactional) operations
 * - read.js: Read/fetch operations
 * - admin.js: Admin & system management
 * - hr.js: HR functions
 * - employee.js: Employee management
 * - qr-attendance.js: QR & attendance operations
 * - departments.js: Department management
 * - utilities.js: Validation, audit, settings
 * - invitations.js: Invitation system
 * - sessions.js: Session & request management
 */

// Core initialization
const { supabase, bcrypt, transformRoleName } = require('./init');

// Helpers
const { findUserByEmail } = require('./helpers');

// RPC Functions
const {
    rpcLogin,
    rpcLogout,
    rpcChangeFirstPassword,
    rpcAttendanceCheckin,
    rpcAttendanceCheckout,
    rpcQrGenerateSession,
    rpcQrRevokeSession,
    rpcProfileUpdate
} = require('./rpc');

// Read Functions
const {
    getProfile,
    getAttendanceHistory,
    validateSession,
    getEmployeeByEmail,
    getNotifications,
    markNotificationsRead,
    getRequests,
    createRequest
} = require('./read');

// Admin Functions
const {
    getAdminUsers,
    getSystemSettings,
    getAuditLogs,
    getActiveSessions
} = require('./admin');

// HR Functions
const {
    getCurrentQRSession,
    getHREmployees,
    getHRAttendance,
    getDepartmentHeads
} = require('./hr');

// Employee Functions
const {
    getEmployeeById,
    updateEmployee,
    deactivateEmployee,
    createHREmployee,
    createAdminUser,
    updateAdminUser,
    validateDepartmentHead
} = require('./employee');

// QR & Attendance Functions
const {
    getQRSession,
    getScanCountForSession,
    getTodayAttendance,
    deactivateExpiredQRSessions,
    deactivateAllQRSessions,
    getEmployeeSchedule,
    getSchedulesByDateRange,
    handleQRCheckin,
    handleQRCheckout,
    createQRSession
} = require('./qr-attendance');

// Department Functions
const {
    getDepartments,
    createDepartment,
    updateDepartment,
    deleteDepartment,
    updateDepartmentHead,
    getDepartmentById,
    getBasicDepartments
} = require('./departments');

// Utility Functions
const {
    checkEmployeeExists,
    checkEmployeeEmailExists,
    checkUserEmailExists,
    checkEmployeeEmailExistsForOther,
    getAttendanceByEmployeeAndDate,
    getFilteredAttendance,
    getUserForPasswordReset,
    updateUserPassword,
    updateUserRole,
    getAllRoles,
    deactivateUser,
    reactivateUser,
    logAuditEvent,
    getAllSystemSettings,
    updateSystemSettings
} = require('./utilities');

// Invitation Functions
const {
    createInvitation,
    verifyInvitationToken,
    acceptInvitation,
    getPendingInvitations,
    getInvitationById,
    resendInvitation,
    cancelInvitation
} = require('./invitations');

// Session & Request Functions
const {
    forceLogoutSession,
    getPendingRequests,
    updateRequestStatus,
    approveRequestWithNotification,
    approveRequestWithChecks
} = require('./sessions');

// ============================================================
// MODULE EXPORTS
// ============================================================
// 
// This hub re-exports all functions with the same interface as the
// original monolithic file. All downstream code imports from here
// and will continue to work without any changes.
//
module.exports = {
    // === CORE INITIALIZATION ===
    supabase,
    bcrypt,
    transformRoleName,
    isSupabaseEnabled: () => !!supabase,

    // === CORE HELPERS ===
    findUserByEmail,

    // === RPC FUNCTIONS ===
    rpcLogin,
    rpcLogout,
    rpcChangeFirstPassword,
    rpcAttendanceCheckin,
    rpcAttendanceCheckout,
    rpcQrGenerateSession,
    rpcQrRevokeSession,
    rpcProfileUpdate,

    // === READ HELPERS ===
    getProfile,
    getAttendanceHistory,
    validateSession,
    getEmployeeByEmail,
    getNotifications,
    markNotificationsRead,
    getRequests,
    createRequest,

    // === ADMIN HELPERS ===
    getAdminUsers,
    getSystemSettings,
    getAuditLogs,
    getActiveSessions,

    // === HR HELPERS ===
    getCurrentQRSession,
    getHREmployees,
    getHRAttendance,
    getDepartmentHeads,

    // === EMPLOYEE OPERATIONS ===
    getEmployeeById,
    updateEmployee,
    deactivateEmployee,
    createHREmployee,
    createAdminUser,
    updateAdminUser,
    validateDepartmentHead,

    // === QR & ATTENDANCE OPERATIONS ===
    getQRSession,
    getScanCountForSession,
    getTodayAttendance,
    deactivateExpiredQRSessions,
    deactivateAllQRSessions,
    getEmployeeSchedule,
    getSchedulesByDateRange,
    handleQRCheckin,
    handleQRCheckout,
    createQRSession,

    // === DEPARTMENT OPERATIONS ===
    getDepartments,
    createDepartment,
    updateDepartment,
    deleteDepartment,
    updateDepartmentHead,
    getDepartmentById,
    getBasicDepartments,

    // === UTILITY & VALIDATION FUNCTIONS ===
    checkEmployeeExists,
    checkEmployeeEmailExists,
    checkUserEmailExists,
    checkEmployeeEmailExistsForOther,
    getAttendanceByEmployeeAndDate,
    getFilteredAttendance,
    getUserForPasswordReset,
    updateUserPassword,
    updateUserRole,
    getAllRoles,
    deactivateUser,
    reactivateUser,
    logAuditEvent,
    getAllSystemSettings,
    updateSystemSettings,

    // === INVITATION OPERATIONS ===
    createInvitation,
    verifyInvitationToken,
    acceptInvitation,
    getPendingInvitations,
    getInvitationById,
    resendInvitation,
    cancelInvitation,

    // === SESSION & REQUEST OPERATIONS ===
    forceLogoutSession,
    getPendingRequests,
    updateRequestStatus,
    approveRequestWithNotification,
    approveRequestWithChecks
};
