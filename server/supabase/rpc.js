// ============================================================
// RPC FUNCTIONS (Transactional Operations)
// ============================================================

const { supabase } = require('./init');

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

async function rpcQrGenerateSession(sessionType = 'checkin', expiresAt = null) {
    if (!supabase) {
        console.error('[rpcQrGenerateSession] Supabase not initialized');
        return null;
    }

    try {
        // Use default expiration if not provided (30 seconds from now)
        const expiration = expiresAt || new Date(Date.now() + 30 * 1000);

        console.log('[rpcQrGenerateSession] Calling RPC | sessionType:', sessionType, '| expiresAt:', expiration.toISOString());

        // Generate session parameters for generate_qr_session_atomic
        const sessionId = `qr_auto_${Date.now()}_${Math.random().toString(36).substring(2, 12)}`;
        const serverId = process.env.NODE_ENV === 'production' ? 'server-primary' : 'local-primary';

        // Call the RPC function
        const { data, error } = await supabase.rpc('generate_qr_session_atomic', {
            p_session_id: sessionId,
            p_expires_at: expiration.toISOString(),
            p_session_type: sessionType,
            p_server_id: serverId
        });

        if (error) {
            console.error('[rpcQrGenerateSession] ✗ RPC error:', error.code, '-', error.message);
            console.log('[rpcQrGenerateSession] Falling back to direct insert (createQRSession)');
            return null;
        }

        console.log('[rpcQrGenerateSession] ✓ RPC success | returned data:', JSON.stringify(data));

        // Handle both array and object/JSON responses
        let sessionData = Array.isArray(data) ? data[0] : data;

        // If data is a JSON string, parse it
        if (typeof sessionData === 'string') {
            sessionData = JSON.parse(sessionData);
        }

        // Format response to match expected structure
        return {
            session_id: sessionData?.session_id || sessionId,
            expires_at: sessionData?.expires_at || expiration.toISOString(),
            issued_at: sessionData?.issued_at || new Date().toISOString(),
            session_type: sessionType
        };
    } catch (error) {
        console.error('[rpcQrGenerateSession] ✗ Error:', error.message);
        console.log('[rpcQrGenerateSession] Stack:', error.stack);
        // Return null so fallback (createQRSession) is used
        return null;
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
        const params = {
            p_user_id: userId,
            p_first_name: profileData.first_name,
            p_last_name: profileData.last_name,
            p_phone: profileData.phone || null,
            p_address: profileData.address || null,
            p_position: profileData.position || null,
            p_dept_id: profileData.dept_id || null,
            p_hire_date: profileData.hire_date || null,
            p_user_role: userRole,
            p_password_hash: profileData.password_hash || null
        };

        const { data, error } = await supabase.rpc('profile_update', params);

        if (error) throw error;
        return data;
    } catch (error) {
        console.error('[supabase] RPC profile update error:', error.message);
        throw error;
    }
}

module.exports = {
    rpcLogin,
    rpcLogout,
    rpcChangeFirstPassword,
    rpcAttendanceCheckin,
    rpcAttendanceCheckout,
    rpcQrGenerateSession,
    rpcQrRevokeSession,
    rpcProfileUpdate
};
