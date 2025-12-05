const { createClient } = require('@supabase/supabase-js');
const bcrypt = require('bcryptjs');

// Reads SUPABASE_URL and SECRET_KEYS from environment
let SUPABASE_URL = process.env.SUPABASE_URL || process.env.LOCAL_SUPABASE_URL || process.env.CLOUD_SUPABASE_URL || null;
const SECRET_KEYS = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SECRET_KEYS || null; // Prefer service role key

// Fix for local development on Windows where host.docker.internal is used in .env but running on host
if (SUPABASE_URL && SUPABASE_URL.includes('host.docker.internal') && process.platform === 'win32') {
  console.log('[supabase] Detected Windows host with host.docker.internal URL, switching to localhost');
  SUPABASE_URL = SUPABASE_URL.replace('host.docker.internal', 'localhost');
}

function maskUrl(url) {
  try {
    if (!url) return '';
    return url.replace(/(https?:\/\/)([^:@]+)(:[^@]+)?@/, '$1*****@');
  } catch (e) { return '*****'; }
}

let supabase = null;
if (SUPABASE_URL && SECRET_KEYS) {
  try {
    supabase = createClient(SUPABASE_URL, SECRET_KEYS, {
      auth: { persistSession: false },
      global: { headers: { 'x-client-info': 'employee-attendance-server' } }
    });
    console.log('[supabase] Supabase client initialized successfully');
    console.log('[supabase] SUPABASE_URL:', maskUrl(SUPABASE_URL));
    console.log('[supabase] SECRET_KEYS present:', SECRET_KEYS ? 'yes' : 'no');
  } catch (err) {
    console.error('[supabase] FATAL: Failed to initialize Supabase client:', err.message);
    supabase = null;
  }
} else {
  console.error('[supabase] CRITICAL: SUPABASE_URL or SECRET_KEYS not set - Supabase will be unavailable!');
  console.error('[supabase] SUPABASE_URL present:', SUPABASE_URL ? 'yes' : 'no');
  console.error('[supabase] SECRET_KEYS present:', SECRET_KEYS ? 'yes' : 'no');
}

// Helper: find user by email using Supabase from 'users' table
async function findUserByEmail(email) {
  // Try Supabase first if available
  if (supabase) {
    try {
      console.log('[supabase] findUserByEmail searching for:', email);
      
      // Use case-insensitive match
      const { data, error } = await supabase
        .from('users')
        .select('user_id, username, password_hash, role_id, status, first_login')
        .ilike('username', email)
        .limit(1);
      
      if (error) {
        console.warn('[supabase] findUserByEmail error:', error.message);
        // Fall through to local DB
      } else if (data && data.length) {
        console.log('[supabase] findUserByEmail found user via Supabase');
        return data[0];
      }
    } catch (err) {
      console.warn('[supabase] findUserByEmail exception:', err.message);
      // Fall through to local DB
    }
  }

  // Fallback to local PostgreSQL
  console.log('[findUserByEmail] Falling back to local PostgreSQL for:', email);
  try {
    const { pool } = require('./conn');
    const result = await pool.query(
      'SELECT user_id, username, password_hash, role_id, status, first_login FROM users WHERE LOWER(username) = LOWER($1)',
      [email]
    );
    if (result.rows && result.rows.length > 0) {
      console.log('[findUserByEmail] Found user via local PostgreSQL');
      return result.rows[0];
    }
  } catch (localErr) {
    console.error('[findUserByEmail] Local PostgreSQL error:', localErr.message);
  }

  console.log('[findUserByEmail] User not found in any database');
  return null;
}

// RPC Helper Functions for transactional operations
async function rpcLogin(email, passwordHash, ipAddress, deviceInfo = {}) {
    if (!supabase) return null;
    
    try {
        const { data, error } = await supabase.rpc('auth_login', {
            p_email: email,
            p_password_hash: passwordHash,
            p_ip_address: ipAddress,
            p_device_info: deviceInfo
        });
        
        if (error) throw error;
        return data;
    } catch (error) {
        console.error('[supabase] RPC login error:', error.message);
        throw error;
    }
}

async function rpcLogout(sessionId) {
    if (!supabase) return null;
    
    try {
        const { data, error } = await supabase.rpc('auth_logout', {
            p_session_id: sessionId
        });
        
        if (error) throw error;
        return data;
    } catch (error) {
        console.error('[supabase] RPC logout error:', error.message);
        throw error;
    }
}

async function rpcChangeFirstPassword(userId, newPasswordHash) {
    if (!supabase) return null;
    
    try {
        const { data, error } = await supabase.rpc('auth_change_first_password', {
            p_user_id: userId,
            p_new_password_hash: newPasswordHash
        });
        
        if (error) throw error;
        return data;
    } catch (error) {
        console.error('[supabase] RPC change password error:', error.message);
        throw error;
    }
}

async function rpcAttendanceCheckin(employeeIdentifier, method = 'manual', status = 'present') {
    if (!supabase) return null;
    
    try {
        const { data, error } = await supabase.rpc('attendance_checkin', {
            p_employee_identifier: employeeIdentifier,
            p_method: method,
            p_status: status
        });
        
        if (error) throw error;
        return data;
    } catch (error) {
        console.error('[supabase] RPC attendance checkin error:', error.message);
        throw error;
    }
}

async function rpcAttendanceCheckout(employeeIdentifier, sessionId = null) {
    if (!supabase) return null;
    
    try {
        const { data, error } = await supabase.rpc('attendance_checkout', {
            p_employee_identifier: employeeIdentifier,
            p_session_id: sessionId
        });
        
        if (error) throw error;
        return data;
    } catch (error) {
        console.error('[supabase] RPC attendance checkout error:', error.message);
        throw error;
    }
}

async function rpcAttendanceBreak(employeeIdentifier, action) {
    if (!supabase) return null;
    
    try {
        const { data, error } = await supabase.rpc('attendance_break', {
            p_employee_identifier: employeeIdentifier,
            p_action: action
        });
        
        if (error) throw error;
        return data;
    } catch (error) {
        console.error('[supabase] RPC attendance break error:', error.message);
        throw error;
    }
}

async function rpcQrGenerateSession(sessionType = 'checkin', expiresMinutes = 60) {
    if (!supabase) return null;
    
    try {
        const { data, error } = await supabase.rpc('qr_generate_session', {
            p_session_type: sessionType,
            p_expires_minutes: expiresMinutes
        });
        
        if (error) throw error;
        return data;
    } catch (error) {
        console.error('[supabase] RPC QR generate error:', error.message);
        throw error;
    }
}

async function rpcQrRevokeSession(sessionId) {
    if (!supabase) return null;
    
    try {
        const { data, error } = await supabase.rpc('qr_revoke_session', {
            p_session_id: sessionId
        });
        
        if (error) throw error;
        return data;
    } catch (error) {
        console.error('[supabase] RPC QR revoke error:', error.message);
        throw error;
    }
}

async function rpcProfileUpdate(userId, profileData, userRole = 'employee') {
    if (!supabase) return null;
    
    try {
        const { data, error } = await supabase.rpc('profile_update', {
            p_user_id: userId,
            p_first_name: profileData.first_name,
            p_last_name: profileData.last_name,
            p_phone: profileData.phone || null,
            p_address: profileData.address || null,
            p_position: profileData.position || null,
            p_dept_id: profileData.dept_id || null,
            p_hire_date: profileData.hire_date || null,
            p_user_role: userRole,
            p_password_hash: profileData.password_hash || null,
            p_pin_hash: profileData.pin_hash || null
        });
        
        if (error) throw error;
        return data;
    } catch (error) {
        console.error('[supabase] RPC profile update error:', error.message);
        throw error;
    }
}

// Generic read helpers for non-transactional queries
async function getProfile(userId) {
    if (!supabase) return null;
    
    try {
        // First try to get user and employee by user_id
        let { data, error } = await supabase
            .from('users')
            .select(`
                user_id,
                username,
                status,
                first_login,
                created_at,
                roles!inner(role_name),
                employees(
                    employee_id,
                    first_name,
                    last_name,
                    full_name,
                    email,
                    phone,
                    address,
                    position,
                    hire_date,
                    status,
                    dept_id,
                    departments(dept_name)
                )
            `)
            .eq('user_id', userId)
            .maybeSingle();

        if (error) throw error;

        // Defensive check: if a nested employee row exists, make sure it actually belongs to this user.
        // Some deployments may have no FK relationship configured and PostgREST nested selects
        // could return unexpected rows. If the nested employee_id doesn't match the userId, ignore it.
        if (data && data.employees) {
            const nestedEmp = Array.isArray(data.employees) && data.employees.length > 0
                ? data.employees[0]
                : data.employees;
            if (nestedEmp && nestedEmp.employee_id && Number(nestedEmp.employee_id) !== Number(userId)) {
                console.warn('[supabase] Ignoring nested employee that does not match user_id', { userId, nestedEmployeeId: nestedEmp.employee_id });
                // Remove the nested employee so the deterministic lookup logic below will run
                data.employees = null;
            }
        }

        // If user found but no employee data, try deterministic lookup by employee_id (user_id) first
        if (data && (!data.employees || data.employees.length === 0)) {
            // Prefer a direct employee_id match to avoid ambiguous email-based matches
            try {
                const { data: empById, error: empByIdErr } = await supabase
                    .from('employees')
                    .select(`
                        employee_id,
                        first_name,
                        last_name,
                        full_name,
                        email,
                        phone,
                        address,
                        position,
                        hire_date,
                        status,
                        dept_id,
                        departments(dept_name)
                    `)
                    .eq('employee_id', userId)
                    .single();

                if (!empByIdErr && empById) {
                    data.employees = empById;
                } else {
                    // Last-resort: try an email lookup but only accept it when the email exactly matches the username
                    const empResult = await supabase
                        .from('employees')
                        .select(`
                            employee_id,
                            first_name,
                            last_name,
                            full_name,
                            email,
                            phone,
                            address,
                            position,
                            hire_date,
                            status,
                            dept_id,
                            departments(dept_name)
                        `)
                        .ilike('email', data.username)
                        .single();

                    if (empResult && empResult.data && !empResult.error) {
                        const candidateEmail = (empResult.data.email || '').trim().toLowerCase();
                        const usernameEmail = (data.username || '').trim().toLowerCase();
                        if (candidateEmail === usernameEmail) {
                            data.employees = empResult.data;
                        } else {
                            // Ambiguous fallback — ignore to avoid returning unrelated employee record
                            console.log('[supabase] Ignoring ambiguous employee fallback match for user', userId, { candidateEmail, usernameEmail });
                        }
                    }
                }
            } catch (e) {
                // If anything goes wrong with the fallback lookups, continue gracefully (we will return user-only profile)
                console.warn('[supabase] getProfile employee reverse lookup error:', e && e.message ? e.message : e);
            }
        }
        
        // Flatten the nested data
        if (data) {
            // Handle employees as either array or direct object
            const employee = Array.isArray(data.employees) && data.employees.length > 0 
                ? data.employees[0] 
                : data.employees;
                
            const flattened = {
                user_id: data.user_id,
                username: data.username,
                role: data.roles?.role_name,
                status: data.status,
                first_login: data.first_login,
                created_at: data.created_at,
                ...(employee && {
                    employee_id: employee.employee_id,
                    first_name: employee.first_name,
                    last_name: employee.last_name,
                    full_name: employee.full_name,
                    email: employee.email,
                    phone: employee.phone,
                    address: employee.address,
                    position: employee.position,
                    hire_date: employee.hire_date,
                    employee_status: employee.status,
                    dept_id: employee.dept_id,
                    department: employee.departments?.dept_name
                })
            };
            return flattened;
        }
        
        return data;
    } catch (error) {
        console.error('[supabase] Error getting profile:', error.message);
        throw error;
    }
}

async function getAttendanceHistory(filters = {}) {
    if (!supabase) return null;
    
    try {
        let query = supabase
            .from('attendance')
            .select(`
                *,
                employees!inner(
                    first_name,
                    last_name,
                    dept_id,
                    departments(dept_name),
                    users!inner(username)
                )
            `)
            .order('date', { ascending: false })
            .order('time_in', { ascending: false });
            
        if (filters.start) {
            query = query.gte('date', filters.start);
        }
        if (filters.end) {
            query = query.lte('date', filters.end);
        }
        if (filters.employee) {
            if (/^\d+$/.test(String(filters.employee))) {
                query = query.eq('employee_id', parseInt(String(filters.employee)));
            } else {
                query = query.eq('employees.users.username', filters.employee);
            }
        }
        
        const { data, error } = await query;
        
        if (error) throw error;
        
        // Flatten the data
        return data.map(record => ({
            ...record,
            username: record.employees?.users?.username,
            employee_name: record.employees ? `${record.employees.first_name} ${record.employees.last_name}` : null,
            dept_name: record.employees?.departments?.dept_name
        }));
        
    } catch (error) {
        console.error('[supabase] Error getting attendance history:', error.message);
        throw error;
    }
}

// Session validation helper
async function validateSession(sessionId, userId) {
    if (!supabase) return null;
    
    try {
        const { data, error } = await supabase
            .from('user_sessions')
            .select('session_id, user_id, login_time, logout_time')
            .eq('session_id', sessionId)
            .eq('user_id', userId)
            .is('logout_time', null)
            .single();
            
        if (error) {
            if (error.code === 'PGRST116') return null; // No rows found
            throw error;
        }
        
        return data;
    } catch (error) {
        console.error('[supabase] Session validation error:', error.message);
        throw error;
    }
}

