const { supabase } = require('./init');

// Get QR session by ID
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
        const now = new Date().toISOString();
        console.log('[QR Auto] Cleanup: Checking for expired sessions (now:', now + ')');
        
        // First, query to see what we have
        const { data: allSessions, error: queryError } = await supabase
            .from('qr_sessions')
            .select('session_id, created_at, expires_at, is_active')
            .eq('is_active', true)
            .order('created_at', { ascending: false })
            .limit(5);
        
        if (!queryError && allSessions && allSessions.length > 0) {
            console.log('[QR Auto] Cleanup: Found', allSessions.length, 'active session(s):');
            allSessions.forEach(s => {
                const isExpired = new Date(s.expires_at) < new Date(now);
                console.log('  -', s.session_id, '| expires:', s.expires_at, '| expired:', isExpired);
            });
        }
        
        // Now deactivate expired ones (also update sync_updated_at so local database will pull the change)
        const { data, error } = await supabase
            .from('qr_sessions')
            .update({ 
                is_active: false,
                sync_updated_at: now  // Update sync timestamp so local DB will pull this change
            })
            .lt('expires_at', now)
            .eq('is_active', true);
            
        if (error) throw error;
        
        const count = data ? data.length : 0;
        console.log('[QR Auto] Cleanup: Deactivated', count, 'expired session(s) and updated sync timestamp');
        
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
        const now = new Date().toISOString();
        // Mark all active sessions as inactive (keep records for audit trail)
        // Also update sync_updated_at so local database will pull the changes
        const { data, error } = await supabase
            .from('qr_sessions')
            .update({ 
                is_active: false,
                sync_updated_at: now  // Update sync timestamp for bidirectional sync
            })
            .eq('is_active', true);
            
        if (error) throw error;
        return data;
    } catch (error) {
        console.error('[supabase] Deactivate all QR sessions error:', error.message);
        throw error;
    }
}

// Get employee record by employee_id
async function getEmployeeSchedule(employeeId) {
    if (!supabase) return null;
    
    try {
        const { data, error } = await supabase
            .from('employees')
            .select('employee_id')
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
        
        // Helper: lookup user by email
        const getUserLookup = async (identifier) => {
            const { data, error } = await supabase
                .from('users')
                .select('user_id, username')
                .eq('username', identifier)
                .limit(1)
                .single();
                
            if (error) {
                if (error.code === 'PGRST116') return null;
                throw error;
            }
            
            return data;
        };
        
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
        
        // Check if already checked in today
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
        
        // VALIDATE: Ensure employee exists in employees table (not just users table)
        const { data: empCheck, error: empCheckError } = await supabase
            .from('employees')
            .select('employee_id')
            .eq('employee_id', empId)
            .single();
        
        if (!empCheck || empCheckError) {
            console.error('[supabase] Employee not found in employees table:', empId);
            return { success: false, error: 'employee profile not found - contact admin to create employee record' };
        }
        
        // Lateness is no longer derived from per-employee schedule columns.
        const status = 'present';
        
        // Convert current time to UTC+8 (Philippine Time)
        const utc8Offset = 8 * 60; // 8 hours in minutes
        const localTime = new Date(now.getTime() + (utc8Offset * 60 * 1000));
        const timeIn = localTime.toISOString().split('T')[1].split('.')[0]; // HH:MM:SS
        
        console.log(`[supabase] Storing attendance - UTC time: ${now.toISOString()}, UTC+8 time: ${timeIn}`);
        
        // Insert or update attendance record (upsert handles existing records)
        const { data, error } = await supabase
            .from('attendance')
            .upsert([{
                employee_id: empId,
                date: date,
                time_in: timeIn,
                method: 'qr_scan',
                status: status,
                checkin_session_id: sessionId  // Link to QR session for check-in scan
            }], { onConflict: 'employee_id,date' })
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

// Handle QR-based check-out
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
        
        // Helper: lookup user by email
        const getUserLookup = async (identifier) => {
            const { data, error } = await supabase
                .from('users')
                .select('user_id, username')
                .eq('username', identifier)
                .limit(1)
                .single();
                
            if (error) {
                if (error.code === 'PGRST116') return null;
                throw error;
            }
            
            return data;
        };
        
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

// Create QR session directly
async function createQRSession(sessionId, expiresAt, creatorId, sessionType) {
    if (!supabase) {
        console.error('[createQRSession] Supabase not initialized');
        return null;
    }
    
    try {
        console.log('[createQRSession] Creating new QR session | sessionId:', sessionId, '| type:', sessionType);
        
        // First, deactivate all previous active QR sessions
        try {
            const { error: deactivateError } = await supabase
                .from('qr_sessions')
                .update({ is_active: false })
                .eq('is_active', true);
            
            if (deactivateError) {
                console.warn('[createQRSession] ⚠ Warning: Could not deactivate previous sessions:', deactivateError.message);
            } else {
                console.log('[createQRSession] ✓ Deactivated previous QR sessions');
            }
        } catch (deactivateErr) {
            console.warn('[createQRSession] ⚠ Error deactivating previous sessions:', deactivateErr.message);
        }
        
        // Generate server ID - use 'server-' prefix for cloud, 'local-' for development
        const serverId = process.env.NODE_ENV === 'production' 
            ? `server-${Date.now()}`
            : `local-${Date.now()}`;
        
        // Manila timezone is UTC+8
        const manilaOffset = 8 * 60 * 60 * 1000; // 8 hours in milliseconds
        
        // Create timestamps in Manila timezone
        const createdAtUTC = new Date();
        const createdAtManila = new Date(createdAtUTC.getTime() + manilaOffset);
        
        // expiresAt comes from server.js already calculated with the interval
        // Just apply Manila timezone to it
        const expiresAtManila = new Date(expiresAt.getTime() + manilaOffset);
        
        console.log('[createQRSession] Server ID:', serverId);
        console.log('[createQRSession] Created at (Manila +8):', createdAtManila.toISOString());
        console.log('[createQRSession] Expires at (Manila +8):', expiresAtManila.toISOString());
        console.log('[createQRSession] Expiration interval: ' + Math.round((expiresAtManila.getTime() - createdAtManila.getTime()) / 1000) + ' seconds');
        
        // Insert directly with session_id as primary key (no qr_id needed)
        const { data, error } = await supabase
            .from('qr_sessions')
            .insert({
                session_id: sessionId,
                expires_at: expiresAtManila.toISOString(),
                created_at: createdAtManila.toISOString(),
                session_type: sessionType,
                is_active: true,
                server_id: serverId
            })
            .select()
            .single();
            
        if (error) {
            console.error('[createQRSession] ✗ Insert error:', error.code, '-', error.message);
            return null;
        }
        
        console.log('[createQRSession] ✓ Successfully created | session_id:', data.session_id);
        
        return {
            session_id: data.session_id,
            expires_at: data.expires_at,
            issued_at: data.created_at,
            type: data.session_type
        };
    } catch (error) {
        console.error('[createQRSession] ✗ Error:', error.message);
        console.error('[createQRSession] Stack:', error.stack);
        return null;
    }
}

module.exports = {
    getQRSession,
    getScanCountForSession,
    getTodayAttendance,
    deactivateExpiredQRSessions,
    deactivateAllQRSessions,
    getEmployeeSchedule,
    getSchedulesByDateRange,
    handleQRCheckin,
    handleQRCheckout,
    createQRSession
};
