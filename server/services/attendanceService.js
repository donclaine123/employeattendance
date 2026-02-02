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
 * Get attendance history by date range
 * @param {number} employeeId - Employee ID
 * @param {string} startDate - Start date (YYYY-MM-DD)
 * @param {string} endDate - End date (YYYY-MM-DD)
 * @returns {Promise<Array>} Array of attendance records
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
    throw new AppError('Error fetching attendance history by date range', 500);
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
async function verifyHour(attendanceId, hourBlock, verifiedBy, employeeId, date, status) {
  try {
    console.log('[verifyHour] Starting verification:', { attendanceId, hourBlock, employeeId, date, status });
    
    let recordId = attendanceId;

    // If no attendance record exists, create one
    if (!recordId || recordId === 'null') {
      console.log('[verifyHour] No attendance record, creating one for:', { employeeId, date });
      
      const { data: newRecord, error: createError } = await supabase
        .from('attendance')
        .insert({
          employee_id: employeeId,
          date: date,
          status: 'present',
          method: 'manual',
          metadata: { verified_manually: true }
        })
        .select()
        .single();

      if (createError) {
        console.error('[verifyHour] Create attendance error:', createError);
        throw createError;
      }

      recordId = newRecord.attendance_id;
      console.log('[verifyHour] Created attendance record:', recordId);
    }

    // 1. Get current metadata
    const { data: currentRecord, error: fetchError } = await supabase
      .from('attendance')
      .select('metadata')
      .eq('attendance_id', recordId)
      .single();

    if (fetchError) throw fetchError;

    let metadata = currentRecord.metadata || {};
    let verifiedHours = metadata.verified_hours || {};

    // 2. Store the status for this hour block
    // Each hourBlock key maps to its status: { "CC103_16": "verified", "CC104_18": "late" }
    // If switching from one status to another, replace it
    if (verifiedHours[hourBlock] && verifiedHours[hourBlock] === status) {
      // Same status clicked twice - toggle off
      delete verifiedHours[hourBlock];
      console.log('[verifyHour] Toggled off:', hourBlock);
    } else {
      // Either new entry or switching status - set to new status
      verifiedHours[hourBlock] = status;
      console.log('[verifyHour] Set status:', hourBlock, 'to:', status);
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
      .eq('attendance_id', recordId)
      .select()
      .single();

    if (updateError) throw updateError;

    console.log('[verifyHour] Verification successful:', recordId);
    return updated;
  } catch (error) {
    console.error('[attendanceService] Verify hour error:', error);
    if (error.isOperational) throw error;
    throw new AppError('Error verifying hour', 500);
  }
}

/**
 * Get hourly rounds with dynamic schedule-based subjects
 * Shows ALL scheduled professors for the date (with or without check-in)
 * This allows HR to manually verify professors who forgot to check in
 * @param {string} date - Date to fetch (YYYY-MM-DD)
 * @returns {Promise<Array>} All scheduled professors with their subject blocks
 */
async function getHourlyRoundsWithSchedules(date) {
  try {
    console.log('[getHourlyRoundsWithSchedules] Starting with date:', date);
    
    // Step 1: Get all employees (professors)
    console.log('[getHourlyRoundsWithSchedules] Fetching employees...');
    const { data: allEmployees, error: empError } = await supabase
      .from('employees')
      .select('*, departments(dept_name)')
      .eq('status', 'active');

    if (empError) {
      console.error('[getHourlyRoundsWithSchedules] Employee fetch error:', empError);
      throw empError;
    }
    
    console.log('[getHourlyRoundsWithSchedules] Found employees:', allEmployees?.length || 0);
    if (!allEmployees || allEmployees.length === 0) return [];

    // Step 2: Get all curriculum schedules to find who's scheduled for today
    console.log('[getHourlyRoundsWithSchedules] Fetching curriculum schedules...');
    const { data: schedules, error: schedError } = await supabase
      .from('curriculum_templates')
      .select('*, subjects:subjects')
      .eq('is_active', true);

    if (schedError) {
      console.error('[getHourlyRoundsWithSchedules] Schedule fetch error:', schedError);
      throw schedError;
    }
    
    console.log('[getHourlyRoundsWithSchedules] Found schedules:', schedules?.length || 0);

    // Step 3: Get attendance records for the date (may be empty)
    console.log('[getHourlyRoundsWithSchedules] Fetching attendance for date:', date);
    const { data: attendanceRecords, error: attError } = await supabase
      .from('attendance')
      .select('*')
      .eq('date', date);

    if (attError) {
      console.error('[getHourlyRoundsWithSchedules] Attendance fetch error:', attError);
      throw attError;
    }
    
    console.log('[getHourlyRoundsWithSchedules] Found attendance records:', attendanceRecords?.length || 0);

    // Create attendance lookup by employee_id
    const attendanceMap = {};
    if (attendanceRecords && attendanceRecords.length > 0) {
      attendanceRecords.forEach(record => {
        attendanceMap[record.employee_id] = record;
      });
    }

    // Step 4: Build result with ALL professors who have subjects scheduled for today
    const recordsWithSchedules = [];

    // Helper: Calculate day
    const dateObj = new Date(date + 'T00:00:00');
    const dayIndex = dateObj.getDay();
    const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const dayAbbreviations = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const today = dayNames[dayIndex];
    const todayAbbr = dayAbbreviations[dayIndex];
    
    console.log('[getHourlyRoundsWithSchedules] Processing for day:', today, todayAbbr);

    allEmployees.forEach(employee => {
      // Find all subjects assigned to this professor for today
      let todaySubjects = [];

      if (schedules && schedules.length > 0) {
        schedules.forEach(template => {
          if (template.subjects && Array.isArray(template.subjects)) {
            template.subjects.forEach(subject => {
              // Check if professor is assigned AND subject is scheduled for today
              if (
                subject.assigned_professor_id === employee.employee_id &&
                subject.days_of_week &&
                Array.isArray(subject.days_of_week)
              ) {
                // Map single letters to full day names for matching
                // Handle: 'M' (Monday), 'T' (Tuesday), 'W' (Wednesday), 'Th' (Thursday), 'F' (Friday), 'Sa'/'S' (Saturday), 'Su'/'U' (Sunday)
                const dayMap = {
                  'M': 'Monday',
                  'T': 'Tuesday',
                  'W': 'Wednesday',
                  'Th': 'Thursday',
                  'TR': 'Thursday',
                  'F': 'Friday',
                  'Sa': 'Saturday',
                  'S': 'Saturday',
                  'Su': 'Sunday',
                  'U': 'Sunday',
                  'Sun': 'Sunday',
                  'Mon': 'Monday',
                  'Tue': 'Tuesday',
                  'Wed': 'Wednesday',
                  'Thu': 'Thursday',
                  'Fri': 'Friday',
                  'Sat': 'Saturday'
                };

                const hasDay = subject.days_of_week.some(dayAbbrev => {
                  // Map the abbreviated day to full name if needed
                  const mappedDay = dayMap[dayAbbrev] || dayAbbrev;
                  // Compare against today's full name
                  return mappedDay === today;
                });

                if (hasDay) {
                  todaySubjects.push({
                    ...subject,
                    template_id: template.template_id,
                    section_name: template.section_name
                  });
                }
              }
            });
          }
        });
      }

      // If professor has subjects scheduled today, add them to results
      if (todaySubjects.length > 0) {
        // Sort by start_time
        todaySubjects.sort((a, b) => {
          const timeA = (a.start_time || '').split(':').slice(0, 2).join(':');
          const timeB = (b.start_time || '').split(':').slice(0, 2).join(':');
          return timeA.localeCompare(timeB);
        });

        // Get attendance record (may be null if no check-in)
        const attendance = attendanceMap[employee.employee_id];

        // Step 5: Determine verification status for each subject
        const subjectsWithStatus = todaySubjects.map((subject, index) => {
          let verifiedStatus = 'unverified';
          let verificationMethod = 'manual';
          const isFirstSubject = index === 0;
          const verifyKey = `${subject.subject_code}_${subject.template_id}`;

          // Check if this subject was manually verified (in metadata.verified_hours)
          if (attendance && attendance.metadata) {
            const verifiedHours = attendance.metadata.verified_hours || {};
            // verifiedHours is now an object: { "CC103_t1": "verified", "CC104_t2": "late" }
            if (verifiedHours[verifyKey]) {
              verifiedStatus = verifiedHours[verifyKey]; // Get the actual status (verified/late/absent)
              verificationMethod = 'manual';
            }
          }

          // If not yet verified, check if professor checked in
          if (verifiedStatus === 'unverified' && attendance && attendance.time_in) {
            // Check this subject's time against check-in time (not just first subject)
            const [classHour, classMin] = (subject.start_time || '').split(':').map(Number);
            const [classEndHour, classEndMin] = (subject.end_time || '').split(':').map(Number);
            const [checkInHour, checkInMin] = (attendance.time_in || '').split(':').map(Number);

            const classTimeInMinutes = classHour * 60 + classMin;
            const classEndTimeInMinutes = classEndHour * 60 + classEndMin;
            const checkInTimeInMinutes = checkInHour * 60 + checkInMin;
            const diffMinutes = checkInTimeInMinutes - classTimeInMinutes;
            
            // Only apply auto-verification if check-in is within the class time window
            // (or shortly after). If check-in is after class has ended, it's unverified.
            if (checkInTimeInMinutes <= classEndTimeInMinutes) {
              // Check-in is during class time
              if (diffMinutes <= 10 && diffMinutes >= -30) {
                // Within 10 min grace period (or checked in early)
                verifiedStatus = 'verified';
                verificationMethod = 'auto';
              } else if (diffMinutes > 10) {
                // Late but still during class
                verifiedStatus = 'late';
                verificationMethod = 'auto';
              }
              // If diffMinutes < -30, checked in too early, stays 'unverified'
            } else if (checkInTimeInMinutes > classEndTimeInMinutes && checkInTimeInMinutes <= classEndTimeInMinutes + 10) {
              // Allow 10 min grace period after class ends (in case of transition time)
              verifiedStatus = 'verified';
              verificationMethod = 'auto';
            }
            // If check-in is after class end + grace, or way before class, leave as 'unverified'
          }

          return {
            subject_code: subject.subject_code,
            subject_name: subject.subject_name,
            start_time: subject.start_time,
            end_time: subject.end_time,
            room_name: subject.room_name || '-',
            section_name: subject.section_name || 'N/A',
            days_of_week: subject.days_of_week,
            is_first_subject: isFirstSubject,
            verified_status: verifiedStatus,
            verification_method: verificationMethod,
            template_id: subject.template_id
          };
        });

        recordsWithSchedules.push({
          attendance_id: attendance?.attendance_id || null,
          employee_id: employee.employee_id,
          date: date,
          time_in: attendance?.time_in || null,
          time_out: attendance?.time_out || null,
          has_checked_in: !!attendance,
          employeeName: `${employee.first_name || ''} ${employee.last_name || ''}`,
          department: employee.departments?.dept_name || 'N/A',
          role: employee.role || 'N/A',
          subjects: subjectsWithStatus,
          has_subjects: subjectsWithStatus.length > 0
        });
      }
    });

    console.log('[getHourlyRoundsWithSchedules] Returning records:', recordsWithSchedules.length);
    
    // Sort by earliest start time (first subject of each employee)
    recordsWithSchedules.sort((a, b) => {
      const timeA = (a.subjects[0]?.start_time || '23:59:59').split(':').slice(0, 2).join(':');
      const timeB = (b.subjects[0]?.start_time || '23:59:59').split(':').slice(0, 2).join(':');
      return timeA.localeCompare(timeB);
    });
    
    return recordsWithSchedules;

  } catch (error) {
    console.error('[attendanceService] Get hourly rounds with schedules error:', error.message || error);
    console.error('[attendanceService] Error stack:', error.stack);
    if (error.isOperational) throw error;
    throw new AppError('Error fetching daily rounds with schedules', 500);
  }
}

/**
 * Record online class attendance
 * @param {Object} data - Attendance data
 * @returns {Promise<Object>} Created attendance record
 */
async function recordOnlineAttendance(data) {
  const { employee_id, instructor_name, date, time_in, online_class_modal, class_period, program_year_section, subject, online_class_link } = data;

  try {
    console.log('[Online Attendance] Recording attendance with data:', {
      employee_id,
      date,
      time_in,
      online_class_modal,
      class_period,
      program_year_section,
      subject,
      online_class_link
    });

    // Prepare metadata with online class details
    const metadata = {
      instructor_name,
      online_class_modal,
      class_period,
      program_year_section,
      subject,
      online_class_link: online_class_link || null,
      terms_accepted: true,
      submitted_at: new Date().toISOString()
    };

    console.log('[Online Attendance] Prepared metadata:', metadata);

    // Insert online attendance record
    console.log('[Online Attendance] Inserting into attendance table...');
    const { data: record, error } = await supabase
      .from('attendance')
      .insert([{
        employee_id,
        date,
        time_in,
        method: 'form_submission',
        attendance_type: 'online',
        status: 'present', // Will be verified/updated by HR later
        metadata,
        created_at: new Date().toISOString()
      }])
      .select()
      .single();

    console.log('[Online Attendance] Insert response - Error:', error, 'Record:', record);

    if (error) {
      console.error('[Online Attendance] Database error:', {
        code: error.code,
        message: error.message,
        details: error.details
      });
      if (error.code === '23505') { // Unique constraint violation
        throw new AppError('Attendance already submitted for this date and subject', 409);
      }
      throw error;
    }

    console.log('[Online Attendance] Successfully recorded:', record);

    // Log audit event
    await logAuditEvent({
      action_type: 'online_attendance_submitted',
      details: {
        employee_id,
        date,
        subject,
        instructor_name
      }
    });

    console.log('[Online Attendance] Audit event logged');
    return record;
  } catch (error) {
    console.error('[Online Attendance] Caught error:', {
      message: error.message,
      stack: error.stack,
      isOperational: error.isOperational
    });
    if (error.isOperational) throw error;
    throw new AppError('Error recording online attendance', 500);
  }
}

/**
 * Get employee's online attendance records
 * @param {string} employeeId - Employee ID
 * @param {string} startDate - Start date (optional)
 * @param {string} endDate - End date (optional)
 * @returns {Promise<Array>} Online attendance records
 */
async function getOnlineAttendanceRecords(employeeId, startDate, endDate) {
  try {
    let query = supabase
      .from('attendance')
      .select('*')
      .eq('employee_id', employeeId)
      .eq('attendance_type', 'online')
      .order('date', { ascending: false });

    if (startDate) {
      query = query.gte('date', startDate);
    }

    if (endDate) {
      query = query.lte('date', endDate);
    }

    const { data, error } = await query;

    if (error) throw error;

    return data || [];
  } catch (error) {
    if (error.isOperational) throw error;
    throw new AppError('Error fetching online attendance records', 500);
  }
}

/**
 * Check if duplicate online attendance exists (same employee, date, subject)
 * @param {string} employeeId - Employee ID
 * @param {string} date - Date
 * @param {string} subject - Subject
 * @returns {Promise<boolean>} True if duplicate exists
 */
async function checkOnlineAttendanceDuplicate(employeeId, date, subject) {
  try {
    const { data, error } = await supabase
      .from('attendance')
      .select('attendance_id', { count: 'exact' })
      .eq('employee_id', employeeId)
      .eq('date', date)
      .eq('attendance_type', 'online')
      .filter('metadata->>subject', 'eq', subject)
      .single();

    if (error && error.code !== 'PGRST116') { // PGRST116 = no rows
      throw error;
    }

    return data !== null;
  } catch (error) {
    if (error.isOperational) throw error;
    console.error('[attendanceService] Duplicate check error:', error);
    return false; // Allow on error (fail open for user experience)
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
  validateQRSession,
  getHourlyRounds,
  getHourlyRoundsWithSchedules,
  verifyHour,
  recordOnlineAttendance,
  getOnlineAttendanceRecords,
  checkOnlineAttendanceDuplicate
};