// Get employee by email helper
async function getEmployeeByEmail(email) {
    if (!supabase) return null;
    
    try {
        console.log('[supabase] Looking up employee for email:', email);
        const trimmedEmail = email.trim().toLowerCase();
        
        // Try multiple approaches to find the employee
        
        // Approach 1: Find user by username and left join employee
        let { data, error } = await supabase
            .from('users')
            .select(`
                user_id,
                username,
                status,
                employees(
                    employee_id,
                    first_name,
                    last_name,
                    email,
                    status,
                    departments(dept_name)
                )
            `)
            .ilike('username', trimmedEmail)
            .single();
            
        console.log('[supabase] User lookup (left join) result:', { data, error });
        
        // If we found a user but no employee record, try direct employee lookup
        if (data && (!data.employees || data.employees.length === 0)) {
            console.log('[supabase] User found but no employee record, checking by employee_id...');
            const { data: empData, error: empError } = await supabase
                .from('employees')
                .select(`
                    employee_id,
                    first_name,
                    last_name,
                    email,
                    status,
                    departments(dept_name)
                `)
                .eq('employee_id', data.user_id)
                .single();
                
            if (!empError && empData) {
                data.employees = [empData];
                console.log('[supabase] Found employee by employee_id:', empData);
            }
        }
            
        // If still not found, try finding by email in employees table
        if (error && error.code === 'PGRST116') {
            console.log('[supabase] User not found by username, trying employees table by email...');
            const empResult = await supabase
                .from('employees')
                .select(`
                    employee_id,
                    first_name,
                    last_name,
                    email,
                    status,
                    departments(dept_name),
                    users(user_id, username, status)
                `)
                .ilike('email', trimmedEmail)
                .single();
                
            console.log('[supabase] Employee lookup by email result:', empResult);
                
            if (empResult.error) {
                if (empResult.error.code === 'PGRST116') {
                    // Last attempt: look for any users/employees that might match
                    console.log('[supabase] Doing broader search for debugging...');
                    const debugUsers = await supabase
                        .from('users')
                        .select('user_id, username, status')
                        .ilike('username', `%${email.split('@')[0]}%`);
                    
                    const debugEmployees = await supabase
                        .from('employees')
                        .select('employee_id, email, first_name, last_name')
                        .ilike('email', `%${email}%`);
                        
                    console.log('[supabase] Debug - Similar users:', debugUsers.data);
                    console.log('[supabase] Debug - Similar employees:', debugEmployees.data);
                    
                    console.log('[supabase] Employee not found in either table for:', email);
                    return null;
                }
                throw empResult.error;
            }
            
            // Transform to match expected structure
            data = {
                user_id: empResult.data.users?.user_id,
                username: empResult.data.users?.username,
                status: empResult.data.users?.status,
                employees: [{
                    employee_id: empResult.data.employee_id,
                    first_name: empResult.data.first_name,
                    last_name: empResult.data.last_name,
                    email: empResult.data.email,
                    status: empResult.data.status,
                    departments: empResult.data.departments
                }]
            };
        } else if (error) {
            console.error('[supabase] User lookup error:', error);
            throw error;
        }
        
        // Return in expected format
        // Handle employees as either array or direct object
        const employee = Array.isArray(data.employees) && data.employees.length > 0 
            ? data.employees[0] 
            : data.employees;
            
        if (!employee) {
            console.log('[supabase] No employee data found for email:', email);
            console.log('[supabase] Data structure received:', JSON.stringify(data, null, 2));
            return null;
        }
        
        const result = {
            id: employee.employee_id,
            employee_id: employee.employee_id,
            name: `${employee.first_name} ${employee.last_name}`,
            department: employee.departments?.dept_name,
            email: employee.email || data.username,
            user_status: data.status,
            employee_status: employee.status
        };
        
        console.log('[supabase] Returning employee data:', result);
        return result;
        
    } catch (error) {
        console.error('[supabase] Get employee by email error:', error.message);
        throw error;
    }
}

// Get notifications for user
async function getNotifications(userId) {
    if (!supabase) return null;
    
    try {
        const { data, error } = await supabase
            .from('notifications')
            .select('*')
            .eq('user_id', userId)
            .eq('status', 'unread')
            .order('created_at', { ascending: false });
            
        if (error) throw error;
        return data;
    } catch (error) {
        console.error('[supabase] Get notifications error:', error.message);
        throw error;
    }
}

// Mark notifications as read
async function markNotificationsRead(userId, notificationIds = null) {
    if (!supabase) return null;
    
    try {
        let query = supabase
            .from('notifications')
            .update({ status: 'read' })
            .eq('user_id', userId)
            .eq('status', 'unread');
            
        if (Array.isArray(notificationIds) && notificationIds.length > 0) {
            query = query.in('notif_id', notificationIds);
        }
        
        const { data, error } = await query;
        if (error) throw error;
        return data;
    } catch (error) {
        console.error('[supabase] Mark notifications read error:', error.message);
        throw error;
    }
}

// Get requests for user
async function getRequests(userAuth, filters = {}) {
    if (!supabase) return null;
    
    try {
        let query = supabase
            .from('requests')
            .select(`
                *,
                employees!inner(
                    full_name,
                    dept_id,
                    departments(dept_name)
                )
            `)
            .order('created_at', { ascending: false });
            
        // Apply user-based filtering
        if (userAuth.role === 'employee') {
            query = query.eq('employee_id', userAuth.employee_id);
        } else if (userAuth.role === 'department_head') {
            // Need to join with departments to filter by head_id
            query = query.eq('employees.departments.head_id', userAuth.id);
        }
        // HR and superadmin see all requests
        
        // Apply optional filters
        if (filters.status) {
            query = query.eq('status', filters.status);
        }
        if (filters.type) {
            query = query.eq('type', filters.type);
        }
        
        const { data, error } = await query;
        if (error) throw error;
        
        // Flatten the data
        return data.map(request => ({
            ...request,
            request_type: request.type, // Add for frontend compatibility
            employee_name: request.employees?.full_name,
            dept_name: request.employees?.departments?.dept_name
        }));
    } catch (error) {
        console.error('[supabase] Get requests error:', error.message);
        throw error;
    }
}

// Create a new request
async function createRequest(employeeId, requestType, details) {
    if (!supabase) return null;
    
    try {
        const { data, error } = await supabase
            .from('requests')
            .insert({
                employee_id: employeeId,
                type: requestType,
                details: details
            })
            .select()
            .single();
            
        if (error) throw error;
        
        // Add request_type for frontend compatibility
        if (data) {
            data.request_type = data.type;
        }
        
        return data;
    } catch (error) {
        console.error('[supabase] Create request error:', error.message);
        throw error;
    }
}

// Get all users with pagination for admin
async function getAdminUsers(filters = {}) {
    if (!supabase) return null;
    
    try {
        const { q, role, _page = 1, _limit = 10 } = filters;
        const page = parseInt(_page, 10);
        const limit = parseInt(_limit, 10);
        const offset = (page - 1) * limit;

        // First get the total count
        let countQuery = supabase
            .from('users')
            .select('user_id', { count: 'exact', head: true });
            
        // Apply role filter to count query
        if (role && role.toLowerCase() !== 'all') {
            countQuery = countQuery.eq('roles.role_name', role.toLowerCase());
        }
            
        // Note: Search filtering will be applied after getting employee data

        // Since employees.employee_id = users.user_id relationship isn't defined as FK,
        // we need to do a manual join using RPC or raw query
        let query = supabase
            .from('users')
            .select(`
                user_id,
                username,
                status,
                created_at,
                updated_at,
                roles!inner(role_name),
                user_sessions!left(login_time)
            `)
            .order('user_id', { ascending: true });
        
        // Apply role filter
        if (role && role.toLowerCase() !== 'all') {
            query = query.eq('roles.role_name', role.toLowerCase());
        }
        
        // Apply search filter (only on username for now, will filter by name after getting employee data)
        if (q && q.trim()) {
            query = query.ilike('username', `%${q}%`);
        }
        
        // Apply pagination
        query = query.range(offset, offset + limit - 1);
        
        const [{ data, error }, { count }] = await Promise.all([query, countQuery]);
        if (error) throw error;
        
        // Get employee data separately for users that have employee records
        const userIds = data.map(user => user.user_id);
        const { data: employeeData, error: empError } = await supabase
            .from('employees')
            .select(`
                employee_id,
                full_name,
                first_name,
                last_name,
                dept_id,
                departments(dept_name)
            `)
            .in('employee_id', userIds);
            
        if (empError) console.warn('[supabase] Employee data fetch error:', empError.message);
        
        // Create a map of employee data by employee_id (which equals user_id)
        const employeeMap = new Map();
        if (employeeData) {
            employeeData.forEach(emp => {
                employeeMap.set(emp.employee_id, emp);
            });
        }
        
        // Format the data
        const formattedData = data.map(user => {
            // Get the most recent login time
            const lastLoginTime = user.user_sessions && user.user_sessions.length > 0 
                ? Math.max(...user.user_sessions.map(s => new Date(s.login_time).getTime()))
                : null;
                
            const lastLogin = lastLoginTime ? new Date(lastLoginTime).toISOString() : null;
            
            // Get employee data for this user
            const employeeInfo = employeeMap.get(user.user_id) || {};
            
            // Only set fullName if we have actual first_name and last_name, otherwise null
            const fullName = (employeeInfo.first_name && employeeInfo.last_name) 
                ? `${employeeInfo.first_name} ${employeeInfo.last_name}`.trim()
                : null;
            
            return {
                user_id: user.user_id,
                username: user.username,
                full_name: fullName,
                first_name: employeeInfo.first_name || null,
                last_name: employeeInfo.last_name || null,
                role_name: user.roles?.role_name,
                status: user.status,
                department_name: employeeInfo.departments?.dept_name || null,
                created_at: user.created_at,
                last_modified_by: 'System', // TODO: Track actual modifier
                last_login: lastLogin
            };
        });
        
        return { users: formattedData, total: count || 0 };
    } catch (error) {
        console.error('[supabase] Get admin users error:', error.message);
        throw error;
    }
}

// Get system settings
async function getSystemSettings() {
    if (!supabase) return null;
    
    try {
        const { data, error } = await supabase
            .from('system_settings')
            .select('setting_key, setting_value');
            
        if (error) throw error;
        
        // Convert to key-value object
        const settings = {};
        data.forEach(row => {
            // setting_value is JSONB, so it comes back as the actual value (boolean, number, string, etc.)
            // No need for JSON.parse as Supabase already handles that
            settings[row.setting_key] = row.setting_value;
        });
        
        return settings;
    } catch (error) {
        console.error('[supabase] Get system settings error:', error.message);
        throw error;
    }
}

// Get audit logs with filtering
async function getAuditLogs(filters = {}) {
    if (!supabase) return null;
    
    try {
        const { startDate, endDate, userId, actionType } = filters;
        
        let query = supabase
            .from('audit_logs')
            .select(`
                log_id,
                user_id,
                action_type,
                details,
                created_at,
                users(username)
            `)
            .order('created_at', { ascending: false });
            
        if (startDate) {
            query = query.gte('created_at', startDate);
        }
        if (endDate) {
            query = query.lte('created_at', endDate);
        }
        if (userId) {
            query = query.eq('user_id', userId);
        }
        if (actionType) {
            query = query.eq('action_type', actionType);
        }
        
        const { data, error } = await query;
        if (error) throw error;
        
        // Flatten the data
        return data.map(log => ({
            ...log,
            username: log.users?.username
        }));
    } catch (error) {
        console.error('[supabase] Get audit logs error:', error.message);
        throw error;
    }
}

// Get active user sessions
async function getActiveSessions() {
    if (!supabase) return null;
    
    try {
        const { data, error } = await supabase
            .from('user_sessions')
            .select(`
                session_id,
                user_id,
                login_time,
                ip_address,
                device_info,
                users!inner(
                    username,
                    employees(full_name)
                )
            `)
            .is('logout_time', null)
            .order('login_time', { ascending: false });
            
        if (error) throw error;
        
        // Format the data
        return data.map(session => ({
            session_id: session.session_id,
            user_id: session.user_id,
            username: session.users?.username,
            full_name: session.users?.employees?.full_name,
            login_time: session.login_time,
            ip_address: session.ip_address,
            user_agent: session.device_info?.userAgent
        }));
    } catch (error) {
        console.error('[supabase] Get active sessions error:', error.message);
        throw error;
    }
}

// Get current active QR session
async function getCurrentQRSession() {
    if (!supabase) return null;
    
    try {
        const { data, error } = await supabase
            .from('qr_sessions')
            .select('session_id, expires_at, created_at, session_type')
            .eq('is_active', true)
            .gt('expires_at', new Date().toISOString())
            .order('created_at', { ascending: false })
            .limit(1)
            .single();
            
        if (error) {
            if (error.code === 'PGRST116') return null; // No rows found
            throw error;
        }
        
        return {
            session_id: data.session_id,
            expires_at: data.expires_at,
            issued_at: data.created_at,
            type: data.session_type
        };
    } catch (error) {
        console.error('[supabase] Get current QR session error:', error.message);
        throw error;
    }
}

// Get HR employees with search and filters
async function getHREmployees(filters = {}) {
    if (!supabase) return null;
    
    try {
        const { search, department, limit = 50, offset = 0 } = filters;
        
        // First, get the department ID if department name is provided
        let deptId = null;
        if (department && department.trim()) {
            const { data: deptData, error: deptError } = await supabase
                .from('departments')
                .select('dept_id')
                .eq('dept_name', department)
                .single();
            
            if (deptError) {
                console.warn('[getHREmployees] Could not find department:', department, deptError.message);
            } else if (deptData) {
                deptId = deptData.dept_id;
                console.log('[getHREmployees] Found dept_id for department', department, ':', deptId);
            }
        }
        
        let query = supabase
            .from('employees')
            .select(`
                employee_id,
                full_name,
                email,
                phone,
                address,
                position,
                status,
                hire_date,
                created_at,
                dept_id,
                departments(dept_name)
            `)
            .order('full_name', { ascending: true })
            .range(parseInt(offset), parseInt(offset) + parseInt(limit) - 1);
            
        if (search && search.trim()) {
            query = query.or(`full_name.ilike.%${search}%,email.ilike.%${search}%`);
        }
        
        // Filter by department ID instead of name for more reliable matching
        if (deptId !== null) {
            query = query.eq('dept_id', deptId);
            console.log('[getHREmployees] Filtering by dept_id:', deptId);
        }
        
        const { data, error } = await query;
        if (error) throw error;
        
        console.log('[getHREmployees] Found', data?.length, 'employees for department:', department);
        
        // Get all user roles for the employees (using employee_id = user_id relationship)
        const employeeIds = data.map(e => e.employee_id);
        let userRoles = {};
        let userLastLogins = {};
        
        if (employeeIds.length > 0) {
            // First, get user roles
            const { data: usersData, error: usersError } = await supabase
                .from('users')
                .select('user_id, roles(role_name)')
                .in('user_id', employeeIds);
            
            if (!usersError && usersData) {
                usersData.forEach(user => {
                    const roleData = Array.isArray(user.roles) ? user.roles[0] : user.roles;
                    userRoles[user.user_id] = roleData?.role_name;
                });
                console.log('[getHREmployees] Fetched roles for', Object.keys(userRoles).length, 'users');
            } else {
                console.warn('[getHREmployees] Error fetching user roles:', usersError?.message);
            }
            
            // Then, get the latest login time for each user from user_sessions
            const { data: sessionsData, error: sessionsError } = await supabase
                .from('user_sessions')
                .select('user_id, login_time')
                .in('user_id', employeeIds)
                .order('login_time', { ascending: false });
            
            if (!sessionsError && sessionsData && sessionsData.length > 0) {
                // Get the most recent login for each user
                const seenUsers = new Set();
                sessionsData.forEach(session => {
                    if (!seenUsers.has(session.user_id)) {
                        seenUsers.add(session.user_id);
                        userLastLogins[session.user_id] = new Date(session.login_time).toISOString();
                        console.log(`[getHREmployees] User ${session.user_id} last login:`, userLastLogins[session.user_id]);
                    }
                });
                console.log('[getHREmployees] Fetched last logins for', Object.keys(userLastLogins).length, 'users');
            } else {
                console.warn('[getHREmployees] Error fetching user sessions:', sessionsError?.message);
                console.log('[getHREmployees] Sessions data:', sessionsData);
            }
        }
        
        // Format the data
        const formatted = data.map(employee => ({
            employee_id: employee.employee_id,
            name: employee.full_name,
            email: employee.email,
            phone: employee.phone,
            address: employee.address,
            position: employee.position,
            department: employee.departments?.dept_name,
            status: employee.status,
            hire_date: employee.hire_date,
            created_at: employee.created_at,
            role: userRoles[employee.employee_id] || null,
            last_login: userLastLogins[employee.employee_id] || null
        }));
        
        console.log('[debug] Department heads found:', formatted.filter(emp => emp.role === 'head_dept').length);
        return formatted;
    } catch (error) {
        console.error('[supabase] Get HR employees error:', error.message);
        throw error;
    }
}

