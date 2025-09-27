// Load environment variables from .env file
require('dotenv').config();

const jsonServer = require('json-server');
const path = require('path');
const bodyParser = require('body-parser');
const cors = require('cors');

const server = jsonServer.create();
const router = jsonServer.router(path.join(__dirname, 'db.json'));
const middlewares = jsonServer.defaults({ static: 'public' });
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const SECRET = process.env.JWT_SECRET || 'dev-secret-key';
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '8h';

const QRCode = require('qrcode');
const { v4: uuidv4 } = require('uuid');

// Import invitation utilities
const { 
    generateRawToken, 
    hashToken, 
    verifyTokenHash, 
    generateInviteLink, 
    checkTokenExpiry 
} = require('./utils/tokenHelpers');
const EmailService = require('./utils/emailService');

// Import Supabase-only connection (no PostgreSQL pool dependency)
const { 
  pool, 
  checkPostgresConnection, 
  maskDatabaseUrl, 
  getWorkingConnectionUrl, 
  getPrimaryConnectionUrl 
} = require('./conn-supabase');

// Supabase REST client (optional)
const { 
    isSupabaseEnabled, 
    validateSession, 
    getEmployeeByEmail, 
    getNotifications,
    markNotificationsRead,
    getRequests,
    createRequest,
    getAdminUsers,
    getSystemSettings,
    getAuditLogs,
    getActiveSessions,
    // Invitation functions
    createInvitation,
    verifyInvitationToken,
    acceptInvitation,
    getPendingInvitations,
    resendInvitation,
    cancelInvitation
} = require('./supabaseClient');
console.log('[server] Supabase REST client enabled?', isSupabaseEnabled() ? 'yes' : 'no');

// allow cross-origin requests (handles OPTIONS preflight)
server.use(cors());

// serve the SPA static files from ../public
const publicPath = path.join(__dirname, '..', 'public');
server.use(jsonServer.defaults({ static: publicPath }));
server.use(expressStaticFallback = (req, res, next) => { next(); });

server.use(middlewares);
server.use(bodyParser.json());

// simple login route (uses users/roles schema; username acts as email in UI)
server.post('/api/login', async (req, res) => {
    const { email, password } = req.body || {};
    if (!email || !password) return res.status(400).json({ error: 'Missing email or password' });
    try{
        // Get user data via Supabase REST first
        let user = null;
        try {
            const { findUserByEmail, supabase } = require('./supabaseClient');
            if (supabase) {
                const sUser = await findUserByEmail(email);
                if (sUser) {
                    console.log('[login] Supabase lookup succeeded for', email);
                    // Get role name - we need to fetch it separately since findUserByEmail doesn't include it
                    const { data: roleData } = await supabase
                        .from('roles')
                        .select('role_name')
                        .eq('role_id', sUser.role_id)
                        .single();
                    
                    user = {
                        user_id: sUser.user_id,
                        username: sUser.username,
                        password_hash: sUser.password_hash,
                        role_id: sUser.role_id,
                        role_name: roleData?.role_name || 'employee',
                        status: sUser.status,
                        first_login: sUser.first_login
                    };
                }
            }
        } catch (supErr) {
            console.warn('[login] Supabase lookup failed, falling back to Postgres pool:', supErr.message || supErr);
        }

        // Use Supabase-only approach - no pool fallback
        if (!user) {
            console.log('[login] User not found via Supabase RPC, login failed');
            return res.status(401).json({ error: 'Invalid credentials' });
        }
        if (user.status !== 'active') return res.status(403).json({ error: 'User account is not active' });

        // Validate password
        let valid = false;
        if (user.password_hash) {
            try { valid = await bcrypt.compare(password, user.password_hash); } catch(e) { valid = false; }
        }
        if (!valid) return res.status(401).json({ error: 'Invalid credentials' });

        // Check if this is the first login - if so, require password change
        if (user.first_login) {
            return res.status(200).json({ 
                requirePasswordChange: true, 
                userId: user.user_id,
                message: 'You must change your password before continuing.' 
            });
        }

        // Try to use Supabase RPC for complete login (session management)
        try {
            const { rpcLogin } = require('./supabaseClient');
            const ipAddress = req.ip || (req.connection && req.connection.remoteAddress);
            const deviceInfo = { userAgent: req.get('User-Agent') };
            
            const rpcResult = await rpcLogin(email, user.password_hash, ipAddress, deviceInfo);
            if (rpcResult && rpcResult.success && rpcResult.user && rpcResult.session_id) {
                console.log('[login] Supabase RPC: Complete login succeeded for', email);
                
                const rpcUser = rpcResult.user;
                const safe = { 
                    id: rpcUser.user_id, 
                    email: rpcUser.username, 
                    role: rpcUser.role_name,
                    employee_id: rpcUser.employee_id || null,
                    employee_db_id: rpcUser.employee_id || null
                };

                // legacy-style redirect based on role
                const roleRedirects = {
                    superadmin: 'pages/Superadmin.html',
                    hr: 'pages/HRDashboard.html',
                    head_dept: 'pages/DepartmentHead.html',
                    employee: 'pages/employee.html'
                };
                safe.redirect = roleRedirects[rpcUser.role_name] || 'pages/employee.html';

                const token = jwt.sign({ 
                    id: safe.id, 
                    email: safe.email, 
                    role: safe.role, 
                    employee_id: safe.employee_id, 
                    sessionId: rpcResult.session_id 
                }, SECRET, { expiresIn: JWT_EXPIRES_IN });
                
                return res.json({ user: safe, token });
            }
        } catch (supErr) {
            console.error('[login] Supabase RPC login failed:', supErr.message || supErr);
            return res.status(500).json({ error: 'Login service unavailable' });
        }

        // If we reach here, Supabase RPC didn't work
        console.error('[login] Supabase RPC login returned no result');
        return res.status(500).json({ error: 'Login service unavailable' });
    }catch(e){ console.error('login error', e); return res.status(500).json({ error: 'login failed' }); }
});

// Logout: invalidate a user session
server.post('/api/logout', requireAuth([]), async (req, res) => {
    try {
        const sessionId = req.auth && req.auth.sessionId;
        if (!sessionId) {
            return res.status(400).json({ error: 'No session to log out from.' });
        }

        // Try Supabase RPC first
        try {
            const { rpcLogout } = require('./supabaseClient');
            const rpcResult = await rpcLogout(sessionId);
            if (rpcResult && rpcResult.success) {
                console.log(`[logout] Supabase RPC: User ${req.auth.id} logged out session ${sessionId}`);
                return res.json({ ok: true, message: rpcResult.message });
            } else {
                console.warn('[logout] Supabase RPC: No session found or already logged out');
                return res.status(404).json({ error: 'Session already logged out or not found.' });
            }
        } catch (supErr) {
            console.error('[logout] Supabase RPC failed:', supErr.message || supErr);
            return res.status(500).json({ error: 'Logout service unavailable' });
        }
    } catch (e) {
        console.error('logout error', e);
        return res.status(500).json({ error: 'Logout failed.' });
    }
});

// Change password on first login
server.post('/api/change-first-login-password', async (req, res) => {
    try {
        const { userId, currentPassword, newPassword } = req.body;
        
        if (!userId || !currentPassword || !newPassword) {
            return res.status(400).json({ error: 'User ID, current password, and new password are required.' });
        }
        
        if (newPassword.length < 6) {
            return res.status(400).json({ error: 'New password must be at least 6 characters long.' });
        }
        
        // Get user info using Supabase
        const { getUserForPasswordReset } = require('./supabaseClient');
        const user = await getUserForPasswordReset(userId);
        
        if (!user) {
            return res.status(404).json({ error: 'User not found.' });
        }
        
        if (!user.first_login) {
            return res.status(400).json({ error: 'Password change not required for this user.' });
        }
        
        // Verify current password
        const validPassword = await bcrypt.compare(currentPassword, user.password_hash);
        if (!validPassword) {
            return res.status(401).json({ error: 'Current password is incorrect.' });
        }
        
        // Hash new password
        const hashedNewPassword = await bcrypt.hash(newPassword, 10);
        
        // Try Supabase RPC first
        try {
            const { rpcChangeFirstPassword } = require('./supabaseClient');
            const rpcResult = await rpcChangeFirstPassword(userId, hashedNewPassword);
            if (rpcResult && rpcResult.success) {
                console.log('[change-password] Supabase RPC: Password changed for user', userId);
                return res.json({ success: true, message: rpcResult.message });
            } else {
                console.error('[change-password] Supabase RPC: Failed to change password');
                return res.status(500).json({ error: 'Failed to change password.' });
            }
        } catch (supErr) {
            console.error('[change-password] Supabase RPC failed:', supErr.message || supErr);
            return res.status(500).json({ error: 'Password change service unavailable' });
        }
    } catch (e) {
        console.error('Change password error:', e);
        res.status(500).json({ error: 'Failed to change password.' });
    }
});

