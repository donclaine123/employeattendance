const { supabase } = require('../conn-supabase');
const { AppError } = require('../middleware/errorHandler');
const { logAuditEvent } = require('../utils/audit');
const { ATTENDANCE_STATUS } = require('../utils/constants');
const { rowToAttendance, calculateHoursWorked, isLateArrival, timeToMinutes } = require('../utils/converters');

/**
 * Mark attendance for an employee
 * @param {string} employeeId - Employee ID
 * @param {string} status - Attendance status (present, absent, late, early_leave)
 * @param {string} method - Mark method (qr, manual, system)
 * @param {Object} metadata - Additional data (location, device_id, etc.)
 * @returns {Promise<Object>} Attendance record
 */
async function markAttendance(employeeId, status, method = 'manual', metadata = {}) {
  if (!Object.values(ATTENDANCE_STATUS).includes(status)) {
    throw new AppError(`Invalid attendance status: ${status}`, 400);
  }

  const today = new Date().toISOString().split('T')[0];

  try {
    // Check if attendance already marked today
    const { data: existingData } = await supabase
      .from('attendance')
      .select('*')
      .eq('employee_id', employeeId)
      .eq('date', today)
      .single();

    if (existingData) {
      throw new AppError('Attendance already marked for today', 400);
    }

    // Get employee details
    const { data: employeeData } = await supabase
      .from('employees')
      .select('*')
      .eq('id', employeeId)
      .single();

    if (!employeeData) {
      throw new AppError('Employee not found', 404);
    }

    // Insert attendance record
    const { data: attendanceRecord, error } = await supabase
      .from('attendance')
      .insert([{
        employee_id: employeeId,
        date: today,
        status,
        time_in: method === 'qr' ? new Date() : null,
        mark_method: method,
        marked_by: 'system',
        metadata: metadata,
        created_at: new Date()
      }])
      .select()
      .single();

    if (error) throw error;

    // Log audit event
    await logAuditEvent(employeeId, 'ATTENDANCE_MARKED', {
      employee_id: employeeId,
      status,
      method,
      date: today
    });

    return rowToAttendance(attendanceRecord);
  } catch (error) {
    if (error.isOperational) throw error;
    throw new AppError('Error marking attendance', 500);
  }
}

/**
 * Record QR check-in
 * @param {string} qrSessionId - QR session ID from QR code
 * @param {Object} location - Check-in location {latitude, longitude}
 * @returns {Promise<Object>} Check-in result
 */
async function checkIn(qrSessionId, location = null) {
  const now = new Date();
  const today = now.toISOString().split('T')[0];

  try {
    // Get QR session details
    const { data: qrSession, error: qrError } = await supabase
      .from('qr_sessions')
      .select('*, employees(*)')
      .eq('id', qrSessionId)
      .single();

    if (qrError || !qrSession) {
      throw new AppError('Invalid QR code', 400);
    }

    if (qrSession.is_paused) {
      throw new AppError('QR session is paused', 400);
    }

    const employeeId = qrSession.employee_id;

    // Check if already checked in today
    const { data: existingAttendance } = await supabase
      .from('attendance')
      .select('*')
      .eq('employee_id', employeeId)
      .eq('date', today)
      .single();

    if (existingAttendance && existingAttendance.time_in) {
      throw new AppError('Already checked in today', 400);
    }

    let attendanceId;

    if (existingAttendance) {
      // Update existing attendance record
      const { data, error } = await supabase
        .from('attendance')
        .update({
          time_in: now,
          status: isLateArrival(now) ? 'late' : 'present',
          mark_method: 'qr',
          location: location
        })
        .eq('id', existingAttendance.id)
        .select()
        .single();

      if (error) throw error;
      attendanceId = data.id;
    } else {
      // Create new attendance record
      const { data, error } = await supabase
        .from('attendance')
        .insert([{
          employee_id: employeeId,
          date: today,
          time_in: now,
          status: isLateArrival(now) ? 'late' : 'present',
          mark_method: 'qr',
          location: location,
          created_at: now
        }])
        .select()
        .single();

      if (error) throw error;
      attendanceId = data.id;
    }

    // Update QR session
    await supabase
      .from('qr_sessions')
      .update({ last_used: now, scans: (qrSession.scans || 0) + 1 })
      .eq('id', qrSessionId);

    // Log audit event
    await logAuditEvent(employeeId, 'CHECK_IN', {
      employee_id: employeeId,
      time: now,
      location
    });

    return {
      success: true,
      attendanceId,
      message: 'Check-in successful',
      status: isLateArrival(now) ? 'late' : 'present'
    };
  } catch (error) {
    if (error.isOperational) throw error;
    throw new AppError('Error during check-in', 500);
  }
}