// Get employees who can be assigned as department heads (employees with role_id = 4, not current heads)
async function getDepartmentHeads() {
    if (!supabase) return null;
    
    try {
        // Get users with 'employee' role (role_id = 4) who are active
        const { data: employeeUsers, error: usersError } = await supabase
            .from('users')
            .select(`
                user_id,
                username,
                role_id,
                roles!inner(role_name)
            `)
            .eq('role_id', 4)  // 4 is employee role
            .eq('status', 'active')
            .eq('roles.role_name', 'employee');  // Only employees can be promoted to head
        
        if (usersError) throw usersError;
        
        console.log(`[getDepartmentHeads] Found ${employeeUsers?.length || 0} employees who can be assigned as heads`);
        
        if (!employeeUsers || employeeUsers.length === 0) {
            console.log('[getDepartmentHeads] No eligible employees found');
            return [];
        }
        
        // Get employee data for these users
        const userIds = employeeUsers.map(u => u.user_id);
        const { data: employees, error: empError } = await supabase
            .from('employees')
            .select(`
                employee_id,
                full_name,
                email,
                position,
                dept_id,
                departments(dept_name)
            `)
            .in('employee_id', userIds)
            .eq('status', 'active');  // employee_id should match user_id
        
        if (empError) throw empError;
        
        console.log(`[getDepartmentHeads] Found ${employees?.length || 0} employee records`);
        
        // Combine user and employee data
        const eligibleEmployees = employeeUsers.map(user => {
            const employee = employees.find(emp => emp.employee_id === user.user_id);
            if (!employee) return null;  // Skip if no employee record
            
            return {
                user_id: user.user_id,
                employee_id: employee.employee_id,
                name: employee.full_name || user.username,
                email: employee.email || user.username,
                position: employee.position || 'Employee',
                department: employee.departments?.dept_name || null,
                dept_id: employee.dept_id,
                username: user.username
            };
        }).filter(emp => emp !== null);  // Remove nulls (users without employee records)
        
        console.log(`[getDepartmentHeads] Returning ${eligibleEmployees.length} eligible employees`);
        return eligibleEmployees;
        
    } catch (error) {
        console.error('[supabase] Get department heads error:', error.message);
        throw error;
    }
}

// Get HR attendance with filters
async function getHRAttendance(filters = {}) {
    if (!supabase) return null;
    
    try {
        const { startDate, endDate, employee, status, department } = filters;
        
        let query = supabase
            .from('attendance')
            .select(`
                employee_id,
                date,
                time_in,
                time_out,
                method,
                status,
                checkin_session_id,
                checkout_session_id,
                employees!inner(
                    first_name,
                    last_name,
                    departments(dept_name),
                    users!inner(username)
                )
            `)
            .order('date', { ascending: false })
            .order('time_in', { ascending: false });
            
        if (startDate) {
            query = query.gte('date', startDate);
        }
        
        if (endDate) {
            query = query.lte('date', endDate);
        }
        
        if (department && department.trim()) {
            query = query.eq('employees.departments.dept_name', department);
        }
        
        if (employee && employee.trim()) {
            if (/^\d+$/.test(employee)) {
                query = query.eq('employee_id', parseInt(employee));
            } else {
                query = query.eq('employees.users.username', employee);
            }
        }
        
        if (status && status.trim()) {
            query = query.eq('status', status);
        }
        
        const { data, error } = await query;
        if (error) throw error;
        
        // Format the data
        return data.map(record => {
            // Combine date and time_in to create proper timestamp
            const dateStr = record.date; // YYYY-MM-DD
            const timeStr = record.time_in; // HH:MM:SS
            let timestamp = null;
            
            if (dateStr && timeStr) {
                // Database stores time in Philippine Time (UTC+8)
                // Create ISO string that represents UTC+8 time
                timestamp = `${dateStr}T${timeStr}+08:00`;
            }
            
            return {
                employee_id: record.employee_id,
                date: record.date,
                time_in: record.time_in,
                time_out: record.time_out,
                method: record.method,
                status: record.status,
                checkin_session_id: record.checkin_session_id,
                checkout_session_id: record.checkout_session_id,
                employee_username: record.employees?.users?.username,
                employee_name: `${record.employees?.first_name || ''} ${record.employees?.last_name || ''}`.trim(),
                employee_department: record.employees?.departments?.dept_name,
                timestamp: timestamp // ISO timestamp with UTC+8 timezone: YYYY-MM-DDTHH:MM:SS+08:00
            };
        });
    } catch (error) {
        console.error('[supabase] Get HR attendance error:', error.message);
        throw error;
    }
}

// Get departments list
async function getDepartments() {
    if (!supabase) return null;
    
    try {
        // Get department data with head information
        const { data, error } = await supabase
            .from('departments')
            .select(`
                dept_id, 
                dept_name, 
                description, 
                head_id
            `)
            .order('dept_name', { ascending: true });
            
        if (error) throw error;
        
        console.log('[getDepartments] Retrieved', data?.length || 0, 'departments');
        
        // For each department, fetch the head's name if head_id exists
        const departmentsWithHeads = await Promise.all(
            data.map(async (dept) => {
                let head_name = null;
                let head_username = null;
                
                if (dept.head_id) {
                    try {
                        // Query employees table using employee_id = head_id (1:1 relationship)
                        const { data: empData } = await supabase
                            .from('employees')
                            .select('full_name, first_name, last_name')
                            .eq('employee_id', dept.head_id)
                            .single();
                        
                        if (empData) {
                            head_name = empData.full_name || `${empData.first_name} ${empData.last_name}`;
                        }
                        
                        // Also get username from users table
                        const { data: userData } = await supabase
                            .from('users')
                            .select('username')
                            .eq('user_id', dept.head_id)
                            .single();
                        
                        if (userData) {
                            head_username = userData.username;
                        }
                        
                        console.log(`[getDepartments] Dept ${dept.dept_id}: head_id=${dept.head_id}, head_name="${head_name}"`);
                    } catch (err) {
                        console.warn(`[getDepartments] Failed to get head info for dept ${dept.dept_id}:`, err.message);
                    }
                }
                
                return {
                    dept_id: dept.dept_id,
                    dept_name: dept.dept_name,
                    description: dept.description,
                    head_id: dept.head_id,
                    head_name: head_name,
                    head_username: head_username
                };
            })
        );
        
        return departmentsWithHeads;
    } catch (error) {
        console.error('[supabase] Get departments error:', error.message);
        throw error;
    }
}

// Get user lookup by username
async function getUserLookup(identifier) {
    if (!supabase) return null;
    
    try {
        const { data, error } = await supabase
            .from('users')
            .select('user_id, username')
            .eq('username', identifier)
            .limit(1)
            .single();
            
        if (error) {
            if (error.code === 'PGRST116') return null; // No rows found
            throw error;
        }
        
        return data;
    } catch (error) {
        console.error('[supabase] Get user lookup error:', error.message);
        throw error;
    }
}

// Get QR session by session_id
async function getQRSession(sessionId) {
    if (!supabase) return null;
    
    try {
        const { data, error } = await supabase
            .from('qr_sessions')
            .select('*')
            .eq('session_id', sessionId)
            .limit(1)
            .single();
            
        if (error) {
            if (error.code === 'PGRST116') return null; // No rows found
            throw error;
        }
        
        return data;
    } catch (error) {
        console.error('[supabase] Get QR session error:', error.message);
        throw error;
    }
}

// Get scan count for a QR session (check-ins and check-outs)
async function getScanCountForSession(sessionId) {
    if (!supabase) return 0;
    
    try {
        // Count distinct employees who checked in via this session
        const { data, error } = await supabase
            .from('attendance')
            .select('employee_id', { count: 'exact' })
            .eq('checkin_session_id', sessionId);
            
        if (error) {
            console.warn('[supabase] Get scan count error:', error.message);
            return 0;
        }
        
        return data ? data.length : 0;
    } catch (error) {
        console.error('[supabase] Get scan count exception:', error.message);
        return 0;
    }
}

// Get employee schedule by employee_id
async function getEmployeeSchedule(employeeId) {
    if (!supabase) return null;
    
    try {
        const { data, error } = await supabase
            .from('employees')
            .select('employee_id, schedule_start_time')
            .eq('employee_id', employeeId)
            .limit(1)
            .single();
            
        if (error) {
            if (error.code === 'PGRST116') return null; // No rows found
            throw error;
        }
        
        return data;
    } catch (error) {
        console.error('[supabase] Get employee schedule error:', error.message);
        throw error;
    }
}

// Get schedules by date range with optional filters (RPC function)
async function getSchedulesByDateRange(startDate, endDate, deptId = null, employeeId = null) {
    if (!supabase) {
        console.warn('[supabase] Supabase client not initialized');
        return [];
    }
    
    try {
        console.log(`[supabase] Calling get_schedules_by_date_range: start=${startDate}, end=${endDate}, deptId=${deptId}, employeeId=${employeeId}`);
        
        const { data, error } = await supabase.rpc('get_schedules_by_date_range', {
            p_start_date: startDate,
            p_end_date: endDate,
            p_dept_id: deptId,
            p_employee_id: employeeId
        });
        
        console.log(`[supabase] RPC result: error=${error?.message || 'none'}, data_count=${data?.length || 0}`);
        
        if (error) {
            console.error('[supabase] Get schedules RPC error:', error.message);
            
            // Better error messages for common issues
            if (error.message && error.message.includes('does not exist')) {
                console.error('[supabase] ⚠️  CRITICAL: RPC function get_schedules_by_date_range does not exist in database');
                console.error('[supabase] ⚠️  ACTION REQUIRED: Run add_scheduling_tables.sql in Supabase SQL Editor');
                console.error('[supabase] ⚠️  File location: server/postgres/add_scheduling_tables.sql');
            } else if (error.message && error.message.includes('relation') && error.message.includes('does not exist')) {
                console.error('[supabase] ⚠️  CRITICAL: Database tables do not exist');
                console.error('[supabase] ⚠️  ACTION REQUIRED: Run add_scheduling_tables.sql in Supabase SQL Editor');
            }
            
            throw error;
        }
        
        if (data && data.length > 0) {
            console.log('[supabase] Schedules data sample:', JSON.stringify(data.slice(0, 2)));
        }
        
        return data || [];
    } catch (error) {
        console.error('[supabase] Get schedules by date range error:', error.message);
        throw error;
    }
}

// Get today's attendance for employee
async function getTodayAttendance(employeeId, date) {
    if (!supabase) return null;
    
    try {
        const { data, error } = await supabase
            .from('attendance')
            .select('*')
            .eq('employee_id', employeeId)
            .eq('date', date)
            .limit(1)
            .single();
            
        if (error) {
            if (error.code === 'PGRST116') return null; // No rows found
            throw error;
        }
        
        return data;
    } catch (error) {
        console.error('[supabase] Get today attendance error:', error.message);
        throw error;
    }
}

// Update QR sessions (deactivate expired ones)
async function deactivateExpiredQRSessions() {
    if (!supabase) return null;
    
    try {
        const { data, error } = await supabase
            .from('qr_sessions')
            .update({ is_active: false })
            .lt('expires_at', new Date().toISOString())
            .eq('is_active', true);
            
        if (error) throw error;
        return data;
    } catch (error) {
        console.error('[supabase] Deactivate expired QR sessions error:', error.message);
        throw error;
    }
}

// Deactivate all QR sessions  
async function deactivateAllQRSessions() {
    if (!supabase) return null;
    
    try {
        // Mark all active sessions as inactive (keep records for audit trail)
        const { data, error } = await supabase
            .from('qr_sessions')
            .update({ is_active: false })
            .eq('is_active', true);
            
        if (error) throw error;
        return data;
    } catch (error) {
        console.error('[supabase] Deactivate all QR sessions error:', error.message);
        throw error;
    }
}

// Get system settings
async function getAllSystemSettings() {
    if (!supabase) return null;
    
    try {
        const { data, error } = await supabase
            .from('system_settings')
            .select('setting_key, setting_value');
            
        if (error) throw error;
        return data;
    } catch (error) {
        console.error('[supabase] Get all system settings error:', error.message);
        throw error;
    }
}

// Check if employee exists
async function checkEmployeeExists(employeeId) {
    if (!supabase) return null;
    
    try {
        const { data, error } = await supabase
            .from('employees')
            .select('employee_id')
            .eq('employee_id', employeeId)
            .limit(1)
            .single();
            
        if (error) {
            if (error.code === 'PGRST116') return false; // No rows found
            throw error;
        }
        
        return !!data;
    } catch (error) {
        console.error('[supabase] Check employee exists error:', error.message);
        throw error;
    }
}