// Get user profile
server.get('/api/auth/profile', requireAuth([]), async (req, res) => {
    try {
        const userId = req.auth.id;
        
        // Try Supabase REST client first
        try {
            const { getProfile } = require('./supabaseClient');
            const profile = await getProfile(userId);
            if (profile) {
                console.log('[profile] Supabase REST: Retrieved profile for user', userId);
                return res.json(profile);
            }
        } catch (supErr) {
            console.error('[profile] Supabase REST failed:', supErr.message || supErr);
            return res.status(500).json({ error: 'Profile service unavailable' });
        }

        // If we reach here, no profile was found
        console.error('[profile] No profile found for user', userId);
        return res.status(404).json({ error: 'Profile not found' });
    } catch (e) {
        console.error('Get profile error:', e);
        res.status(500).json({ error: 'Failed to get profile' });
    }
});

// Update user profile
server.put('/api/auth/profile', requireAuth([]), async (req, res) => {
    try {
        const userId = req.auth.id;
        const userRole = req.auth.role;
        const { 
            first_name, 
            last_name, 
            phone, 
            address, 
            position, 
            dept_id, 
            hire_date,
            currentPassword,
            newPassword
        } = req.body;
        
        // Validation
        if (!first_name || !last_name) {
            return res.status(400).json({ error: 'First name and last name are required' });
        }
        
        // Phone validation
        if (phone && !/^\+63[0-9]{10}$/.test(phone)) {
            return res.status(400).json({ error: 'Phone number must be in format: +63xxxxxxxxxx' });
        }
        
        // Use Supabase RPC for profile update
        const { rpcProfileUpdate } = require('./supabaseClient');
        const profileData = {
            first_name, 
            last_name, 
            phone, 
            address, 
            position, 
            dept_id, 
            hire_date,
            currentPassword,
            newPassword
        };
        
        const result = await rpcProfileUpdate(userId, profileData, userRole);
        
        if (result && result.success) {
            console.log('[profile] Supabase RPC: Profile updated successfully for user', userId);
            
            // Get updated profile data
            const { getProfile } = require('./supabaseClient');
            const profileData = await getProfile(userId);
            
            if (profileData) {
                res.json({
                    success: true,
                    message: 'Profile updated successfully',
                    user: profileData
                });
            } else {
                res.json({
                    success: true,
                    message: 'Profile updated successfully'
                });
            }
        } else {
            console.error('[profile] Supabase RPC failed:', result?.error);
            res.status(500).json({ error: result?.error || 'Failed to update profile' });
        }
        
    } catch (e) {
        console.error('Update profile error:', e);
        res.status(500).json({ error: e.message || 'Failed to update profile' });
    }
});

// simple middleware to protect HR endpoints
function requireAuth(allowedRoles){
    return async function(req, res, next){
        const auth = req.headers && (req.headers.authorization || req.headers.Authorization);
        if (!auth || !auth.startsWith('Bearer ')) return res.status(401).json({ error: 'Missing or invalid authorization header' });
        const token = auth.slice('Bearer '.length);
        try{
            const decoded = jwt.verify(token, SECRET);
            req.auth = decoded;

            // Verify the session is still active in the database
            if (!decoded.sessionId) {
                return res.status(401).json({ error: 'Invalid token: No session ID.' });
            }
            
            // Try Supabase session validation first
            let sessionValid = false;
            try {
                if (isSupabaseEnabled()) {
                    const session = await validateSession(decoded.sessionId, decoded.id);
                    sessionValid = !!session;
                    console.log('[auth] Supabase session validation:', sessionValid ? 'valid' : 'invalid');
                }
            } catch (supErr) {
                console.warn('[auth] Supabase session validation error:', supErr.message);
            }

            if (!sessionValid) {
                return res.status(401).json({ error: 'Session has expired or been logged out. Please log in again.' });
            }

            // check roles
            if (Array.isArray(allowedRoles) && allowedRoles.length > 0){
                const userRole = decoded.role;
                if (!allowedRoles.includes(userRole.toLowerCase())){
                    return res.status(403).json({ error: 'Forbidden: Insufficient permissions' });
                }
            }
            next();
        }catch(e){
            console.warn('auth error', e.message || e);
            return res.status(401).json({ error: 'Invalid or expired token' });
        }
    };
}

// helper: convert DB row -> session object (compat fields)
function rowToSession(row){ 
    if (!row) return null; 
    return { 
        session_id: row.session_id, 
        issued_at: row.created_at ? row.created_at.toISOString() : null, 
        expires_at: row.expires_at ? row.expires_at.toISOString() : null, 
        is_active: row.is_active,
        session_type: row.session_type 
    }; 
}

// cleanup: expire sessions past expires_at
async function cleanupExpiredQrSessions(){
    try{
        const { deactivateExpiredQRSessions } = require('./supabaseClient');
        await deactivateExpiredQRSessions();
    }catch(e){ console.warn('qr cleanup failed:', e.message || e); }
}

// revoke session
// QR revoke endpoint is defined later in the file with correct schema

// mark attendance - append to db.json attendance array
server.post('/api/attendance', async (req, res) => {
    try{
        const body = req.body || {};
        // For compatibility, accept employee identifier in body.email
        const ident = body.email || body.employee_id;
        if (!ident) return res.status(400).json({ error: 'missing employee identifier' });
        
        const status = body.status || 'present';
        const method = body.method || 'manual';
        
        // Try Supabase RPC first
        try {
            const { rpcAttendanceCheckin } = require('./supabaseClient');
            const rpcResult = await rpcAttendanceCheckin(ident, method, status);
            if (rpcResult && rpcResult.success) {
                console.log('[attendance] Supabase RPC: Checked in employee', ident);
                return res.status(201).json(rpcResult.attendance);
            } else {
                console.error('[attendance] Supabase RPC: Failed to check in employee', ident);
                return res.status(500).json({ error: 'Failed to record attendance' });
            }
        } catch (supErr) {
            console.error('[attendance] Supabase RPC failed:', supErr.message || supErr);
            return res.status(500).json({ error: 'Attendance service unavailable' });
        }
    }catch(e){ console.error('attendance post error', e); return res.status(500).json({ error: 'failed to post attendance' }); }
});

// attendance: checkout (sets time_out for today's record)
server.post('/api/attendance/checkout', async (req, res) => {
    try{
        const body = req.body || {};
        const ident = body.employee_id || body.email;
        if (!ident) return res.status(400).json({ error: 'missing employee identifier' });

        const { rpcAttendanceCheckout } = require('./supabaseClient');
        const rpcResult = await rpcAttendanceCheckout(ident);
        
        if (rpcResult && rpcResult.success) {
            console.log('[checkout] Supabase RPC: Checked out employee', ident);
            return res.json({ ok: true, record: rpcResult.attendance });
        } else {
            console.error('[checkout] Supabase RPC failed:', rpcResult?.error || 'unknown error');
            return res.status(400).json({ error: rpcResult?.error || 'checkout failed' });
        }
    }catch(e){ console.error('checkout error', e); return res.status(500).json({ error: 'failed to checkout' }); }
});

// attendance: break in/out
server.post('/api/attendance/break', async (req, res) => {
    try{
        const body = req.body || {};
        const ident = body.employee_id || body.email;
        const action = (body.action || '').toLowerCase(); // 'in' or 'out'
        if (!ident || (action !== 'in' && action !== 'out')) return res.status(400).json({ error: 'missing employee identifier or invalid action' });

        const { rpcAttendanceBreak } = require('./supabaseClient');
        const rpcResult = await rpcAttendanceBreak(ident, action);
        
        if (rpcResult && rpcResult.success) {
            console.log('[break] Supabase RPC: Break', action, 'for employee', ident);
            return res.json({ ok: true, record: rpcResult.attendance });
        } else {
            console.error('[break] Supabase RPC failed:', rpcResult?.error || 'unknown error');
            return res.status(400).json({ error: rpcResult?.error || 'break operation failed' });
        }
    }catch(e){ console.error('break error', e); return res.status(500).json({ error: 'failed to update break' }); }
});

// attendance history with optional date range and employee filter
server.get('/api/attendance/history', async (req, res) => {
    try{
        const { start, end, employee } = req.query || {};
        
        const { getAttendanceHistory } = require('./supabaseClient');
        const history = await getAttendanceHistory({ start, end, employee });
        
        if (history) {
            console.log('[attendance-history] Supabase REST: Retrieved', history.length, 'records');
            return res.json(history);
        } else {
            console.error('[attendance-history] Supabase REST failed: no data returned');
            return res.status(500).json({ error: 'failed to fetch attendance history' });
        }
    }catch(e){ console.error('history error', e); return res.status(500).json({ error: 'failed to fetch history' }); }
});

