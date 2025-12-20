const { supabase } = require('../conn-supabase');
const { AppError } = require('../middleware/errorHandler');
const { logAuditEvent } = require('../utils/audit');
const { rowToEmployee } = require('../utils/converters');

/**
 * Create QR session for employee
 * @param {string} employeeId - Employee ID
 * @param {string} createdBy - User ID who created
 * @param {Object} config - QR configuration
 * @returns {Promise<Object>} QR session
 */
async function createQRSession(employeeId, createdBy, config = {}) {
  const expiresAt = config.expiresAt || new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // 30 days

  try {
    const { data: qrSession, error } = await supabase
      .from('qr_sessions')
      .insert([{
        employee_id: employeeId,
        is_active: true,
        is_paused: false,
        created_by: createdBy,
        expires_at: expiresAt,
        created_at: new Date()
      }])
      .select()
      .single();

    if (error) throw error;

    await logAuditEvent(createdBy, 'QR_SESSION_CREATED', {
      employee_id: employeeId,
      qr_session_id: qrSession.id
    });

    return qrSession;
  } catch (error) {
    if (error.isOperational) throw error;
    throw new AppError('Error creating QR session', 500);
  }
}

/**
 * Get current QR session for employee
 * @param {string} employeeId - Employee ID
 * @returns {Promise<Object>} QR session
 */
async function getQRSession(employeeId) {
  try {
    const { data, error } = await supabase
      .from('qr_sessions')
      .select('*')
      .eq('employee_id', employeeId)
      .eq('is_active', true)
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    if (error || !data) {
      throw new AppError('No active QR session found', 404);
    }

    return data;
  } catch (error) {
    if (error.isOperational) throw error;
    throw new AppError('Error fetching QR session', 500);
  }
}

/**
 * Get QR session status
 * @param {string} qrSessionId - QR session ID
 * @returns {Promise<Object>} Session status
 */
async function getQRSessionStatus(qrSessionId) {
  try {
    const { data, error } = await supabase
      .from('qr_sessions')
      .select('*, employees(*)')
      .eq('id', qrSessionId)
      .single();

    if (error || !data) {
      throw new AppError('QR session not found', 404);
    }

    return {
      id: data.id,
      employeeName: data.employees.name,
      isActive: data.is_active,
      isPaused: data.is_paused,
      scans: data.scans || 0,
      lastUsed: data.last_used,
      expiresAt: data.expires_at,
      createdAt: data.created_at
    };
  } catch (error) {
    if (error.isOperational) throw error;
    throw new AppError('Error fetching QR status', 500);
  }
}

/**
 * Get QR history
 * @param {Object} filters - Filter criteria
 * @param {number} page - Page number
 * @param {number} limit - Records per page
 * @returns {Promise<Object>} Paginated QR history
 */
async function getQRHistory(filters = {}, page = 1, limit = 20) {
  try {
    let query = supabase
      .from('qr_sessions')
      .select('*, employees(*)', { count: 'exact' });

    if (filters.employeeId) {
      query = query.eq('employee_id', filters.employeeId);
    }

    if (filters.startDate && filters.endDate) {
      query = query
        .gte('created_at', filters.startDate)
        .lte('created_at', filters.endDate);
    }

    if (filters.isActive !== undefined) {
      query = query.eq('is_active', filters.isActive);
    }

    const offset = (page - 1) * limit;
    query = query
      .range(offset, offset + limit - 1)
      .order('created_at', { ascending: false });

    const { data, count, error } = await query;

    if (error) throw error;

    return {
      data: data.map(qr => ({
        id: qr.id,
        employeeName: qr.employees.name,
        employeeId: qr.employee_id,
        isActive: qr.is_active,
        isPaused: qr.is_paused,
        scans: qr.scans || 0,
        createdAt: qr.created_at,
        expiresAt: qr.expires_at
      })),
      pagination: {
        page,
        limit,
        total: count,
        pages: Math.ceil(count / limit)
      }
    };
  } catch (error) {
    if (error.isOperational) throw error;
    throw new AppError('Error fetching QR history', 500);
  }
}

/**
 * Pause QR session
 * @param {string} qrSessionId - QR session ID
 * @param {string} pausedBy - User ID
 */
