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
      .eq('id', qrSessionId)
      .single();

    if (error || !data) {
      throw new AppError('QR session not found', 404);
    }

    return {
      id: data.id,
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
    let query = supabase.from('employees').select('*, users(*, roles(*)), departments(*)', { count: 'exact' });

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
      // dept_id is the actual column name, don't map it
      employeeUpdate[key] = value;
    }
  }

  console.log('[hrService.updateEmployee] Fields to update:', employeeUpdate);

  if (Object.keys(employeeUpdate).length === 0) {
    throw new AppError('No valid fields to update', 400);
  }

  try {
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

    await logAuditEvent(updatedBy, 'EMPLOYEE_UPDATED', {
      employee_id: employeeId,
      changes: employeeUpdate
    });

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
        hours_worked: a.hours_worked
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
      .eq('action_type', 'ATTENDANCE_OVERRIDDEN');

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
  overrideAttendance,
  getAdjustmentHistory
};