/**
 * Record QR check-out
 * @param {string} qrSessionId - QR session ID
 * @param {Object} location - Check-out location
 * @returns {Promise<Object>} Check-out result
 */
async function checkOut(qrSessionId, location = null) {
  const now = new Date();
  const today = now.toISOString().split('T')[0];

  try {
    // Get QR session
    const { data: qrSession } = await supabase
      .from('qr_sessions')
      .select('*')
      .eq('id', qrSessionId)
      .single();

    if (!qrSession) {
      throw new AppError('Invalid QR code', 400);
    }

    const employeeId = qrSession.employee_id;

    // Get today's attendance record
    const { data: attendance, error } = await supabase
      .from('attendance')
      .select('*')
      .eq('employee_id', employeeId)
      .eq('date', today)
      .single();

    if (error || !attendance) {
      throw new AppError('No attendance record for today', 404);
    }

    if (!attendance.time_in) {
      throw new AppError('Must check in before checking out', 400);
    }

    if (attendance.time_out) {
      throw new AppError('Already checked out', 400);
    }

    // Update attendance record with checkout
    const { data: updatedAttendance, error: updateError } = await supabase
      .from('attendance')
      .update({
        time_out: now,
        location_out: location,
        hours_worked: calculateHoursWorked(attendance.time_in, now)
      })
      .eq('id', attendance.id)
      .select()
      .single();

    if (updateError) throw updateError;

    // Log audit event
    await logAuditEvent(employeeId, 'CHECK_OUT', {
      employee_id: employeeId,
      time: now,
      hours_worked: updatedAttendance.hours_worked
    });

    return {
      success: true,
      attendanceId: attendance.id,
      message: 'Check-out successful',
      hoursWorked: updatedAttendance.hours_worked
    };
  } catch (error) {
    if (error.isOperational) throw error;
    throw new AppError('Error during check-out', 500);
  }
}

/**
 * Get attendance records with filters
 * @param {Object} filters - Filter criteria
 * @param {number} page - Page number
 * @param {number} limit - Records per page
 * @returns {Promise<Object>} Paginated attendance records
 */
async function getAttendanceRecords(filters = {}, page = 1, limit = 20) {
  try {
    let query = supabase.from('attendance').select('*, employees(*)', { count: 'exact' });

    // Apply filters
    if (filters.employeeId) {
      query = query.eq('employee_id', filters.employeeId);
    }

    if (filters.startDate && filters.endDate) {
      query = query
        .gte('date', filters.startDate)
        .lte('date', filters.endDate);
    }

    if (filters.status) {
      query = query.eq('status', filters.status);
    }

    if (filters.departmentId) {
      query = query.eq('employees.department_id', filters.departmentId);
    }

    // Pagination
    const offset = (page - 1) * limit;
    query = query.range(offset, offset + limit - 1).order('date', { ascending: false });

    const { data, count, error } = await query;

    if (error) throw error;

    return {
      data: data.map(rowToAttendance),
      pagination: {
        page,
        limit,
        total: count,
        pages: Math.ceil(count / limit)
      }
    };
  } catch (error) {
    if (error.isOperational) throw error;
    throw new AppError('Error fetching attendance records', 500);
  }
}

/**
 * Get attendance statistics
 * @param {string} employeeId - Employee ID
 * @param {string} startDate - Start date (YYYY-MM-DD)
 * @param {string} endDate - End date (YYYY-MM-DD)
 * @returns {Promise<Object>} Statistics
 */
