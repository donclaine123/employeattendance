// ============================================================
// ADMIN & SYSTEM FUNCTIONS
// ============================================================

const { supabase } = require('./init');
const { transformRoleName } = require('./init');

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
        
        console.log('[getAdminUsers] Fetched users:', data.length);

        // Get employee data - fetch all employees and match by email since employee_id may not equal user_id
        const { data: allEmployeeData, error: empError } = await supabase
            .from('employees')
            .select(`
                employee_id,
                email,
                full_name,
                first_name,
                last_name,
                dept_id
            `);
            
        if (empError) console.warn('[supabase] Employee data fetch error:', empError.message);
        console.log('[getAdminUsers] Fetched employees:', allEmployeeData?.length || 0);
        console.log('[getAdminUsers] Sample employees:', allEmployeeData?.slice(0, 3).map(e => ({ email: e.email, dept_id: e.dept_id })));

        // Get departments for employees
        const { data: deptData, error: deptError } = await supabase
            .from('departments')
            .select('dept_id, dept_name');
            
        if (deptError) console.warn('[supabase] Department data fetch error:', deptError.message);
        console.log('[getAdminUsers] Fetched departments:', deptData?.map(d => ({ dept_id: d.dept_id, dept_name: d.dept_name })));
        
        // Create a map of departments by dept_id
        const departmentMap = new Map();
        if (deptData) {
            deptData.forEach(dept => {
                departmentMap.set(dept.dept_id, dept.dept_name);
            });
        }
        
        // Create a map of employee data by email for matching with users
        const employeeMap = new Map();
        if (allEmployeeData) {
            allEmployeeData.forEach(emp => {
                if (emp.email) {
                    employeeMap.set(emp.email.toLowerCase(), emp);
                }
            });
        }
        
        console.log('[getAdminUsers] Employee map size:', employeeMap.size);
        
        // Format the data
        const formattedData = data.map(user => {
            // Get the most recent login time
            const lastLoginTime = user.user_sessions && user.user_sessions.length > 0 
                ? Math.max(...user.user_sessions.map(s => new Date(s.login_time).getTime()))
                : null;
                
            const lastLogin = lastLoginTime ? new Date(lastLoginTime).toISOString() : null;
            
            // Get employee data for this user - match by email
            const employeeInfo = employeeMap.get(user.username.toLowerCase()) || {};
            console.log(`[getAdminUsers] User ${user.username}: dept_id=${employeeInfo.dept_id}, dept_name=${departmentMap.get(employeeInfo.dept_id)}`);
            
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
                department_name: employeeInfo.dept_id ? departmentMap.get(employeeInfo.dept_id) : null,
                created_at: user.created_at,
                last_modified_by: 'System',
                last_login: lastLogin
            };
        });
        
        return { users: formattedData, total: count || 0 };
    } catch (error) {
        console.error('[supabase] Get admin users error:', error.message);
        throw error;
    }
}

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
            settings[row.setting_key] = row.setting_value;
        });
        
        return settings;
    } catch (error) {
        console.error('[supabase] Get system settings error:', error.message);
        throw error;
    }
}

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
        
        // Flatten the data and transform role names in details
        return data.map(log => ({
            ...log,
            username: log.users?.username,
            details: {
                ...log.details,
                role: log.details?.role ? transformRoleName(log.details.role) : log.details?.role,
                targetUserRole: log.details?.targetUserRole ? transformRoleName(log.details.targetUserRole) : log.details?.targetUserRole
            }
        }));
    } catch (error) {
        console.error('[supabase] Get audit logs error:', error.message);
        throw error;
    }
}

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

module.exports = {
    getAdminUsers,
    getSystemSettings,
    getAuditLogs,
    getActiveSessions
};