async function pauseQRSession(qrSessionId, pausedBy) {
  try {
    const { error } = await supabase
      .from('qr_sessions')
      .update({ is_paused: true })
      .eq('id', qrSessionId);

    if (error) throw error;

    await logAuditEvent(pausedBy, 'QR_SESSION_PAUSED', {
      qr_session_id: qrSessionId
    });

    return { success: true, message: 'QR session paused' };
  } catch (error) {
    if (error.isOperational) throw error;
    throw new AppError('Error pausing QR session', 500);
  }
}

/**
 * Resume QR session
 * @param {string} qrSessionId - QR session ID
 * @param {string} resumedBy - User ID
 */
async function resumeQRSession(qrSessionId, resumedBy) {
  try {
    const { error } = await supabase
      .from('qr_sessions')
      .update({ is_paused: false })
      .eq('id', qrSessionId);

    if (error) throw error;

    await logAuditEvent(resumedBy, 'QR_SESSION_RESUMED', {
      qr_session_id: qrSessionId
    });

    return { success: true, message: 'QR session resumed' };
  } catch (error) {
    if (error.isOperational) throw error;
    throw new AppError('Error resuming QR session', 500);
  }
}

/**
 * List employees with filters
 * @param {Object} filters - Filter criteria {departmentId, role, status, search}
 * @param {number} page - Page number
 * @param {number} limit - Records per page
 * @returns {Promise<Object>} Paginated employees
 */
async function listEmployees(filters = {}, page = 1, limit = 20) {
  try {
    let query = supabase.from('employees').select('*, users(*)', { count: 'exact' });

    if (filters.departmentId) {
      query = query.eq('department_id', filters.departmentId);
    }

    if (filters.search) {
      query = query.or(`users.email.ilike.%${filters.search}%,users.name.ilike.%${filters.search}%`);
    }

    const offset = (page - 1) * limit;
    query = query.range(offset, offset + limit - 1).order('created_at', { ascending: false });

    const { data, count, error } = await query;

    if (error) throw error;

    return {
      data: data.map(rowToEmployee),
      pagination: {
        page,
        limit,
        total: count,
        pages: Math.ceil(count / limit)
      }
    };
  } catch (error) {
    if (error.isOperational) throw error;
    throw new AppError('Error fetching employees', 500);
  }
}

/**
 * Get employee details
 * @param {string} employeeId - Employee ID
 * @returns {Promise<Object>} Employee details
 */
async function getEmployee(employeeId) {
  try {
    const { data, error } = await supabase
      .from('employees')
      .select('*, users(*)')
      .eq('id', employeeId)
      .single();

    if (error || !data) {
      throw new AppError('Employee not found', 404);
    }

    return rowToEmployee(data);
  } catch (error) {
    if (error.isOperational) throw error;
    throw new AppError('Error fetching employee', 500);
  }
}

/**
 * Update employee details
 * @param {string} employeeId - Employee ID
 * @param {Object} updates - Fields to update
 * @param {string} updatedBy - User ID who updated
 */
async function updateEmployee(employeeId, updates, updatedBy) {
  const allowedFields = ['position', 'department_id', 'hire_date', 'phone_number', 'address'];
  const employeeUpdate = {};

  for (const [key, value] of Object.entries(updates)) {
    if (allowedFields.includes(key) && value !== undefined) {
      employeeUpdate[key] = value;
    }
  }

  if (Object.keys(employeeUpdate).length === 0) {
    throw new AppError('No valid fields to update', 400);
  }

  employeeUpdate.updated_at = new Date();

  try {
    const { data: updatedEmployee, error } = await supabase
      .from('employees')
      .update(employeeUpdate)
      .eq('id', employeeId)
      .select('*')
      .single();

    if (error) throw error;

    await logAuditEvent(updatedBy, 'EMPLOYEE_UPDATED', {
      employee_id: employeeId,
      changes: employeeUpdate
    });

    return rowToEmployee(updatedEmployee);
  } catch (error) {
    if (error.isOperational) throw error;
    throw new AppError('Error updating employee', 500);
  }
}

/**
 * Get attendance report
 * @param {Object} filters - Filter criteria
 * @param {number} page - Page number
 * @param {number} limit - Records per page
 * @returns {Promise<Object>} Attendance report
 */
