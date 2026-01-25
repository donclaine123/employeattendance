const { supabase } = require('./init');

// ============================================================
// VALIDATION & EXISTENCE CHECKS
// ============================================================

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

// ============================================================
// ATTENDANCE HELPERS
// ============================================================

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
        throw error;
    }
}

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

// ============================================================
// PASSWORD & USER HELPERS
// ============================================================

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

// ============================================================
// USER ROLE & ROLE HELPERS
// ============================================================

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

// ============================================================
// USER ACTIVATION/DEACTIVATION
// ============================================================

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

// ============================================================
// AUDIT & LOGGING
// ============================================================

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

// ============================================================
// SYSTEM SETTINGS
// ============================================================

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

module.exports = {
    // Validation
    checkEmployeeExists,
    checkEmployeeEmailExists,
    checkUserEmailExists,
    checkEmployeeEmailExistsForOther,
    // Attendance
    getAttendanceByEmployeeAndDate,
    getFilteredAttendance,
    // Password & User
    getUserForPasswordReset,
    updateUserPassword,
    // Roles
    updateUserRole,
    getAllRoles,
    // User activation
    deactivateUser,
    reactivateUser,
    // Audit & Logging
    logAuditEvent,
    // System Settings
    getAllSystemSettings,
    updateSystemSettings
};