// Update department head
async function updateDepartmentHead(deptId, headId) {
    if (!supabase) return null;
    
    try {
        console.log(`[updateDepartmentHead] Starting head assignment for dept ${deptId}, new head: ${headId}`);
        
        // Step 1: Get current department head
        const { data: deptData, error: deptError } = await supabase
            .from('departments')
            .select('head_id, dept_name')
            .eq('dept_id', deptId)
            .single();
            
        if (deptError) {
            console.error('[updateDepartmentHead] Error fetching department:', deptError);
            throw deptError;
        }
        
        const previousHeadId = deptData.head_id;
        console.log(`[updateDepartmentHead] Current head: ${previousHeadId}, New head: ${headId}`);
        
        // Step 2: If there's a previous head and we're either removing them or assigning someone different, demote them
        const isDifferentHead = !headId || (headId !== previousHeadId);
        console.log(`[updateDepartmentHead] isDifferentHead: ${isDifferentHead}, previousHeadId: ${previousHeadId}`);
        
        if (previousHeadId && isDifferentHead) {
            console.log(`[updateDepartmentHead] ===== DEMOTING PREVIOUS HEAD ${previousHeadId} =====`);
            console.log(`[updateDepartmentHead] Will update: employee_id=${previousHeadId} AND dept_id=${deptId}`);
            
            // First, get the previous head's employee record to see what we're demoting
            const { data: empBefore, error: empBeforeError } = await supabase
                .from('employees')
                .select('employee_id, full_name, position, dept_id')
                .eq('employee_id', previousHeadId);
                
            console.log(`[updateDepartmentHead] All employee records for employee_id ${previousHeadId}:`, empBefore);
            
            if (!empBeforeError && empBefore) {
                const targetEmployee = empBefore.find(e => e.dept_id === deptId);
                if (targetEmployee) {
                    console.log(`[updateDepartmentHead] BEFORE demotion - Employee ${previousHeadId} in dept ${deptId}: position="${targetEmployee.position}", dept_id=${targetEmployee.dept_id}`);
                } else {
                    console.log(`[updateDepartmentHead] WARNING: Employee ${previousHeadId} NOT FOUND in dept ${deptId}!`);
                }
            }
            
            // Update previous head's role to employee (role_id = 4)
            const { data: userData, error: demoteError } = await supabase
                .from('users')
                .update({ role_id: 4 })
                .eq('user_id', previousHeadId)
                .select();
                
            if (demoteError) {
                console.error('[updateDepartmentHead] Error demoting previous head in users table:', demoteError);
                throw demoteError;
            }
            console.log('[updateDepartmentHead] ✓ Users table updated for demotion:', userData);
            
            // Update previous head's position and dept_id in employees table
            // Make sure to only update the one in this department using both employee_id AND dept_id
            console.log(`[updateDepartmentHead] Attempting to update employees: WHERE employee_id=${previousHeadId} AND dept_id=${deptId}`);
            const { data: empData, error: empUpdateError } = await supabase
                .from('employees')
                .update({ 
                    position: 'Employee'
                    // IMPORTANT: Keep dept_id unchanged - employee stays in their department
                })
                .eq('employee_id', previousHeadId)
                .eq('dept_id', deptId)  // IMPORTANT: Also check they're in this department
                .select();
                
            if (empUpdateError) {
                console.error('[updateDepartmentHead] Error updating previous head in employees table:', empUpdateError);
                throw empUpdateError;
            }
            
            console.log('[updateDepartmentHead] ✓ Employees table update result:', empData);
            if (empData && empData.length > 0) {
                console.log(`[updateDepartmentHead] ✓✓ SUCCESS - Demotion completed for ${empData.length} row(s)`);
                console.log(`[updateDepartmentHead] AFTER demotion - Employee ${previousHeadId}: position="${empData[0].position}", dept_id=${empData[0].dept_id}`);
            } else {
                console.log(`[updateDepartmentHead] ✗✗ CRITICAL: NO ROWS UPDATED! Employee ${previousHeadId} may not be in dept ${deptId}`);
            }
            
            console.log(`[updateDepartmentHead] ===== DEMOTION COMPLETE =====`);
        } else {
            console.log(`[updateDepartmentHead] No demotion needed (previousHeadId: ${previousHeadId}, isDifferentHead: ${isDifferentHead})`);
        }
        
        // Step 3: If new head is being assigned (not null), promote them (role_id 4 -> 3)
        if (headId) {
            console.log(`[updateDepartmentHead] ===== PROMOTING NEW HEAD ${headId} =====`);
            console.log(`[updateDepartmentHead] Will update: employee_id=${headId} for dept ${deptId}`);
            
            // First, get the new head's employee record to see what we're promoting
            const { data: empBefore, error: empBeforeError } = await supabase
                .from('employees')
                .select('employee_id, full_name, position, dept_id')
                .eq('employee_id', headId);
                
            console.log(`[updateDepartmentHead] All employee records for employee_id ${headId}:`, empBefore);
            
            if (!empBeforeError && empBefore && empBefore.length > 0) {
                console.log(`[updateDepartmentHead] BEFORE promotion - Employee ${headId}: position="${empBefore[0].position}", dept_id=${empBefore[0].dept_id}`);
            }
            
            // Update new head's role to head_dept (role_id = 3)
            const { data: promoteData, error: promoteError } = await supabase
                .from('users')
                .update({ role_id: 3 })
                .eq('user_id', headId)
                .select();
                
            if (promoteError) {
                console.error('[updateDepartmentHead] Error promoting new head in users table:', promoteError);
                throw promoteError;
            }
            console.log('[updateDepartmentHead] ✓ Users table updated for promotion:', promoteData);
            
            // Update new head's position and dept_id in employees table
            console.log(`[updateDepartmentHead] Attempting to update employees: WHERE employee_id=${headId}`);
            const { data: newEmpData, error: newEmpError } = await supabase
                .from('employees')
                .update({ 
                    position: `Department Head - ${deptData.dept_name}`,
                    dept_id: deptId
                })
                .eq('employee_id', headId)
                .select();
                
            if (newEmpError) {
                console.error('[updateDepartmentHead] Error updating new head in employees table:', newEmpError);
                throw newEmpError;
            }
            console.log('[updateDepartmentHead] ✓ Employees table update result:', newEmpData);
            if (newEmpData && newEmpData.length > 0) {
                console.log(`[updateDepartmentHead] ✓✓ SUCCESS - Promotion completed for ${newEmpData.length} row(s)`);
                console.log(`[updateDepartmentHead] AFTER promotion - Employee ${headId}: position="${newEmpData[0].position}", dept_id=${newEmpData[0].dept_id}`);
            } else {
                console.log(`[updateDepartmentHead] ✗✗ CRITICAL: NO ROWS UPDATED! Employee ${headId} not found`);
            }
            
            console.log(`[updateDepartmentHead] ===== PROMOTION COMPLETE =====`);
        } else {
            console.log(`[updateDepartmentHead] No new head assigned - department head removed`);
        }
        
        // Step 4: Update department's head_id
        console.log(`[updateDepartmentHead] ===== UPDATING DEPARTMENTS TABLE =====`);
        console.log(`[updateDepartmentHead] Setting departments.head_id = ${headId || null} WHERE dept_id = ${deptId}`);
        
        const { data: updateData, error: updateError } = await supabase
            .from('departments')
            .update({ head_id: headId || null })
            .eq('dept_id', deptId)
            .select();
            
        if (updateError) {
            console.error('[updateDepartmentHead] ✗ Error updating department head_id:', updateError);
            throw updateError;
        }
        
        console.log('[updateDepartmentHead] ✓ Departments table update result:', updateData);
        if (updateData && updateData.length > 0) {
            console.log(`[updateDepartmentHead] ✓✓ SUCCESS - Department head_id set to ${updateData[0].head_id}`);
        } else {
            console.log(`[updateDepartmentHead] ✗✗ CRITICAL: NO ROWS UPDATED in departments table!`);
        }
        
        console.log(`[updateDepartmentHead] ===== ALL UPDATES COMPLETE =====`);
        console.log(`[updateDepartmentHead] SUCCESS - Department head successfully updated`);
        return updateData;
        
    } catch (error) {
        console.error('[supabase] Update department head error:', error.message);
        throw error;
    }
}

// Get user for first-time password validation
async function getUserForPasswordReset(userId) {
    if (!supabase) return null;
    
    try {
        const { data, error } = await supabase
            .from('users')
            .select('user_id, password_hash, first_login')
            .eq('user_id', userId)
            .limit(1)
            .single();
            
        if (error) {
            if (error.code === 'PGRST116') return null; // No rows found
            throw error;
        }
        
        return data;
    } catch (error) {
        console.error('[supabase] Get user for password reset error:', error.message);
        throw error;
    }
}

// Update user password hash (for non-RPC password updates)
async function updateUserPassword(userId, passwordHash) {
    if (!supabase) return null;
    
    try {
        const { data, error } = await supabase
            .from('users')
            .update({ 
                password_hash: passwordHash,
                first_login: false,
                updated_at: new Date().toISOString()
            })
            .eq('user_id', userId)
            .select();
            
        if (error) throw error;
        return data;
    } catch (error) {
        console.error('[supabase] Update user password error:', error.message);
        throw error;
    }
}

// Get filtered attendance data for HR/Admin
async function getFilteredAttendance({ startDate, endDate, employee, status, department }) {
    if (!supabase) return null;
    
    try {
        console.log('[getFilteredAttendance] Filters received:', { startDate, endDate, employee, status, department });
        
        // Use LEFT joins instead of INNER joins to avoid missing data
        // The issue is that !inner requires ALL related records to exist
        // LEFT joins will include attendance even if relationship is incomplete
        let query = supabase
            .from('attendance')
            .select(`
                employee_id,
                date,
                time_in,
                time_out,
                method,
                status,
                users(username),
                employees(
                    first_name,
                    last_name,
                    dept_id,
                    departments(dept_name)
                )
            `);

        // Apply date filters
        if (startDate) query = query.gte('date', startDate);
        if (endDate) query = query.lte('date', endDate);
        // Only default to today if NO filters at all (backward compatibility)
        // If employee filter is provided, don't default to today
        if (!startDate && !endDate && !employee && !status && !department) {
            const today = new Date().toISOString().slice(0,10);
            console.log('[getFilteredAttendance] No filters provided, defaulting to today:', today);
            query = query.eq('date', today);
        }

        // Apply employee filter (numeric only, name filtering is client-side)
        if (employee) {
            // If it's numeric, filter by employee_id, otherwise by username or name
            if (/^\d+$/.test(String(employee))) {
                console.log('[getFilteredAttendance] Filtering by numeric employee_id:', employee);
                query = query.eq('employee_id', parseInt(String(employee), 10));
            } else {
                console.log('[getFilteredAttendance] Non-numeric employee filter, will be done client-side:', employee);
            }
        }

        // Apply status filter (ignore if 'all')
        if (status && status !== 'all') query = query.eq('status', status);

        // Order by time_in descending
        query = query.order('time_in', { ascending: false, nullsFirst: false });

        const { data, error } = await query;
        if (error) throw error;
        
        console.log('[getFilteredAttendance] Query returned', data?.length || 0, 'records');

        // Apply department filter manually (can't use inner joins)
        let filteredData = data || [];
        if (department) {
            console.log('[getFilteredAttendance] Filtering by department:', department);
            filteredData = filteredData.filter(r => r.employees?.departments?.dept_name === department);
            console.log('[getFilteredAttendance] After department filter:', filteredData.length, 'records');
        }

        // Transform data to match expected format
        const formattedData = filteredData?.map(record => ({
            employee_id: record.employee_id,
            date: record.date,
            time_in: record.time_in,
            time_out: record.time_out,
            method: record.method,
            status: record.status,
            employee_username: record.users?.username,
            employee_name: `${record.employees?.first_name || ''} ${record.employees?.last_name || ''}`.trim(),
            employee_department: record.employees?.departments?.dept_name,
            timestamp: record.time_in
        })) || [];

        console.log('[getFilteredAttendance] Returning', formattedData.length, 'formatted records');
        if (formattedData.length > 0) {
            console.log('[getFilteredAttendance] Sample:', formattedData[0]);
        }
        return formattedData;
    } catch (error) {
        console.error('[supabase] Get filtered attendance error:', error.message);
        throw error;
    }
}

// Handle QR-based check-in
async function handleQRCheckin(sessionId, employeeId, lat, lon, deviceInfo) {
    if (!supabase) return null;
    
    try {
        console.log('[supabase] QR checkin attempt:', { sessionId, employeeId, lat, lon });
        
        // Get QR session
        const session = await getQRSession(sessionId);
        if (!session) {
            console.log('[supabase] Session not found:', sessionId);
            return { success: false, error: 'session not found' };
        }
        
        const now = new Date();
        if (!session.is_active) {
            console.log('[supabase] Session not active:', sessionId);
            return { success: false, error: 'session not active' };
        }
        
        if (session.expires_at && new Date(session.expires_at) < now) {
            console.log('[supabase] Session expired:', sessionId);
            return { success: false, error: 'session expired' };
        }
        
        // employeeId could be a user_id (number) or username (string)
        // Try to determine which and get the user_id
        let empId = null;
        
        if (typeof employeeId === 'number' || !isNaN(parseInt(employeeId))) {
            // It's a numeric ID, use directly
            empId = parseInt(employeeId);
            console.log('[supabase] Using numeric employee ID:', empId);
        } else {
            // It's a username, look it up
            console.log('[supabase] Looking up username:', employeeId);
            const employee = await getUserLookup(employeeId);
            if (!employee) {
                console.log('[supabase] Employee not found for username:', employeeId);
                return { success: false, error: 'employee not found' };
            }
            empId = employee.user_id;
            console.log('[supabase] Found user_id for username:', empId);
        }
        const date = now.toISOString().slice(0,10);
        console.log('[supabase] Checking attendance for date:', date, 'empId:', empId);
        
        // Check if already checked in today using existing helper
        const existingAttendance = await getTodayAttendance(empId, date);
        console.log('[supabase] Existing attendance check result:', existingAttendance);
        
        // If they already have a record:
        if (existingAttendance) {
            // If they have BOTH time_in and time_out, they already completed - reject
            if (existingAttendance.time_in && existingAttendance.time_out) {
                return { success: false, error: 'already completed today', record: existingAttendance };
            }
            // If they only have time_in (no time_out), this is a second scan for checkout - also reject check-in
            // but return the record so frontend knows they can checkout
            if (existingAttendance.time_in && !existingAttendance.time_out) {
                console.log('[supabase] Employee already checked in - they should checkout instead');
                return { success: false, error: 'already_checked_in', record: existingAttendance };
            }
        }
        
        // Get employee schedule
        const employeeSchedule = await getEmployeeSchedule(empId);
        
        // Determine status (late or present)
        let status = 'present';
        if (employeeSchedule && employeeSchedule.schedule_start_time) {
            const scheduleTime = new Date(`${date}T${employeeSchedule.schedule_start_time}`);
            scheduleTime.setMinutes(scheduleTime.getMinutes() + 5); // 5 minute grace period
            if (now > scheduleTime) {
                status = 'late';
            }
        }
        
        // Convert current time to UTC+8 (Philippine Time)
        const utc8Offset = 8 * 60; // 8 hours in minutes
        const localTime = new Date(now.getTime() + (utc8Offset * 60 * 1000));
        const timeIn = localTime.toISOString().split('T')[1].split('.')[0]; // HH:MM:SS
        
        console.log(`[supabase] Storing attendance - UTC time: ${now.toISOString()}, UTC+8 time: ${timeIn}`);
        
        // Insert attendance record
        const { data, error } = await supabase
            .from('attendance')
            .insert([{
                employee_id: empId,
                date: date,
                time_in: timeIn,
                method: 'qr_scan',
                status: status,
                checkin_session_id: sessionId  // Link to QR session for check-in scan
            }])
            .select()
            .single();
            
        if (error) throw error;
        
        // Format response for compatibility
        const dateStr = new Date(data.date).toISOString().split('T')[0];
        const fullTimestamp = new Date(`${dateStr}T${data.time_in}`).toISOString();
        
        const compatRecord = {
            attendance_id: data.attendance_id,
            employee_id: data.employee_id,
            date: data.date,
            time_in: data.time_in,
            time_out: data.time_out,
            method: data.method,
            status: data.status,
            timestamp: fullTimestamp
        };
        
        return { success: true, record: compatRecord };
        
    } catch (error) {
        console.error('[supabase] QR checkin error:', error.message);
        return { success: false, error: 'checkin failed: ' + error.message };
    }
}

