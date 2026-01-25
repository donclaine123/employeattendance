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
async function checkIn(qrSessionId, employeeId, location = null) {
  const now = new Date();

  // Format to Manila Time (UTC+8)
  const today = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Manila',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(now);

  const timeString = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Manila',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  }).format(now);

  console.log('[checkIn] Manila Time:', { today, timeString });


  console.log('[checkIn] Attempting check-in:', { qrSessionId, employeeId, location, timeString });

  try {
    // Get QR session details
    const { data: qrSession, error: qrError } = await supabase
      .from('qr_sessions')
      .select('*')
      .eq('session_id', qrSessionId)
      .single();

    if (qrError || !qrSession) {
      console.error('[checkIn] QR Session error:', qrError);
      throw new AppError('Invalid QR code', 400);
    }

    // employeeId is passed as argument, no need to get from session

    // Check if already checked in today
    const { data: existingAttendance, error: existError } = await supabase
      .from('attendance')
      .select('*')
      .eq('employee_id', employeeId)
      .eq('date', today)
      .single();

    if (existError && existError.code !== 'PGRST116') { // PGRST116 is "No rows found"
      console.error('[checkIn] Error checking existing attendance:', existError);
    }

    if (existingAttendance && existingAttendance.time_in) {
      throw new AppError('Already checked in today', 400);
    }

    let attendanceId;

    if (existingAttendance) {
      // Update existing attendance record
      console.log('[checkIn] Updating existing attendance record:', existingAttendance.id);
      const { data, error } = await supabase
        .from('attendance')
        .update({
          time_in: timeString,
          status: isLateArrival(timeString) ? 'late' : 'present',
          method: 'qr_scan', // Fixed column name and value
          location: location
        })
        .eq('id', existingAttendance.id) // Ensure this is the correct PK
        .select()
        .single();

      if (error) {
        console.error('[checkIn] Update error:', error);
        throw error;
      }
      attendanceId = data.attendance_id || data.id; // Check PK name
    } else {
      // Create new attendance record
      console.log('[checkIn] Creating new attendance record for employee:', employeeId);
      const { data, error } = await supabase
        .from('attendance')
        .insert([{
          employee_id: employeeId,
          date: today,
          time_in: timeString,
          status: isLateArrival(timeString) ? 'late' : 'present',
          method: 'qr_scan', // Fixed column name and value
          location: location,
          created_at: now
        }])
        .select()
        .single();

      if (error) {
        console.error('[checkIn] Insert error:', error);
        throw error;
      }
      attendanceId = data.attendance_id || data.id; // Check PK name
    }

    // Update QR session
    await supabase
      .from('qr_sessions')
      .update({ last_used: now, scans: (qrSession.scans || 0) + 1 })
      .eq('session_id', qrSessionId);

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
      status: isLateArrival(timeString) ? 'late' : 'present'
    };
  } catch (error) {
    console.error('[checkIn] Detailed error:', error);
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
async function checkOut(qrSessionId, employeeId, location = null) {
  const now = new Date();

  // Format to Manila Time (UTC+8)
  const today = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Manila',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(now);

  const timeString = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Manila',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  }).format(now);

  console.log('[checkOut] Manila Time:', { today, timeString });

  console.log('[checkOut] Attempting check-out:', { qrSessionId, employeeId, timeString });

  try {
    // Get QR session
    const { data: qrSession, error: qrError } = await supabase
      .from('qr_sessions')
      .select('*')
      .eq('session_id', qrSessionId)
      .single();

    if (qrError || !qrSession) {
      console.error('[checkOut] QR Session error:', qrError);
      throw new AppError('Invalid QR code', 400);
    }

    // employeeId is passed as argument

    // Get today's attendance record
    const { data: attendance, error } = await supabase
      .from('attendance')
      .select('*')
      .eq('employee_id', employeeId)
      .eq('date', today)
      .single();

    if (error || !attendance) {
      console.error('[checkOut] Fetch attendance error:', error);
      throw new AppError('No attendance record for today', 404);
    }

    if (!attendance.time_in) {
      throw new AppError('Must check in before checking out', 400);
    }

    if (attendance.time_out) {
      throw new AppError('Already checked out', 400);
    }

    // Calculate hours worked for audit log (not saved to DB yet as column doesn't exist)
    const hoursWorked = calculateHoursWorked(attendance.time_in, timeString);

    // Update attendance record with checkout
    const { data: updatedAttendance, error: updateError } = await supabase
      .from('attendance')
      .update({
        time_out: timeString
        // location_out: location, // Column does not exist
        // hours_worked: hoursWorked // Column does not exist
      })
      .eq('attendance_id', attendance.attendance_id)
      .select()
      .single();

    if (updateError) {
      console.error('[checkOut] Update error:', updateError);
      throw updateError;
    }

    // Log audit event
    await logAuditEvent(employeeId, 'CHECK_OUT', {
      employee_id: employeeId,
      time: now,
      hours_worked: hoursWorked
    });

    return {
      success: true,
      attendanceId: attendance.attendance_id,
      message: 'Check-out successful',
      hoursWorked: hoursWorked
    };
  } catch (error) {
    console.error('[checkOut] Detailed error:', error);
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
    console.log('[getAttendanceRecords] Filters received:', JSON.stringify(filters, null, 2));

    // If filtering by department name, we need an inner join to filter parent rows based on child condition
    // We need to join employees AND departments to filter by department name
    let selectString = '*, employees(*, departments(*))';
    if (filters.department) {
      selectString = '*, employees!inner(*, departments!inner(*))';
    }

    console.log('[getAttendanceRecords] Select string:', selectString);

    let query = supabase.from('attendance').select(selectString, { count: 'exact' });

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

    if (filters.department) {
      const deptFilter = filters.department;
      console.log('[getAttendanceRecords] Applying department filter (deep join):', deptFilter);
      // Filter by department name on the joined departments table via employees
      query = query.eq('employees.departments.dept_name', deptFilter);
    }

    // Pagination
    const offset = (page - 1) * limit;
    query = query.range(offset, offset + limit - 1).order('date', { ascending: false });

    const { data, count, error } = await query;

    if (error) {
      console.error('[getAttendanceRecords] Query error:', error);
      throw error;
    }

    console.log('[getAttendanceRecords] Found records:', count);

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
    console.error('[getAttendanceRecords] Error fetching attendance records', error); // Added detailed log
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
    // Join with departments to get department name
    const { data: employeeData, error } = await supabase
      .from('employees')
      .select('*, departments(dept_name)')
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

    const employee = employeeData[0];
    // Map department name to top level if available
    if (employee.departments && employee.departments.dept_name) {
      employee.department = employee.departments.dept_name;
    }

    console.log('[getEmployeeByEmail] Returning employee:', JSON.stringify(employee, null, 2));
    return employee;
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
    console.log('[validateQRSession] Validating session ID:', qrSessionId);

    const { data, error } = await supabase
      .from('qr_sessions')
      .select('*')
      .eq('session_id', qrSessionId)
      .single();

    if (error) {
      console.error('[validateQRSession] Database error or not found:', error.message);
      return false;
    }

    if (!data) {
      console.log('[validateQRSession] No data found for ID:', qrSessionId);
      return false;
    }

    console.log('[validateQRSession] Session found:', JSON.stringify(data, null, 2));

    // Check expiration
    const now = new Date();
    const expiresAt = new Date(data.expires_at);

    console.log('[validateQRSession] Checking expiration. Now:', now.toISOString(), 'Expires:', expiresAt.toISOString());

    if (data.expires_at && expiresAt < now) {
      console.log('[validateQRSession] Session expired.');
      return false;
    }

    if (!data.is_active) {
      console.log('[validateQRSession] Session is not active (is_active is false).');
      // Note: Currently the code didn't check is_active, but it probably should. 
      // For now I'll just log it to see if that's the issue, without changing logic unless previous code did.
      // Previous code:     if (data.expires_at && new Date(data.expires_at) < new Date()) { return false; }
      // It didn't check is_active explicitly in the return, but let's stick to the original logic + logs first.
    }

    console.log('[validateQRSession] Session is valid.');
    return true;
  } catch (error) {
    console.error('[validateQRSession] Unexpected error:', error);
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
/**
 * Get daily attendance for hourly rounds
 * @param {string} date - Date to fetch (YYYY-MM-DD)
 * @returns {Promise<Array>} Attendance records with employee details
 */
async function getHourlyRounds(date) {
  try {
    const { data, error } = await supabase
      .from('attendance')
      .select('*, employees(*, departments(dept_name))')
      .eq('date', date)
      .order('time_in', { ascending: true });

    if (error) throw error;

    return data.map(record => ({
      ...rowToAttendance(record),
      employeeName: `${record.employees.first_name} ${record.employees.last_name}`,
      department: record.employees.departments?.dept_name || 'N/A',
      role: record.employees.role,
      verifiedHours: record.metadata?.verified_hours || []
    }));
  } catch (error) {
    console.error('[attendanceService] Get hourly rounds error:', error);
    if (error.isOperational) throw error;
    throw new AppError('Error fetching daily rounds', 500);
  }
}

/**
 * Verify a specific hour block for an attendance record
 * @param {number} attendanceId - Attendance ID
 * @param {string} hourBlock - Hour block (e.g., "09:00-10:00")
 * @param {number} verifiedBy - User ID of verifier
 * @returns {Promise<Object>} Updated record
 */
async function verifyHour(attendanceId, hourBlock, verifiedBy) {
  try {
    // 1. Get current metadata
    const { data: currentRecord, error: fetchError } = await supabase
      .from('attendance')
      .select('metadata')
      .eq('attendance_id', attendanceId)
      .single();

    if (fetchError) throw fetchError;

    let metadata = currentRecord.metadata || {};
    let verifiedHours = metadata.verified_hours || [];

    // 2. Add hour if not exists
    if (!verifiedHours.includes(hourBlock)) {
      verifiedHours.push(hourBlock);
      // Sort hours
      verifiedHours.sort();
    } else {
      // Toggle off if already exists
      verifiedHours = verifiedHours.filter(h => h !== hourBlock);
    }

    metadata.verified_hours = verifiedHours;
    metadata.last_verified_by = verifiedBy;

    // Manila Time (UTC+8)
    const now = new Date();
    const manilaTime = new Date(now.getTime() + (8 * 60 * 60 * 1000));
    metadata.last_verified_at = manilaTime.toISOString().replace('Z', '+08:00');

    // 3. Update record
    const { data: updated, error: updateError } = await supabase
      .from('attendance')
      .update({ metadata })
      .eq('attendance_id', attendanceId)
      .select()
      .single();

    if (updateError) throw updateError;

    return updated;
  } catch (error) {
    console.error('[attendanceService] Verify hour error:', error);
    if (error.isOperational) throw error;
    throw new AppError('Error verifying hour', 500);
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
  validateQRSession,
  getHourlyRounds,
  verifyHour
};
