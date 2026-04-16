/**
 * Converters
 * Data transformation and conversion utilities
 */

/**
 * Convert database row to session object
 */
function rowToSession(row) {
  if (!row) return null;

  return {
    session_id: row.session_id,
    issued_at: row.created_at ? row.created_at.toISOString() : null,
    expires_at: row.expires_at ? row.expires_at.toISOString() : null,
    is_active: row.is_active,
    session_type: row.session_type,
  };
}

/**
 * Convert database user row to user object (for API response)
 */
function rowToUser(row) {
  if (!row) return null;

  // Get name and email from employee object
  // Handle case where employee comes back as empty array instead of object
  let employee = row.employee;
  if (Array.isArray(employee)) {
    employee = employee.length > 0 ? employee[0] : null;
  }
  
  const firstName = employee?.first_name || null;
  const lastName = employee?.last_name || null;
  const email = employee?.email || null;

  // Get department from employee's department relationship
  const department_name = employee?.departments?.dept_name || null;
  const dept_id = employee?.dept_id || null;

  // Build full name from employee data
  const fullName = [firstName, lastName].filter(Boolean).join(' ') || null;

  return {
    user_id: row.user_id,
    id: row.user_id,
    username: row.username,
    email: email,
    first_name: firstName,
    last_name: lastName,
    full_name: fullName,
    phone: employee?.phone || null,
    address: employee?.address || null,
    role: row.role_id,
    role_id: row.role_id,
    role_name: row.roles?.role_name,
    status: row.status,
    dept_id: dept_id,
    dept_name: department_name,
    department_name: department_name,
    last_login: row.last_login || null,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

/**
 * Convert database employee row to employee object
 */
function rowToEmployee(row) {
  if (!row) return null;

  // Get role from users -> roles relationship
  const roleId = row.users?.role_id;
  const roleName = row.users?.roles?.role_name;

  return {
    employee_id: row.employee_id,
    id: row.employee_id,
    first_name: row.first_name,
    last_name: row.last_name,
    full_name: row.full_name || `${row.first_name} ${row.last_name}`,
    name: row.full_name || `${row.first_name} ${row.last_name}`,
    email: row.email,
    phone: row.phone,
    position: row.position,
    dept_id: row.dept_id,
    department: row.departments?.dept_name || row.department,
    role_id: roleId || null,
    role_name: roleName || null,
    role: roleName || null,
    status: row.status,
    hire_date: row.hire_date,
    created_at: row.created_at,
    updated_at: row.updated_at,
    last_login: row.users?.last_login,
  };
}

/**
 * Convert database attendance row to attendance object
 */
function rowToAttendance(row) {
  if (!row) return null;

  // Check for joined employee/employees object (Supabase might return single object or array depending on join)
  // Usually it's 'employees' (plural) if coming from our service query
  const employee = row.employees || row.employee;
  let employeeName = 'Unknown';

  if (employee) {
    if (employee.full_name) {
      employeeName = employee.full_name;
    } else if (employee.first_name || employee.last_name) {
      employeeName = [employee.first_name, employee.last_name].filter(Boolean).join(' ');
    }
  }

  return {
    attendance_id: row.attendance_id,
    id: row.attendance_id,
    employee_id: row.employee_id,
    employee_name: employeeName, // Added for frontend display
    date: row.date,
    time_in: row.time_in,
    time_out: row.time_out,
    status: row.status,
    method: row.mark_method || row.method,
    notes: row.notes,
    metadata: row.metadata || {},
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

/**
 * Convert ISO string to Date object
 */
function stringToDate(isoString) {
  if (!isoString) return null;
  return new Date(isoString);
}

/**
 * Convert date object to ISO string
 */
function dateToString(date) {
  if (!date) return null;
  return date instanceof Date ? date.toISOString() : date;
}

/**
 * Convert date to YYYY-MM-DD format
 */
function dateToDateString(date) {
  if (!date) return null;

  const d = date instanceof Date ? date : new Date(date);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');

  return `${year}-${month}-${day}`;
}

/**
 * Convert time string HH:MM to minutes
 */
function timeToMinutes(timeString) {
  if (!timeString) return 0;

  const [hours, minutes] = timeString.split(':').map(n => parseInt(n, 10));
  return hours * 60 + (minutes || 0);
}

/**
 * Convert minutes to time string HH:MM
 */
function minutesToTime(minutes) {
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;

  return `${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}`;
}

/**
 * Calculate hours worked from time_in and time_out
 */
function calculateHoursWorked(timeIn, timeOut) {
  if (!timeIn || !timeOut) return 0;

  const inDate = new Date(`2000-01-01T${timeIn}`);
  const outDate = new Date(`2000-01-01T${timeOut}`);

  const diffMs = outDate - inDate;
  const diffHours = diffMs / (1000 * 60 * 60);

  return Math.round(diffHours * 100) / 100;
}

/**
 * Check if arrival is late (after 9:00 AM)
 */
function isLateArrival(timeIn) {
  if (!timeIn) return false;

  const minutes = timeToMinutes(timeIn);
  const nineAMMinutes = 9 * 60; // 09:00

  return minutes > nineAMMinutes;
}

/**
 * Format time for display
 */
function formatTime(timeString) {
  if (!timeString) return '-';

  const [hours, minutes] = timeString.split(':');
  return `${hours}:${minutes}`;
}

/**
 * Format date for display
 */
function formatDate(dateString) {
  if (!dateString) return '-';

  const date = new Date(dateString);
  return date.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

module.exports = {
  rowToSession,
  rowToUser,
  rowToEmployee,
  rowToAttendance,
  stringToDate,
  dateToString,
  dateToDateString,
  timeToMinutes,
  minutesToTime,
  calculateHoursWorked,
  isLateArrival,
  formatTime,
  formatDate,
};