async function getAttendanceStats(employeeId, startDate, endDate) {
  try {
    const { data, error } = await supabase
      .from('attendance')
      .select('*')
      .eq('employee_id', employeeId)
      .gte('date', startDate)
      .lte('date', endDate);

    if (error) throw error;

    const stats = {
      totalDays: data.length,
      present: data.filter(a => a.status === 'present').length,
      absent: data.filter(a => a.status === 'absent').length,
      late: data.filter(a => a.status === 'late').length,
      earlyLeave: data.filter(a => a.status === 'early_leave').length,
      totalHours: data
        .filter(a => a.hours_worked)
        .reduce((sum, a) => sum + a.hours_worked, 0),
      attendanceRate: (data.filter(a => a.status !== 'absent').length / data.length) * 100 || 0
    };

    return stats;
  } catch (error) {
    if (error.isOperational) throw error;
    throw new AppError('Error calculating statistics', 500);
  }
}

/**
 * Get employee info by email
 * @param {string} email - Employee email
 * @returns {Promise<Object>} Employee data
 */
async function getEmployeeByEmail(email) {
  try {
    console.log('[getEmployeeByEmail] Looking for email:', email);
    
    // The employees table has an 'email' column directly
    const { data: employeeData, error } = await supabase
      .from('employees')
      .select('*')
      .ilike('email', email)
      .limit(1);

    console.log('[getEmployeeByEmail] Result:', employeeData?.length, 'error:', error?.message);

    if (error) {
      console.error('[getEmployeeByEmail] Query error:', error);
      throw error;
    }

    if (!employeeData || employeeData.length === 0) {
      console.error('[getEmployeeByEmail] Employee not found for email:', email);
      throw new AppError('Employee not found', 404);
    }

    return employeeData[0];
  } catch (error) {
    if (error.isOperational) throw error;
    console.error('[getEmployeeByEmail] Error:', error.message);
    throw new AppError('Error fetching employee', 500);
  }
}

/**
 * Get attendance history for employee
 * @param {string} employeeId - Employee ID
 * @param {number} months - Number of months to retrieve
 * @returns {Promise<Array>} Attendance history
 */
async function getAttendanceHistory(employeeId, months = 3) {
  try {
    const startDate = new Date();
    startDate.setMonth(startDate.getMonth() - months);
    const formattedStartDate = startDate.toISOString().split('T')[0];

    const { data, error } = await supabase
      .from('attendance')
      .select('*')
      .eq('employee_id', employeeId)
      .gte('date', formattedStartDate)
      .order('date', { ascending: false });

    if (error) throw error;

    return data.map(rowToAttendance);
  } catch (error) {
    if (error.isOperational) throw error;
    throw new AppError('Error fetching attendance history', 500);
  }
}

/**
 * Validate QR session is active and valid
 * @param {string} qrSessionId - QR session ID
 * @returns {Promise<boolean>}
 */
async function validateQRSession(qrSessionId) {
  try {
    const { data, error } = await supabase
      .from('qr_sessions')
      .select('*')
      .eq('id', qrSessionId)
      .single();

    if (error || !data) return false;

    // Check if paused
    if (data.is_paused) return false;

    // Check expiration
    if (data.expires_at && new Date(data.expires_at) < new Date()) {
      return false;
    }

    return true;
  } catch (error) {
    return false;
  }
}


/**
 * Get attendance history by date range
 * @param {string} employeeId - Employee ID
 * @param {string} startDate - Start date (YYYY-MM-DD)
 * @param {string} endDate - End date (YYYY-MM-DD)
 * @returns {Promise<Array>} Attendance records
 */
async function getAttendanceHistoryByDateRange(employeeId, startDate, endDate) {
  try {
    const { data, error } = await supabase
      .from('attendance')
      .select('*')
      .eq('employee_id', employeeId)
      .gte('date', startDate)
      .lte('date', endDate)
      .order('date', { ascending: false });

    if (error) throw error;

    return data.map(rowToAttendance);
  } catch (error) {
    if (error.isOperational) throw error;
    throw new AppError('Error fetching attendance history', 500);
  }
}

module.exports = {
  markAttendance,
  checkIn,
  checkOut,
  getAttendanceRecords,
  getAttendanceStats,
  getEmployeeByEmail,
  getAttendanceHistory,
  getAttendanceHistoryByDateRange,
  validateQRSession
};