// Fetch attendance with filters
server.get('/api/attendance', requireAuth(['hr', 'superadmin', 'head_dept']), async (req, res) => {
    try{
        const { startDate, endDate, employee, status, department } = req.query;
        
        const { getFilteredAttendance } = require('./supabaseClient');
        const attendanceData = await getFilteredAttendance({ startDate, endDate, employee, status, department });
        
        if (attendanceData) {
            console.log('[attendance] Supabase REST: Retrieved', attendanceData.length, 'records');
            return res.json(Array.isArray(attendanceData) ? attendanceData : []);
        } else {
            console.error('[attendance] Supabase REST failed: no data returned');
            return res.status(500).json({ error: 'failed to fetch attendance' });
        }
    }catch(e){ console.error('attendance fetch error', e); return res.status(500).json({ error: 'failed to fetch attendance' }); }
});

// check-in using a QR session (validates session, one check-in per employee per day)
server.post('/api/attendance/checkin', async (req, res) => {
    try{
        const body = req.body || {};
        const { session_id, employee_id, lat, lon, deviceInfo } = body;
        console.log('Check-in request received:', { session_id, employee_id, lat, lon, deviceInfo });
        
        if (!session_id || !employee_id) return res.status(400).json({ error: 'missing session_id or employee_id' });

        const { handleQRCheckin } = require('./supabaseClient');
        const result = await handleQRCheckin(session_id, employee_id, lat, lon, deviceInfo);
        
        if (result && result.success) {
            console.log('Attendance inserted successfully:', result.record);
            return res.json({ ok: true, record: result.record });
        } else {
            console.error('QR checkin failed:', result?.error || 'unknown error');
            const statusCode = result?.error?.includes('already checked in') ? 409 :
                             result?.error?.includes('not found') ? 404 :
                             result?.error?.includes('not active') || result?.error?.includes('expired') ? 410 : 400;
            return res.status(statusCode).json({ error: result?.error || 'checkin failed' });
        }
    }catch(e){ console.error('checkin error', e); return res.status(500).json({ error: 'failed to checkin' }); }
});

// Fetch employee info by email (secured): returns {id, employee_id, name, department, email}
// Backward-compatible: treat email param as username and return combined fields
server.get('/api/employee/by-email', requireAuth([]), async (req, res) => {
    try{
        const email = (req.query && req.query.email) ? String(req.query.email) : (req.auth && req.auth.email);
        if (!email) return res.status(400).json({ error: 'missing email' });
        
        const { getEmployeeByEmail } = require('./supabaseClient');
        const employee = await getEmployeeByEmail(email);
        
        if (employee) {
            console.log('[employee] Supabase: Found employee', email);
            return res.json(employee);
        } else {
            console.error('[employee] Supabase: Employee not found', email);
            return res.status(404).json({ error: 'employee not found' });
        }
    }catch(e){ console.error('employee lookup error', e); return res.status(500).json({ error: 'failed to fetch employee' }); }
});

// --- Super Admin: User Management ---

// GET all users for the admin panel
server.get('/api/admin/users', requireAuth(['superadmin']), async (req, res) => {
    try {
        const { q, role, _page = 1, _limit = 10 } = req.query;
        
        const { getAdminUsers } = require('./supabaseClient');
        const result = await getAdminUsers({ q, role, _page, _limit });
        
        if (result !== null) {
            console.log('[admin] Supabase: Retrieved', result.users.length, 'users');
            res.setHeader('X-Total-Count', result.total || result.users.length);
            return res.json(result.users);
        } else {
            console.error('[admin] Supabase: Failed to retrieve users');
            return res.status(500).json({ error: 'Failed to fetch users.' });
        }
    } catch (e) {
        console.error('Admin fetch users error:', e);
        res.status(500).json({ error: 'Failed to fetch users.' });
    }
});

// POST a new user (Superadmin action)
server.post('/api/admin/users', requireAuth(['superadmin']), async (req, res) => {
    const { email, password, role, firstName, lastName, departmentId } = req.body;
    const creatorId = req.auth.id;

    if (!email || !password || !role || !firstName || !lastName) {
        return res.status(400).json({ error: 'Missing required fields.' });
    }

    // Superadmin can only create HR or Super Admin accounts
    const normalizedRole = String(role).toLowerCase();
    if (!['hr', 'superadmin'].includes(normalizedRole)) {
        return res.status(403).json({ error: 'Not allowed to create this role. Only HR or Super Admin can be created.' });
    }

    try {
        // Use Supabase helper
        const { createAdminUser, logAuditEvent } = require('./supabaseClient');
        const userData = { email, password, role: normalizedRole, firstName, lastName, departmentId };
        const result = await createAdminUser(userData, creatorId);
        
        if (result.success) {
            // Enhanced audit logging for user creation
            await logAuditEvent(creatorId, 'USER_CREATED', { 
                createdUserId: result.userId, 
                email,
                firstName,
                lastName,
                role: normalizedRole,
                departmentId,
                description: `Created new ${normalizedRole} user: ${firstName} ${lastName} (${email})`
            });
            
            res.status(201).json({ success: true, userId: result.userId });
        } else {
            console.error('Admin create user error:', result.error);
            if (result.error.includes('email already exists')) {
                return res.status(409).json({ error: result.error });
            }
            return res.status(500).json({ error: result.error });
        }
    } catch (e) {
        console.error('Admin create user error:', e);
        res.status(500).json({ error: 'Failed to create user.' });
    }
});

// PUT to update a user's role or status
server.put('/api/admin/users/:id', requireAuth(['superadmin']), async (req, res) => {
    const userId = parseInt(req.params.id, 10);
    if (isNaN(userId)) return res.status(400).json({ error: 'Invalid user ID.' });

    const { email, role, status, firstName, lastName, departmentId, password } = req.body || {};

    // Validate simple enums
    if (status && !['active', 'inactive', 'locked'].includes(status)) {
        return res.status(400).json({ error: 'Invalid status.' });
    }

    try {
        // Use Supabase helper
        const { updateAdminUser, logAuditEvent } = require('./supabaseClient');
        const updateData = { email, role, status, firstName, lastName, departmentId, password };
        const result = await updateAdminUser(userId, updateData, req.auth.id);
        
        if (result.success) {
            await logAuditEvent(req.auth.id, 'USER_UPDATED', result.auditDetails);
            res.json({ success: true });
        } else {
            console.error(`Admin update user ${userId} error:`, result.error);
            if (result.error.includes('Invalid role')) {
                return res.status(400).json({ error: 'Invalid role.' });
            }
            if (result.error.includes('User not found')) {
                return res.status(404).json({ error: 'User not found.' });
            }
            if (result.error.includes('email already exists')) {
                return res.status(409).json({ error: 'A user with this email already exists.' });
            }
            res.status(500).json({ error: result.error });
        }
    } catch (e) {
        console.error(`Admin update user ${userId} error:`, e);
        res.status(500).json({ error: 'Failed to update user.' });
    }
});

// DELETE a user (soft delete by setting status to 'inactive')
server.delete('/api/admin/users/:id', requireAuth(['superadmin']), async (req, res) => {
    const userId = parseInt(req.params.id, 10);
    if (isNaN(userId)) return res.status(400).json({ error: 'Invalid user ID.' });

    // Prevent superadmin from deleting themselves
    if (userId === req.auth.id) {
        return res.status(403).json({ error: 'You cannot delete your own account.' });
    }

    try {
        const { deactivateUser } = require('./supabaseClient');
        const result = await deactivateUser(userId, req.auth.id);
        
        if (result && result.success) {
            console.log(`[admin] Successfully deactivated user ${userId}`);
            return res.status(204).send(); // No content
        } else {
            console.error(`[admin] Failed to deactivate user ${userId}:`, result?.error);
            const statusCode = result?.error?.includes('not found') ? 404 :
                             result?.error?.includes('cannot deactivate') ? 403 : 500;
            return res.status(statusCode).json({ error: result?.error || 'Failed to delete user.' });
        }
    } catch (e) {
        console.error(`Admin delete user ${userId} error:`, e);
        res.status(500).json({ error: 'Failed to delete user.' });
    }
});