// Handle QR-based check-out (mirrors handleQRCheckin logic)
async function handleQRCheckout(sessionId, employeeId) {
    if (!supabase) return null;
    
    try {
        console.log('[supabase] QR checkout attempt:', { sessionId, employeeId });
        
        // Get QR session
        const session = await getQRSession(sessionId);
        if (!session) {
            console.log('[supabase] Session not found:', sessionId);
            return { success: false, error: 'session not found' };
        }
        
        const now = new Date();
        if (!session.is_active) {
            console.log('[supabase] Session not active:', sessionId);
            return { success: false, error: 'session not active' };
        }
        
        if (session.expires_at && new Date(session.expires_at) < now) {
            console.log('[supabase] Session expired:', sessionId);
            return { success: false, error: 'session expired' };
        }
        
        // employeeId could be a user_id (number) or username (string)
        let empId = null;
        
        if (typeof employeeId === 'number' || !isNaN(parseInt(employeeId))) {
            empId = parseInt(employeeId);
            console.log('[supabase] Using numeric employee ID:', empId);
        } else {
            console.log('[supabase] Looking up username:', employeeId);
            const employee = await getUserLookup(employeeId);
            if (!employee) {
                console.log('[supabase] Employee not found for username:', employeeId);
                return { success: false, error: 'employee not found' };
            }
            empId = employee.user_id;
            console.log('[supabase] Found user_id for username:', empId);
        }
        
        const date = now.toISOString().slice(0,10);
        console.log('[supabase] Checking attendance for checkout - date:', date, 'empId:', empId);
        
        // Check if already checked in today
        const existingAttendance = await getTodayAttendance(empId, date);
        console.log('[supabase] Existing attendance check result:', existingAttendance);
        
        if (!existingAttendance) {
            return { success: false, error: 'no check-in record found' };
        }
        
        // If they already checked out today, reject
        if (existingAttendance.time_out) {
            return { success: false, error: 'already checked out today', record: existingAttendance };
        }
        
        // If no check-in time, reject
        if (!existingAttendance.time_in) {
            return { success: false, error: 'no check-in time recorded' };
        }
        
        // Convert current time to UTC+8 (Philippine Time)
        const utc8Offset = 8 * 60; // 8 hours in minutes
        const localTime = new Date(now.getTime() + (utc8Offset * 60 * 1000));
        const timeOut = localTime.toISOString().split('T')[1].split('.')[0]; // HH:MM:SS
        
        console.log(`[supabase] Storing checkout - UTC time: ${now.toISOString()}, UTC+8 time: ${timeOut}`);
        
        // Update attendance record with checkout info
        const { data, error } = await supabase
            .from('attendance')
            .update({
                time_out: timeOut,
                checkout_session_id: sessionId  // Link to QR session for check-out scan
            })
            .eq('employee_id', empId)
            .eq('date', date)
            .select()
            .single();
            
        if (error) throw error;
        
        // Format response for compatibility
        const dateStr = new Date(data.date).toISOString().split('T')[0];
        const fullTimestamp = new Date(`${dateStr}T${data.time_out}`).toISOString();
        
        const compatRecord = {
            attendance_id: data.attendance_id,
            employee_id: data.employee_id,
            date: data.date,
            time_in: data.time_in,
            time_out: data.time_out,
            method: data.method,
            status: data.status,
            checkin_session_id: data.checkin_session_id,
            checkout_session_id: data.checkout_session_id,
            timestamp: fullTimestamp
        };
        
        return { success: true, record: compatRecord };
        
    } catch (error) {
        console.error('[supabase] QR checkout error:', error.message);
        return { success: false, error: 'checkout failed: ' + error.message };
    }
}

// Deactivate a user (for admin operations)
async function deactivateUser(userId, adminId) {
    if (!supabase) return null;
    
    try {
        // Get target user's role and details
        const { data: userCheck, error: userCheckError } = await supabase
            .from('users')
            .select(`
                user_id,
                username,
                status,
                roles!inner(role_name),
                employees(first_name, last_name)
            `)
            .eq('user_id', userId)
            .single();
            
        if (userCheckError) {
            if (userCheckError.code === 'PGRST116') {
                return { success: false, error: 'User not found.' };
            }
            throw userCheckError;
        }
        
        const targetRole = userCheck.roles.role_name.toLowerCase();
        
        // Policy check: prevent self-deactivation of superadmin
        if (targetRole === 'superadmin' && userId === adminId) {
            return { success: false, error: 'You cannot deactivate your own superadmin account.' };
        }
        
        // Update user status to inactive
        const { data: updateData, error: updateError } = await supabase
            .from('users')
            .update({ 
                status: 'inactive',
                updated_at: new Date().toISOString()
            })
            .eq('user_id', userId)
            .select();
            
        if (updateError) throw updateError;
        
        if (!updateData || updateData.length === 0) {
            return { success: false, error: 'User not found.' };
        }
        
        // Prepare audit information
        const userName = userCheck.employees ? 
            `${userCheck.employees.first_name} ${userCheck.employees.last_name}` : 
            'Unknown User';
        const userEmail = userCheck.username || 'Unknown Email';
        const userRole = userCheck.roles.role_name || 'Unknown Role';
        
        // Log audit event
        const { error: auditError } = await supabase
            .from('audit_logs')
            .insert([{
                user_id: adminId,
                action_type: 'USER_DEACTIVATED',
                details: {
                    targetUserId: userId,
                    targetUserEmail: userEmail,
                    targetUserName: userName,
                    targetUserRole: userRole,
                    description: `Deactivated ${userRole} user: ${userName} (${userEmail})`
                }
            }]);
            
        if (auditError) {
            console.warn('[supabase] Audit log failed for user deactivation:', auditError.message);
        }
        
        return { success: true, data: updateData[0] };
        
    } catch (error) {
        console.error('[supabase] Deactivate user error:', error.message);
        return { success: false, error: 'Failed to deactivate user.' };
    }
}

// Reactivate a user (for admin operations)  
async function reactivateUser(userId, adminId) {
    if (!supabase) return null;
    
    try {
        // Get target user's details
        const { data: userCheck, error: userCheckError } = await supabase
            .from('users')
            .select(`
                user_id,
                username,
                status,
                roles!inner(role_name),
                employees(first_name, last_name)
            `)
            .eq('user_id', userId)
            .single();
            
        if (userCheckError) {
            if (userCheckError.code === 'PGRST116') {
                return { success: false, error: 'User not found.' };
            }
            throw userCheckError;
        }
        
        // Update user status to active
        const { data: updateData, error: updateError } = await supabase
            .from('users')
            .update({ 
                status: 'active',
                updated_at: new Date().toISOString()
            })
            .eq('user_id', userId)
            .select();
            
        if (updateError) throw updateError;
        
        if (!updateData || updateData.length === 0) {
            return { success: false, error: 'User not found.' };
        }
        
        // Prepare audit information
        const userName = userCheck.employees ? 
            `${userCheck.employees.first_name} ${userCheck.employees.last_name}` : 
            'Unknown User';
        const userEmail = userCheck.username || 'Unknown Email';
        const userRole = userCheck.roles.role_name || 'Unknown Role';
        
        // Log audit event
        const { error: auditError } = await supabase
            .from('audit_logs')
            .insert([{
                user_id: adminId,
                action_type: 'USER_REACTIVATED',
                details: {
                    targetUserId: userId,
                    targetUserEmail: userEmail,
                    targetUserName: userName,
                    targetUserRole: userRole,
                    description: `Reactivated ${userRole} user: ${userName} (${userEmail})`
                }
            }]);
            
        if (auditError) {
            console.warn('[supabase] Audit log failed for user reactivation:', auditError.message);
        }
        
        return { success: true, data: updateData[0] };
        
    } catch (error) {
        console.error('[supabase] Reactivate user error:', error.message);
        return { success: false, error: 'Failed to reactivate user.' };
    }
}

// Log audit events to Supabase
async function logAuditEvent(userId, actionType, details = {}) {
    if (!supabase) return false;
    
    try {
        const { error } = await supabase
            .from('audit_logs')
            .insert([{
                user_id: userId,
                action_type: actionType,
                details: details
            }]);
            
        if (error) throw error;
        
        console.log(`[audit] User ${userId} performed action: ${actionType}`);
        return true;
        
    } catch (error) {
        console.error('[supabase] Failed to log audit event:', error.message);
        return false;
    }
}

// Update system settings (batch update with upsert)
async function updateSystemSettings(settings, adminId) {
    if (!supabase) return { success: false, error: 'Supabase not available' };
    
    try {
        const updates = [];
        
        // Prepare all setting updates
        for (const key in settings) {
            if (Object.hasOwnProperty.call(settings, key)) {
                updates.push({
                    setting_key: key,
                    setting_value: settings[key],  // Store directly as JSONB value, no stringification
                    updated_at: new Date().toISOString()
                });
            }
        }
        
        if (updates.length === 0) {
            return { success: false, error: 'No settings to update' };
        }
        
        // Use upsert to insert or update settings
        const { error } = await supabase
            .from('system_settings')
            .upsert(updates, {
                onConflict: 'setting_key'
            });
            
        if (error) throw error;
        
        // Log audit event
        await logAuditEvent(adminId, 'SETTINGS_UPDATED', { updatedKeys: Object.keys(settings) });
        
        console.log(`[supabase] Updated ${updates.length} system settings`);
        return { success: true };
        
    } catch (error) {
        console.error('[supabase] Update system settings error:', error.message);
        return { success: false, error: error.message };
    }
}

// Check if employee email exists
async function checkEmployeeEmailExists(email) {
    if (!supabase) return null;
    
    try {
        const { data, error } = await supabase
            .from('employees')
            .select('employee_id')
            .eq('email', email)
            .limit(1)
            .single();
            
        if (error) {
            if (error.code === 'PGRST116') return false; // No rows found
            throw error;
        }
        
        return !!data;
    } catch (error) {
        console.error('[supabase] Check employee email exists error:', error.message);
        return null;
    }
}

// Check if user email exists
async function checkUserEmailExists(email) {
    if (!supabase) return null;
    
    try {
        const { data, error } = await supabase
            .from('users')
            .select('user_id')
            .eq('username', email)
            .limit(1)
            .single();
            
        if (error) {
            if (error.code === 'PGRST116') return false; // No rows found
            throw error;
        }
        
        return !!data;
    } catch (error) {
        console.error('[supabase] Check user email exists error:', error.message);
        return null;
    }
}

// Check if department exists and get basic info
async function getDepartmentById(deptId) {
    if (!supabase) return null;
    
    try {
        const { data, error } = await supabase
            .from('departments')
            .select('dept_id, dept_name')
            .eq('dept_id', deptId)
            .limit(1)
            .single();
            
        if (error) {
            if (error.code === 'PGRST116') return null; // No rows found
            throw error;
        }
        
        return data;
    } catch (error) {
        console.error('[supabase] Get department by ID error:', error.message);
        return null;
    }
}

// Get attendance record by employee ID and date
async function getAttendanceByEmployeeAndDate(employeeId, date) {
    if (!supabase) return null;
    
    try {
        const { data, error } = await supabase
            .from('attendance')
            .select('attendance_id, employee_id, date, time_in, time_out, status')
            .eq('employee_id', employeeId)
            .eq('date', date)
            .limit(1)
            .single();
            
        if (error) {
            if (error.code === 'PGRST116') return null; // No rows found
            throw error;
        }
        
        return data;
    } catch (error) {
        console.error('[supabase] Get attendance by employee and date error:', error.message);
        return null;
    }
}

// Create QR session directly (alternative to RPC for custom logic)
async function createQRSession(sessionId, expiresAt, creatorId, sessionType) {
    if (!supabase) return null;
    
    try {
        console.log('[supabase] Attempting to insert QR session:', { sessionId, expiresAt, sessionType });
        
        // Generate server ID - use 'server-' prefix for cloud, 'local-' for development
        const serverId = process.env.NODE_ENV === 'production' 
            ? `server-${Date.now()}`
            : `local-${Date.now()}`;
        
        console.log('[supabase] Generated server_id:', serverId);
        
        // Insert directly with session_id as primary key (no qr_id needed)
        const { data, error } = await supabase
            .from('qr_sessions')
            .insert({
                session_id: sessionId,
                expires_at: expiresAt.toISOString(),
                created_by: creatorId,
                session_type: sessionType,
                is_active: true,
                server_id: serverId
            })
            .select()
            .single();
            
        if (error) {
            console.error('[supabase] Insert error:', error.message);
            return null;
        }
        
        console.log('[supabase] QR session created successfully | session_id:', data.session_id);
        
        return {
            session_id: data.session_id,
            expires_at: data.expires_at,
            issued_at: data.created_at,
            type: data.session_type
        };
                
                // First, let's see what's actually in the table
                const { data: allSessions, error: listError } = await supabase
                    .from('qr_sessions')
                    .select('session_id')
                    .eq('is_active', true)
                    .limit(5);
                
                if (!listError) {
                    console.log('[supabase] Active sessions in DB:', allSessions.map(s => s.session_id));
                }
                
                // Now try to fetch this specific one
                const { data: existingData, error: fetchError } = await supabase
                    .from('qr_sessions')
                    .select()
                    .eq('session_id', sessionId)
                    .single();
                
                if (!fetchError && existingData) {
                    console.warn('[supabase] Found existing session, returning it');
                    return {
                        session_id: existingData.session_id,
                        expires_at: existingData.expires_at,
                        issued_at: existingData.created_at,
                        type: existingData.session_type
                    };
                } else if (fetchError) {
                    console.warn('[supabase] Session not found in DB, error:', fetchError.message);
                }
            }
            throw error;
        }
        
        console.log('[supabase] QR session created successfully:', {
            session_id: data.session_id
        });
        
        return {
            session_id: data.session_id,
            expires_at: data.expires_at,
            issued_at: data.created_at,
            type: data.session_type
        };
    } catch (error) {
        console.error('[supabase] Create QR session error:', error.message);
        return null;
    }
}

