/**
 * Authentication Routes
 * Handles user login, logout, token refresh, password changes, and profile
 */

const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');

const router = express.Router();
const config = require('../config/environment');
const { requireAuth, optionalAuth } = require('../middleware/auth');
const { catchAsync, AppError } = require('../middleware/errorHandler');
const {
  generateRefreshToken,
  hashRefreshToken,
  storeRefreshToken,
  validateRefreshToken,
  rotateRefreshToken,
  revokeRefreshToken,
  revokeAllUserTokens,
} = require('../utils/refreshTokens');
const {
  ACCESS_TOKEN_EXPIRES_IN,
  ACCESS_TOKEN_COOKIE_NAME,
  REFRESH_TOKEN_COOKIE_NAME,
  getAccessTokenCookieOptions,
  getRefreshTokenCookieOptions,
  clearAuthCookies,
} = require('../utils/cookieConfig');
const { validateEmail, validatePassword, validateLoginInput } = require('../utils/validators');
const { logAuditEvent, AUDIT_ACTIONS } = require('../utils/audit');

/**
 * POST /api/auth/login
 * User login with email and password
 */
router.post('/login', catchAsync(async (req, res) => {
  const { email, password } = req.body || {};

  console.log('[login] Attempt with email:', email);

  // Validate input
  if (!email || !password) {
    throw new AppError('Missing email or password', 400);
  }

  let user;
  // Get user data via Supabase
  try {
    const { findUserByEmail, supabase } = require('../supabase');

    if (supabase) {
      const sUser = await findUserByEmail(email);

      if (sUser) {
        // Get role name
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
          first_login: sUser.first_login,
          employee_id: sUser.user_id, // employee_id equals user_id per schema
        };
      }
    }
  } catch (error) {
    console.warn('[login] Supabase lookup failed:', error.message);
  }

  // Check if user was found
  if (!user) {
    console.log('[login] User not found for:', email);
    throw new AppError('Invalid credentials', 401);
  }

  // Check user status
  if (user.status !== 'active' && user.status !== 'pending') {
    throw new AppError('User account is not active', 403);
  }

  // Validate password
  const validPassword = await bcrypt.compare(password, user.password_hash);
  if (!validPassword) {
    throw new AppError('Invalid credentials', 401);
  }

  // Auto-activate pending users on successful login
  if (user.status === 'pending') {
    await activateUser(user.user_id);
    user.status = 'active';
    user.first_login = false;
  }

  // Handle single session enforcement (except display accounts)
  const isDisplayAccount = user.role_name === 'display';
  if (!isDisplayAccount) {
    await revokeAllUserTokens(user.user_id);
    await terminateExistingSessions(user.user_id);
  }

  // Perform login (RPC or fallback)
  const loginResult = await performLogin(user, req);

  // Generate tokens
  const { accessToken, refreshToken } = await generateTokens(
    user,
    loginResult.sessionId,
    req
  );

  // Set cookies
  res.cookie(ACCESS_TOKEN_COOKIE_NAME, accessToken, getAccessTokenCookieOptions());
  res.cookie(REFRESH_TOKEN_COOKIE_NAME, refreshToken, getRefreshTokenCookieOptions());

  // Log audit event
  await logAuditEvent(user.user_id, AUDIT_ACTIONS.USER_LOGIN, {
    email,
    ipAddress: req.ip,
  });

  res.json({
    success: true,
    user: {
      id: user.user_id,
      email: user.username,
      role: user.role_name,
      redirect: getRoleRedirect(user.role_name),
    },
    message: 'Login successful',
  });
}));

/**
 * POST /api/auth/refresh
 * Refresh access token using refresh token
 */