// PUT /api/admin/users/:id/reactivate - Reactivate a user
server.put('/api/admin/users/:id/reactivate', requireAuth(['superadmin']), async (req, res) => {
    const userId = parseInt(req.params.id, 10);
    if (isNaN(userId)) return res.status(400).json({ error: 'Invalid user ID.' });

    try {
        const { reactivateUser } = require('./supabaseClient');
        const result = await reactivateUser(userId, req.auth.id);
        
        if (result && result.success) {
            console.log(`[admin] Successfully reactivated user ${userId}`);
            return res.status(200).json({ message: 'User reactivated successfully.' });
        } else {
            console.error(`[admin] Failed to reactivate user ${userId}:`, result?.error);
            const statusCode = result?.error?.includes('not found') ? 404 :
                             result?.error?.includes('already active') ? 400 : 500;
            return res.status(statusCode).json({ error: result?.error || 'Failed to reactivate user.' });
        }
    } catch (e) {
        console.error(`Admin reactivate user ${userId} error:`, e);
        res.status(500).json({ error: 'Failed to reactivate user.' });
    }
});

// --- Super Admin: System Settings ---

// Helper function to log audit events
async function logAuditEvent(userId, actionType, details = {}) {
    const { logAuditEvent: supabaseLogAuditEvent } = require('./supabaseClient');
    await supabaseLogAuditEvent(userId, actionType, details);
}

// Enhanced audit logging for field changes
async function logFieldChanges(userId, targetUserId, actionType, changes, additionalContext = {}) {
    try {
        // Log each field change separately for detailed tracking
        for (const change of changes) {
            const details = {
                targetUserId,
                field: change.field,
                fieldLabel: change.fieldLabel,
                oldValue: change.oldValue,
                newValue: change.newValue,
                changeDescription: change.description,
                ...additionalContext
            };
            
            await logAuditEvent(userId, actionType, details);
        }
    } catch (e) {
        console.error('Failed to log field changes:', e);
    }
}

// Helper to compare objects and generate change descriptions
function generateFieldChanges(oldData, newData, fieldMappings) {
    const changes = [];
    
    for (const [field, config] of Object.entries(fieldMappings)) {
        const oldValue = oldData[field];
        const newValue = newData[field];
        
        // Skip if values are the same
        if (oldValue === newValue) continue;
        
        // Skip if new value is undefined (field not being updated)
        if (newValue === undefined) continue;
        
        const fieldLabel = config.label || field;
        const oldDisplay = config.formatter ? config.formatter(oldValue) : (oldValue || 'Not set');
        const newDisplay = config.formatter ? config.formatter(newValue) : (newValue || 'Not set');
        
        changes.push({
            field,
            fieldLabel,
            oldValue: oldValue,
            newValue: newValue,
            description: `Changed ${fieldLabel} from "${oldDisplay}" to "${newDisplay}"`
        });
    }
    
    return changes;
}

// GET all system settings
server.get('/api/admin/settings', requireAuth(['superadmin']), async (req, res) => {
    try {
        const { getSystemSettings } = require('./supabaseClient');
        const settings = await getSystemSettings();
        
        if (settings !== null) {
            console.log('[admin] Supabase: Retrieved system settings');
            return res.json(settings);
        } else {
            console.error('[admin] Supabase: Failed to retrieve system settings');
            return res.status(500).json({ error: 'Failed to fetch system settings.' });
        }
    } catch (e) {
        console.error('Admin get settings error:', e);
        res.status(500).json({ error: 'Failed to fetch system settings.' });
    }
});

// PUT to update system settings
server.put('/api/admin/settings', requireAuth(['superadmin']), async (req, res) => {
    const settings = req.body;
    if (typeof settings !== 'object' || settings === null) {
        return res.status(400).json({ error: 'Invalid settings format.' });
    }

    try {
        const { updateSystemSettings } = require('./supabaseClient');
        const result = await updateSystemSettings(settings, req.auth.id);
        
        if (result.success) {
            console.log('[admin] Successfully updated system settings');
            res.json({ success: true, message: 'Settings updated successfully.' });
        } else {
            console.error('[admin] Failed to update system settings:', result.error);
            res.status(500).json({ error: result.error || 'Failed to update settings.' });
        }
    } catch (e) {
        console.error('Admin update settings error:', e);
        res.status(500).json({ error: 'Failed to update settings.' });
    }
});

// --- Super Admin: Audit Logs ---

// GET all audit logs with filtering
server.get('/api/admin/audit-logs', requireAuth(['superadmin']), async (req, res) => {
    try {
        const { startDate, endDate, userId, actionType } = req.query;
        
        const { getAuditLogs } = require('./supabaseClient');
        const logs = await getAuditLogs({ startDate, endDate, userId, actionType });
        
        if (logs !== null) {
            console.log('[admin] Supabase: Retrieved', logs.length, 'audit logs');
            return res.json(logs);
        } else {
            console.error('[admin] Supabase: Failed to retrieve audit logs');
            return res.status(500).json({ error: 'Failed to fetch audit logs.' });
        }
    } catch (e) {
        console.error('Admin get audit logs error:', e);
        res.status(500).json({ error: 'Failed to fetch audit logs.' });
    }
});

// --- Super Admin: Activity Monitor ---

// GET active user sessions
server.get('/api/admin/sessions', requireAuth(['superadmin']), async (req, res) => {
    try {
        const { getActiveSessions } = require('./supabaseClient');
        const sessions = await getActiveSessions();
        
        if (sessions !== null) {
            console.log('[admin] Supabase: Retrieved', sessions.length, 'active sessions');
            return res.json(sessions);
        } else {
            console.error('[admin] Supabase: Failed to retrieve active sessions');
            return res.status(500).json({ error: 'Failed to fetch active sessions.' });
        }
    } catch (e) {
        console.error('Admin get sessions error:', e);
        res.status(500).json({ error: 'Failed to fetch active sessions.' });
    }
});

// POST to forcefully log out a user session
server.post('/api/admin/sessions/:sessionId/logout', requireAuth(['superadmin']), async (req, res) => {
    const { sessionId } = req.params;
    const adminId = req.auth.id;

    try {
        // Use Supabase helper
        const { forceLogoutSession, logAuditEvent } = require('./supabaseClient');
        const result = await forceLogoutSession(sessionId);

        if (result) {
            const targetUserId = result.user_id;
            await logAuditEvent(adminId, 'SESSION_LOGOUT_FORCED', { targetUserId, targetSessionId: sessionId });
            res.json({ success: true, message: 'Session logged out successfully.' });
        } else {
            res.status(404).json({ error: 'Active session not found.' });
        }
    } catch (e) {
        console.error('Admin force logout error:', e);
        res.status(500).json({ error: 'Failed to log out session.' });
    }
});


// --- HR Dashboard API ---

// QR Code Management for HR
server.get('/api/hr/qr/current', requireAuth(['hr', 'superadmin']), async (req, res) => {
    try {
        // Use Supabase-only approach
        const { getCurrentQRSession } = require('./supabaseClient');
        const session = await getCurrentQRSession();
        
        if (session) {
            console.log('[qr] Supabase REST: Retrieved current QR session');
            // Generate QR code on-demand from session_id
            session.imageDataUrl = await QRCode.toDataURL(session.session_id, { margin: 1, width: 320 });
            return res.json({ session });
        }
        
        // No active session found
        console.log('[qr] No active QR session found in Supabase');
        return res.status(404).json({ error: 'No active QR session found' });
        
    } catch (e) {
        console.error('Get current QR error:', e);
        res.status(500).json({ error: 'Failed to fetch current QR session.' });
    }
});