// Check if employee email exists for another employee (exclude specific employee ID)
async function checkEmployeeEmailExistsForOther(email, excludeEmployeeId) {
    if (!supabase) return null;
    
    try {
        const { data, error } = await supabase
            .from('employees')
            .select('employee_id')
            .eq('email', email)
            .neq('employee_id', excludeEmployeeId)
            .limit(1)
            .single();
            
        if (error) {
            if (error.code === 'PGRST116') return false; // No rows found
            throw error;
        }
        
        return !!data;
    } catch (error) {
        console.error('[supabase] Check employee email exists for other error:', error.message);
        return null;
    }
}

// Validate department head role
async function validateDepartmentHead(employeeId) {
  try {
    console.log('[validateDepartmentHead] Checking if employee can be promoted:', employeeId);
    
    // Query users table directly using user_id = employee_id (1:1 relationship)
    // Now we accept employees (role_id=4) since we'll promote them to head_dept (role_id=3)
    const { data, error } = await supabase
      .from('users')
      .select(`
        user_id,
        role_id,
        roles!inner(role_name)
      `)
      .eq('user_id', employeeId)
      .single();
    
    if (error) {
      console.error('[validateDepartmentHead] Error:', error.message);
      return null;
    }
    
    console.log('[validateDepartmentHead] Raw data:', JSON.stringify(data, null, 2));
    
    // Get employee info separately
    const { data: empData } = await supabase
      .from('employees')
      .select('employee_id, full_name')
      .eq('employee_id', employeeId)
      .single();
    
    const result = {
      employee_id: employeeId,
      full_name: empData?.full_name || 'Unknown',
      user_id: data.user_id,
      role_id: data.role_id,
      role_name: data.roles?.role_name
    };
    
    console.log('[validateDepartmentHead] Employee validation result:', JSON.stringify(result, null, 2));
    
    return result;
  } catch (err) {
    console.error('[validateDepartmentHead] Exception:', err.message);
    return null;
  }
}

// Attendance override operations
async function overrideAttendanceRecord(employeeId, date, attendanceData, creatorId) {
  try {
    const { time_in, time_out, status, reason } = attendanceData;
    
    // Check if record exists first
    const { data: existingRecord } = await supabase
      .from('attendance')
      .select('attendance_id')
      .eq('employee_id', employeeId)
      .eq('date', date)
      .single();
    
    let result;
    if (existingRecord) {
      // Update existing record
      const { data, error } = await supabase
        .from('attendance')
        .update({
          time_in: time_in,
          time_out: time_out,
          status: status,
          override_reason: reason,
          overridden_by: creatorId,
          overridden_at: new Date().toISOString()
        })
        .eq('employee_id', employeeId)
        .eq('date', date)
        .select('attendance_id, employee_id, date, time_in, time_out, status')
        .single();
      
      if (error) {
        console.error('Error updating attendance record:', error);
        return null;
      }
      result = { data, action: 'updated' };
    } else {
      // Create new record
      const { data, error } = await supabase
        .from('attendance')
        .insert({
          employee_id: employeeId,
          date: date,
          time_in: time_in,
          time_out: time_out,
          status: status,
          override_reason: reason,
          overridden_by: creatorId,
          overridden_at: new Date().toISOString()
        })
        .select('attendance_id, employee_id, date, time_in, time_out, status')
        .single();
      
      if (error) {
        console.error('Error creating attendance record:', error);
        return null;
      }
      result = { data, action: 'created' };
    }
    
    return result;
  } catch (err) {
    console.error('Exception in overrideAttendanceRecord:', err);
    return null;
  }
}

// Soft delete employee (deactivate)
async function deactivateEmployee(employeeId) {
  try {
    const { data, error } = await supabase
      .from('employees')
      .update({ status: 'inactive' })
      .eq('employee_id', employeeId)
      .select('employee_id, full_name, email')
      .single();
    
    if (error) {
      console.error('Error deactivating employee:', error);
      return null;
    }
    
    return data;
  } catch (err) {
    console.error('Exception in deactivateEmployee:', err);
    return null;
  }
}

// Update employee information
async function updateEmployee(employeeId, employeeData) {
  try {
    // Calculate full_name from first_name and last_name
    const fullName = `${employeeData.first_name} ${employeeData.last_name}`.trim();
    
    const { data, error } = await supabase
      .from('employees')
      .update({
        first_name: employeeData.first_name,
        last_name: employeeData.last_name,
        full_name: fullName,
        email: employeeData.email,
        phone: employeeData.phone,
        address: employeeData.address,
        position: employeeData.position,
        dept_id: employeeData.dept_id,
        status: employeeData.status
      })
      .eq('employee_id', employeeId)
      .select('employee_id, first_name, last_name, full_name, email, phone, address, position, dept_id, status, hire_date')
      .single();
    
    if (error) {
      console.error('Error updating employee:', error);
      return null;
    }
    
    return data;
  } catch (err) {
    console.error('Exception in updateEmployee:', err);
    return null;
  }
}

// HR employee creation with user account
async function createHREmployee(employeeData, creatorId) {
  try {
    const { 
      first_name, last_name, email, phone, address, position, 
      role, status, dept_id, hire_date, password 
    } = employeeData;
    
    // Hash the password
    const hashedPassword = await bcrypt.hash(password, 10);
    
    // Get role ID
    const { data: roleData, error: roleError } = await supabase
      .from('roles')
      .select('role_id')
      .eq('role_name', role)
      .single();
    
    if (roleError || !roleData) {
      console.error('Role not found:', roleError);
      return { success: false, error: `Role '${role}' not found in database` };
    }
    
    // Create user account first
    const { data: userData, error: userError } = await supabase
      .from('users')
      .insert({
        username: email,
        password_hash: hashedPassword,
        role_id: roleData.role_id,
        first_login: true,
        created_by: creatorId
      })
      .select('user_id')
      .single();
    
    if (userError) {
      console.error('Error creating user account:', userError);
      if (userError.code === '23505') { // Unique constraint violation
        return { success: false, error: 'A user with this email already exists.' };
      }
      return { success: false, error: 'Failed to create user account.' };
    }
    
    const userId = userData.user_id;
    
    // Auto-set position based on role if not provided
    let finalPosition = position;
    if (!finalPosition) {
      switch (role.toLowerCase()) {
        case 'superadmin':
          finalPosition = 'SuperAdmin';
          break;
        case 'hr':
          finalPosition = 'Human Resource';
          break;
        case 'head_dept':
          finalPosition = 'Department Head';
          break;
        default:
          finalPosition = position; // Keep original or null
      }
    }
    
    // Create employee record with matching employee_id
    const { data: newEmployeeData, error: employeeError } = await supabase
      .from('employees')
      .insert({
        employee_id: userId,
        first_name,
        last_name,
        email,
        phone,
        address,
        position: finalPosition,
        dept_id,
        hire_date,
        status,
        created_by: creatorId
      })
      .select()
      .single();
    
    if (employeeError) {
      console.error('Error creating employee record:', employeeError);
      // Should ideally rollback user creation, but for now log the issue
      return { success: false, error: 'Failed to create employee record.' };
    }
    
    return { 
      success: true, 
      employee: newEmployeeData,
      userId: userId,
      message: 'Employee created successfully.' 
    };
  } catch (err) {
    console.error('Exception in createHREmployee:', err);
    return { success: false, error: err.message || 'Failed to create employee.' };
  }
}

// Admin user update
async function updateAdminUser(userId, updateData, updaterId) {
  try {
    const { email, role, status, firstName, lastName, departmentId, password } = updateData;
    const auditDetails = { targetUserId: userId, changes: {} };
    
    // Update user table fields
    const userUpdates = {};
    if (email && email.trim()) {
      userUpdates.username = email.trim();
      auditDetails.changes.email = true;
    }
    if (status) {
      userUpdates.status = status;
      auditDetails.changes.status = status;
    }
    if (password && password.length > 0) {
      userUpdates.password_hash = await bcrypt.hash(password, 10);
      auditDetails.changes.passwordReset = true;
    }
    
    // Handle role update
    if (role) {
      const normalizedRole = String(role).toLowerCase();
      const allowedRoles = ['employee','head_dept','hr','superadmin'];
      if (!allowedRoles.includes(normalizedRole)) {
        return { success: false, error: 'Invalid role.' };
      }
      
      const { data: roleData, error: roleError } = await supabase
        .from('roles')
        .select('role_id')
        .ilike('role_name', normalizedRole)
        .single();
      
      if (roleError || !roleData) {
        return { success: false, error: 'Invalid role.' };
      }
      
      userUpdates.role_id = roleData.role_id;
      auditDetails.changes.role = role;
    }
    
    // Update user if there are changes
    if (Object.keys(userUpdates).length > 0) {
      userUpdates.updated_at = new Date().toISOString();
      
      const { error: userError } = await supabase
        .from('users')
        .update(userUpdates)
        .eq('user_id', userId);
      
      if (userError) {
        console.error('Error updating user:', userError);
        if (userError.code === '23505') { // Unique constraint violation
          return { success: false, error: 'A user with this email already exists.' };
        }
        return { success: false, error: 'Failed to update user.' };
      }
    }
    
    // Update employee table fields
    const empUpdates = {};
    if (firstName && firstName.trim()) {
      empUpdates.first_name = firstName.trim();
      auditDetails.changes.firstName = true;
    }
    if (lastName && lastName.trim()) {
      empUpdates.last_name = lastName.trim();
      auditDetails.changes.lastName = true;
    }
    if (departmentId !== undefined && departmentId !== null) {
      empUpdates.dept_id = departmentId;
      auditDetails.changes.departmentId = departmentId;
    }
    
    // Update employee if there are changes
    if (Object.keys(empUpdates).length > 0) {
      const { error: empError } = await supabase
        .from('employees')
        .update(empUpdates)
        .eq('employee_id', userId);
      
      if (empError) {
        console.warn(`No employee record found for user_id ${userId} to update details.`);
      }
    }
    
    return { success: true, auditDetails };
  } catch (err) {
    console.error('Exception in updateAdminUser:', err);
    return { success: false, error: err.message || 'Failed to update user.' };
  }
}

// Admin user creation
async function createAdminUser(userData, creatorId) {
  try {
    const { email, password, role, firstName, lastName, departmentId } = userData;
    
    // Hash the password
    const hashedPassword = await bcrypt.hash(password, 10);
    
    // Get role ID
    const { data: roleData, error: roleError } = await supabase
      .from('roles')
      .select('role_id')
      .ilike('role_name', role)
      .single();
    
    if (roleError || !roleData) {
      console.error('Invalid role specified:', roleError);
      return { success: false, error: 'Invalid role specified.' };
    }
    
    // Create user account
    const { data: newUserData, error: userError } = await supabase
      .from('users')
      .insert({
        username: email,
        password_hash: hashedPassword,
        role_id: roleData.role_id,
        created_by: creatorId
      })
      .select('user_id')
      .single();
    
    if (userError) {
      console.error('Error creating user:', userError);
      if (userError.code === '23505') { // Unique constraint violation
        return { success: false, error: 'A user with this email already exists.' };
      }
      return { success: false, error: 'Failed to create user account.' };
    }
    
    // Create employee record
    const { error: employeeError } = await supabase
      .from('employees')
      .insert({
        employee_id: newUserData.user_id,
        first_name: firstName,
        last_name: lastName,
        dept_id: departmentId,
        hire_date: new Date().toISOString().split('T')[0], // Today's date
        created_by: creatorId
      });
    
    if (employeeError) {
      console.error('Error creating employee record:', employeeError);
      // Should ideally rollback user creation, but for now log the issue
      return { success: false, error: 'Failed to create employee record.' };
    }
    
    return { 
      success: true, 
      userId: newUserData.user_id,
      message: `${role.toUpperCase()} user created successfully.` 
    };
  } catch (err) {
    console.error('Exception in createAdminUser:', err);
    return { success: false, error: err.message || 'Failed to create user.' };
  }
}

// Get pending requests with complex filtering
async function getPendingRequests(userAuth, department = null) {
  try {
    const { role, id } = userAuth;
    
    console.log('[getPendingRequests] Starting query...');
    console.log('[getPendingRequests] User role:', role);
    console.log('[getPendingRequests] User ID:', id);
    console.log('[getPendingRequests] Department filter:', department);
    
        // Use LEFT joins so requests are returned even when related employee/department records are missing
        let query = supabase
            .from('requests')
            .select(`
                request_id,
                type,
                details,
                status,
                created_at,
                employees!left(
                    full_name,
                    departments!left(
                        dept_name,
                        head_id
                    )
                )
            `)
      .eq('status', 'pending')
      .order('created_at', { ascending: true });
    
    // Apply filtering: prioritize department parameter if provided
    if (department) {
      console.log('[getPendingRequests] Applying department filter from parameter:', department);
      query = query.ilike('employees.departments.dept_name', department);
    } else if (role === 'head_dept') {
      console.log('[getPendingRequests] Applying head_dept filter: head_id ==', id);
      query = query.eq('employees.departments.head_id', id);
    }
    
    const { data, error } = await query;
    
    console.log('[getPendingRequests] Supabase query error:', error);
    console.log('[getPendingRequests] Supabase query data count:', data?.length || 0);
    console.log('[getPendingRequests] Raw data:', data);
    
    if (error) {
      console.error('Error getting pending requests:', error);
      return null;
    }
    
    // Format response to match expected structure
    const formattedData = data.map(request => {
      const startDate = request.details?.start_date || request.details?.date;
      const endDate = request.details?.end_date || request.details?.date;
      const reason = request.details?.reason || request.details?.description;
      
      return {
        id: request.request_id,
        request_type: request.type,
        details: request.details,
        status: request.status,
        employee_name: request.employees.full_name,
        dept_name: request.employees.departments.dept_name,
        start_date: startDate,
        end_date: endDate,
        reason: reason,
        raw_details: request.details
      };
    });
    
    console.log('[getPendingRequests] Formatted data:', formattedData);
    return formattedData;
  } catch (err) {
    console.error('Exception in getPendingRequests:', err);
    return null;
  }
}

