const { supabase } = require('../conn-supabase');
const { AppError } = require('../middleware/errorHandler');
const { logAuditEvent, logFieldChanges, generateFieldChanges, getEmployeeUpdateFieldMappings } = require('../utils/audit');
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

    // Fetch employee name for logging
    const { data: empData } = await supabase
      .from('employees')
      .select('first_name, last_name, users(username)')
      .eq('employee_id', employeeId)
      .single();
    const empName = empData ? (empData.first_name ? `${empData.first_name} ${empData.last_name}` : empData.users?.username) : `Employee #${employeeId}`;

    await logAuditEvent(createdBy, 'QR_SESSION_CREATED', {
      employee_id: employeeId,
      employee_name: empName,
      qr_session_id: qrSession.session_id
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
      // Return null instead of throwing 404 for no active session
      // This allows the frontend to handle "no session" gracefully without error logs
      return null;
    }

    return data;
  } catch (error) {
    if (error.isOperational) throw error;
    throw new AppError('Error fetching QR session', 500);
  }
}

/**
 * Get current global active QR session
 * Used by HR dashboard to display the currently active auto-generated QR session
 * @returns {Promise<Object|null>} Current QR session with imageDataUrl or null if none exists
 */
async function getCurrentQRSession() {
  try {
    const { data, error } = await supabase
      .from('qr_sessions')
      .select('session_id, expires_at, created_at, session_type, is_active')
      .eq('is_active', true)
      .gt('expires_at', new Date().toISOString())
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    // No rows found is not an error - just return null
    if (error && error.code === 'PGRST116') {
      console.log('[getCurrentQRSession] No active QR sessions found');
      return null;
    }

    // Other database errors should be thrown
    if (error) {
      console.error('[getCurrentQRSession] Database query error:', error.message);
      throw error;
    }

    if (!data) {
      console.log('[getCurrentQRSession] No active QR session data');
      return null;
    }

    // Generate QR code image from session_id using qrcode.js
    let imageDataUrl = null;
    try {
      const QRCode = require('qrcode');
      // Generate QR code as data URL
      imageDataUrl = await QRCode.toDataURL(data.session_id, {
        errorCorrectionLevel: 'H',
        type: 'image/png',
        quality: 0.95,
        margin: 1,
        width: 300
      });
    } catch (qrError) {
      console.warn('[getCurrentQRSession] ⚠ Error generating QR code image:', qrError.message);
      // Continue without image if generation fails - don't throw, it's not critical
      imageDataUrl = null;
    }

    return {
      session_id: data.session_id,
      expires_at: data.expires_at,
      issued_at: data.created_at,
      type: data.session_type,
      is_active: data.is_active,
      imageDataUrl: imageDataUrl
    };
  } catch (error) {
    console.error('[getCurrentQRSession] Error in catch block:', error.message);
    // Return null instead of throwing - no QR session is a valid state
    return null;
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
      .eq('session_id', qrSessionId)
      .single();

    if (error || !data) {
      throw new AppError('QR session not found', 404);
    }

    return {
      id: data.session_id,
      employeeName: data.employees.name,
      isActive: data.is_active,
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
    const offset = (page - 1) * limit;

    // Build base query for qr_sessions
    let query = supabase
      .from('qr_sessions')
      .select(`
        session_id,
        session_type,
        is_active,
        created_at,
        expires_at
      `, { count: 'exact' })
      .order('created_at', { ascending: false });

    // Apply base filters
    if (filters.startDate && filters.endDate) {
      query = query
        .gte('created_at', filters.startDate)
        .lte('created_at', filters.endDate);
    }

    // For has_scans filter: Smart approach - query attendance first to get scanned sessions
    if (filters.hasScans === true) {
      // Get distinct session IDs that have scans (from both checkin and checkout)
      const [checkinResult, checkoutResult] = await Promise.all([
        supabase
          .from('attendance')
          .select('checkin_session_id', { distinct: true }),
        supabase
          .from('attendance')
          .select('checkout_session_id', { distinct: true })
      ]);

      const checkinIds = (checkinResult.data || [])
        .map(r => r.checkin_session_id)
        .filter(Boolean);
      const checkoutIds = (checkoutResult.data || [])
        .map(r => r.checkout_session_id)
        .filter(Boolean);

      // Combine and get unique session IDs
      const scannedIds = [...new Set([...checkinIds, ...checkoutIds])];

      if (scannedIds.length === 0) {
        // No sessions with scans
        return {
          data: [],
          pagination: {
            page,
            limit,
            total: 0,
            pages: 0
          }
        };
      }

      // Query sessions by scanned IDs with pagination
      const { data: sessions, count: totalCount, error } = await query
        .in('session_id', scannedIds)
        .range(offset, offset + limit - 1);

      if (error) {
        console.error('[hrService] getQRHistory query error:', error);
        throw error;
      }

      // Count attendance for only the sessions on this page
      const sessionCountsMap = {};
      if (sessions && sessions.length > 0) {
        const sessionIds = sessions.map(s => s.session_id).filter(Boolean);

        // Initialize counts
        sessionIds.forEach(id => {
          sessionCountsMap[id] = { checkins: 0, checkouts: 0, total: 0 };
        });

        // Fetch check-ins for these sessions
        const { data: checkinRows } = await supabase
          .from('attendance')
          .select('checkin_session_id')
          .in('checkin_session_id', sessionIds);

        if (checkinRows) {
          checkinRows.forEach(r => {
            if (r.checkin_session_id && sessionCountsMap[r.checkin_session_id]) {
              sessionCountsMap[r.checkin_session_id].checkins++;
              sessionCountsMap[r.checkin_session_id].total++;
            }
          });
        }

        // Fetch check-outs for these sessions
        const { data: checkoutRows } = await supabase
          .from('attendance')
          .select('checkout_session_id')
          .in('checkout_session_id', sessionIds);

        if (checkoutRows) {
          let matched = 0;
          checkoutRows.forEach(r => {
            if (r.checkout_session_id && sessionCountsMap[r.checkout_session_id]) {
              sessionCountsMap[r.checkout_session_id].checkouts++;
              sessionCountsMap[r.checkout_session_id].total++;
              matched++;
            }
          });
        }
      }

      // Format response
      const enrichedData = (sessions || []).map(qr => {
        const counts = sessionCountsMap[qr.session_id] || { checkins: 0, checkouts: 0, total: 0 };

        let status = 'expired';
        const now = new Date();
        if (qr.is_active && new Date(qr.expires_at) > now) {
          status = 'active';
        }

        return {
          id: qr.session_id,
          session_id: qr.session_id,
          createdBy: qr.created_by,
          status,
          checkins: counts.checkins,
          checkouts: counts.checkouts,
          scans: counts.total,
          createdAt: qr.created_at,
          expiresAt: qr.expires_at
        };
      });

      return {
        data: enrichedData,
        pagination: {
          page,
          limit,
          total: totalCount || 0,
          pages: Math.ceil((totalCount || 0) / limit)
        }
      };
    } else {
      // Normal pagination path: apply pagination first, THEN count attendance only for those sessions
      const { data: sessions, count: totalCount, error } = await query.range(offset, offset + limit - 1);

      if (error) {
        console.error('[hrService] getQRHistory query error:', error);
        throw error;
      }

      // Count attendance only for the sessions on this page
      const sessionCountsMap = {};
      if (sessions && sessions.length > 0) {
        const sessionIds = sessions.map(s => s.session_id).filter(Boolean);

        // Initialize counts
        sessionIds.forEach(id => {
          sessionCountsMap[id] = { checkins: 0, checkouts: 0, total: 0 };
        });

        // Fetch check-ins for these sessions
        const { data: checkinRows } = await supabase
          .from('attendance')
          .select('checkin_session_id')
          .in('checkin_session_id', sessionIds);

        if (checkinRows) {
          checkinRows.forEach(r => {
            if (r.checkin_session_id && sessionCountsMap[r.checkin_session_id]) {
              sessionCountsMap[r.checkin_session_id].checkins++;
              sessionCountsMap[r.checkin_session_id].total++;
            }
          });
        }

        // Fetch check-outs for these sessions
        const { data: checkoutRows } = await supabase
          .from('attendance')
          .select('checkout_session_id')
          .in('checkout_session_id', sessionIds);

        if (checkoutRows) {
          let matched = 0;
          checkoutRows.forEach(r => {
            if (r.checkout_session_id && sessionCountsMap[r.checkout_session_id]) {
              sessionCountsMap[r.checkout_session_id].checkouts++;
              sessionCountsMap[r.checkout_session_id].total++;
              matched++;
            }
          });
        }
      }

      // Format response
      const enrichedData = (sessions || []).map(qr => {
        const counts = sessionCountsMap[qr.session_id] || { checkins: 0, checkouts: 0, total: 0 };

        let status = 'expired';
        const now = new Date();
        if (qr.paused_at) {
          status = 'paused';
        } else if (qr.is_active && new Date(qr.expires_at) > now) {
          status = 'active';
        }

        return {
          id: qr.session_id,
          session_id: qr.session_id,
          createdBy: qr.created_by,
          status,
          checkins: counts.checkins,
          checkouts: counts.checkouts,
          scans: counts.total,
          createdAt: qr.created_at,
          expiresAt: qr.expires_at
        };
      });

      return {
        data: enrichedData,
        pagination: {
          page,
          limit,
          total: totalCount || 0,
          pages: Math.ceil((totalCount || 0) / limit)
        }
      };
    }
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
    // Fetch employees with departments
    let query = supabase.from('employees').select('*, departments(*)', { count: 'exact' });

    if (filters.departmentId) {
      query = query.eq('dept_id', filters.departmentId);
    }

    if (filters.search) {
      query = query.or(`email.ilike.%${filters.search}%,first_name.ilike.%${filters.search}%,last_name.ilike.%${filters.search}%`);
    }

    const offset = (page - 1) * limit;
    query = query.range(offset, offset + limit - 1).order('created_at', { ascending: false });

    const { data: employees, count, error } = await query;

    if (error) throw error;

    // Fetch all users with roles for joining
    const { data: usersWithRoles, error: usersError } = await supabase
      .from('users')
      .select('user_id, username, role_id, roles(role_name)');

    if (usersError) throw usersError;

    // Fetch user sessions to get last login times
    const { data: userSessions, error: sessionsError } = await supabase
      .from('user_sessions')
      .select('user_id, login_time')
      .order('login_time', { ascending: false });

    if (sessionsError) throw sessionsError;

    // Create a map of last login by user_id
    const lastLoginByUserId = {};
    (userSessions || []).forEach(session => {
      if (session.user_id && !lastLoginByUserId[session.user_id]) {
        lastLoginByUserId[session.user_id] = session.login_time;
      }
    });

    // Create maps of users by employee/user ID and by email/username for quick lookup
    const usersById = {};
    const usersByEmail = {};
    (usersWithRoles || []).forEach(user => {
      if (user.user_id !== null && user.user_id !== undefined) {
        usersById[String(user.user_id)] = user;
      }
      if (user.username) {
        usersByEmail[user.username.toLowerCase()] = user;
      }
    });

    // Join employees with users data by employee ID first, then by email as fallback
    const enrichedEmployees = (employees || []).map(emp => {
      const user = usersById[String(emp.employee_id)] || usersByEmail[emp.email ? emp.email.toLowerCase() : ''];
      const lastLogin = user ? lastLoginByUserId[user.user_id] : null;
      return {
        ...emp,
        users: user ? {
          user_id: user.user_id,
          username: user.username,
          role_id: user.role_id,
          roles: user.roles,
          last_login: lastLogin
        } : null
      };
    });

    // Filter by excludeRoles if provided
    let finalEmployees = enrichedEmployees;
    if (filters.excludeRoles && Array.isArray(filters.excludeRoles) && filters.excludeRoles.length > 0) {
      finalEmployees = enrichedEmployees.filter(emp => {
        const roleName = emp.users?.roles?.role_name;
        // If no role name found, keep the employee (assume safe)
        if (!roleName) return true;
        // Return true if roleName is NOT in excludeRoles
        return !filters.excludeRoles.includes(roleName);
      });
    }

    return {
      data: finalEmployees.map(rowToEmployee),
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
      .select('*, users(*, roles(*)), departments(*)')
      .eq('employee_id', employeeId)
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
  const allowedFields = ['first_name', 'last_name', 'email', 'phone', 'position', 'status', 'department_id', 'dept_id', 'hire_date', 'phone_number', 'address'];
  const employeeUpdate = {};

  console.log('[hrService.updateEmployee] Input updates:', updates);

  for (const [key, value] of Object.entries(updates)) {
    if (allowedFields.includes(key) && value !== undefined && value !== '') {
      // Normalize API aliases to DB columns
      const dbKey = key === 'department_id' ? 'dept_id' : key;
      employeeUpdate[dbKey] = value;
    }
  }

  console.log('[hrService.updateEmployee] Fields to update:', employeeUpdate);

  if (Object.keys(employeeUpdate).length === 0) {
    throw new AppError('No valid fields to update', 400);
  }

  try {
    const { data: currentEmployee, error: currentError } = await supabase
      .from('employees')
      .select('employee_id, first_name, last_name, email, phone, position, status, dept_id, hire_date, address')
      .eq('employee_id', employeeId)
      .single();

    if (currentError || !currentEmployee) {
      throw new AppError('Employee not found', 404);
    }

    const { data: accountUser } = await supabase
      .from('users')
      .select('username')
      .eq('user_id', employeeId)
      .maybeSingle();

    const { data: updatedEmployee, error } = await supabase
      .from('employees')
      .update(employeeUpdate)
      .eq('employee_id', employeeId)
      .select('*, users(*, roles(*)), departments(*)')
      .single();

    if (error) {
      console.error('[hrService.updateEmployee] Supabase error:', error);
      throw error;
    }

    const username = accountUser?.username || updatedEmployee.email || currentEmployee.email || `Employee #${employeeId}`;
    const beforeSnapshot = {
      ...currentEmployee,
      username,
    };
    const afterSnapshot = {
      ...beforeSnapshot,
      ...employeeUpdate,
      first_name: updatedEmployee.first_name,
      last_name: updatedEmployee.last_name,
      email: updatedEmployee.email,
      phone: updatedEmployee.phone,
      position: updatedEmployee.position,
      status: updatedEmployee.status,
      dept_id: updatedEmployee.dept_id,
      hire_date: updatedEmployee.hire_date,
      address: updatedEmployee.address,
      username,
    };

    const fieldMappings = getEmployeeUpdateFieldMappings();
    const changes = generateFieldChanges(beforeSnapshot, afterSnapshot, fieldMappings)
      .map((change) => ({
        ...change,
        description: `Updated the "${change.fieldLabel}" of user "${username}"`,
      }));

    if (changes.length > 0) {
      await logFieldChanges(updatedBy, employeeId, 'EMPLOYEE_UPDATED', changes, {
        employee_id: employeeId,
        username,
      });
    } else {
      await logAuditEvent(updatedBy, 'EMPLOYEE_UPDATED', {
        employee_id: employeeId,
        username,
        description: `Updated employee profile for user "${username}"`,
      });
    }

    return rowToEmployee(updatedEmployee);
  } catch (error) {
    console.error('[hrService.updateEmployee] Error:', error);
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
      .select('*, employees(*, users(*), departments(*))', { count: 'exact' });

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
        attendance_id: a.attendance_id,
        id: a.attendance_id,
        employee_id: a.employee_id,
        employee_name: a.employees?.full_name || `${a.employees?.first_name} ${a.employees?.last_name}`,
        employee_department: a.employees?.departments?.dept_name || a.employees?.department,
        date: a.date,
        status: a.status,
        time_in: a.time_in,
        time_out: a.time_out,
        hours_worked: a.hours_worked,
        metadata: a.metadata || {}
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
 * Verify attendance status (HR verification)
 * @param {number} attendanceId - Attendance record ID
 * @param {string} status - Verified status (present, absent, late)
 * @param {string} verifiedBy - User ID who verified
 * @returns {Promise<Object>} Updated attendance record
 */
async function verifyAttendance(attendanceId, status, verifiedBy) {
  const validStatuses = ['present', 'absent', 'late'];

  if (!validStatuses.includes(status)) {
    throw new AppError(`Invalid status: ${status}`, 400);
  }

  try {
    const { data: updatedAttendance, error } = await supabase
      .from('attendance')
      .update({
        status: status,
        verified_by: verifiedBy,
        verified_at: new Date(),
        is_verified: true
      })
      .eq('id', attendanceId)
      .select('*, employees(first_name, last_name, users(username))')
      .single();

    if (error) throw error;

    const emp = updatedAttendance.employees || {};
    const empName = emp.first_name ? `${emp.first_name} ${emp.last_name}` : (emp.users?.username || `Employee ${updatedAttendance.employee_id}`);

    await logAuditEvent(verifiedBy, 'ATTENDANCE_VERIFIED', {
      attendance_id: attendanceId,
      employee_name: empName,
      verified_status: status
    });

    return updatedAttendance;
  } catch (error) {
    if (error.isOperational) throw error;
    throw new AppError('Error verifying attendance', 500);
  }
}

/**
 * List departments
 * @returns {Promise<Array>} Departments
 */
async function getDepartments() {
  try {
    const { data, error } = await supabase
      .from('departments')
      .select('*')
      .order('dept_name', { ascending: true });

    if (error) throw error;

    return data;
  } catch (error) {
    if (error.isOperational) throw error;
    throw new AppError('Error fetching departments', 500);
  }
}

/**
 * Get adjustment history (audit logs for attendance)
 * @param {Object} filters - Filter criteria
 * @param {number} page - Page number
 * @param {number} limit - Records per page
 */
async function getAdjustmentHistory(filters = {}, page = 1, limit = 20) {
  try {
    let query = supabase
      .from('audit_logs')
      .select('*, users(username)', { count: 'exact' })
      .in('action_type', ['ATTENDANCE_VERIFIED', 'HOURLY_ROUNDS_VERIFIED']);

    if (filters.startDate && filters.endDate) {
      query = query
        .gte('created_at', filters.startDate)
        .lte('created_at', filters.endDate);
    }

    const offset = (page - 1) * limit;
    query = query.range(offset, offset + limit - 1).order('created_at', { ascending: false });

    const { data, count, error } = await query;

    if (error) {
      console.error('[hrService.getAdjustmentHistory] Supabase error:', error);
      throw error;
    }

    return {
      data: (data || []).map(log => ({
        id: log.log_id,
        action: log.action_type,
        details: log.details,
        performedBy: log.users?.username || 'Unknown',
        timestamp: log.created_at
      })),
      pagination: {
        page,
        limit,
        total: count || 0,
        pages: Math.ceil((count || 0) / limit)
      }
    };
  } catch (error) {
    if (error.isOperational) throw error;
    throw new AppError('Error fetching adjustment history', 500);
  }
}




module.exports = {
  createQRSession,
  getQRSession,
  getCurrentQRSession,
  getQRSessionStatus,
  getQRHistory,
  pauseQRSession,
  resumeQRSession,
  listEmployees,
  getEmployee,
  updateEmployee,
  getAttendanceReport,
  verifyAttendance,
  getAdjustmentHistory,
  getDepartments
};
