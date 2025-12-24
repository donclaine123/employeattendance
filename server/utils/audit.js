/**
 * Audit Logging
 * Centralized audit trail functionality
 */

const { AUDIT_ACTIONS } = require('./constants');

/**
 * Log audit event
 */
async function logAuditEvent(userId, actionType, details = {}) {
  try {
    const { logAuditEvent: supabaseLogAuditEvent } = require('../supabaseClient');
    
    const auditData = {
      user_id: userId,
      action_type: actionType,
      details: JSON.stringify(details),
      created_at: new Date().toISOString(),
    };

    await supabaseLogAuditEvent(userId, actionType, details);
    
    console.log(`[audit] ${actionType} by user ${userId}`, details);
  } catch (error) {
    console.error('[audit] Failed to log audit event:', error.message);
    // Don't throw - audit logging shouldn't break the main operation
  }
}

/**
 * Log field changes for detailed tracking
 */
async function logFieldChanges(userId, targetUserId, actionType, changes, additionalContext = {}) {
  try {
    const changeDetails = {
      targetUserId,
      changes,
      ...additionalContext,
    };

    // Log each field change separately for detailed tracking
    for (const change of changes) {
      await logAuditEvent(userId, actionType, {
        targetUserId,
        field: change.field,
        fieldLabel: change.fieldLabel,
        oldValue: change.oldValue,
        newValue: change.newValue,
        description: change.description,
        ...additionalContext,
      });
    }
  } catch (error) {
    console.error('[audit] Failed to log field changes:', error.message);
  }
}

/**
 * Generate field changes description
 */
function generateFieldChanges(oldData, newData, fieldMappings) {
  const changes = [];

  for (const [field, config] of Object.entries(fieldMappings)) {
    const oldValue = oldData[field];
    const newValue = newData[field];

    // Skip if values are the same
    if (oldValue === newValue) {
      continue;
    }

    // Skip if new value is undefined (field not being updated)
    if (newValue === undefined) {
      continue;
    }

    const fieldLabel = config.label || field;
    const oldDisplay = config.formatter ? config.formatter(oldValue) : (oldValue || 'Not set');
    const newDisplay = config.formatter ? config.formatter(newValue) : (newValue || 'Not set');

    changes.push({
      field,
      fieldLabel,
      oldValue,
      newValue,
      description: `Changed ${fieldLabel} from "${oldDisplay}" to "${newDisplay}"`,
    });
  }

  return changes;
}

/**
 * Get field mapping for user updates
 */
function getUserUpdateFieldMappings() {
  return {
    first_name: {
      label: 'First Name',
    },
    last_name: {
      label: 'Last Name',
    },
    email: {
      label: 'Email',
    },
    role_id: {
      label: 'Role',
      formatter: (roleId) => {
        const roleMap = { 1: 'Admin', 2: 'HR', 3: 'Department Head', 4: 'Employee' };
        return roleMap[roleId] || roleId;
      },
    },
    status: {
      label: 'Status',
      formatter: (status) => status?.charAt(0).toUpperCase() + status?.slice(1),
    },
    dept_id: {
      label: 'Department',
    },
  };
}

/**
 * Get field mapping for employee updates
 */
function getEmployeeUpdateFieldMappings() {
  return {
    first_name: {
      label: 'First Name',
    },
    last_name: {
      label: 'Last Name',
    },
    email: {
      label: 'Email',
    },
    phone: {
      label: 'Phone',
    },
    position: {
      label: 'Position',
    },
    dept_id: {
      label: 'Department',
    },
    status: {
      label: 'Status',
      formatter: (status) => status?.charAt(0).toUpperCase() + status?.slice(1),
    },
    hire_date: {
      label: 'Hire Date',
    },
  };
}

/**
 * Get field mapping for settings updates
 */
function getSettingsUpdateFieldMappings() {
  return {
    qr_auto_generate_enabled: {
      label: 'QR Auto Generation',
      formatter: (val) => val ? 'Enabled' : 'Disabled',
    },
    qr_auto_interval_seconds: {
      label: 'QR Interval (seconds)',
    },
    qr_session_schedule_start: {
      label: 'QR Session Start Time',
    },
    qr_session_schedule_end: {
      label: 'QR Session End Time',
    },
    qr_active_days: {
      label: 'Active Days',
    },
  };
}

module.exports = {
  logAuditEvent,
  logFieldChanges,
  generateFieldChanges,
  getUserUpdateFieldMappings,
  getEmployeeUpdateFieldMappings,
  getSettingsUpdateFieldMappings,
  AUDIT_ACTIONS,
};
