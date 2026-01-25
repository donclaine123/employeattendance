const { supabase } = require('./init');

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

// Get employees who can be assigned as department heads
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

module.exports = {
    getCurrentQRSession,
    getHREmployees,
    getHRAttendance,
    getDepartmentHeads
};
