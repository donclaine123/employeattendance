// Load environment variables from .env file
require('dotenv').config();

const jsonServer = require('json-server');
const path = require('path');
const bodyParser = require('body-parser');
const cors = require('cors');
const cookieParser = require('cookie-parser');

const server = jsonServer.create();
const router = jsonServer.router(path.join(__dirname, 'db.json'));
const middlewares = jsonServer.defaults({ static: 'public' });
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const SECRET = process.env.JWT_SECRET || 'dev-secret-key';
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '8h';

// Import refresh token utilities
const {
    generateRefreshToken,
    hashRefreshToken,
    storeRefreshToken,
    validateRefreshToken,
    rotateRefreshToken,
    revokeRefreshToken,
    revokeAllUserTokens
} = require('./utils/refreshTokens');

// Import cookie configuration
const {
    ACCESS_TOKEN_EXPIRES_IN,
    ACCESS_TOKEN_COOKIE_NAME,
    REFRESH_TOKEN_COOKIE_NAME,
    getAccessTokenCookieOptions,
    getRefreshTokenCookieOptions,
    clearAuthCookies
} = require('./utils/cookieConfig');

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
// Expose X-Total-Count so the frontend can read pagination totals from responses
// IMPORTANT: credentials: true allows cookies to be sent/received
// PRODUCTION: Must specify exact origin for SameSite cookies to work properly
const FRONTEND_URL = process.env.FRONTEND_URL || 'https://employeeattendance.me';
const allowedOrigins = [
    FRONTEND_URL,
    'https://backend-rxe4.onrender.com',
    'https://employeeattendance.me', // Explicit fallback for production
    'http://localhost:5000', // For local testing
    'http://127.0.0.1:5000'
].filter(Boolean); // Remove any undefined/null values

console.log('[CORS] Allowed origins configured:', allowedOrigins);
console.log('[CORS] NODE_ENV:', process.env.NODE_ENV);

server.use(cors({ 
    origin: function (origin, callback) {
        // Allow requests with no origin (like mobile apps or Postman)
        if (!origin) {
            console.log('[CORS] Request with no origin - allowing');
            return callback(null, true);
        }
        
        console.log('[CORS] Checking origin:', origin, 'against allowed:', allowedOrigins);
        
        if (allowedOrigins.indexOf(origin) !== -1) {
            console.log('[CORS] Origin allowed:', origin);
            callback(null, true);
        } else if (process.env.NODE_ENV !== 'production') {
            console.log('[CORS] Non-production mode - allowing origin:', origin);
            callback(null, true);
        } else {
            console.warn('[CORS] Blocked origin:', origin, '(allowed:', allowedOrigins, ')');
            callback(new Error('Not allowed by CORS'));
        }
    },
    credentials: true, 
    exposedHeaders: ['X-Total-Count'],
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'Accept']
}));

// Parse cookies and body BEFORE json-server middleware
server.use(cookieParser());
server.use(bodyParser.json());

// serve the SPA static files from ../public
const publicPath = path.join(__dirname, '..', 'public');
server.use(jsonServer.defaults({ static: publicPath }));
server.use(expressStaticFallback = (req, res, next) => { next(); });