server.post('/api/hr/qr/generate', requireAuth(['hr', 'superadmin']), async (req, res) => {
    try {
        const { type = 'rotating', duration_hours = 24, duration_minutes } = req.body;
        const creator_id = req.auth.id;
        
        console.log('QR Generate request:', { type, duration_hours, duration_minutes, body: req.body });
        
        // Deactivate any existing sessions using Supabase helper
        const { deactivateAllQRSessions } = require('./supabaseClient');
        await deactivateAllQRSessions();
        
        // Generate session ID (QR code will be generated on-demand)
        const sessionId = `qr_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        
        // Calculate expiration time - for rotating, default to 1 minute; for static, use hours
        let durationMs;
        if (type === 'rotating') {
            // For rotating QR codes, use 1 minute unless specifically overridden
            durationMs = duration_minutes ? 
                duration_minutes * 60 * 1000 : 
                1 * 60 * 1000; // Default 1 minute for rotating
        } else {
            // For static QR codes, use hours
            durationMs = duration_hours * 60 * 60 * 1000;
        }
        const expiresAt = new Date(Date.now() + durationMs);
        
        console.log('QR expiration calculation:', { type, duration_minutes, duration_hours, durationMs, durationMinutes: Math.round(durationMs / (1000 * 60)), expiresAt: expiresAt.toISOString() });
        
        // Store session using Supabase helper
        const { createQRSession } = require('./supabaseClient');
        const session = await createQRSession(sessionId, expiresAt, creator_id, type);
        
        if (!session) {
            return res.status(500).json({ error: 'Failed to create QR session' });
        }
        
        // Generate QR code on-demand for immediate response
        session.imageDataUrl = await QRCode.toDataURL(sessionId, { margin: 1, width: 320 });
        
        // Log audit event
        await logAuditEvent(creator_id, 'QR_GENERATED', { sessionId, type, expiresAt });
        
        res.json({ session, message: 'QR code generated successfully' });
    } catch (e) {
        console.error('Generate QR error:', e);
        res.status(500).json({ error: 'Failed to generate QR code.' });
    }
});

server.post('/api/hr/qr/revoke', requireAuth(['hr', 'superadmin']), async (req, res) => {
    try {
        const revoker_id = req.auth.id;
        
        // Use Supabase helper
        const { deactivateAllQRSessions, logAuditEvent } = require('./supabaseClient');
        const revokedSessions = await deactivateAllQRSessions();
        
        if (revokedSessions) {
            // Log audit event
            await logAuditEvent(revoker_id, 'QR_REVOKED', { revokedSessions });
            
            res.json({ message: 'QR codes revoked successfully', revokedCount: revokedSessions.length });
        } else {
            res.status(500).json({ error: 'Failed to revoke QR codes.' });
        }
    } catch (e) {
        console.error('Revoke QR error:', e);
        res.status(500).json({ error: 'Failed to revoke QR codes.' });
    }
});

// Employee Management for HR
server.get('/api/hr/employees', requireAuth(['hr', 'superadmin']), async (req, res) => {
    try {
        // Use Supabase-only approach
        const { getHREmployees } = require('./supabaseClient');
        const employees = await getHREmployees(req.query);
        
        if (employees) {
            console.log('[hr] Supabase REST: Retrieved employees list');
            return res.json(employees);
        }
        
        // If no employees found or Supabase query failed
        console.log('[hr] No employees found in Supabase or query failed');
        return res.json([]);
        
    } catch (e) {
        console.error('Get HR employees error:', e);
        res.status(500).json({ error: 'Failed to fetch employees.' });
    }
});

// Get single employee by ID
server.get('/api/hr/employees/:id', requireAuth(['hr', 'superadmin']), async (req, res) => {
    try {
        const employee_id = parseInt(req.params.id, 10);
        
        if (isNaN(employee_id)) {
            return res.status(400).json({ error: 'Invalid employee ID.' });
        }
        
        // Use Supabase helper
        const { getEmployeeById } = require('./supabaseClient');
        const employee = await getEmployeeById(employee_id);
        
        if (!employee) {
            return res.status(404).json({ error: 'Employee not found.' });
        }
        
        res.json(employee);
    } catch (e) {
        console.error('Get employee error:', e);
        res.status(500).json({ error: 'Failed to fetch employee.' });
    }
});

server.post('/api/hr/employees', requireAuth(['hr', 'superadmin']), async (req, res) => {
    try {
        console.log('Create employee request received:', req.body);
        const { first_name, last_name, email, phone, address, position, role, status, dept_id, hire_date, password } = req.body;
        const creator_id = req.auth.id;
        
        console.log('Extracted fields:', { first_name, last_name, email, phone, position, role, status, dept_id, hire_date, password: password ? '[REDACTED]' : undefined, creator_id });
        
        if (!first_name || !last_name || !email || !password || !role || !status) {
            console.log('Validation failed: missing required fields');
            return res.status(400).json({ error: 'First name, last name, email, password, role, and status are required.' });
        }
        
        if (password.length < 6) {
            console.log('Validation failed: password too short');
            return res.status(400).json({ error: 'Password must be at least 6 characters long.' });
        }
        
        // Validate role
        const validRoles = ['employee', 'head_dept'];
        if (!validRoles.includes(role)) {
            console.log('Validation failed: invalid role:', role);
            return res.status(400).json({ error: 'Invalid role. Must be employee or head_dept.' });
        }
        
        // Validate status
        const validStatuses = ['active', 'inactive', 'suspended'];
        if (!validStatuses.includes(status)) {
            console.log('Validation failed: invalid status:', status);
            return res.status(400).json({ error: 'Invalid status. Must be active, inactive, or suspended.' });
        }
        
        // Validate phone format if provided
        if (phone && !/^\+63[0-9]{10}$/.test(phone)) {
            console.log('Validation failed: invalid phone format:', phone);
            return res.status(400).json({ error: 'Phone number must be in format: +63xxxxxxxxxx' });
        }
        
        console.log('All validation passed, checking for existing records...');
        
        // Check if email already exists in employees or users using Supabase helpers
        const { checkEmployeeEmailExists, checkUserEmailExists } = require('./supabaseClient');
        
        const employeeEmailExists = await checkEmployeeEmailExists(email);
        if (employeeEmailExists) {
            console.log('Validation failed: employee email already exists');
            return res.status(400).json({ error: 'Employee with this email already exists.' });
        }
        
        const userEmailExists = await checkUserEmailExists(email);
        if (userEmailExists) {
            console.log('Validation failed: user email already exists');
            return res.status(400).json({ error: 'User account with this email already exists.' });
        }
        
        console.log('No existing records found, proceeding with creation...');
        
        try {
            // Use Supabase helper
            const { createHREmployee, logAuditEvent } = require('./supabaseClient');
            const employeeData = { 
                first_name, last_name, email, phone, address, position, 
                role, status, dept_id, hire_date, password 
            };
            
            const result = await createHREmployee(employeeData, creator_id);
            
            if (result.success) {
                console.log('Employee creation completed successfully');
                
                // Log audit event
                await logAuditEvent(creator_id, 'EMPLOYEE_CREATED', { 
                    employeeId: result.employee.employee_id, 
                    userId: result.userId,
                    email,
                    role: role,
                    status: status,
                    userAccountCreated: true 
                });
                
                res.status(201).json(result.employee);
            } else {
                console.error('Create employee error:', result.error);
                if (result.error.includes('email already exists')) {
                    return res.status(400).json({ error: result.error });
                }
                return res.status(500).json({ error: result.error });
            }
        } catch (error) {
            console.error('Create employee error:', error);
            throw error;
        }
    } catch (e) {
        console.error('Create employee error:', e);
        console.error('Request body was:', req.body);
        console.error('Stack trace:', e.stack);
        res.status(500).json({ error: 'Failed to create employee: ' + e.message });
    }
});

server.put('/api/hr/employees/:id', requireAuth(['hr', 'superadmin']), async (req, res) => {
    try {
        const employeeId = parseInt(req.params.id, 10);
        const { first_name, last_name, email, phone, address, position, dept_id, status } = req.body;
        const updater_id = req.auth.id;
        
        if (!first_name || !last_name || !email) {
            return res.status(400).json({ error: 'First name, last name, and email are required.' });
        }
        
        // Validate status if provided
        if (status && !['active', 'inactive', 'suspended'].includes(status)) {
            return res.status(400).json({ error: 'Invalid status. Must be active, inactive, or suspended.' });
        }
        
        // Validate phone format if provided
        if (phone && !/^\+63[0-9]{10}$/.test(phone)) {
            return res.status(400).json({ error: 'Phone number must be in format: +63xxxxxxxxxx' });
        }
        
        // Check if email exists for another employee using Supabase helper
        const { checkEmployeeEmailExistsForOther, updateEmployee, logAuditEvent } = require('./supabaseClient');
        const emailExistsForOther = await checkEmployeeEmailExistsForOther(email, employeeId);
        if (emailExistsForOther) {
            return res.status(400).json({ error: 'Email is already used by another employee.' });
        }
        
        // Use Supabase helper to update employee
        const result = await updateEmployee(employeeId, {
            first_name, last_name, email, phone, address, position, dept_id, status
        });
        
        if (!result) {
            return res.status(404).json({ error: 'Employee not found.' });
        }
        
        // Log audit event
        await logAuditEvent(updater_id, 'EMPLOYEE_UPDATED', { employeeId, email });
        
        res.json(result);
    } catch (e) {
        console.error('Update employee error:', e);
        res.status(500).json({ error: 'Failed to update employee.' });
    }
});

server.delete('/api/hr/employees/:id', requireAuth(['hr', 'superadmin']), async (req, res) => {
    try {
        const employeeId = parseInt(req.params.id, 10);
        const deleter_id = req.auth.id;
        
        // Use Supabase helper for soft delete
        const { deactivateEmployee, logAuditEvent } = require('./supabaseClient');
        const result = await deactivateEmployee(employeeId);
        
        if (!result) {
            return res.status(404).json({ error: 'Employee not found.' });
        }
        
        // Log audit event
        await logAuditEvent(deleter_id, 'EMPLOYEE_DELETED', { 
            employeeId, 
            email: result.email,
            name: result.full_name 
        });
        
        res.json({ message: 'Employee deactivated successfully.' });
    } catch (e) {
        console.error('Delete employee error:', e);
        res.status(500).json({ error: 'Failed to delete employee.' });
    }
});

// Update employee role (temporary endpoint for fixing department head issue)
server.put('/api/hr/employees/:id/role', requireAuth(['hr', 'superadmin']), async (req, res) => {
    try {
        const employeeId = parseInt(req.params.id, 10);
        const { role_name } = req.body;
        const updater_id = req.auth.id;
        
        if (!role_name) {
            return res.status(400).json({ error: 'Role name is required.' });
        }
        
        // Get the employee to find their user_id
        const { getEmployeeById, updateUserRole, getAllRoles, logAuditEvent } = require('./supabaseClient');
        const employee = await getEmployeeById(employeeId);
        
        if (!employee) {
            return res.status(404).json({ error: 'Employee not found.' });
        }
        
        // Get the role_id for the role_name
        const roles = await getAllRoles();
        const role = roles.find(r => r.role_name === role_name);
        
        if (!role) {
            return res.status(400).json({ error: 'Invalid role name.' });
        }
        
        // Update the user's role
        const updatedUser = await updateUserRole(employee.user_id, role.role_id);
        
        // Log audit event
        await logAuditEvent(updater_id, 'EMPLOYEE_ROLE_UPDATED', { 
            employeeId, 
            employeeName: employee.full_name,
            oldRole: employee.role,
            newRole: role_name,
            userId: employee.user_id
        });
        
        console.log(`[hr] Updated employee ${employeeId} (${employee.full_name}) role to ${role_name}`);
        res.json({ message: 'Employee role updated successfully.', role: role_name });
    } catch (e) {
        console.error('Update employee role error:', e);
        res.status(500).json({ error: 'Failed to update employee role.' });
    }
});

// Get department heads (users with role_id = 3)
server.get('/api/hr/department-heads', requireAuth(['hr', 'superadmin']), async (req, res) => {
    try {
        const { getDepartmentHeads } = require('./supabaseClient');
        const heads = await getDepartmentHeads();
        
        console.log(`[hr] Retrieved ${heads.length} department heads`);
        res.json(heads);
    } catch (e) {
        console.error('Get department heads error:', e);
        res.status(500).json({ error: 'Failed to retrieve department heads.' });
    }
});

// Attendance Reports for HR
server.get('/api/hr/attendance', requireAuth(['hr', 'superadmin']), async (req, res) => {
    try {
        // Use Supabase-only approach
        const { getHRAttendance } = require('./supabaseClient');
        const { date, department, employee_id, start_date, end_date } = req.query;
        
        // Map query params to Supabase format
        const filters = {
            startDate: start_date || date,
            endDate: end_date || date,
            department,
            employee: employee_id
        };
        
        const attendance = await getHRAttendance(filters);
        
        if (attendance) {
            console.log('[hr] Supabase REST: Retrieved attendance records');
            return res.json(attendance);
        }
        
        // If no attendance found or Supabase query failed
        console.log('[hr] No attendance records found in Supabase or query failed');
        return res.json([]);
        
    } catch (e) {
        console.error('Get HR attendance error:', e);
        res.status(500).json({ error: 'Failed to fetch attendance records.' });
    }
});

// Attendance Override for HR
server.post('/api/hr/attendance/override', requireAuth(['hr', 'superadmin']), async (req, res) => {
    try {
        const { employee_id, date, time_in, time_out, status, reason } = req.body;
        const creator_id = req.auth.id;
        
        if (!employee_id || !date || !status) {
            return res.status(400).json({ error: 'Employee ID, date, and status are required.' });
        }
        
        // Check if employee exists using Supabase helper
        const { checkEmployeeExists } = require('./supabaseClient');
        const employeeExists = await checkEmployeeExists(employee_id);
        if (!employeeExists) {
            return res.status(404).json({ error: 'Employee not found.' });
        }
        
        // Check if attendance record already exists for this date using Supabase helper
        const { getAttendanceByEmployeeAndDate, overrideAttendanceRecord, logAuditEvent } = require('./supabaseClient');
        const existingRecord = await getAttendanceByEmployeeAndDate(employee_id, date);
        
        // Use Supabase helper for attendance override
        const result = await overrideAttendanceRecord(employee_id, date, {
            time_in, time_out, status, reason
        }, creator_id);
        
        if (!result) {
            return res.status(500).json({ error: 'Failed to override attendance record.' });
        }
        
        // Log audit event
        await logAuditEvent(creator_id, 'ATTENDANCE_OVERRIDE', { 
            employeeId: employee_id, 
            date, 
            status, 
            reason,
            action: result.action
        });
        
        res.json({ 
            message: 'Attendance record updated successfully.',
            record: result.data
        });
    } catch (e) {
        console.error('Attendance override error:', e);
        res.status(500).json({ error: 'Failed to override attendance record.' });
    }
});

// Departments list for HR
server.get('/api/hr/departments', requireAuth(['hr', 'superadmin']), async (req, res) => {
    try {
        // Use Supabase-only approach
        const { getDepartments } = require('./supabaseClient');
        const departments = await getDepartments();
        
        if (departments) {
            console.log('[hr] Supabase REST: Retrieved departments list');
            return res.json(departments);
        }
        
        // If no departments found or Supabase query failed
        console.log('[hr] No departments found in Supabase or query failed');
        return res.json([]);
        
    } catch (e) {
        console.error('Get departments error:', e);
        res.status(500).json({ error: 'Failed to fetch departments.' });
    }
});

// Basic departments list for all authenticated users (for profile modal)
server.get('/api/departments', requireAuth([]), async (req, res) => {
    try {
        // Use Supabase helper
        const { getBasicDepartments } = require('./supabaseClient');
        const departments = await getBasicDepartments();
        
        if (departments) {
            res.json(departments);
        } else {
            res.status(500).json({ error: 'Failed to fetch departments.' });
        }
    } catch (e) {
        console.error('Get departments error:', e);
        res.status(500).json({ error: 'Failed to fetch departments.' });
    }
});

// Basic roles list for all authenticated users (for invitation modal)
server.get('/api/roles', requireAuth([]), async (req, res) => {
    try {
        // Use Supabase helper
        const { getAllRoles } = require('./supabaseClient');
        const roles = await getAllRoles();
        
        if (roles) {
            res.json(roles);
        } else {
            res.status(500).json({ error: 'Failed to fetch roles.' });
        }
    } catch (e) {
        console.error('Get roles error:', e);
        res.status(500).json({ error: 'Failed to fetch roles.' });
    }
});

// Update department head assignment
server.put('/api/hr/departments/:id/head', requireAuth(['hr', 'superadmin']), async (req, res) => {
    try {
        const deptId = parseInt(req.params.id);
        const { head_id } = req.body;
        
        // Validate department exists using Supabase helper
        const { getDepartmentById } = require('./supabaseClient');
        const department = await getDepartmentById(deptId);
        if (!department) {
            return res.status(404).json({ error: 'Department not found.' });
        }
        
        // If head_id is provided, validate it exists and is a department head
        if (head_id) {
            const { validateDepartmentHead } = require('./supabaseClient');
            const headCheck = await validateDepartmentHead(head_id);
            
            if (!headCheck) {
                return res.status(400).json({ error: 'Employee not found.' });
            }
            
            if (headCheck.role_name !== 'head_dept') {
                return res.status(400).json({ error: 'Employee must have Department Head role.' });
            }
        }
        
        // Update department head using Supabase helper
        const { updateDepartmentHead } = require('./supabaseClient');
        await updateDepartmentHead(deptId, head_id);
        
        // Log audit event
        await logAuditEvent(req.auth.id, 'DEPARTMENT_HEAD_ASSIGNED', {
            departmentId: deptId,
            departmentName: department.dept_name,
            headId: head_id,
            action: head_id ? 'assigned' : 'removed'
        });
        
        res.json({ 
            success: true, 
            message: head_id ? 'Department head assigned successfully.' : 'Department head removed successfully.' 
        });
        
    } catch (e) {
        console.error('Update department head error:', e);
        res.status(500).json({ error: 'Failed to update department head.' });
    }
});


// --- Request Management API ---

server.get('/api/requests/pending', requireAuth(['head_dept', 'hr', 'superadmin']), async (req, res) => {
    try {
        const { department } = req.query;
        const { role, id } = req.auth;

        // Use Supabase helper
        const { getPendingRequests } = require('./supabaseClient');
        const requests = await getPendingRequests(req.auth, department);
        
        if (requests !== null) {
            return res.json(requests);
        } else {
            return res.status(500).json({ error: 'Failed to fetch pending requests.' });
        }
    } catch (e) {
        console.error('get pending requests error', e);
        return res.status(500).json({ error: 'Failed to fetch pending requests.' });
    }
});

server.put('/api/requests/:id/status', requireAuth(['head_dept', 'hr', 'superadmin']), async (req, res) => {
    try {
        const requestId = parseInt(req.params.id, 10);
        const { status } = req.body;
        const approver_id = req.auth.id;

        if (isNaN(requestId) || !['approved', 'declined'].includes(status)) {
            return res.status(400).json({ error: 'Invalid request ID or status.' });
        }

        // Use Supabase helper
        const { updateRequestStatus } = require('./supabaseClient');
        const result = await updateRequestStatus(requestId, status, approver_id);

        if (!result) {
            return res.status(404).json({ error: 'Request not found or already actioned.' });
        }
        
        console.log(`[requests] Request ${requestId} was ${status} by user ${approver_id}`);
        return res.json(result);
    } catch (e) {
        console.error('update request status error', e);
        return res.status(500).json({ error: 'Failed to update request status.' });
    }
});

server.post('/api/requests', requireAuth([]), async (req, res) => {
    try {
        // Accept either `request_type` (frontend) or `type` (db-friendly)
        const body = req.body || {};
        const request_type = body.request_type || body.type;
        const details = body.details;
        const employee_id = req.auth.employee_id;

        if (!employee_id) {
            return res.status(400).json({ error: 'Only employees can create requests.' });
        }
        if (!['leave', 'overtime', 'correction'].includes(request_type)) {
            return res.status(400).json({ error: 'Invalid request_type.' });
        }
        if (!details || typeof details !== 'object') {
            return res.status(400).json({ error: 'Details must be a valid JSON object.' });
        }

        // Create request using Supabase helper
        const { createRequest } = require('./supabaseClient');
        const result = await createRequest(employee_id, request_type, details);
        
        if (result !== null) {
            console.log(`[requests] Supabase: New ${request_type} request created for employee ${employee_id}`);
            return res.status(201).json(result);
        } else {
            console.error('[requests] Supabase: Failed to create request');
            return res.status(500).json({ error: 'Failed to create request.' });
        }
    } catch (e) {
        console.error('request creation error', e);
        return res.status(500).json({ error: 'Failed to create request.' });
    }
});

server.get('/api/requests', requireAuth([]), async (req, res) => {
    try {
        const { id, role, employee_id } = req.auth;
        const { status, type } = req.query;

        // Use Supabase helper
        const { getRequests } = require('./supabaseClient');
        const requests = await getRequests(req.auth, { status, type });
        
        if (requests !== null) {
            console.log('[requests] Supabase: Retrieved', requests.length, 'requests');
            return res.json(requests);
        } else {
            console.error('[requests] Supabase: Failed to retrieve requests');
            return res.status(500).json({ error: 'Failed to fetch requests.' });
        }
    } catch (e) {
        console.error('get requests error', e);
        return res.status(500).json({ error: 'Failed to fetch requests.' });
    }
});

server.put('/api/requests/:id', requireAuth(['hr', 'super_admin', 'department_head']), async (req, res) => {
    try {
        const requestId = parseInt(req.params.id, 10);
        const { status } = req.body;
        const approver_id = req.auth.id;
        const approver_role = req.auth.role;

        if (isNaN(requestId)) {
            return res.status(400).json({ error: 'Invalid request ID.' });
        }
        if (!['approved', 'declined'].includes(status)) {
            return res.status(400).json({ error: 'Invalid status. Must be "approved" or "declined".' });
        }

        // Use Supabase helper with permission checks and notifications
        const { approveRequestWithNotification } = require('./supabaseClient');
        const result = await approveRequestWithNotification(requestId, status, approver_id, approver_role);

        console.log(`[requests] Request ${requestId} was ${status} by user ${approver_id}`);
        return res.json(result);
    } catch (e) {
        console.error('update request error', e);
        
        if (e.message.includes('Forbidden')) {
            return res.status(403).json({ error: e.message });
        } else if (e.message.includes('not found')) {
            return res.status(404).json({ error: e.message });
        } else {
            return res.status(500).json({ error: 'Failed to update request.' });
        }
    }
});

// --- Notifications API ---

// GET /api/notifications - Get unread notifications for the current user
server.get('/api/notifications', requireAuth([]), async (req, res) => {
    try {
        const userId = req.auth.id;
        
        // Use Supabase helper
        const { getNotifications } = require('./supabaseClient');
        const notifications = await getNotifications(userId);
        
        if (notifications !== null) {
            console.log('[notifications] Supabase: Retrieved', notifications.length, 'notifications');
            return res.json(notifications);
        } else {
            console.error('[notifications] Supabase: Failed to retrieve notifications');
            return res.status(500).json({ error: 'Failed to fetch notifications.' });
        }
    } catch (e) {
        console.error('get notifications error', e);
        return res.status(500).json({ error: 'Failed to fetch notifications.' });
    }
});

// PUT /api/notifications/mark-read - Mark specific or all notifications as read
server.put('/api/notifications/mark-read', requireAuth([]), async (req, res) => {
    try {
        const userId = req.auth.id;
        const { ids } = req.body; // ids can be an array of notification IDs or null/undefined for all

        // Use Supabase helper
        const { markNotificationsRead } = require('./supabaseClient');
        const result = await markNotificationsRead(userId, ids);
        
        if (result !== null) {
            console.log('[notifications] Supabase: Marked notifications as read');
            return res.json({ ok: true, count: result?.length || 0 });
        } else {
            console.error('[notifications] Supabase: Failed to mark notifications as read');
            return res.status(500).json({ error: 'Failed to update notifications.' });
        }
    } catch (e) {
        console.error('mark notifications read error', e);
        return res.status(500).json({ error: 'Failed to update notifications.' });
    }
});

// --- Account Management ---

// PUT /api/account/password - Change user password
server.put('/api/account/password', requireAuth([]), async (req, res) => {
    try {
        const userId = req.auth.id;
        const { currentPassword, newPassword } = req.body;

        if (!currentPassword || !newPassword) {
            return res.status(400).json({ error: 'Current password and new password are required.' });
        }
        if (newPassword.length < 8) {
            return res.status(400).json({ error: 'New password must be at least 8 characters long.' });
        }

        // Get current user info using Supabase helper
        const { getUserForPasswordReset, updateUserPassword } = require('./supabaseClient');
        const user = await getUserForPasswordReset(userId);
        
        if (!user) {
            return res.status(404).json({ error: 'User not found.' });
        }

        // Verify current password
        const isMatch = await bcrypt.compare(currentPassword, user.password_hash);
        if (!isMatch) {
            return res.status(401).json({ error: 'Incorrect current password.' });
        }

        // Hash new password
        const newPasswordHash = await bcrypt.hash(newPassword, 10);

        // Update password using Supabase helper
        await updateUserPassword(userId, newPasswordHash);

        console.log(`[account] User ${userId} changed their password successfully.`);
        return res.json({ ok: true, message: 'Password updated successfully.' });
    } catch (e) {
        console.error('change password error', e);
        return res.status(500).json({ error: 'Failed to change password.' });
    }
});

// Health endpoint (placed at /health instead of /api/health to avoid json-server router conflicts)
server.get('/health', async (req, res) => {
    const requester = req.ip || req.connection && req.connection.remoteAddress || 'unknown';
    const ua = req.get('User-Agent') || 'unknown';
    console.log(`[server] /health requested from ${requester} - UA: ${ua}`);
    
    try {
        // Supabase-only health check
        const { supabase, isSupabaseEnabled } = require('./supabaseClient');
        if (supabase && isSupabaseEnabled()) {
            // Test Supabase connection with a simple query
            const { data, error } = await supabase.from('users').select('user_id').limit(1);
            if (error) {
                console.error('[server] /health FAILED - Supabase:', error.message);
                return res.status(503).json({ 
                    ok: false, 
                    db: { ok: false, error: `Supabase error: ${error.message}` },
                    supabase: { ok: false, error: error.message },
                    architecture: 'REST + RPC (Supabase-only)'
                });
            }
            console.log(`[server] /health OK - Supabase REST + RPC system working`);
            return res.json({ 
                ok: true, 
                db: { ok: true, type: 'supabase-rest-rpc' },
                supabase: { ok: true, connection: 'active' },
                architecture: 'REST + RPC (Supabase-only)',
                pool_dependency: 'removed'
            });
        }
        
        // If Supabase is not configured
        console.error('[server] /health FAILED - Supabase client not configured');
        return res.status(503).json({ 
            ok: false, 
            db: { ok: false, error: 'Supabase client not initialized - check environment variables' },
            supabase: { ok: false, error: 'not-configured' },
            architecture: 'REST + RPC (Supabase-only)',
            pool_dependency: 'removed'
        });
    } catch (e) {
        console.error('[server] /health FAILED -', e.message || e);
        return res.status(503).json({ 
            ok: false, 
            db: { ok: false, error: (e && e.message) ? e.message : String(e) },
            supabase: { ok: false, error: 'connection-failed' },
            architecture: 'REST + RPC (Supabase-only)',
            pool_dependency: 'removed'
        });
    }
});

// Lightweight ping endpoint for uptime monitors (returns plain text "OK" by default)
// - Non-cached (Cache-Control headers) so external pingers always receive a fresh 200
// - Returns JSON when client asks for application/json
server.get('/health/ping', (req, res) => {
    // Prevent caching so pings always hit the app
    res.set('Cache-Control', 'no-cache, no-store, must-revalidate, max-age=0');
    res.set('Pragma', 'no-cache');
    res.set('Expires', '0');

    const accept = (req.get('Accept') || '').toLowerCase();
    if (accept.includes('application/json')) {
        return res.json({ ok: true, message: 'Service alive (ping)' });
    }

    return res.type('text/plain').send('OK');
});

// ============ INVITATION ENDPOINTS ============

// Create new invitation (HR/Admin only)
server.post('/api/admin/invitations', requireAuth(['hr', 'superadmin']), async (req, res) => {
    try {
        const { email, role_id, dept_id, expires_in_hours, metadata } = req.body;
        
        // Validate input
        if (!email || !role_id) {
            return res.status(400).json({ 
                error: 'Email and role_id are required' 
            });
        }
        
        // Generate token and expiry
        const rawToken = generateRawToken();
        const tokenHash = hashToken(rawToken);
        const expiresAt = new Date();
        expiresAt.setHours(expiresAt.getHours() + (expires_in_hours || 24));
        
        // Create invitation in database
        const result = await createInvitation({
            email: email.toLowerCase().trim(),
            role_id,
            dept_id,
            token_hash: tokenHash,
            expires_at: expiresAt.toISOString(),
            metadata: metadata || {}
        }, req.auth.id);
        
        if (!result.success) {
            return res.status(400).json({ error: result.error });
        }
        
        // Generate invite link and send email
        const baseUrl = process.env.BASE_URL || 'http://localhost:5000';
        const inviteLink = generateInviteLink(baseUrl, rawToken);
        const emailService = new EmailService();
        const emailResult = await emailService.sendInvitationEmail({
            email,
            inviteLink,
            roleName: result.invitation.role_name,
            departmentName: result.invitation.dept_name || 'N/A',
            inviterName: req.auth.email || 'Administrator',
            expiresAt: expiresAt.toISOString()
        });
        
        // Log email status but don't fail the invitation creation
        if (!emailResult.success) {
            console.warn('[server] Email failed to send:', emailResult.error);
        }
        
        res.status(201).json({
            message: 'Invitation created successfully',
            invitation: {
                id: result.invitation.id,
                email: result.invitation.email,
                role_name: result.invitation.role_name,
                dept_name: result.invitation.dept_name,
                expires_at: result.invitation.expires_at,
                invite_link: inviteLink // Include for admin to manually share if needed
            },
            email_sent: emailResult.success
        });
        
    } catch (error) {
        console.error('[server] Create invitation error:', error.message);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Get pending invitations (HR/Admin only)
server.get('/api/admin/invitations', requireAuth(['hr', 'superadmin']), async (req, res) => {
    try {
        const { role, department, limit, offset } = req.query;
        
        const invitations = await getPendingInvitations({
            role,
            department,
            limit: limit ? parseInt(limit) : 50,
            offset: offset ? parseInt(offset) : 0
        });
        
        if (invitations === null) {
            return res.status(500).json({ error: 'Failed to fetch invitations' });
        }
        
        res.json({ 
            invitations,
            count: invitations.length
        });
        
    } catch (error) {
        console.error('[server] Get invitations error:', error.message);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Resend invitation (HR/Admin only)
server.post('/api/admin/invitations/:id/resend', requireAuth(['hr', 'superadmin']), async (req, res) => {
    try {
        const invitationId = req.params.id;
        const { expires_in_hours } = req.body;
        
        // Generate new token and expiry
        const rawToken = generateRawToken();
        const tokenHash = hashToken(rawToken);
        const expiresAt = new Date();
        expiresAt.setHours(expiresAt.getHours() + (expires_in_hours || 24));
        
        // Update invitation with new token
        const result = await resendInvitation(
            invitationId,
            tokenHash,
            expiresAt.toISOString(),
            req.user.user_id
        );
        
        if (!result.success) {
            return res.status(400).json({ error: result.error });
        }
        
        // Send new email
        const inviteLink = generateInviteLink(rawToken);
        const emailService = new EmailService();
        const emailResult = await emailService.sendInvitationEmail({
            email: result.invitation.email,
            inviteLink,
            roleName: result.invitation.role_name,
            departmentName: result.invitation.dept_name || 'N/A',
            inviterName: req.user.username || 'Administrator',
            expiresAt: expiresAt.toISOString()
        });
        
        res.json({
            message: 'Invitation resent successfully',
            invitation: {
                ...result.invitation,
                invite_link: inviteLink
            },
            email_sent: emailResult.success
        });
        
    } catch (error) {
        console.error('[server] Resend invitation error:', error.message);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Cancel invitation (HR/Admin only)
server.delete('/api/admin/invitations/:id', requireAuth(['hr', 'superadmin']), async (req, res) => {
    try {
        const invitationId = req.params.id;
        
        const result = await cancelInvitation(invitationId, req.user.user_id);
        
        if (!result.success) {
            return res.status(400).json({ error: result.error });
        }
        
        res.json({ message: 'Invitation cancelled successfully' });
        
    } catch (error) {
        console.error('[server] Cancel invitation error:', error.message);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Verify invitation token (Public endpoint for invite acceptance page)
server.get('/api/invitations/verify/:token', async (req, res) => {
    try {
        const rawToken = req.params.token;
        
        if (!rawToken) {
            return res.status(400).json({ 
                valid: false, 
                error: 'Token is required' 
            });
        }
        
        // Hash token to check against database
        const tokenHash = hashToken(rawToken);
        const verification = await verifyInvitationToken(tokenHash);
        
        if (!verification.valid) {
            return res.status(400).json({
                valid: false,
                error: verification.reason,
                used_at: verification.used_at,
                expires_at: verification.expires_at
            });
        }
        
        // Return invitation details without sensitive data
        res.json({
            valid: true,
            invitation: {
                email: verification.invitation.email,
                role_name: verification.invitation.role_name,
                dept_name: verification.invitation.dept_name,
                expires_at: verification.invitation.expires_at
            }
        });
        
    } catch (error) {
        console.error('[server] Verify invitation error:', error.message);
        res.status(500).json({ 
            valid: false, 
            error: 'Internal server error' 
        });
    }
});

// Accept invitation and create account (Public endpoint)
server.post('/api/auth/accept-invite', async (req, res) => {
    try {
        const { token, first_name, last_name, password } = req.body;
        
        // Validate input
        if (!token || !first_name || !last_name || !password) {
            return res.status(400).json({
                error: 'All fields are required: token, first_name, last_name, password'
            });
        }
        
        // Validate password strength
        if (password.length < 8) {
            return res.status(400).json({
                error: 'Password must be at least 8 characters long'
            });
        }
        
        // Hash token to check against database
        const tokenHash = hashToken(token);
        
        // Accept invitation and create account
        const result = await acceptInvitation(tokenHash, {
            first_name: first_name.trim(),
            last_name: last_name.trim(),
            password
        });
        
        if (!result.success) {
            return res.status(400).json({ error: result.error });
        }
        
        // Generate JWT token for immediate login
        const jwtToken = jwt.sign(
            { 
                user_id: result.user.user_id,
                email: result.user.email,
                role: result.user.role
            },
            SECRET,
            { expiresIn: JWT_EXPIRES_IN }
        );
        
        res.status(201).json({
            message: 'Account created successfully',
            user: {
                user_id: result.user.user_id,
                email: result.user.email,
                role: result.user.role,
                department: result.user.department,
                first_name: result.user.first_name,
                last_name: result.user.last_name
            },
            token: jwtToken
        });
        
    } catch (error) {
        console.error('[server] Accept invitation error:', error.message);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// mount router
server.use('/api', router);

const PORT = process.env.PORT || 5000;

// Run connectivity check
checkPostgresConnection();

server.listen(PORT, () => {
    console.log(`Mock server running at http://localhost:${PORT}`);
    console.log('[server] API mount: /api  (json-server router + custom routes)');
    console.log('[server] Serving static files from:', publicPath);
    console.log('[server] Database: Supabase REST + RPC (PostgreSQL pool removed)');
    console.log('[server] Supabase URL:', maskDatabaseUrl());
    console.log('[server] JWT secret set?', !!process.env.JWT_SECRET);
    console.log('[server] Environment:', process.env.NODE_ENV || 'development');
    console.log('[server] Architecture: Pure REST + RPC (no pool dependency)');
});
 