// Simple departments list
async function getBasicDepartments() {
  try {
    const { data, error } = await supabase
      .from('departments')
      .select('dept_id, dept_name')
      .order('dept_name', { ascending: true });
    
    if (error) {
      console.error('Error getting basic departments:', error);
      return null;
    }
    
    return data;
  } catch (err) {
    console.error('Exception in getBasicDepartments:', err);
    return null;
  }
}

// Create a new department
async function createDepartment({ dept_name, description = null, head_id = null }) {
    if (!supabase) return { success: false, error: 'Supabase client not initialized' };

    try {
        const name = (dept_name || '').trim();
        if (!name) return { success: false, error: 'Department name is required' };

        // Check for existing department with same name (case-insensitive)
        try {
            const { data: existing, error: existingErr } = await supabase
                .from('departments')
                .select('dept_id')
                .ilike('dept_name', name)
                .limit(1)
                .maybeSingle();

            if (existingErr) {
                console.warn('[supabase] Department existence check error:', existingErr.message);
            }
            
            if (existing) {
                return { success: false, error: 'Department already exists' };
            }
        } catch (e) {
            // If the check errors, continue to attempt insert (we'll catch unique constraint on insert)
            console.warn('[supabase] Department existence check failed:', e && e.message);
        }

        const { data, error } = await supabase
            .from('departments')
            .insert({ dept_name: name, description, head_id })
            .select()
            .single();

        if (error) {
            console.error('[supabase] Create department error:', error.message || error);
            // Handle unique constraint gracefully
            if (String(error.message || '').toLowerCase().includes('unique') || error.code === '23505') {
                return { success: false, error: 'Department already exists' };
            }
            return { success: false, error: error.message || 'Failed to create department' };
        }

        return { success: true, department: data };
    } catch (err) {
        console.error('[supabase] Exception creating department:', err && err.message ? err.message : err);
        return { success: false, error: err.message || 'Failed to create department' };
    }
}

// Update department
async function updateDepartment(deptId, { dept_name, description = null, head_id = null }) {
    if (!supabase) return { success: false, error: 'Supabase client not initialized' };

    try {
        const name = (dept_name || '').trim();
        if (!name) return { success: false, error: 'Department name is required' };

        // Check if department exists
        const { data: existing, error: existingError } = await supabase
            .from('departments')
            .select('dept_id')
            .eq('dept_id', deptId)
            .single();

        if (existingError || !existing) {
            return { success: false, error: 'Department not found' };
        }

        // Check for duplicate name (excluding current department)
        try {
            const { data: duplicate, error: dupError } = await supabase
                .from('departments')
                .select('dept_id')
                .ilike('dept_name', name)
                .neq('dept_id', deptId)
                .limit(1)
                .maybeSingle();

            if (dupError) {
                console.warn('[supabase] Duplicate name check error:', dupError.message);
            }
            
            if (duplicate) {
                console.log('[supabase] Duplicate department name found:', duplicate);
                return { success: false, error: 'Department name already exists' };
            }
        } catch (dupErr) {
            // Log and continue — if supabase returns an unexpected error, surface it
            console.warn('[supabase] Duplicate name check failed (non-fatal):', dupErr && dupErr.message ? dupErr.message : dupErr);
        }

        const { data, error } = await supabase
            .from('departments')
            .update({ 
                dept_name: name, 
                description, 
                head_id
            })
            .eq('dept_id', deptId)
            .select()
            .single();

        if (error) {
            console.error('[supabase] Update department error:', error.message || error);
            return { success: false, error: error.message || 'Failed to update department' };
        }

        return { success: true, department: data };
    } catch (err) {
        console.error('[supabase] Exception updating department:', err && err.message ? err.message : err);
        return { success: false, error: err.message || 'Failed to update department' };
    }
}

// Delete department
async function deleteDepartment(deptId) {
    if (!supabase) return { success: false, error: 'Supabase client not initialized' };

    try {
        // Check if department exists
        const { data: existing, error: existingError } = await supabase
            .from('departments')
            .select('dept_id')
            .eq('dept_id', deptId)
            .single();

        if (existingError || !existing) {
            return { success: false, error: 'Department not found' };
        }

        // Check if any employees are assigned to this department
        const { data: employees, error: employeesError } = await supabase
            .from('employees')
            .select('employee_id')
            .eq('dept_id', deptId)
            .limit(1);

        if (employeesError) {
            console.error('[supabase] Error checking employees:', employeesError);
            return { success: false, error: 'Failed to check department dependencies' };
        }

        if (employees && employees.length > 0) {
            return { success: false, error: 'Cannot delete department with assigned employees' };
        }

        const { error } = await supabase
            .from('departments')
            .delete()
            .eq('dept_id', deptId);

        if (error) {
            console.error('[supabase] Delete department error:', error.message || error);
            return { success: false, error: error.message || 'Failed to delete department' };
        }

        return { success: true };
    } catch (err) {
        console.error('[supabase] Exception deleting department:', err && err.message ? err.message : err);
        return { success: false, error: err.message || 'Failed to delete department' };
    }
}

// Single employee lookup
async function getEmployeeById(employeeId) {
  try {
    const { data, error } = await supabase
      .from('employees')
      .select(`
        employee_id,
        first_name,
        last_name,
        full_name,
        email,
        phone,
        position,
        dept_id,
        departments(dept_name),
        status,
        hire_date,
        created_at,
        users(username, role_id, roles(role_name))
      `)
      .eq('employee_id', employeeId)
      .single();
    
    if (error) {
      console.error('Error getting employee by ID:', error);
      return null;
    }
    
    // Format response to match expected structure
    const result = {
      ...data,
      department: data.departments?.dept_name || null,
      username: data.users?.username || null,
      role: data.users?.roles?.role_name || null
    };
    
    // Clean up nested data
    delete result.departments;
    delete result.users;
    
    return result;
  } catch (err) {
    console.error('Exception in getEmployeeById:', err);
    return null;
  }
}

// Update user role
async function updateUserRole(userId, newRoleId) {
    try {
        const { data, error } = await supabase
            .from('users')
            .update({ 
                role_id: newRoleId,
                updated_at: new Date().toISOString()
            })
            .eq('user_id', userId)
            .select();
        
        if (error) throw error;
        return data[0];
    } catch (error) {
        console.error('[supabase] Update user role error:', error.message);
        throw error;
    }
}

// Get all roles
async function getAllRoles() {
    try {
        const { data, error } = await supabase
            .from('roles')
            .select('*')
            .order('role_name');
        
        if (error) throw error;
        return data;
    } catch (error) {
        console.error('[supabase] Get all roles error:', error.message);
        throw error;
    }
}

// ============ INVITATION SYSTEM FUNCTIONS ============

// Create a new invitation 
async function createInvitation(invitationData, creatorId) {
    if (!supabase) return null;
    
    try {
        const { email, role_id, dept_id, token_hash, expires_at, metadata } = invitationData;
        
        console.log('[createInvitation] Creating invitation with creatorId:', creatorId);
        console.log('[createInvitation] Invitation data:', invitationData);
        
        // Check if user already exists with this email
        const existingUser = await checkUserEmailExists(email);
        if (existingUser) {
            return { success: false, error: 'A user with this email already exists.' };
        }
        
        // RESTRAINT: Cancel any existing pending invitations for this email
        // This ensures only one active invitation per email address
        const { data: existingInvitations, error: fetchError } = await supabase
            .from('invitations')
            .select('id')
            .eq('email', email.toLowerCase().trim())
            .eq('used', false)
            .gt('expires_at', new Date().toISOString());
        
        if (fetchError) {
            console.error('[createInvitation] Error checking existing invitations:', fetchError);
            // Continue anyway - don't block on this error
        } else if (existingInvitations && existingInvitations.length > 0) {
            // Delete previous pending invitations for this email
            console.log(`[createInvitation] Canceling ${existingInvitations.length} previous invitation(s) for ${email}`);
            for (const inv of existingInvitations) {
                const { error: deleteError } = await supabase
                    .from('invitations')
                    .delete()
                    .eq('id', inv.id);
                
                if (deleteError) {
                    console.warn(`[createInvitation] Failed to delete old invitation ${inv.id}:`, deleteError);
                } else {
                    console.log(`[createInvitation] Cancelled previous invitation: ${inv.id}`);
                    // Log this cancellation
                    await logAuditEvent(creatorId, 'INVITATION_SUPERSEDED', {
                        oldInvitationId: inv.id,
                        email: email,
                        reason: 'New invitation created for same email'
                    });
                }
            }
        }
        
        // Create invitation record
        const { data, error } = await supabase
            .from('invitations')
            .insert({
                email: email.toLowerCase().trim(),
                role_id,
                dept_id,
                token_hash,
                expires_at,
                created_by: creatorId,
                metadata: metadata || {}
            })
            .select(`
                id,
                email,
                role_id,
                dept_id,
                expires_at,
                created_at,
                created_by,
                roles!inner(role_name),
                departments(dept_name)
            `)
            .single();
        
        console.log('[createInvitation] Insert result:', { data, error });
        
        if (error) {
            console.error('[supabase] Create invitation error:', error);
            if (error.code === '23505') { // Unique constraint violation
                return { success: false, error: 'An invitation for this email is already pending.' };
            }
            return { success: false, error: 'Failed to create invitation.' };
        }
        
        // Log audit event
        await logAuditEvent(creatorId, 'INVITATION_CREATED', {
            invitationId: data.id,
            email: data.email,
            role: data.roles.role_name,
            department: data.departments?.dept_name,
            expiresAt: data.expires_at
        });
        
        return {
            success: true,
            invitation: {
                id: data.id,
                email: data.email,
                role_name: data.roles.role_name,
                dept_name: data.departments?.dept_name,
                expires_at: data.expires_at,
                created_at: data.created_at
            }
        };
        
    } catch (error) {
        console.error('[supabase] Exception in createInvitation:', error.message);
        return { success: false, error: 'Failed to create invitation.' };
    }
}

// Verify invitation token and get invitation details
async function verifyInvitationToken(tokenHash) {
    if (!supabase) return null;
    
    try {
        const { data, error } = await supabase
            .from('invitations')
            .select(`
                id,
                email,
                role_id,
                dept_id,
                expires_at,
                used,
                used_at,
                created_by,
                roles!inner(role_name),
                departments(dept_name)
            `)
            .eq('token_hash', tokenHash)
            .single();
        
        if (error) {
            if (error.code === 'PGRST116') {
                return { valid: false, reason: 'Invalid invitation token' };
            }
            throw error;
        }
        
        // Check if already used
        if (data.used) {
            return { 
                valid: false, 
                reason: 'This invitation has already been used',
                used_at: data.used_at
            };
        }
        
        // Check if expired
        const now = new Date();
        const expiresAt = new Date(data.expires_at);
        if (now > expiresAt) {
            return { 
                valid: false, 
                reason: 'This invitation has expired',
                expires_at: data.expires_at
            };
        }
        
        // Fetch creator details separately to ensure we get the right user
        const { data: creatorData, error: creatorError } = await supabase
            .from('users')
            .select(`
                user_id,
                username
            `)
            .eq('user_id', data.created_by)
            .single();
        
        if (creatorError) {
            console.error('[verifyInvitationToken] Error fetching creator:', creatorError);
        }
        
        // Try to find creator's name by email (username field)
        let creatorName = 'System';
        
        if (creatorData?.username) {
            // Try to find employee by email (username is the email)
            const { data: empData } = await supabase
                .from('employees')
                .select('first_name, last_name')
                .eq('email', creatorData.username)
                .single();
            
            if (empData) {
                creatorName = `${empData.first_name} ${empData.last_name}`;
            } else {
                // Fallback to username if no employee found
                creatorName = creatorData.username;
            }
        }
        
        console.log('[verifyInvitationToken] Creator name resolved as:', creatorName, 'from user:', data.created_by);
            
        return {
            valid: true,
            invitation: {
                id: data.id,
                email: data.email,
                role_id: data.role_id,
                role_name: data.roles.role_name,
                dept_id: data.dept_id,
                dept_name: data.departments?.dept_name,
                expires_at: data.expires_at,
                created_by: data.created_by,
                invited_by: creatorName
            }
        };
        
    } catch (error) {
        console.error('[supabase] Verify invitation token error:', error.message);
        return { valid: false, reason: 'Token verification failed' };
    }
}