async function getAttendanceReport(filters = {}, page = 1, limit = 20) {
  try {
    let query = supabase
      .from('attendance')
      .select('*, employees(*, users(*))', { count: 'exact' });

    if (filters.departmentId) {
      query = query.eq('employees.department_id', filters.departmentId);
    }

    if (filters.startDate && filters.endDate) {
      query = query
        .gte('date', filters.startDate)
        .lte('date', filters.endDate);
    }

    if (filters.status) {
      query = query.eq('status', filters.status);
    }

    const offset = (page - 1) * limit;
    query = query.range(offset, offset + limit - 1).order('date', { ascending: false });

    const { data, count, error } = await query;

    if (error) throw error;

    return {
      data: data.map(a => ({
        id: a.id,
        employeeName: a.employees.users.name,
        date: a.date,
        status: a.status,
        timeIn: a.time_in,
        timeOut: a.time_out,
        hoursWorked: a.hours_worked
      })),
      pagination: {
        page,
        limit,
        total: count,
        pages: Math.ceil(count / limit)
      }
    };
  } catch (error) {
    if (error.isOperational) throw error;
    throw new AppError('Error fetching attendance report', 500);
  }
}

/**
 * Override attendance record
 * @param {string} attendanceId - Attendance ID
 * @param {string} newStatus - New status
 * @param {string} reason - Override reason
 * @param {string} overriddenBy - User ID
 */
async function overrideAttendance(attendanceId, newStatus, reason, overriddenBy) {
  const validStatuses = ['present', 'absent', 'late', 'early_leave'];

  if (!validStatuses.includes(newStatus)) {
    throw new AppError(`Invalid status: ${newStatus}`, 400);
  }

  try {
    const { data: updatedAttendance, error } = await supabase
      .from('attendance')
      .update({
        status: newStatus,
        override_reason: reason,
        overridden_by: overriddenBy,
        overridden_at: new Date()
      })
      .eq('id', attendanceId)
      .select()
      .single();

    if (error) throw error;

    await logAuditEvent(overriddenBy, 'ATTENDANCE_OVERRIDDEN', {
      attendance_id: attendanceId,
      new_status: newStatus,
      reason
    });

    return { success: true, message: 'Attendance overridden' };
  } catch (error) {
    if (error.isOperational) throw error;
    throw new AppError('Error overriding attendance', 500);
  }
}

/**
 * List departments
 * @returns {Promise<Array>} Departments
 */
async function listDepartments() {
  try {
    const { data, error } = await supabase
      .from('departments')
      .select('*')
      .order('name', { ascending: true });

    if (error) throw error;

    return data;
  } catch (error) {
    if (error.isOperational) throw error;
    throw new AppError('Error fetching departments', 500);
  }
}

/**
 * Get department details
 * @param {string} departmentId - Department ID
 * @returns {Promise<Object>} Department
 */
async function getDepartment(departmentId) {
  try {
    const { data, error } = await supabase
      .from('departments')
      .select('*')
      .eq('id', departmentId)
      .single();

    if (error || !data) {
      throw new AppError('Department not found', 404);
    }

    return data;
  } catch (error) {
    if (error.isOperational) throw error;
    throw new AppError('Error fetching department', 500);
  }
}

/**
 * Assign department head
 * @param {string} departmentId - Department ID
 * @param {string} userId - User ID to assign
 * @param {string} assignedBy - User ID who assigned
 */
async function assignDepartmentHead(departmentId, userId, assignedBy) {
  try {
    const { error } = await supabase
      .from('departments')
      .update({
        department_head_id: userId,
        updated_at: new Date()
      })
      .eq('id', departmentId);

    if (error) throw error;

    await logAuditEvent(assignedBy, 'DEPARTMENT_HEAD_ASSIGNED', {
      department_id: departmentId,
      user_id: userId
    });

    return { success: true, message: 'Department head assigned' };
  } catch (error) {
    if (error.isOperational) throw error;
    throw new AppError('Error assigning department head', 500);
  }
}

module.exports = {
  createQRSession,
  getQRSession,
  getQRSessionStatus,
  getQRHistory,
  pauseQRSession,
  resumeQRSession,
  listEmployees,
  getEmployee,
  updateEmployee,
  getAttendanceReport,
  overrideAttendance,
  listDepartments,
  getDepartment,
  assignDepartmentHead
};