router.post('/auth/refresh', catchAsync(async (req, res) => {
  const refreshToken = req.cookies[REFRESH_TOKEN_COOKIE_NAME];

  if (!refreshToken) {
    console.warn('[refresh] No refresh token provided');
    throw new AppError('No refresh token provided', 401);
  }

  // Validate refresh token
  const tokenRecord = await validateRefreshToken(refreshToken);
  if (!tokenRecord) {
    clearAuthCookies(res);
    throw new AppError('Invalid or expired refresh token', 401);
  }

  // Rotate refresh token (security best practice)
  const newRefreshToken = await rotateRefreshToken(refreshToken, {
    deviceInfo: req.get('User-Agent'),
    ipAddress: req.ip || req.connection?.remoteAddress,
  });

  if (!newRefreshToken) {
    clearAuthCookies(res);
    throw new AppError('Token rotation failed', 401);
  }

  // Generate new access token
  const newAccessToken = jwt.sign(
    {
      id: tokenRecord.user_id,
      email: tokenRecord.username,
      role: tokenRecord.role_name,
      employee_id: tokenRecord.user_id, // employee_id equals user_id per schema
      sessionId: tokenRecord.session_id,
    },
    config.JWT_SECRET,
    { expiresIn: ACCESS_TOKEN_EXPIRES_IN }
  );

  // Set new cookies
  res.cookie(ACCESS_TOKEN_COOKIE_NAME, newAccessToken, getAccessTokenCookieOptions());
  res.cookie(REFRESH_TOKEN_COOKIE_NAME, newRefreshToken, getRefreshTokenCookieOptions());

  res.json({
    success: true,
    message: 'Token refreshed',
  });
}));

/**
 * POST /api/auth/logout
 * Logout and invalidate refresh token
 */
router.post('/auth/logout', catchAsync(async (req, res) => {
  const refreshToken = req.cookies[REFRESH_TOKEN_COOKIE_NAME];
  const accessToken = req.cookies[ACCESS_TOKEN_COOKIE_NAME];

  // Revoke refresh token
  if (refreshToken) {
    await revokeRefreshToken(refreshToken);
  }

  // Invalidate session
  if (accessToken) {
    try {
      const decoded = jwt.verify(accessToken, config.JWT_SECRET);
      if (decoded.sessionId) {
        const { rpcLogout } = require('../supabase');
        await rpcLogout(decoded.sessionId);
      }
    } catch (error) {
      console.warn('[logout] Session invalidation failed:', error.message);
    }
  }

  // Clear cookies
  clearAuthCookies(res);

  // Log audit event
  if (req.auth) {
    await logAuditEvent(req.auth.id, AUDIT_ACTIONS.USER_LOGOUT, {
      ipAddress: req.ip,
    });
  }

  res.json({
    success: true,
    message: 'Logged out successfully',
  });
}));

/**
 * GET /api/auth/profile
 * Get current user profile
 */
router.get('/auth/profile', requireAuth([]), catchAsync(async (req, res) => {
  const userId = req.auth.id;

  try {
    const { getProfile } = require('../supabase');
    const profile = await getProfile(userId);

    if (!profile) {
      throw new AppError('Profile not found', 404);
    }

    res.json(profile);
  } catch (error) {
    console.error('[profile] Error:', error.message);
    throw error;
  }
}));

/**
 * PUT /api/auth/profile
 * Update user profile
 */
router.put('/auth/profile', requireAuth([]), catchAsync(async (req, res) => {
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
  } = req.body;

  // Validation
  if (!first_name || !last_name) {
    throw new AppError('First name and last name are required', 400);
  }

  // Phone validation
  if (phone && !/^\+63[0-9]{10}$/.test(phone)) {
    throw new AppError('Phone number must be in format: +63xxxxxxxxxx', 400);
  }

  // Use Supabase RPC for profile update
  try {
    const { rpcProfileUpdate } = require('../supabase');
    const profileData = {
      first_name,
      last_name,
      phone,
      address,
      position,
      dept_id,
      hire_date,
      currentPassword,
      newPassword,
    };

    const result = await rpcProfileUpdate(userId, profileData, userRole);

    if (result && result.success) {
      res.json({
        success: true,
        message: 'Profile updated successfully',
        profile: result.profile,
      });
    } else {
      throw new AppError(result?.error || 'Failed to update profile', 500);
    }
  } catch (error) {
    console.error('[profile-update] Error:', error.message);
    throw error;
  }
}));

/**
 * POST /api/auth/session-check
 * Lightweight session validation (for force-logout detection)
 */
router.get('/auth/session-check', requireAuth([]), catchAsync(async (req, res) => {
  // If we reach here, requireAuth middleware has already validated the session
  res.json({
    valid: true,
    userId: req.auth.id,
  });
}));