// Accept invitation and create user account
async function acceptInvitation(tokenHash, userData) {
    if (!supabase) return null;
    
    try {
        const { first_name, last_name, password } = userData;
        
        // First verify the token
        const verification = await verifyInvitationToken(tokenHash);
        if (!verification.valid) {
            return { success: false, error: verification.reason };
        }
        
        const invitation = verification.invitation;
        
        // Hash the password
        const hashedPassword = await bcrypt.hash(password, 10);
        
        // Start transaction by creating user first
        const { data: newUser, error: userError } = await supabase
            .from('users')
            .insert({
                username: invitation.email,
                password_hash: hashedPassword,
                role_id: invitation.role_id,
                status: 'active', // Set as active immediately, no first login required
                first_login: false, // No password change required
                created_by: invitation.created_by // Set the user who sent the invitation
            })
            .select('user_id')
            .single();
        
        if (userError) {
            console.error('[supabase] Create user error:', userError);
            if (userError.code === '23505') {
                return { success: false, error: 'A user with this email already exists.' };
            }
            return { success: false, error: 'Failed to create user account.' };
        }
        
        // Get position from invitation metadata or set based on role
        let position = invitation.metadata?.position;
        
        // Auto-set position based on role if not already provided
        if (!position) {
            switch (invitation.role_name.toLowerCase()) {
                case 'superadmin':
                    position = 'SuperAdmin';
                    break;
                case 'hr':
                    position = 'Human Resource';
                    break;
                case 'head_dept':
                    position = 'Department Head';
                    break;
                default:
                    position = null; // Will be set later for regular employees
            }
        }
        
        // Create employee record
        const { error: employeeError } = await supabase
            .from('employees')
            .insert({
                employee_id: newUser.user_id,
                first_name,
                last_name,
                email: invitation.email,
                dept_id: invitation.dept_id,
                hire_date: new Date().toISOString().split('T')[0],
                position: position,
                status: 'active', // Employee status active immediately
                created_by: invitation.created_by // Set the user who sent the invitation
            });
        
        if (employeeError) {
            console.error('[supabase] Create employee error:', employeeError);
            // TODO: Should rollback user creation in a real transaction
            return { success: false, error: 'Failed to create employee record.' };
        }
        
        // If this is a department head role, update the departments table
        if (invitation.role_name && invitation.role_name.toLowerCase() === 'head_dept' && invitation.dept_id) {
            const { data: updateData, error: deptError } = await supabase
                .from('departments')
                .update({
                    head_id: newUser.user_id
                })
                .eq('dept_id', invitation.dept_id)
                .select();
            
            if (deptError) {
                console.error('[supabase] Update department head error:', deptError);
                console.warn('[supabase] Department head assignment failed, but user/employee records created');
                // Don't return error here - user account was created successfully
            }
        }
        
        // Mark invitation as used
        const { error: inviteError } = await supabase
            .from('invitations')
            .update({
                used: true,
                used_by: newUser.user_id,
                used_at: new Date().toISOString()
            })
            .eq('id', invitation.id);
        
        if (inviteError) {
            console.warn('[supabase] Failed to mark invitation as used:', inviteError.message);
        }
        
        // Log audit event
        await logAuditEvent(newUser.user_id, 'INVITATION_ACCEPTED', {
            invitationId: invitation.id,
            email: invitation.email,
            role: invitation.role_name,
            department: invitation.dept_name
        });
        
        return {
            success: true,
            user: {
                user_id: newUser.user_id,
                email: invitation.email,
                role: invitation.role_name,
                department: invitation.dept_name,
                first_name,
                last_name
            }
        };
        
    } catch (error) {
        console.error('[supabase] Exception in acceptInvitation:', error.message);
        return { success: false, error: 'Failed to accept invitation.' };
    }
}

// Get pending invitations (for admin view)
async function getPendingInvitations(filters = {}) {
    if (!supabase) return null;
    
    try {
        const { role, department, limit = 50, offset = 0 } = filters;
        
        let query = supabase
            .from('invitations')
            .select(`
                id,
                email,
                expires_at,
                created_at,
                created_by,
                roles!inner(role_name),
                departments(dept_name),
                users!invitations_created_by_fkey(
                    user_id,
                    username
                )
            `)
            .eq('used', false)
            .gt('expires_at', new Date().toISOString())
            .order('created_at', { ascending: false })
            .range(parseInt(offset), parseInt(offset) + parseInt(limit) - 1);
        
        if (role && role !== 'all') {
            query = query.eq('roles.role_name', role);
        }
        
        if (department && department !== 'all') {
            query = query.eq('departments.dept_name', department);
        }
        
        const { data, error } = await query;
        if (error) throw error;

        // Now fetch employee names for the creators
        const invitations = await Promise.all(data.map(async (invite) => {
            let createdBy = 'System';
            
            // Try to find employee by email (username is the email)
            if (invite.users?.username) {
                const { data: empData } = await supabase
                    .from('employees')
                    .select('first_name, last_name')
                    .eq('email', invite.users.username)
                    .single();
                
                if (empData) {
                    createdBy = `${empData.first_name} ${empData.last_name}`;
                } else {
                    // Fallback to username if no employee found
                    createdBy = invite.users.username;
                }
            }
            
            return {
                id: invite.id,
                email: invite.email,
                role_name: invite.roles.role_name,
                dept_name: invite.departments?.dept_name,
                created_by: createdBy,
                created_at: invite.created_at,
                expires_at: invite.expires_at
            };
        }));
        
        return invitations;
        
    } catch (error) {
        console.error('[supabase] Get pending invitations error:', error.message);
        return null;
    }
}

// Get single invitation by ID
async function getInvitationById(invitationId) {
    if (!supabase) return null;
    
    try {
        const { data: invite, error } = await supabase
            .from('invitations')
            .select(`
                id,
                email,
                expires_at,
                created_at,
                created_by,
                roles!inner(role_name),
                departments(dept_name),
                users!invitations_created_by_fkey(
                    user_id,
                    username
                )
            `)
            .eq('id', invitationId)
            .single();
        
        if (error) throw error;
        if (!invite) return null;

        let createdBy = 'System';
        if (invite.users?.username) {
            const { data: empData } = await supabase
                .from('employees')
                .select('first_name, last_name')
                .eq('email', invite.users.username)
                .single();
            
            if (empData) {
                createdBy = `${empData.first_name} ${empData.last_name}`;
            } else {
                createdBy = invite.users.username;
            }
        }
        
        return {
            id: invite.id,
            email: invite.email,
            role_name: invite.roles.role_name,
            dept_name: invite.departments?.dept_name,
            created_by: createdBy,
            created_at: invite.created_at,
            expires_at: invite.expires_at
        };
        
    } catch (error) {
        console.error('[supabase] Get invitation by ID error:', error.message);
        return null;
    }
}

// Resend invitation (create new token, invalidate old)
async function resendInvitation(invitationId, newTokenHash, newExpiresAt, adminId) {
    if (!supabase) return null;
    
    try {
        // Update invitation with new token and expiry
        const { data, error } = await supabase
            .from('invitations')
            .update({
                token_hash: newTokenHash,
                expires_at: newExpiresAt,
                created_at: new Date().toISOString() // Reset created time for new token
            })
            .eq('id', invitationId)
            .eq('used', false) // Only update unused invitations
            .select(`
                id,
                email,
                expires_at,
                roles!inner(role_name),
                departments(dept_name)
            `)
            .single();
        
        if (error) {
            if (error.code === 'PGRST116') {
                return { success: false, error: 'Invitation not found or already used.' };
            }
            throw error;
        }
        
        // Log audit event
        await logAuditEvent(adminId, 'INVITATION_RESENT', {
            invitationId: data.id,
            email: data.email,
            role: data.roles.role_name,
            department: data.departments?.dept_name,
            newExpiresAt: data.expires_at
        });
        
        return {
            success: true,
            invitation: {
                id: data.id,
                email: data.email,
                role_name: data.roles.role_name,
                dept_name: data.departments?.dept_name,
                expires_at: data.expires_at
            }
        };
        
    } catch (error) {
        console.error('[supabase] Resend invitation error:', error.message);
        return { success: false, error: 'Failed to resend invitation.' };
    }
}

// Cancel/revoke invitation
async function cancelInvitation(invitationId, adminId) {
    if (!supabase) return null;
    
    try {
        const { data, error } = await supabase
            .from('invitations')
            .delete()
            .eq('id', invitationId)
            .eq('used', false) // Only delete unused invitations
            .select(`
                id,
                email,
                roles!inner(role_name),
                departments(dept_name)
            `)
            .single();
        
        if (error) {
            if (error.code === 'PGRST116') {
                return { success: false, error: 'Invitation not found or already used.' };
            }
            throw error;
        }
        
        // Log audit event
        await logAuditEvent(adminId, 'INVITATION_CANCELLED', {
            invitationId: data.id,
            email: data.email,
            role: data.roles.role_name,
            department: data.departments?.dept_name
        });
        
        return { success: true };
        
    } catch (error) {
        console.error('[supabase] Cancel invitation error:', error.message);
        return { success: false, error: 'Failed to cancel invitation.' };
    }
}

// Session management operations
async function forceLogoutSession(sessionId) {
  try {
    // Step 1: Update user_sessions table to mark logout
    const { data, error } = await supabase
      .from('user_sessions')
      .update({ 
        logout_time: new Date().toISOString()
      })
      .eq('session_id', sessionId)
      .is('logout_time', null)
      .select('user_id')
      .single();
    
    if (error) {
      console.error('Error forcing logout session:', error);
      return null;
    }
    
    if (data && data.user_id) {
      // Step 2: Revoke all refresh tokens for this user to force immediate logout
      console.log(`[forceLogoutSession] Revoking all refresh tokens for user ${data.user_id}`);
      const { error: revokeError } = await supabase
        .from('refresh_tokens')
        .update({
          revoked: true,
          revoked_at: new Date().toISOString()
        })
        .eq('user_id', data.user_id)
        .eq('revoked', false);
      
      if (revokeError) {
        console.error('[forceLogoutSession] Error revoking refresh tokens:', revokeError);
        // Continue anyway - session is logged out even if token revocation fails
      } else {
        console.log(`[forceLogoutSession] Successfully revoked refresh tokens for user ${data.user_id}`);
      }
    }
    
    return data;
  } catch (err) {
    console.error('Exception in forceLogoutSession:', err);
    return null;
  }
}

async function approveRequestWithNotification(requestId, status, approverId, approverRole) {
  try {
    // If department head, check permission first
    if (approverRole === 'department_head') {
      const { data: permissionCheck, error: permError } = await supabase
        .from('requests')
        .select(`
          *,
          employees!inner(
            dept_id,
            departments!inner(head_id)
          )
        `)
        .eq('request_id', requestId)
        .eq('employees.departments.head_id', approverId)
        .single();
      
      if (permError || !permissionCheck) {
        console.error('Permission check failed:', permError);
        throw new Error('Forbidden: You can only approve requests from your department.');
      }
    }

    // Update request status
    const { data: updatedRequest, error: updateError } = await supabase
      .from('requests')
      .update({ 
        status: status,
        approved_by: approverId,
        updated_at: new Date().toISOString()
      })
      .eq('request_id', requestId)
      .eq('status', 'pending')
      .select()
      .single();
    
    if (updateError || !updatedRequest) {
      console.error('Error updating request:', updateError);
      throw new Error('Request not found, already actioned, or you do not have permission.');
    }
    
    // Create notification
    const message = `Your ${updatedRequest.type} request (ID: ${updatedRequest.request_id}) has been ${status}.`;
    const { error: notifError } = await supabase
      .from('notifications')
      .insert({
        user_id: updatedRequest.employee_id,
        message: message,
        status: 'unread'
      });
    
    if (notifError) {
      console.error('Error creating notification:', notifError);
      // Don't fail the whole operation for notification error
    } else {
      console.log(`[notifications] Created notification for user ${updatedRequest.employee_id}`);
    }
    
    return updatedRequest;
  } catch (err) {
    console.error('Exception in approveRequestWithNotification:', err);
    throw err;
  }
}

// Request approval operations
async function updateRequestStatus(requestId, status, approverId) {
  try {
    const { data, error } = await supabase
      .from('requests')
      .update({ 
        status: status,
        approved_by: approverId,
        updated_at: new Date().toISOString()
      })
      .eq('request_id', requestId)
      .eq('status', 'pending')
      .select()
      .single();
    
    if (error) {
      console.error('Error updating request status:', error);
      return null;
    }
    
    return data;
  } catch (err) {
    console.error('Exception in updateRequestStatus:', err);
    return null;
  }
}

async function approveRequestWithChecks(requestId, status, approverId, employeeId) {
  try {
    // Check if the request exists and the approver has permission
    const { data: checkData, error: checkError } = await supabase
      .from('requests')
      .select(`
        *,
        employees!inner(*)
      `)
      .eq('request_id', requestId)
      .eq('employees.employee_id', employeeId)
      .single();
    
    if (checkError || !checkData) {
      console.error('Error checking request permission:', checkError);
      return null;
    }
    
    // Update the request
    const { data, error } = await supabase
      .from('requests')
      .update({ 
        status: status,
        approved_by: approverId,
        updated_at: new Date().toISOString()
      })
      .eq('request_id', requestId)
      .select()
      .single();
    
    if (error) {
      console.error('Error approving request:', error);
      return null;
    }
    
    return data;
  } catch (err) {
    console.error('Exception in approveRequestWithChecks:', err);
    return null;
  }
}

// Helper: run arbitrary SQL via RPC or direct query is not recommended here; prefer table selects
module.exports = {
  supabase,
  findUserByEmail,
  isSupabaseEnabled: () => !!supabase,
  // RPC functions
  rpcLogin,
  rpcLogout,
  rpcChangeFirstPassword,
  rpcAttendanceCheckin,
  rpcAttendanceCheckout,
  rpcAttendanceBreak,
  rpcQrGenerateSession,
  rpcQrRevokeSession,
  rpcProfileUpdate,
  // Read helpers
  getProfile,
  getAttendanceHistory,
  validateSession,
  getEmployeeByEmail,
  getNotifications,
  markNotificationsRead,
  getRequests,
  createRequest,
  // Admin helpers
  getAdminUsers,
  getSystemSettings,
  getAuditLogs,
  getActiveSessions,
  // HR helpers
  getCurrentQRSession,
  getHREmployees,
  getHRAttendance,
  getDepartments,
    createDepartment,
  // Additional REST helpers
  getUserLookup,
  getQRSession,
  getScanCountForSession,
  getEmployeeSchedule,
  getSchedulesByDateRange,
  getTodayAttendance,
  deactivateExpiredQRSessions,
  deactivateAllQRSessions,
  getAllSystemSettings,
  checkEmployeeExists,
  updateDepartmentHead,
  getUserForPasswordReset,
  updateUserPassword,
  getFilteredAttendance,
  handleQRCheckin,
  handleQRCheckout,
  deactivateUser,
  reactivateUser,
  logAuditEvent,
  updateSystemSettings,
  checkEmployeeEmailExists,
  checkUserEmailExists,
  getDepartmentById,
  getAttendanceByEmployeeAndDate,
  createQRSession,
  checkEmployeeEmailExistsForOther,
  // Employee operations
  getEmployeeById,
  getBasicDepartments,
  createHREmployee,
  getDepartmentHeads,
  updateAdminUser,
  createAdminUser,
  updateEmployee,
  deactivateEmployee,
  validateDepartmentHead,
  // Attendance operations
  overrideAttendanceRecord,
  // Request operations
  updateRequestStatus,
  approveRequestWithChecks,
  approveRequestWithNotification,
  getPendingRequests,
  // Session operations
  forceLogoutSession,
  // Role operations
  updateUserRole,
  getAllRoles,
  // Department operations
  createDepartment,
  updateDepartment,
  deleteDepartment,
  // Invitation operations
  createInvitation,
  verifyInvitationToken,
  acceptInvitation,
  getPendingInvitations,
  getInvitationById,
  resendInvitation,
  cancelInvitation
};
