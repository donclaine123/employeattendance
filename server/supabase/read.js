// ============================================================
// READ & FETCH HELPER FUNCTIONS
// ============================================================

const { supabase } = require('./init');

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
        if (data && data.employees) {
            const nestedEmp = Array.isArray(data.employees) && data.employees.length > 0
                ? data.employees[0]
                : data.employees;
            if (nestedEmp && nestedEmp.employee_id && Number(nestedEmp.employee_id) !== Number(userId)) {
                console.warn('[supabase] Ignoring nested employee that does not match user_id', { userId, nestedEmployeeId: nestedEmp.employee_id });
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
                            console.log('[supabase] Ignoring ambiguous employee fallback match for user', userId, { candidateEmail, usernameEmail });
                        }
                    }
                }
            } catch (e) {
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
                    pin_hash: employee.pin_hash,
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

async function getEmployeeByEmail(email) {
    if (!supabase) return null;
    
    try {
        console.log('[supabase] Looking up employee for email:', email);
        const trimmedEmail = email.trim().toLowerCase();
        
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
                    console.log('[supabase] Employee not found in either table for:', email);
                    return null;
                }
                throw empResult.error;
            }
            
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
        
        const employee = Array.isArray(data.employees) && data.employees.length > 0 
            ? data.employees[0] 
            : data.employees;
            
        if (!employee) {
            console.log('[supabase] No employee data found for email:', email);
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
            
        if (userAuth.role === 'employee') {
            if (!userAuth.employee_id) {
                console.warn('[getRequests] Employee role but no employee_id in auth');
                return [];
            }
            query = query.eq('employee_id', userAuth.employee_id);
        } else if (userAuth.role === 'department_head') {
            if (!userAuth.id) {
                console.warn('[getRequests] Department head role but no id in auth');
                return [];
            }
            query = query.eq('employees.departments.head_id', userAuth.id);
        }
        
        if (filters.status) {
            query = query.eq('status', filters.status);
        }
        if (filters.type) {
            query = query.eq('type', filters.type);
        }
        
        const { data, error } = await query;
        if (error) throw error;
        
        return data.map(request => ({
            ...request,
            request_type: request.type,
            employee_name: request.employees?.full_name,
            dept_name: request.employees?.departments?.dept_name
        }));
    } catch (error) {
        console.error('[supabase] Get requests error:', error.message);
        console.error('[supabase] Get requests error details:', error);
        throw error;
    }
}

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
        
        if (data) {
            data.request_type = data.type;
        }
        
        return data;
    } catch (error) {
        console.error('[supabase] Create request error:', error.message);
        throw error;
    }
}

module.exports = {
    getProfile,
    getAttendanceHistory,
    validateSession,
    getEmployeeByEmail,
    getNotifications,
    markNotificationsRead,
    getRequests,
    createRequest
};