/**
 * POST /api/change-first-login-password
 * Change password (optionally on first login)
 */
router.post('/change-first-login-password', catchAsync(async (req, res) => {
  const { userId, currentPassword, newPassword } = req.body;

  // Validation
  if (!userId || !currentPassword || !newPassword) {
    throw new AppError('User ID, current password, and new password are required', 400);
  }

  if (!validatePassword(newPassword)) {
    throw new AppError('New password must be at least 6 characters long', 400);
  }

  // Get user info
  const { getUserForPasswordReset } = require('../supabase');
  const user = await getUserForPasswordReset(userId);

  if (!user) {
    throw new AppError('User not found', 404);
  }

  // Verify current password
  const validPassword = await bcrypt.compare(currentPassword, user.password_hash);
  if (!validPassword) {
    throw new AppError('Current password is incorrect', 401);
  }

  // Hash new password
  const hashedNewPassword = await bcrypt.hash(newPassword, 10);

  // Update password via RPC
  try {
    const { rpcChangeFirstPassword } = require('../supabase');
    const result = await rpcChangeFirstPassword(userId, hashedNewPassword);

    if (result && result.success) {
      res.json({
        success: true,
        message: result.message || 'Password changed successfully',
      });
    } else {
      throw new AppError('Failed to change password', 500);
    }
  } catch (error) {
    console.error('[change-password] Error:', error.message);
    throw error;
  }
}));

/**
 * POST /api/auth/accept-invite
 * Accept invitation and create account
 */
router.post('/auth/accept-invite', optionalAuth, catchAsync(async (req, res) => {
  const { token, first_name, last_name, password } = req.body;

  // Validation
  if (!token || !first_name || !last_name || !password) {
    throw new AppError('Token, first name, last name, and password are required', 400);
  }

  if (!validatePassword(password)) {
    throw new AppError('Password must be at least 6 characters long', 400);
  }

  try {
    // Hash the incoming plain token to compare with database
    const crypto = require('crypto');
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');

    const { acceptInvitation } = require('../supabase');
    const result = await acceptInvitation(tokenHash, { first_name, last_name, password });

    if (result && result.success) {
      // Log the account creation
      await logAuditEvent(result.user?.user_id, AUDIT_ACTIONS.USER_CREATED, {
        email: result.user?.email,
        role: result.user?.role,
        method: 'invitation',
      });

      res.json({
        success: true,
        message: 'Account created successfully',
        user: result.user,
      });
    } else {
      throw new AppError(result?.error || 'Failed to accept invitation', 400);
    }
  } catch (error) {
    throw error;
  }
}));

/**
 * GET /api/auth/invitations/verify/:token
 * Verify invitation token (public endpoint)
 */
router.get('/invitations/verify/:token', catchAsync(async (req, res) => {
  const { token } = req.params;

  try {
    // Hash the incoming plain token to compare with database
    const crypto = require('crypto');
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');

    const { verifyInvitationToken } = require('../supabase');
    const result = await verifyInvitationToken(tokenHash);

    if (result && result.valid) {
      res.json({
        valid: true,
        invitation: result.invitation
      });
    } else {
      res.status(400).json({
        valid: false,
        error: result?.reason || 'Invalid or expired token',
      });
    }
  } catch (error) {
    res.status(500).json({
      valid: false,
      error: 'Verification service unavailable',
    });
  }
}));

/**
 * POST /api/logout (legacy endpoint for backwards compatibility)
 */
router.post('/logout', requireAuth([]), catchAsync(async (req, res) => {
  const sessionId = req.auth?.sessionId;
  const refreshToken = req.cookies[REFRESH_TOKEN_COOKIE_NAME];

  // Revoke refresh token
  if (refreshToken) {
    await revokeRefreshToken(refreshToken);
  }

  // Try Supabase RPC
  if (sessionId) {
    try {
      const { rpcLogout } = require('../supabase');
      await rpcLogout(sessionId);
    } catch (error) {
      console.warn('[logout] Supabase RPC failed:', error.message);
    }
  }

  // Clear cookies
  clearAuthCookies(res);

  res.json({
    ok: true,
    message: 'Logged out successfully',
  });
}));