server.use(middlewares);

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
        
        // Allow active users and pending users (for first login)
        if (user.status !== 'active' && user.status !== 'pending') {
            return res.status(403).json({ error: 'User account is not active' });
        }

        // Validate password
        let valid = false;
        if (user.password_hash) {
            try { valid = await bcrypt.compare(password, user.password_hash); } catch(e) { valid = false; }
        }
        if (!valid) return res.status(401).json({ error: 'Invalid credentials' });

        // Auto-activate pending users on successful login
        if (user.status === 'pending') {
            try {
                const { supabase } = require('./supabaseClient');
                
                // Update user status to active
                const { error: userUpdateError } = await supabase
                    .from('users')
                    .update({ 
                        status: 'active',
                        first_login: false,
                        updated_at: new Date().toISOString()
                    })
                    .eq('user_id', user.user_id);
                
                if (!userUpdateError) {
                    // Also update employee status if exists
                    await supabase
                        .from('employees')
                        .update({ 
                            status: 'active',
                            updated_at: new Date().toISOString()
                        })
                        .eq('employee_id', user.user_id)
                        .eq('status', 'pending');
                    
                    // Update local user object for the login process
                    user.status = 'active';
                    user.first_login = false;
                    
                    console.log('[login] Auto-activated pending user:', email);
                }
            } catch (activationError) {
                console.error('[login] Failed to auto-activate user:', activationError);
                // Continue with login even if activation fails
            }
        }

        // SINGLE SESSION ENFORCEMENT: Revoke all existing sessions and tokens for this user
        // This ensures only one active login per account (latest login wins)
        try {
            console.log('[login] Enforcing single-session policy for user:', user.user_id);
            
            // 1. Revoke all existing refresh tokens for this user
            await revokeAllUserTokens(user.user_id);
            console.log('[login] Revoked all existing refresh tokens for user:', user.user_id);
            
            // 2. Force logout all existing sessions for this user
            const { supabase } = require('./supabaseClient');
            const { data: existingSessions } = await supabase
                .from('user_sessions')
                .select('session_id')
                .eq('user_id', user.user_id)
                .is('logout_time', null);
            
            if (existingSessions && existingSessions.length > 0) {
                console.log('[login] Found', existingSessions.length, 'active sessions to terminate');
                
                // Set logout_time for all active sessions
                const { error: logoutError } = await supabase
                    .from('user_sessions')
                    .update({ 
                        logout_time: new Date().toISOString(),
                        updated_at: new Date().toISOString()
                    })
                    .eq('user_id', user.user_id)
                    .is('logout_time', null);
                
                if (logoutError) {
                    console.error('[login] Error terminating existing sessions:', logoutError);
                } else {
                    console.log('[login] Successfully terminated all existing sessions');
                }
            }
        } catch (cleanupError) {
            console.error('[login] Error during session cleanup:', cleanupError);
            // Continue with login even if cleanup fails
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

                // Generate short-lived access token
                const accessToken = jwt.sign({ 
                    id: safe.id, 
                    email: safe.email, 
                    role: safe.role, 
                    employee_id: safe.employee_id, 
                    sessionId: rpcResult.session_id 
                }, SECRET, { expiresIn: ACCESS_TOKEN_EXPIRES_IN });

                // Generate refresh token
                const refreshToken = generateRefreshToken();
                const refreshTokenHash = hashRefreshToken(refreshToken);

                // Store refresh token in database
                await storeRefreshToken(rpcUser.user_id, refreshTokenHash, {
                    deviceInfo: req.get('User-Agent'),
                    ipAddress: ipAddress
                });

                // Set HttpOnly cookies
                res.cookie(ACCESS_TOKEN_COOKIE_NAME, accessToken, getAccessTokenCookieOptions());
                res.cookie(REFRESH_TOKEN_COOKIE_NAME, refreshToken, getRefreshTokenCookieOptions());

                console.log('[login] Cookies set for user:', safe.email);
                
                // Return user data without tokens
                return res.json({ 
                    success: true,
                    user: safe,
                    message: 'Login successful'
                });
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

// Refresh access token using refresh token
server.post('/api/auth/refresh', async (req, res) => {
    try {
        const refreshToken = req.cookies[REFRESH_TOKEN_COOKIE_NAME];

        // DEBUG: log whether refresh cookie was received (do not log token value)
        try {
            console.log('[refresh] Cookies received by server:', Object.keys(req.cookies || {}));
            console.log('[refresh] Refresh token present in cookies:', !!refreshToken);
        } catch (e) { console.warn('[refresh] Failed to log cookies'); }

        if (!refreshToken) {
            console.warn('[refresh] No refresh token provided in request');
            return res.status(401).json({ error: 'No refresh token provided' });
        }

        // Validate refresh token
        const tokenRecord = await validateRefreshToken(refreshToken);

        if (!tokenRecord) {
            // DEBUG: token validation failed
            console.warn('[refresh] validateRefreshToken returned no record for provided token');
            clearAuthCookies(res);
            return res.status(401).json({ error: 'Invalid or expired refresh token' });
        }

        // Rotate refresh token (security best practice)
        const newRefreshToken = await rotateRefreshToken(refreshToken, {
            deviceInfo: req.get('User-Agent'),
            ipAddress: req.ip || req.connection?.remoteAddress
        });

        if (!newRefreshToken) {
            clearAuthCookies(res);
            return res.status(401).json({ error: 'Token rotation failed' });
        }

        // Get the active session_id for this user from user_sessions
        let sessionId = null;
        try {
            const { supabase } = require('./supabaseClient');
            const { data: sessionData } = await supabase
                .from('user_sessions')
                .select('session_id')
                .eq('user_id', tokenRecord.user_id)
                .is('logout_time', null)
                .maybeSingle();
            
            if (sessionData && sessionData.session_id) {
                sessionId = sessionData.session_id;
                console.log('[refresh] Found active session for user:', tokenRecord.user_id);
            } else {
                console.warn('[refresh] No active session found for user:', tokenRecord.user_id);
            }
        } catch (err) {
            console.error('[refresh] Error fetching session:', err);
            // Continue anyway - will generate a new session if needed
        }

        // Generate new access token with sessionId preserved
        const newAccessToken = jwt.sign({
            id: tokenRecord.user_id,
            email: tokenRecord.username,
            role: tokenRecord.role_name,
            employee_id: tokenRecord.employee_id || null,
            sessionId: sessionId  // Include sessionId for session validation
        }, SECRET, { expiresIn: ACCESS_TOKEN_EXPIRES_IN });

        // Set new cookies
        res.cookie(ACCESS_TOKEN_COOKIE_NAME, newAccessToken, getAccessTokenCookieOptions());
        res.cookie(REFRESH_TOKEN_COOKIE_NAME, newRefreshToken, getRefreshTokenCookieOptions());

        console.log('[refresh] Token refreshed for user:', tokenRecord.username);

        res.json({
            success: true,
            message: 'Token refreshed'
        });

    } catch (error) {
        console.error('[refresh] Error:', error);
        clearAuthCookies(res);
        res.status(500).json({ error: 'Token refresh failed' });
    }
});

// Logout: invalidate refresh token and clear cookies
server.post('/api/auth/logout', async (req, res) => {
    try {
        const refreshToken = req.cookies[REFRESH_TOKEN_COOKIE_NAME];

        if (refreshToken) {
            // Revoke the refresh token in the database
            await revokeRefreshToken(refreshToken);
            console.log('[logout] Refresh token revoked');
        }

        // Also try to invalidate Supabase session if using old auth
        const accessToken = req.cookies[ACCESS_TOKEN_COOKIE_NAME];
        if (accessToken) {
            try {
                const decoded = jwt.verify(accessToken, SECRET);
                if (decoded.sessionId) {
                    const { rpcLogout } = require('./supabaseClient');
                    await rpcLogout(decoded.sessionId);
                    console.log('[logout] Supabase session invalidated');
                }
            } catch (err) {
                // Ignore errors in session invalidation
            }
        }

        // Clear cookies
        clearAuthCookies(res);

        res.json({
            success: true,
            message: 'Logged out successfully'
        });

    } catch (error) {
        console.error('[logout] Error:', error);
        // Still clear cookies even if DB operation fails
        clearAuthCookies(res);
        res.status(500).json({ error: 'Logout failed' });
    }
});

// Legacy logout endpoint (keep for backwards compatibility during migration)
server.post('/api/logout', requireAuth([]), async (req, res) => {
    try {
        const sessionId = req.auth && req.auth.sessionId;
        const refreshToken = req.cookies[REFRESH_TOKEN_COOKIE_NAME];

        // Revoke refresh token if present
        if (refreshToken) {
            await revokeRefreshToken(refreshToken);
        }

        // Try Supabase RPC
        if (sessionId) {
            try {
                const { rpcLogout } = require('./supabaseClient');
                const rpcResult = await rpcLogout(sessionId);
                if (rpcResult && rpcResult.success) {
                    console.log(`[logout] Supabase RPC: User ${req.auth.id} logged out session ${sessionId}`);
                }
            } catch (supErr) {
                console.error('[logout] Supabase RPC failed:', supErr.message || supErr);
            }
        }

        // Clear cookies
        clearAuthCookies(res);

        return res.json({ ok: true, message: 'Logged out successfully' });
    } catch (e) {
        console.error('logout error', e);
        clearAuthCookies(res);
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
        
                            // DEBUG: log that cookies were set (do not log token values)
                            try {
                                console.log('[login] Cookies set for user:', safe.email);
                                console.log('[login] Access cookie options:', getAccessTokenCookieOptions());
                                console.log('[login] Refresh cookie options:', getRefreshTokenCookieOptions());
                            } catch (e) {
                                console.warn('[login] Failed to log cookie options');
                            }
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
    console.log('[profile] ========== PROFILE REQUEST START ==========');
    console.log('[profile] Request URL:', req.url);
    console.log('[profile] User ID from JWT:', req.auth?.id);
    console.log('[profile] User Role from JWT:', req.auth?.role);
    
    // Add response finish listener to debug
    res.on('finish', () => {
        console.log('[profile] ✓ Response.finish event fired - status:', res.statusCode);
    });
    
    res.on('close', () => {
        console.log('[profile] ✓ Response.close event fired');
    });
    
    try {
        const userId = req.auth.id;
        
        // Try Supabase REST client first
        try {
            const { getProfile } = require('./supabaseClient');
            const profile = await getProfile(userId);
            
            if (profile) {
                console.log('[profile] Profile retrieved successfully for user', userId);
                console.log('[profile] Profile has role:', profile.role);
                console.log('[profile] About to send 200 response with profile data');
                
                // Force proper headers to prevent connection reuse issues
                res.setHeader('Content-Type', 'application/json');
                res.setHeader('Connection', 'keep-alive');
                res.status(200).json(profile);
                
                console.log('[profile] res.json() call completed');
                console.log('[profile] ========== PROFILE REQUEST END ==========');
                return;
            }
        } catch (supErr) {
            console.error('[profile] Supabase REST failed:', supErr.message || supErr);
            return res.status(500).json({ error: 'Profile service unavailable' });
        }

        // If we reach here, no profile was found
        console.error('[profile] No profile found for user', userId);
        return res.status(404).json({ error: 'Profile not found' });
    } catch (e) {
        console.error('[profile] Outer catch - Get profile error:', e);
        console.error('[profile] Error stack:', e.stack);
        res.status(500).json({ error: 'Failed to get profile' });
    }
});

// Lightweight session validation endpoint for force-logout detection
// This is called periodically by the client to detect if admin has terminated the session
server.get('/api/auth/session-check', requireAuth([]), async (req, res) => {
    // If we reach here, requireAuth middleware has already validated:
    // 1. JWT token is valid
    // 2. User has active session (not force-logged out)
    // Just return a simple OK response
    res.json({ valid: true, userId: req.auth.id });
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
            newPassword,
            pinPassword,
            pinCode
        } = req.body;
        
        // Validation
        if (!first_name || !last_name) {
            return res.status(400).json({ error: 'First name and last name are required' });
        }
        
        // Phone validation
        if (phone && !/^\+63[0-9]{10}$/.test(phone)) {
            return res.status(400).json({ error: 'Phone number must be in format: +63xxxxxxxxxx' });
        }

        // PIN code validation if provided
        if (pinCode) {
            if (!pinPassword) {
                return res.status(400).json({ error: 'Current password is required to set PIN code' });
            }
            if (!/^\d{4,6}$/.test(pinCode)) {
                return res.status(400).json({ error: 'PIN code must be 4-6 digits' });
            }
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

        // Handle PIN code hashing if provided
        if (pinCode && pinPassword) {
            try {
                // Get current user password hash from users table
                const { supabase } = require('./supabaseClient');
                const { data: userData, error: userError } = await supabase
                    .from('users')
                    .select('password_hash, username')
                    .eq('user_id', userId)
                    .single();
                
                if (userError || !userData) {
                    console.error('[profile] Error fetching user password:', userError);
                    return res.status(404).json({ error: 'User not found' });
                }

                // Verify current password
                const isPasswordValid = await bcrypt.compare(pinPassword, userData.password_hash);
                if (!isPasswordValid) {
                    return res.status(401).json({ error: 'Current password is incorrect' });
                }

                // Hash the PIN code
                const pinHash = await bcrypt.hash(pinCode, 10);
                profileData.pin_hash = pinHash;
                console.log('[profile] PIN code hashed and will be updated for user:', userId);
            } catch (e) {
                console.error('[profile] Error hashing PIN code:', e);
                return res.status(500).json({ error: 'Failed to process PIN code' });
            }
        }
        
        const result = await rpcProfileUpdate(userId, profileData, userRole);
        
        if (result && result.success) {
            console.log('[profile] Supabase RPC: Profile updated successfully for user', userId);
            
            // Get updated profile data
            const { getProfile } = require('./supabaseClient');
            const updatedProfileData = await getProfile(userId);
            
            if (updatedProfileData) {
                res.json({
                    success: true,
                    message: 'Profile updated successfully',
                    user: updatedProfileData
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
        // Use cookie-based authentication instead of Bearer token
        const token = req.cookies[ACCESS_TOKEN_COOKIE_NAME];

        // DEBUG: log cookie keys and presence of access token (do not log token value)
        try {
            console.log('[auth] Cookies received:', Object.keys(req.cookies || {}));
            console.log('[auth] Access token present:', !!token);
        } catch (e) {
            console.warn('[auth] Failed to log cookies debug info');
        }

        if (!token) {
            console.warn('[auth] No access token in cookies');
            return res.status(401).json({ error: 'No access token provided' });
        }
        
        try{
            const decoded = jwt.verify(token, SECRET);
            req.auth = decoded;

            // Check if THIS SPECIFIC session is active (not just any session for this user)
            // This prevents logged-out sessions from persisting when user has multiple concurrent logins
            try {
                const { supabase } = require('./supabaseClient');
                
                // If JWT has a sessionId, validate that specific session
                if (decoded.sessionId) {
                    const { data: sessionData, error: sessionError } = await supabase
                        .from('user_sessions')
                        .select('session_id, logout_time')
                        .eq('session_id', decoded.sessionId)
                        .maybeSingle();
                    
                    if (sessionError) {
                        console.error('[auth] Error checking session:', sessionError);
                        // Continue anyway - don't block on session check error
                    } else if (!sessionData) {
                        console.warn(`[auth] Session ${decoded.sessionId} not found - session may have been deleted`);
                        clearAuthCookies(res);
                        return res.status(401).json({ 
                            error: 'Session not found',
                            message: 'Your session is no longer valid. Please log in again.'
                        });
                    } else if (sessionData.logout_time !== null) {
                        console.warn(`[auth] Session ${decoded.sessionId} was logged out at ${sessionData.logout_time}`);
                        clearAuthCookies(res);
                        return res.status(401).json({ 
                            error: 'Session terminated',
                            message: 'You have been logged out. Please log in again.'
                        });
                    }
                    
                    console.log(`[auth] Session ${decoded.sessionId} is active for user ${decoded.id}`);
                } else {
                    // CRITICAL: Legacy tokens without sessionId should NOT happen in new code
                    // This fallback is dangerous because it allows cross-session token reuse
                    // DO NOT USE - all new tokens MUST have sessionId
                    console.warn(`[auth] WARNING: Token without sessionId detected for user ${decoded.id}`);
                    console.warn('[auth] This is a security risk - token should have been generated with sessionId');
                    
                    // For backward compatibility, we still allow it but with strict requirements:
                    // 1. The user must have exactly ONE active session
                    // 2. The token must be the ONLY token from that session
                    
                    // DO NOT check "user has ANY active session" - that's insecure!
                    // Instead: Mark this as suspicious and log it
                    clearAuthCookies(res);
                    return res.status(401).json({ 
                        error: 'Invalid token format',
                        message: 'Your session token is invalid. Please log in again.'
                    });
                }
            } catch (sessionCheckErr) {
                console.error('[auth] Exception checking sessions:', sessionCheckErr);
                // Continue anyway - don't block on session check error
            }
            
            // check roles
            if (Array.isArray(allowedRoles) && allowedRoles.length > 0){
                const userRole = decoded.role;
                console.log(`[auth-role-check] Checking user role "${userRole}" against allowed roles:`, allowedRoles);
                if (!allowedRoles.includes(userRole.toLowerCase())){
                    console.error(`[auth-role-check] FORBIDDEN - User role "${userRole}" not in allowed roles`, allowedRoles);
                    return res.status(403).json({ error: 'Forbidden: Insufficient permissions' });
                }
                console.log(`[auth-role-check] Role check PASSED for user ${decoded.id}`);
            }
            next();
        }catch(e){
            console.warn('[auth] Token verification failed:', e.message || e);
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

// attendance: checkout (sets time_out for today's record using QR session)
server.post('/api/attendance/checkout', async (req, res) => {
    try{
        const body = req.body || {};
        const { session_id, employee_id, lat, lon, deviceInfo } = body;
        console.log('Check-out request received:', { session_id, employee_id, lat, lon, deviceInfo });
        
        if (!session_id || !employee_id) return res.status(400).json({ error: 'missing session_id or employee_id' });

        const { handleQRCheckout } = require('./supabaseClient');
        const result = await handleQRCheckout(session_id, employee_id);
        
        if (result && result.success) {
            console.log('Checkout successful:', result.record);
            return res.json({ ok: true, record: result.record });
        } else {
            console.error('QR checkout failed:', result?.error || 'unknown error');
            const statusCode = result?.error?.includes('already checked out') ? 409 :
                             result?.error?.includes('not found') ? 404 :
                             result?.error?.includes('not active') || result?.error?.includes('expired') ? 410 : 400;
            return res.status(statusCode).json({ error: result?.error || 'checkout failed' });
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

// Get attendance statistics for current month (days present, late arrivals, avg hours, absences)
server.get('/api/attendance/stats', async (req, res) => {
    try {
        const { employee_id } = req.query;
        
        if (!employee_id) {
            return res.status(400).json({ error: 'missing employee_id' });
        }

        const { getAttendanceHistory } = require('./supabaseClient');
        
        // Get current month's first and last day
        const now = new Date();
        const firstDay = new Date(now.getFullYear(), now.getMonth(), 1);
        const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0);
        
        const startDate = firstDay.toISOString().split('T')[0];
        const endDate = lastDay.toISOString().split('T')[0];
        
        console.log('[attendance-stats] Fetching stats for employee:', employee_id, 'period:', startDate, 'to', endDate);
        
        // Fetch attendance history for the month
        const attendanceData = await getAttendanceHistory({ 
            start: startDate, 
            end: endDate, 
            employee: employee_id 
        });

        if (!attendanceData || attendanceData.length === 0) {
            console.log('[attendance-stats] No attendance data found for employee:', employee_id);
            return res.json({
                daysPresent: 0,
                lateArrivals: 0,
                avgHours: 0,
                absences: 0
            });
        }

        // Calculate statistics
        let daysPresent = 0;
        let lateArrivals = 0;
        let totalHours = 0;
        let absences = 0;

        attendanceData.forEach(record => {
            // Count days present (records with time_in)
            if (record.time_in) {
                daysPresent++;
                
                // Check if late (assuming work starts at 8 AM or earlier)
                if (record.time_in) {
                    const timeParts = record.time_in.split(':');
                    const hour = parseInt(timeParts[0], 10);
                    const minute = parseInt(timeParts[1], 10);
                    
                    // If check-in after 8:00 AM, count as late
                    if (hour > 8 || (hour === 8 && minute > 0)) {
                        lateArrivals++;
                    }
                }
                
                // Calculate hours worked
                if (record.time_in && record.time_out && record.time_out !== 'NULL') {
                    try {
                        const timeInParts = record.time_in.split(':');
                        const timeOutParts = record.time_out.split(':');
                        
                        const timeInMinutes = parseInt(timeInParts[0], 10) * 60 + parseInt(timeInParts[1], 10);
                        const timeOutMinutes = parseInt(timeOutParts[0], 10) * 60 + parseInt(timeOutParts[1], 10);
                        
                        const hoursWorked = (timeOutMinutes - timeInMinutes) / 60;
                        if (hoursWorked > 0) {
                            totalHours += hoursWorked;
                        }
                    } catch (e) {
                        console.warn('[attendance-stats] Error calculating hours for record:', record);
                    }
                }
            } else {
                // If no time_in, count as absence
                absences++;
            }
        });

        // Calculate average hours per day
        const avgHours = daysPresent > 0 ? (totalHours / daysPresent).toFixed(1) : 0;

        console.log('[attendance-stats] Calculated stats - Days Present:', daysPresent, 'Late Arrivals:', lateArrivals, 'Avg Hours:', avgHours, 'Absences:', absences);

        return res.json({
            daysPresent,
            lateArrivals,
            avgHours: parseFloat(avgHours),
            absences
        });

    } catch (error) {
        console.error('[attendance-stats] Error:', error);
        return res.status(500).json({ error: 'failed to calculate attendance statistics' });
    }
});

// Fetch attendance with filters
server.get('/api/attendance', requireAuth(['hr', 'superadmin', 'head_dept']), async (req, res) => {
    try{
        console.log('[/api/attendance] Endpoint called with query:', req.query);
        const { startDate, endDate, employee, status, department } = req.query;
        console.log('[/api/attendance] Extracted params:', { startDate, endDate, employee, status, department });
        
        const { getFilteredAttendance } = require('./supabaseClient');
        console.log('[/api/attendance] Calling getFilteredAttendance...');
        const attendanceData = await getFilteredAttendance({ startDate, endDate, employee, status, department });
        console.log('[/api/attendance] getFilteredAttendance returned:', attendanceData?.length || 0, 'records');
        
        if (attendanceData) {
            console.log('[attendance] Supabase REST: Retrieved', attendanceData.length, 'records');
            return res.json(Array.isArray(attendanceData) ? attendanceData : []);
        } else {
            console.error('[attendance] Supabase REST failed: no data returned');
            return res.status(500).json({ error: 'failed to fetch attendance' });
        }
    }catch(e){ console.error('attendance fetch error', e); return res.status(500).json({ error: 'failed to fetch attendance' }); }
});

// Department Head Dashboard Stats - Get team attendance statistics for today
server.get('/api/departmenthead/dashboard', requireAuth(['head_dept', 'superadmin']), async (req, res) => {
    try {
        const userId = req.auth.id;
        const { getProfile, getFilteredAttendance, getHREmployees } = require('./supabaseClient');
        
        // Get user profile to find their department
        const userProfile = await getProfile(userId);
        console.log('[departmenthead-dashboard] User profile retrieved:', { 
            userId, 
            department: userProfile?.department,
            role: userProfile?.role 
        });

        if (!userProfile || !userProfile.department) {
            console.warn('[departmenthead-dashboard] User profile or department not found for user:', userId);
            return res.json({
                totalPresent: 0,
                totalLate: 0,
                totalAbsent: 0,
                teamSize: 0
            });
        }

        const department = userProfile.department;
        console.log('[departmenthead-dashboard] Querying for department:', department);
        
        // Get today's attendance records for the department
        const today = new Date().toISOString().split('T')[0];
        console.log('[departmenthead-dashboard] Query date:', today);
        
        const attendanceData = await getFilteredAttendance({ 
            startDate: today, 
            endDate: today, 
            department: department 
        });

        console.log('[departmenthead-dashboard] Attendance data returned:', {
            count: attendanceData?.length || 0,
            sample: attendanceData?.slice(0, 2)
        });

        // Calculate team size = total employees in this department
        // Get all employees in the department to calculate team size
        let teamSize = 0;
        try {
            const deptEmployees = await getHREmployees({ department: department, limit: 1000 });
            console.log('[departmenthead-dashboard] Department employees fetched:', {
                count: deptEmployees?.length || 0,
                sample: deptEmployees?.slice(0, 2)
            });
            teamSize = Array.isArray(deptEmployees) ? deptEmployees.length : 0;
            console.log('[departmenthead-dashboard] Team size (all employees in department):', teamSize);
        } catch (e) {
            console.warn('[departmenthead-dashboard] Could not fetch team size:', e.message);
        }

        // Calculate today's statistics
        let totalPresent = 0;
        let totalLate = 0;
        let totalAbsent = 0;

        if (attendanceData && Array.isArray(attendanceData)) {
            console.log('[departmenthead-dashboard] Processing', attendanceData.length, 'attendance records');
            attendanceData.forEach((record, idx) => {
                console.log(`[departmenthead-dashboard] Record ${idx}:`, {
                    employee: record.employee_name,
                    time_in: record.time_in,
                    date: record.date
                });

                if (record.time_in) {
                    // Has check-in
                    const timeParts = record.time_in.split(':');
                    const hour = parseInt(timeParts[0], 10);
                    const minute = parseInt(timeParts[1], 10);
                    
                    if (hour > 8 || (hour === 8 && minute > 0)) {
                        totalLate++;
                    } else {
                        totalPresent++;
                    }
                } else {
                    // No check-in = absent
                    totalAbsent++;
                }
            });
        }

        console.log('[departmenthead-dashboard] Final stats - Present:', totalPresent, 'Late:', totalLate, 'Absent:', totalAbsent, 'Team Size:', teamSize);

        return res.json({
            totalPresent,
            totalLate,
            totalAbsent,
            teamSize
        });

    } catch (error) {
        console.error('[departmenthead-dashboard] Error:', error);
        return res.status(500).json({ error: 'failed to calculate department statistics' });
    }
});

// Department Head Recent Activity - Get recent check-ins and requests
server.get('/api/departmenthead/recent-activity', requireAuth(['head_dept', 'superadmin']), async (req, res) => {
    try {
        const userId = req.auth.id;
        const { getProfile, getFilteredAttendance } = require('./supabaseClient');
        
        // Get user profile to find their department
        const userProfile = await getProfile(userId);
        console.log('[departmenthead-activity] User profile retrieved:', { 
            userId, 
            department: userProfile?.department 
        });

        if (!userProfile || !userProfile.department) {
            console.warn('[departmenthead-activity] User profile or department not found for user:', userId);
            return res.json({
                activities: []
            });
        }

        const department = userProfile.department;
        console.log('[departmenthead-activity] Querying for department:', department);
        
        // Get today's and recent attendance records (last 24 hours)
        const now = new Date();
        const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
        const today = now.toISOString().split('T')[0];
        const yesterdayStr = yesterday.toISOString().split('T')[0];

        console.log('[departmenthead-activity] Query date range:', yesterdayStr, 'to', today);

        const attendanceData = await getFilteredAttendance({ 
            startDate: yesterdayStr, 
            endDate: today, 
            department: department 
        });

        console.log('[departmenthead-activity] Attendance data returned:', {
            count: attendanceData?.length || 0,
            sample: attendanceData?.slice(0, 2)
        });

        // Format recent activity
        const activities = [];
        
        if (attendanceData && Array.isArray(attendanceData)) {
            console.log('[departmenthead-activity] Processing', attendanceData.length, 'attendance records');

            // Sort by timestamp (most recent first)
            const sorted = attendanceData.sort((a, b) => {
                const aTime = a.time_in || a.time_out || '00:00';
                const bTime = b.time_in || b.time_out || '00:00';
                return bTime.localeCompare(aTime);
            });

            console.log('[departmenthead-activity] After sorting:', sorted.slice(0, 3).map(r => ({ 
                employee: r.employee_name, 
                time_in: r.time_in 
            })));

            // Take last 5 activities
            sorted.slice(0, 5).forEach((record, idx) => {
                const employeeName = record.employee_name || 'Unknown';
                let action = 'Check-in';
                let indicator = 'primary';
                
                if (record.time_in) {
                    const timeParts = record.time_in.split(':');
                    const hour = parseInt(timeParts[0], 10);
                    const minute = parseInt(timeParts[1], 10);
                    
                    if (hour > 8 || (hour === 8 && minute > 0)) {
                        action = 'Clocked in (Late)';
                        indicator = 'warning';
                    } else {
                        action = 'Clocked in';
                        indicator = 'success';
                    }
                    
                    activities.push({
                        name: employeeName,
                        employee_id: record.employee_id,
                        action: action,
                        time: record.time_in,
                        time_out: record.time_out,
                        indicator: indicator,
                        date: record.date
                    });

                    console.log(`[departmenthead-activity] Activity ${idx}: ${employeeName} - ${action} at ${record.time_in}`);
                }
            });
        }

        console.log('[departmenthead-activity] Final activities count:', activities.length);

        return res.json({
            activities: activities.length > 0 ? activities : []
        });

    } catch (error) {
        console.error('[departmenthead-activity] Error:', error);
        return res.status(500).json({ error: 'failed to fetch recent activity' });
    }
});

// Validate QR session (check if it's active and not expired)
server.post('/api/qr/validate', async (req, res) => {
    try {
        const { session_id } = req.body;
        
        if (!session_id) {
            return res.status(400).json({ error: 'missing session_id' });
        }
        
        const { getQRSession } = require('./supabaseClient');
        const session = await getQRSession(session_id);
        
        if (!session) {
            console.log('[qr-validate] Session not found:', session_id);
            return res.status(404).json({ error: 'session not found', valid: false });
        }
        
        const now = new Date();
        
        if (!session.is_active) {
            console.log('[qr-validate] Session not active:', session_id);
            return res.status(410).json({ error: 'session not active', valid: false });
        }
        
        if (session.expires_at && new Date(session.expires_at) < now) {
            console.log('[qr-validate] Session expired:', session_id);
            return res.status(410).json({ error: 'session expired', valid: false });
        }
        
        console.log('[qr-validate] Session valid:', session_id);
        return res.json({ valid: true, session });
        
    } catch (error) {
        console.error('[qr-validate] Error:', error);
        return res.status(500).json({ error: 'failed to validate session' });
    }
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

// Pause QR auto-generation
server.post('/api/hr/qr/pause', requireAuth(['hr', 'superadmin']), async (req, res) => {
    try {
        const { reason } = req.body;
        const userId = req.auth.id;
        const { supabase, logAuditEvent } = require('./supabaseClient');
        
        if (!reason || reason.trim().length === 0) {
            return res.status(400).json({ error: 'Pause reason is required' });
        }
        
        // Check if HR is allowed to pause
        if (req.auth.role === 'hr') {
            const settings = await getSystemSettings();
            const allowHrPause = settings.qr_allow_hr_pause === 'true';
            
            if (!allowHrPause) {
                return res.status(403).json({ error: 'HR is not authorized to pause QR generation' });
            }
        }
        
        // Update automation state
        const { data, error } = await supabase
            .from('qr_automation_state')
            .update({
                paused: true,
                paused_reason: reason.trim()
            })
            .eq('id', 1)
            .select()
            .single();
        
        if (error) throw error;
        
        // Get current active session and mark as paused
        const { data: currentSession } = await supabase
            .from('qr_sessions')
            .select('session_id')
            .eq('is_active', true)
            .order('created_at', { ascending: false })
            .limit(1)
            .maybeSingle();
        
        if (currentSession) {
            await supabase
                .from('qr_sessions')
                .update({
                    paused_at: new Date().toISOString(),
                    paused_by: userId,
                    pause_reason: reason.trim()
                })
                .eq('session_id', currentSession.session_id);
            
            // Log in pause audit table
            await supabase
                .from('qr_session_pauses')
                .insert([{
                    session_id: currentSession.session_id,
                    action: 'paused',
                    performed_by: userId,
                    reason: reason.trim()
                }]);
        }
        
        // Log audit event
        await logAuditEvent(userId, 'QR_PAUSED', { reason: reason.trim(), sessionId: currentSession?.session_id });
        
        console.log(`[QR Pause] Paused by user ${userId}, reason: ${reason}`);
        
        res.json({ 
            success: true, 
            message: 'QR generation paused successfully',
            paused: true,
            reason: reason.trim()
        });
        
    } catch (error) {
        console.error('[QR Pause] Error:', error);
        res.status(500).json({ error: 'Failed to pause QR generation' });
    }
});

// Resume QR auto-generation
server.post('/api/hr/qr/resume', requireAuth(['hr', 'superadmin']), async (req, res) => {
    try {
        const userId = req.auth.id;
        const { supabase, logAuditEvent } = require('./supabaseClient');
        
        // Check if HR is allowed to resume
        if (req.auth.role === 'hr') {
            const settings = await getSystemSettings();
            const allowHrPause = settings.qr_allow_hr_pause === 'true';
            
            if (!allowHrPause) {
                return res.status(403).json({ error: 'HR is not authorized to resume QR generation' });
            }
        }
        
        // Update automation state
        const { data, error } = await supabase
            .from('qr_automation_state')
            .update({
                paused: false,
                paused_reason: null
            })
            .eq('id', 1)
            .select()
            .single();
        
        if (error) throw error;
        
        // Get most recently paused session and mark as resumed
        const { data: pausedSession } = await supabase
            .from('qr_sessions')
            .select('session_id')
            .not('paused_at', 'is', null)
            .is('resumed_at', null)
            .order('paused_at', { ascending: false })
            .limit(1)
            .maybeSingle();
        
        if (pausedSession) {
            await supabase
                .from('qr_sessions')
                .update({
                    resumed_at: new Date().toISOString(),
                    resumed_by: userId
                })
                .eq('session_id', pausedSession.session_id);
            
            // Log in pause audit table
            await supabase
                .from('qr_session_pauses')
                .insert([{
                    session_id: pausedSession.session_id,
                    action: 'resumed',
                    performed_by: userId,
                    reason: null
                }]);
        }
        
        // Log audit event
        await logAuditEvent(userId, 'QR_RESUMED', { sessionId: pausedSession?.session_id });
        
        console.log(`[QR Resume] Resumed by user ${userId}`);
        
        // Trigger immediate generation by calling the function directly
        if (typeof generateQRAutomatically === 'function') {
            await generateQRAutomatically();
        }
        
        res.json({ 
            success: true, 
            message: 'QR generation resumed successfully',
            paused: false
        });
        
    } catch (error) {
        console.error('[QR Resume] Error:', error);
        res.status(500).json({ error: 'Failed to resume QR generation' });
    }
});

// Get QR automation status
server.get('/api/hr/qr/status', requireAuth(['hr', 'superadmin']), async (req, res) => {
    try {
        const { supabase } = require('./supabaseClient');
        
        // Get automation state
        const { data: state } = await supabase
            .from('qr_automation_state')
            .select('*')
            .eq('id', 1)
            .maybeSingle();
        
        // Get settings
        const settings = await getSystemSettings();
        
        res.json({
            enabled: settings.qr_auto_generate_enabled === 'true',
            paused: state?.paused || false,
            pausedReason: state?.paused_reason || null,
            intervalSeconds: parseInt(settings.qr_auto_interval_seconds || '60', 10),
            scheduleStart: settings.qr_session_schedule_start || '07:00',
            scheduleEnd: settings.qr_session_schedule_end || '18:00',
            activeDays: settings.qr_active_days || '1,2,3,4,5',
            allowHrPause: settings.qr_allow_hr_pause === 'true',
            lastGeneratedAt: state?.last_generated_at || null,
            currentSessionId: state?.current_session_id || null
        });
        
    } catch (error) {
        console.error('[QR Status] Error:', error);
        res.status(500).json({ error: 'Failed to fetch QR status' });
    }
});

// Get QR session history with scan counts
server.get('/api/hr/qr/history', requireAuth(['hr', 'superadmin']), async (req, res) => {
    try {
        const { from, to, status, has_scans, _page = '1', _limit = '50' } = req.query;
        const { supabase } = require('./supabaseClient');
        
        const page = parseInt(_page, 10);
        const limit = parseInt(_limit, 10);
        const offset = (page - 1) * limit;
        
        // Build query for qr_sessions
        let query = supabase
            .from('qr_sessions')
            .select(`
                session_id,
                session_type,
                created_at,
                expires_at,
                is_active,
                paused_at,
                paused_by,
                pause_reason,
                resumed_at,
                resumed_by,
                created_by,
                users!qr_sessions_created_by_fkey(username)
            `, { count: 'exact' })
            .order('created_at', { ascending: false });
        
        // Only apply pagination if NOT filtering by has_scans
        // (because we need to count all sessions first, then filter)
        if (has_scans !== 'true') {
            query = query.range(offset, offset + limit - 1);
        }
        
        // Apply filters
        if (from) {
            query = query.gte('created_at', from);
        }
        
        if (to) {
            query = query.lte('created_at', to);
        }
        
        if (status === 'active') {
            query = query.eq('is_active', true);
        } else if (status === 'expired') {
            query = query.eq('is_active', false).is('paused_at', null);
        } else if (status === 'paused') {
            query = query.not('paused_at', 'is', null).is('resumed_at', null);
        }
        
        const { data: sessions, error, count } = await query;
        
        if (error) throw error;
        
        // Fetch attendance rows to count check-ins and check-outs separately
        const sessionIds = (sessions || []).map(s => s.session_id).filter(Boolean);
        const sessionCountsMap = Object.create(null); // {session_id: {checkins: X, checkouts: Y}}
        
        console.log('[QR History] Processing', sessionIds.length, 'sessions:', sessionIds.slice(0, 3));
        
        // First, check TOTAL attendance records
        const { data: totalAttendance, error: totalError } = await supabase
            .from('attendance')
            .select('*', { count: 'exact' });
        console.log('[QR History] TOTAL attendance records in DB:', totalAttendance?.length || 0, 'count result:', totalAttendance?.length);

        if (sessionIds.length > 0) {
            try {
                // Initialize map for all sessions
                sessionIds.forEach(id => {
                    sessionCountsMap[id] = { checkins: 0, checkouts: 0 };
                });

                // First, let's check what's in the attendance table - get more samples
                const { data: allAttendance, error: allError } = await supabase
                    .from('attendance')
                    .select('*')
                    .limit(10);
                
                console.log('[QR History] Sample attendance records (first 3):', allAttendance?.slice(0, 3).map(a => ({
                    employee_id: a.employee_id,
                    date: a.date,
                    checkin_session_id: a.checkin_session_id,
                    checkout_session_id: a.checkout_session_id
                })) || [], 'error:', allError?.message);

                // Fetch check-in scans
                const { data: checkinRows, error: checkinError } = await supabase
                    .from('attendance')
                    .select('checkin_session_id')
                    .in('checkin_session_id', sessionIds);

                console.log('[QR History] Checkin rows fetched:', checkinRows?.length || 0, 'from:', sessionIds.length, 'sessionIds:', sessionIds.slice(0, 3), 'error:', checkinError?.message);
                if (checkinRows && checkinRows.length > 0) {
                    console.log('[QR History] First 3 checkin rows:', checkinRows.slice(0, 3));
                }
                
                if (checkinError) {
                    console.warn('[QR History] Failed to fetch checkin scans:', checkinError.message);
                } else if (checkinRows && checkinRows.length) {
                    checkinRows.forEach(r => {
                        if (r && r.checkin_session_id && sessionCountsMap[r.checkin_session_id]) {
                            sessionCountsMap[r.checkin_session_id].checkins++;
                        }
                    });
                    console.log('[QR History] After checkins aggregation:', JSON.stringify(sessionCountsMap));
                }
                
                // Fetch check-out scans
                const { data: checkoutRows, error: checkoutError } = await supabase
                    .from('attendance')
                    .select('checkout_session_id')
                    .in('checkout_session_id', sessionIds);

                console.log('[QR History] Checkout rows fetched:', checkoutRows?.length || 0, 'from:', sessionIds.length, 'sessionIds:', sessionIds.slice(0, 3), 'error:', checkoutError?.message);
                if (checkoutRows && checkoutRows.length > 0) {
                    console.log('[QR History] First 3 checkout rows:', checkoutRows.slice(0, 3));
                }
                
                if (checkoutError) {
                    console.warn('[QR History] Failed to fetch checkout scans:', checkoutError.message);
                } else if (checkoutRows && checkoutRows.length) {
                    checkoutRows.forEach(r => {
                        if (r && r.checkout_session_id && sessionCountsMap[r.checkout_session_id]) {
                            sessionCountsMap[r.checkout_session_id].checkouts++;
                        }
                    });
                    console.log('[QR History] After checkouts aggregation:', JSON.stringify(sessionCountsMap));
                }
            } catch (e) {
                console.warn('[QR History] Exception fetching attendance rows:', e && e.message ? e.message : e);
            }
        }

        const sessionsWithScans = (sessions || []).map((session) => {
            const counts = sessionCountsMap[session.session_id] || { checkins: 0, checkouts: 0 };

            // Determine current status
            let sessionStatus = 'expired';
            const now = new Date();

            if (session.paused_at && !session.resumed_at) {
                sessionStatus = 'paused';
            } else if (session.is_active && new Date(session.expires_at) > now) {
                sessionStatus = 'active';
            } else {
                sessionStatus = 'expired';
            }

            return {
                session_id: session.session_id,
                session_type: session.session_type,
                created_at: session.created_at,
                expires_at: session.expires_at,
                status: sessionStatus,
                checkins: counts.checkins,
                checkouts: counts.checkouts,
                created_by: session.users?.username || 'System',
                paused_at: session.paused_at,
                paused_by: session.paused_by,
                pause_reason: session.pause_reason,
                resumed_at: session.resumed_at,
                resumed_by: session.resumed_by
            };
        });
        
        // Apply has_scans filter if requested
        if (has_scans === 'true') {
            // Instead of filtering the already-fetched sessions, query attendance to get
            // distinct session_ids that have scans, then fetch sessions by those ids with pagination.
            try {
                // Get all distinct session IDs from both checkin and checkout
                const { data: checkinSessions, error: checkinError } = await supabase
                    .from('attendance')
                    .select('checkin_session_id', { distinct: true });
                
                const { data: checkoutSessions, error: checkoutError } = await supabase
                    .from('attendance')
                    .select('checkout_session_id', { distinct: true });

                if (checkinError) {
                    console.warn('[QR History] Failed to query checkin sessions:', checkinError.message);
                    return res.status(500).json({ error: 'Failed to fetch sessions with scans' });
                }

                // Combine both and get unique IDs
                const scannedIds = [
                    ...(checkinSessions || []).map(r => r.checkin_session_id).filter(Boolean),
                    ...(checkoutSessions || []).map(r => r.checkout_session_id).filter(Boolean)
                ];
                const uniqueScannedIds = [...new Set(scannedIds)];

                // If no scanned sessions, return empty
                if (uniqueScannedIds.length === 0) {
                    res.setHeader('X-Total-Count', 0);
                    return res.json([]);
                }

                // Fetch sessions for those ids with pagination
                const { data: sessionsFiltered, error: sessionsError, count: sessionsCount } = await supabase
                    .from('qr_sessions')
                    .select(`
                        session_id,
                        session_type,
                        created_at,
                        expires_at,
                        is_active,
                        paused_at,
                        paused_by,
                        pause_reason,
                        resumed_at,
                        resumed_by,
                        created_by,
                        users!qr_sessions_created_by_fkey(username)
                    `, { count: 'exact' })
                    .in('session_id', uniqueScannedIds)
                    .order('created_at', { ascending: false })
                    .range(offset, offset + limit - 1);

                if (sessionsError) {
                    console.error('[QR History] Failed to fetch sessions by scanned IDs:', sessionsError.message);
                    return res.status(500).json({ error: 'Failed to fetch sessions with scans' });
                }

                // For accurate counts on the paginated page, fetch attendance rows for the paginated session ids
                const paginatedIds = (sessionsFiltered || []).map(s => s.session_id).filter(Boolean);
                let pageCounts = Object.create(null);

                if (paginatedIds.length > 0) {
                    try {
                        // Initialize page counts
                        paginatedIds.forEach(id => {
                            pageCounts[id] = { checkins: 0, checkouts: 0 };
                        });

                        const { data: pageCheckin, error: pageCheckinError } = await supabase
                            .from('attendance')
                            .select('checkin_session_id')
                            .in('checkin_session_id', paginatedIds);

                        const { data: pageCheckout, error: pageCheckoutError } = await supabase
                            .from('attendance')
                            .select('checkout_session_id')
                            .in('checkout_session_id', paginatedIds);

                        if (pageCheckinError) {
                            console.warn('[QR History] Failed to fetch checkin attendance for paginated sessions:', pageCheckinError.message);
                        } else if (pageCheckin && pageCheckin.length) {
                            pageCheckin.forEach(r => {
                                if (r && r.checkin_session_id && pageCounts[r.checkin_session_id]) {
                                    pageCounts[r.checkin_session_id].checkins++;
                                }
                            });
                        }

                        if (pageCheckoutError) {
                            console.warn('[QR History] Failed to fetch checkout attendance for paginated sessions:', pageCheckoutError.message);
                        } else if (pageCheckout && pageCheckout.length) {
                            pageCheckout.forEach(r => {
                                if (r && r.checkout_session_id && pageCounts[r.checkout_session_id]) {
                                    pageCounts[r.checkout_session_id].checkouts++;
                                }
                            });
                        }
                    } catch (e) {
                        console.warn('[QR History] Exception fetching page attendance rows:', e && e.message ? e.message : e);
                    }
                }

                const result = (sessionsFiltered || []).map(s => ({
                    session_id: s.session_id,
                    session_type: s.session_type,
                    created_at: s.created_at,
                    expires_at: s.expires_at,
                    status: (s.paused_at && !s.resumed_at) ? 'paused' : (s.is_active && new Date(s.expires_at) > new Date() ? 'active' : 'expired'),
                    checkins: (pageCounts[s.session_id] || { checkins: 0 }).checkins,
                    checkouts: (pageCounts[s.session_id] || { checkouts: 0 }).checkouts,
                    created_by: s.users?.username || 'System',
                    paused_at: s.paused_at,
                    paused_by: s.paused_by,
                    pause_reason: s.pause_reason,
                    resumed_at: s.resumed_at,
                    resumed_by: s.resumed_by
                }));

                res.setHeader('X-Total-Count', sessionsCount || result.length);
                return res.json(result);
            } catch (e) {
                console.error('[QR History] Error while fetching sessions with scans:', e && e.message ? e.message : e);
                return res.status(500).json({ error: 'Failed to fetch sessions with scans' });
            }
        } else {
            // Normal pagination was already applied in the original query
            res.setHeader('X-Total-Count', count || sessionsWithScans.length);
            res.json(sessionsWithScans);
        }
        
    } catch (error) {
        console.error('[QR History] Error:', error);
        res.status(500).json({ error: 'Failed to fetch QR history' });
    }
});

// Debug: Get attendance scans for a specific QR session (HR/Superadmin only)
server.get('/api/hr/qr/session/:id/scans', requireAuth(['hr', 'superadmin']), async (req, res) => {
    try {
        const sessionId = String(req.params.id || '');
        if (!sessionId) return res.status(400).json({ error: 'session id required' });

        const { supabase } = require('./supabaseClient');

        // Get records where this session ID was used for check-in
        const { data: checkinRows, error: checkinError } = await supabase
            .from('attendance')
            .select('attendance_id, employee_id, date, time_in, time_out, method, created_at, checkin_session_id, checkout_session_id')
            .eq('checkin_session_id', sessionId)
            .order('created_at', { ascending: false });

        // Get records where this session ID was used for check-out
        const { data: checkoutRows, error: checkoutError } = await supabase
            .from('attendance')
            .select('attendance_id, employee_id, date, time_in, time_out, method, created_at, checkin_session_id, checkout_session_id')
            .eq('checkout_session_id', sessionId)
            .order('created_at', { ascending: false });

        if (checkinError) {
            console.error('[QR Debug] Failed to fetch checkin attendance for session', sessionId, checkinError.message);
            return res.status(500).json({ error: 'failed to fetch attendance rows' });
        }

        // Combine and deduplicate by attendance_id
        const allRows = [...(checkinRows || []), ...(checkoutRows || [])];
        const uniqueRows = Array.from(new Map(allRows.map(r => [r.attendance_id, r])).values());
        const count = uniqueRows.length;
        
        return res.json({ session_id: sessionId, count, rows: uniqueRows.slice(0, 50) });
    } catch (e) {
        console.error('[QR Debug] Error:', e && e.message ? e.message : e);
        return res.status(500).json({ error: 'internal error' });
    }
});

// Employee Management for HR
server.get('/api/hr/employees', requireAuth(['hr', 'superadmin']), async (req, res) => {
    try {
        // Use Supabase-only approach
        const { getHREmployees } = require('./supabaseClient');
        const employees = await getHREmployees(req.query);
        
        if (employees) {
            // Filter out SuperAdmin and Human Resource positions for HR users
            // SuperAdmin users can see all employees
            let filteredEmployees = employees;
            if (req.auth.role === 'hr') {
                filteredEmployees = employees.filter(e => {
                    const position = e.position || '';
                    return position !== 'SuperAdmin' && position !== 'Human Resource';
                });
            }
            
            console.log('[hr] Supabase REST: Retrieved employees list');
            return res.json(filteredEmployees);
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
        
        // Prevent HR users from accessing SuperAdmin and Human Resource employees
        if (req.auth.role === 'hr') {
            const position = employee.position || '';
            if (position === 'SuperAdmin' || position === 'Human Resource') {
                return res.status(403).json({ error: 'Access denied: You do not have permission to view this employee.' });
            }
        }
        
        res.json(employee);
    } catch (e) {
        console.error('Get employee error:', e);
        res.status(500).json({ error: 'Failed to fetch employee.' });
    }
});

// REMOVED: Employee creation endpoint - use /api/hr/invitations instead
// server.post('/api/hr/employees', requireAuth(['hr', 'superadmin']), async (req, res) => {
/*
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
*/
// End of removed POST endpoint

server.put('/api/hr/employees/:id', requireAuth(['hr', 'superadmin']), async (req, res) => {
    try {
        const employeeId = parseInt(req.params.id, 10);
        const { first_name, last_name, email, phone, address, position, dept_id, status } = req.body;
        const updater_id = req.auth.id;
        
        if (!first_name || !last_name || !email) {
            return res.status(400).json({ error: 'First name, last name, and email are required.' });
        }
        
        // Check if employee exists and if HR can modify it
        const { getEmployeeById } = require('./supabaseClient');
        const existingEmployee = await getEmployeeById(employeeId);
        
        if (!existingEmployee) {
            return res.status(404).json({ error: 'Employee not found.' });
        }
        
        // Prevent HR users from modifying SuperAdmin and Human Resource employees
        if (req.auth.role === 'hr') {
            const currentPosition = existingEmployee.position || '';
            if (currentPosition === 'SuperAdmin' || currentPosition === 'Human Resource') {
                return res.status(403).json({ error: 'Access denied: You do not have permission to modify this employee.' });
            }
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
        
        // Check if employee exists and if HR can modify it
        const { getEmployeeById } = require('./supabaseClient');
        const existingEmployee = await getEmployeeById(employeeId);
        
        if (!existingEmployee) {
            return res.status(404).json({ error: 'Employee not found.' });
        }
        
        // Prevent HR users from deleting SuperAdmin and Human Resource employees
        if (req.auth.role === 'hr') {
            const currentPosition = existingEmployee.position || '';
            if (currentPosition === 'SuperAdmin' || currentPosition === 'Human Resource') {
                return res.status(403).json({ error: 'Access denied: You do not have permission to delete this employee.' });
            }
        }
        
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

// Get attendance adjustments history for audit log
server.get('/api/hr/adjustments/history', requireAuth(['hr', 'superadmin']), async (req, res) => {
    try {
        const limit = parseInt(req.query.limit) || 50;
        const offset = parseInt(req.query.offset) || 0;
        
        const { getAuditLogs } = require('./supabaseClient');
        
        // Get audit logs filtered for attendance adjustments
        const auditLogs = await getAuditLogs({
            actionType: 'ATTENDANCE_OVERRIDE'
        });
        
        if (!auditLogs) {
            return res.status(500).json({ error: 'Failed to fetch adjustment history.' });
        }
        
        // Transform audit logs to match frontend expectations
        const adjustmentHistory = auditLogs.slice(0, limit).map(log => {
            const details = log.details || {};
            const timestamp = new Date(log.created_at);
            
            return {
                id: log.log_id,
                status: 'success', // All logged actions were successful
                action: `Override attendance for employee ${details.employeeId || 'Unknown'} on ${details.date || 'N/A'} - Status: ${details.status || 'N/A'}${details.reason ? ` - Reason: ${details.reason}` : ''}`,
                time: timestamp.toLocaleString(),
                timestamp: log.created_at,
                user: log.username || 'System',
                details: details
            };
        });
        
        res.json(adjustmentHistory);
    } catch (e) {
        console.error('Adjustment history error:', e);
        res.status(500).json({ error: 'Failed to fetch adjustment history.' });
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

// Create a new department (HR and Superadmin)
server.post('/api/hr/departments', requireAuth(['hr', 'superadmin']), async (req, res) => {
    try {
        const { dept_name, description, head_id } = req.body || {};
        const creatorId = req.auth.id;

        if (!dept_name || !dept_name.trim()) {
            return res.status(400).json({ error: 'Department name is required.' });
        }

        // Use Supabase helper to create department
        const { createDepartment, logAuditEvent } = require('./supabaseClient');
        const result = await createDepartment({ dept_name: dept_name.trim(), description, head_id: head_id || null });

        if (!result || !result.success) {
            if (result && result.error && result.error.toLowerCase().includes('already')) {
                return res.status(409).json({ error: 'Department already exists.' });
            }
            console.error('Create department failed:', result && result.error);
            return res.status(500).json({ error: result && result.error ? result.error : 'Failed to create department.' });
        }

        // Log audit
        await logAuditEvent(creatorId, 'DEPARTMENT_CREATED', { dept: result.department });

        return res.status(201).json(result.department);
    } catch (e) {
        console.error('Create department error:', e);
        return res.status(500).json({ error: 'Failed to create department.' });
    }
});

// Update a department (HR and Superadmin)
server.put('/api/hr/departments/:id', requireAuth(['hr', 'superadmin']), async (req, res) => {
    try {
        const deptId = parseInt(req.params.id);
        const { dept_name, description, head_id } = req.body || {};
        const userId = req.auth.id;

        if (!dept_name || !dept_name.trim()) {
            return res.status(400).json({ error: 'Department name is required.' });
        }

        // Use Supabase helper to update department
        const { updateDepartment, logAuditEvent } = require('./supabaseClient');
        const result = await updateDepartment(deptId, { 
            dept_name: dept_name.trim(), 
            description, 
            head_id: head_id || null 
        });

        if (!result || !result.success) {
            if (result && result.error && result.error.toLowerCase().includes('not found')) {
                return res.status(404).json({ error: 'Department not found.' });
            }
            if (result && result.error && result.error.toLowerCase().includes('already exists')) {
                return res.status(409).json({ error: 'Department name already exists.' });
            }
            console.error('Update department failed:', result && result.error);
            return res.status(500).json({ error: result && result.error ? result.error : 'Failed to update department.' });
        }

        // Log audit
        await logAuditEvent(userId, 'DEPARTMENT_UPDATED', { dept: result.department });

        return res.json(result.department);
    } catch (e) {
        console.error('Update department error:', e && e.stack ? e.stack : e);
        return res.status(500).json({ error: 'Failed to update department.' });
    }
});

// Delete a department (HR and Superadmin)
server.delete('/api/hr/departments/:id', requireAuth(['hr', 'superadmin']), async (req, res) => {
    try {
        const deptId = parseInt(req.params.id);
        const userId = req.auth.id;

        // Use Supabase helper to delete department
        const { deleteDepartment, getDepartmentById, logAuditEvent } = require('./supabaseClient');
        
        // Get department info before deleting for audit log
        const department = await getDepartmentById(deptId);
        if (!department) {
            return res.status(404).json({ error: 'Department not found.' });
        }

        const result = await deleteDepartment(deptId);

        if (!result || !result.success) {
            if (result && result.error && result.error.toLowerCase().includes('employees')) {
                return res.status(409).json({ error: 'Cannot delete department with assigned employees.' });
            }
            console.error('Delete department failed:', result && result.error);
            return res.status(500).json({ error: result && result.error ? result.error : 'Failed to delete department.' });
        }

        // Log audit
        await logAuditEvent(userId, 'DEPARTMENT_DELETED', { 
            dept_id: deptId, 
            dept_name: department.dept_name 
        });

        return res.json({ success: true, message: 'Department deleted successfully.' });
    } catch (e) {
        console.error('Delete department error:', e);
        return res.status(500).json({ error: 'Failed to delete department.' });
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

// Debug endpoint to check users and employees (development only)
server.get('/api/debug/users-employees', requireAuth([]), async (req, res) => {
    try {
        const { supabase } = require('./supabaseClient');
        
        // Get all users
        const { data: users, error: usersError } = await supabase
            .from('users')
            .select('user_id, username, status, role_id, created_by')
            .order('user_id');
            
        if (usersError) {
            console.error('Debug users error:', usersError);
            return res.status(500).json({ error: 'Failed to fetch users' });
        }
        
        // Get all employees
        const { data: employees, error: employeesError } = await supabase
            .from('employees')
            .select('employee_id, first_name, last_name, email, status, dept_id, created_by')
            .order('employee_id');
            
        if (employeesError) {
            console.error('Debug employees error:', employeesError);
            return res.status(500).json({ error: 'Failed to fetch employees' });
        }
        
        // Get all invitations
        const { data: invitations, error: invitationsError } = await supabase
            .from('invitations')
            .select('id, email, created_by, created_at, used')
            .order('created_at', { ascending: false })
            .limit(10);
            
        if (invitationsError) {
            console.error('Debug invitations error:', invitationsError);
            return res.status(500).json({ error: 'Failed to fetch invitations' });
        }
        
        res.json({
            users: users || [],
            employees: employees || [],
            invitations: invitations || [],
            total_users: users?.length || 0,
            total_employees: employees?.length || 0,
            total_invitations: invitations?.length || 0
        });
        
    } catch (e) {
        console.error('Debug endpoint error:', e);
        res.status(500).json({ error: 'Debug endpoint failed' });
    }
});

// Update department head assignment
server.put('/api/hr/departments/:id/head', requireAuth(['hr', 'superadmin']), async (req, res) => {
    try {
        const deptId = parseInt(req.params.id);
        const { head_id } = req.body;
        
        console.log('[dept-head-assign] Department ID:', deptId);
        console.log('[dept-head-assign] New head ID from request:', head_id);
        
        // Validate department exists using Supabase helper
        const { getDepartmentById } = require('./supabaseClient');
        const department = await getDepartmentById(deptId);
        if (!department) {
            return res.status(404).json({ error: 'Department not found.' });
        }
        
        // If head_id is provided, validate employee exists (can be any role - will be promoted)
        if (head_id) {
            const { validateDepartmentHead } = require('./supabaseClient');
            const employeeCheck = await validateDepartmentHead(head_id);
            
            console.log('[dept-head-assign] Employee validation result:', employeeCheck);
            
            if (!employeeCheck) {
                console.log('[dept-head-assign] Employee not found');
                return res.status(400).json({ error: 'Employee not found.' });
            }
            
            // Accept employees (role_id=4) or existing heads (role_id=3)
            // They will be promoted/assigned in updateDepartmentHead function
            if (employeeCheck.role_id !== 4 && employeeCheck.role_id !== 3) {
                console.log('[dept-head-assign] Invalid role! Employee must have employee or head_dept role. Got role_id:', employeeCheck.role_id);
                return res.status(400).json({ error: 'Only employees or existing department heads can be assigned as department head.' });
            }
            
            console.log('[dept-head-assign] Validation passed! Employee will be promoted to department head.');
        }
        
        // Update department head using Supabase helper
        // This will handle role promotion, previous head demotion, and all table updates
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

        console.log('[requests-pending] Fetching pending requests...');
        console.log('[requests-pending] Query department:', department);
        console.log('[requests-pending] User role:', role);
        console.log('[requests-pending] User ID:', id);

        // Use Supabase helper
        const { getPendingRequests } = require('./supabaseClient');
        const requests = await getPendingRequests(req.auth, department);
        
        console.log('[requests-pending] getPendingRequests returned:', requests);
        
        if (requests !== null) {
            console.log('[requests-pending] Returning', requests.length, 'requests');
            return res.json(requests);
        } else {
            console.log('[requests-pending] getPendingRequests returned null');
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

        console.log(`[requests-update] Request ID: ${requestId}, Status: ${status}, Approver: ${approver_id}`);
        console.log(`[requests-update] User role from token: ${req.auth.role}`);

        if (isNaN(requestId) || !['approved', 'rejected'].includes(status)) {
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

// Activate pending users (utility endpoint)
server.post('/api/admin/activate-pending-users', requireAuth(['superadmin']), async (req, res) => {
    try {
        const { updateUsers } = require('./supabaseClient');
        
        // Update all pending users to active
        const { data: updatedUsers, error: userError } = await require('./supabaseClient').supabase
            .from('users')
            .update({ status: 'active' })
            .eq('status', 'pending')
            .select('user_id, username');
            
        if (userError) {
            console.error('[admin] Error activating pending users:', userError);
            return res.status(500).json({ error: 'Failed to activate pending users' });
        }
        
        // Update corresponding employee records
        const { data: updatedEmployees, error: employeeError } = await require('./supabaseClient').supabase
            .from('employees')
            .update({ status: 'active' })
            .eq('status', 'pending')
            .select('employee_id');
            
        if (employeeError) {
            console.error('[admin] Error activating pending employees:', employeeError);
        }
        
        // Log audit event
        const { logAuditEvent } = require('./supabaseClient');
        await logAuditEvent(req.auth.id, 'BULK_USER_ACTIVATION', {
            usersActivated: updatedUsers?.length || 0,
            employeesActivated: updatedEmployees?.length || 0
        });
        
        res.json({
            success: true,
            message: `Activated ${updatedUsers?.length || 0} users and ${updatedEmployees?.length || 0} employees`,
            activatedUsers: updatedUsers
        });
        
    } catch (error) {
        console.error('Error activating pending users:', error);
        res.status(500).json({ error: 'Failed to activate pending users' });
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
        
        // Debug: Check what req.auth contains
        console.log('[invitation] Creating invitation with creator ID:', req.auth.id);
        console.log('[invitation] Full req.auth object:', JSON.stringify(req.auth, null, 2));
        
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
        const baseUrl = process.env.BASE_URL || 'https://employeeattendance.me';
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
            req.auth.id
        );
        
        if (!result.success) {
            return res.status(400).json({ error: result.error });
        }
        
        // Send new email
        const baseUrl = process.env.BASE_URL || 'https://employeeattendance.me';
        const inviteLink = generateInviteLink(baseUrl, rawToken);
        const emailService = new EmailService();
        const emailResult = await emailService.sendInvitationEmail({
            email: result.invitation.email,
            inviteLink,
            roleName: result.invitation.role_name,
            departmentName: result.invitation.dept_name || 'N/A',
            inviterName: req.auth.email || 'Administrator',
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
        
        const result = await cancelInvitation(invitationId, req.auth.id);
        
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
                expires_at: verification.invitation.expires_at,
                invited_by: verification.invitation.invited_by
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

// ============================================================
// QR AUTOMATION SCHEDULER
// ============================================================

let qrAutoGenerationInterval = null;

/**
 * Generate QR code automatically based on system settings
 */
async function generateQRAutomatically() {
    try {
        const { supabase } = require('./supabaseClient');
        
        // Check if paused
        const { data: state, error: stateError } = await supabase
            .from('qr_automation_state')
            .select('paused, paused_reason')
            .eq('id', 1)
            .single();
        
        if (stateError) {
            console.error('[QR Auto] Failed to check pause state:', stateError.message);
            return;
        }
        
        if (state && state.paused) {
            return; // Silently skip when paused
        }
        
        // Get settings
        const settings = await getSystemSettings();
        
        // Check schedule enforcement
        const now = new Date();
        const currentHour = now.getHours();
        const currentMinute = now.getMinutes();
        const currentDay = now.getDay(); // 0=Sunday, 6=Saturday
        
        // Parse schedule settings
        const scheduleStart = settings.qr_session_schedule_start || '07:00';
        const scheduleEnd = settings.qr_session_schedule_end || '18:00';
        const activeDaysStr = settings.qr_active_days || '1,2,3,4,5';
        const activeDays = activeDaysStr.split(',').map(d => parseInt(d.trim(), 10));
        
        const [startHour, startMin] = scheduleStart.split(':').map(n => parseInt(n, 10));
        const [endHour, endMin] = scheduleEnd.split(':').map(n => parseInt(n, 10));
        
        const currentMinutes = currentHour * 60 + currentMinute;
        const startMinutes = startHour * 60 + startMin;
        const endMinutes = endHour * 60 + endMin;
        
        // Map Sunday (0) to 7 for easier comparison
        const adjustedDay = currentDay === 0 ? 7 : currentDay;
        
        // Check if today is an active day
        if (!activeDays.includes(adjustedDay)) {
            return; // Silently skip when outside active days
        }
        
        // Check if within scheduled hours
        if (currentMinutes < startMinutes || currentMinutes >= endMinutes) {
            return; // Silently skip when outside scheduled hours
        }
        
        // Import QR functions
        const { deactivateAllQRSessions, createQRSession } = require('./supabaseClient');
        
        // Deactivate previous sessions
        await deactivateAllQRSessions();
        
        // Generate new session
        const intervalSeconds = parseInt(settings.qr_auto_interval_seconds || '60', 10);
        const sessionId = `qr_auto_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        const expiresAt = new Date(Date.now() + (intervalSeconds * 1000) + 5000); // Add 5s buffer
        
        const session = await createQRSession(sessionId, expiresAt, null, 'rotating'); // null = system-generated
        
        if (session) {
            // Update automation state
            const { error: updateError } = await supabase
                .from('qr_automation_state')
                .update({
                    last_generated_at: new Date().toISOString(),
                    last_generated_by: 'system',
                    current_session_id: sessionId
                })
                .eq('id', 1);
            
            if (updateError) {
                console.error('[QR Auto] Failed to update automation state:', updateError.message);
            }
            
            console.log(`[QR Auto] ✅ Generated: ${sessionId.substring(0, 30)}... (expires ${expiresAt.toLocaleTimeString()})`);
        } else {
            console.error('[QR Auto] ❌ Failed to create QR session');
        }
        
    } catch (error) {
        console.error('[QR Auto] ❌ Error:', error.message);
    }
}

/**
 * Start the QR auto-generation scheduler
 */
async function startQRAutoGeneration() {
    try {
        const settings = await getSystemSettings();
        const enabled = settings.qr_auto_generate_enabled === 'true' || settings.qr_auto_generate_enabled === true;
        const intervalSeconds = parseInt(settings.qr_auto_interval_seconds || '60', 10);
        
        if (!enabled) {
            console.log('[QR Auto] Auto-generation is DISABLED');
            return;
        }
        
        console.log(`[QR Auto] Starting auto-generation (every ${intervalSeconds}s)`);
        
        // Clear existing interval if any
        if (qrAutoGenerationInterval) {
            clearInterval(qrAutoGenerationInterval);
        }
        
        // Run immediately on start
        await generateQRAutomatically();
        
        // Set recurring interval
        qrAutoGenerationInterval = setInterval(async () => {
            await generateQRAutomatically();
        }, intervalSeconds * 1000);
        
    } catch (error) {
        console.error('[QR Auto] Failed to start:', error.message);
    }
}

server.listen(PORT, () => {
    console.log(`Mock server running at http://localhost:${PORT}`);
    console.log('[server] API mount: /api  (json-server router + custom routes)');
    console.log('[server] Serving static files from:', publicPath);
    console.log('[server] Database: Supabase REST + RPC (PostgreSQL pool removed)');
    console.log('[server] Supabase URL:', maskDatabaseUrl());
    console.log('[server] JWT secret set?', !!process.env.JWT_SECRET);
    console.log('[server] Environment:', process.env.NODE_ENV || 'development');
    console.log('[server] Architecture: Pure REST + RPC (no pool dependency)');
    
    // Start QR automation after server is fully initialized
    setTimeout(() => {
        startQRAutoGeneration();
    }, 3000); // Wait 3 seconds for DB connections to stabilize
});
 