// ============================================================
// HELPER FUNCTIONS
// ============================================================

/**
 * Auto-activate pending users on first successful login
 */
async function activateUser(userId) {
  try {
    const { supabase } = require('../supabase');

    // Update user status
    const { error: userError } = await supabase
      .from('users')
      .update({
        status: 'active',
        first_login: false,
        updated_at: new Date().toISOString(),
      })
      .eq('user_id', userId);

    if (!userError) {
      // Also update employee status if exists
      await supabase
        .from('employees')
        .update({
          status: 'active',
          updated_at: new Date().toISOString(),
        })
        .eq('employee_id', userId)
        .eq('status', 'pending');
    }
  } catch (error) {
    console.error('[activateUser] Error:', error.message);
  }
}

/**
 * Terminate existing sessions for user (single session enforcement)
 */
async function terminateExistingSessions(userId) {
  try {
    const { supabase } = require('../supabase');

    const { data: existingSessions } = await supabase
      .from('user_sessions')
      .select('session_id')
      .eq('user_id', userId)
      .is('logout_time', null);

    if (existingSessions && existingSessions.length > 0) {
      console.log('[login] Terminating', existingSessions.length, 'existing sessions');

      await supabase
        .from('user_sessions')
        .update({
          logout_time: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq('user_id', userId)
        .is('logout_time', null);
    }
  } catch (error) {
    console.error('[terminateExistingSessions] Error:', error.message);
  }
}

/**
 * Perform login (RPC or fallback)
 */
async function performLogin(user, req) {
  try {
    const { rpcLogin } = require('../supabase');
    const ipAddress = req.ip || (req.connection?.remoteAddress);
    const deviceInfo = { userAgent: req.get('User-Agent') };

    const result = await rpcLogin(user.username, user.password_hash, ipAddress, deviceInfo);

    if (result && result.success && result.session_id) {
      return { sessionId: result.session_id };
    }
  } catch (error) {
    console.warn('[performLogin] RPC failed, using fallback:', error.message);
  }

  // Fallback: Create session manually
  try {
    const { supabase } = require('../supabase');
    const sessionId = uuidv4();

    await supabase.from('user_sessions').insert({
      session_id: sessionId,
      user_id: user.user_id,
      login_time: new Date().toISOString(),
    });

    return { sessionId };
  } catch (error) {
    console.error('[performLogin] Fallback failed:', error.message);
    throw new AppError('Login service unavailable', 500);
  }
}

/**
 * Generate access and refresh tokens
 */
async function generateTokens(user, sessionId, req) {
  const accessToken = jwt.sign(
    {
      id: user.user_id,
      email: user.username,
      role: user.role_name,
      employee_id: user.employee_id || user.user_id, // Use user_id if employee_id not set
      sessionId,
    },
    config.JWT_SECRET,
    { expiresIn: ACCESS_TOKEN_EXPIRES_IN }
  );

  const refreshToken = generateRefreshToken();
  const refreshTokenHash = hashRefreshToken(refreshToken);
  const ipAddress = req.ip || (req.connection?.remoteAddress);

  await storeRefreshToken(user.user_id, refreshTokenHash, {
    deviceInfo: req.get('User-Agent'),
    ipAddress,
    sessionId,
  });

  return { accessToken, refreshToken };
}

/**
 * Get role-based redirect page
 */
function getRoleRedirect(roleName) {
  const rolePages = {
    superadmin: 'pages/Superadmin.html',
    hr: 'pages/HRDashboard.html',
    head_dept: 'pages/DepartmentHead.html',
    display: 'pages/qr-display.html',
    employee: 'pages/employee.html',
  };
  return rolePages[roleName] || 'pages/employee.html';
}

/**
 * GET /api/roles
 * List all available roles
 */
router.get('/roles', requireAuth(['hr', 'superadmin']), catchAsync(async (req, res) => {
  const { supabase } = require('../conn-supabase');
  const { data: roles, error } = await supabase
    .from('roles')
    .select('*')
    .order('role_id');

  if (error) throw new AppError(error.message, 500);

  res.json({ success: true, data: roles });
}));

module.exports = router;
