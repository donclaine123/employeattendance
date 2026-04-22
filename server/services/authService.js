const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { supabase } = require('../conn-supabase');
const { AppError } = require('../middleware/errorHandler');
const { logAuditEvent } = require('../utils/audit');
const { validateEmail, validatePassword } = require('../utils/validators');
const { buildSyncDirtyPatch } = require('../utils/syncDirty');
const { rowToUser } = require('../utils/converters');

/**
 * Verify user credentials and return user object
 * @param {string} email - User email
 * @param {string} password - User password
 * @returns {Promise<Object>} User object if credentials valid
 */
async function verifyCredentials(email, password) {
  validateEmail(email);
  
  if (!password) {
    throw new AppError('Password is required', 400);
  }

  // Try Supabase first
  try {
    const { data, error } = await supabase
      .from('users')
      .select('*')
      .eq('email', email)
      .single();

    if (error || !data) {
      throw new AppError('Invalid credentials', 401);
    }

    const user = rowToUser(data);

    // Verify password
    const validPassword = await bcrypt.compare(password, user.password_hash);
    if (!validPassword) {
      throw new AppError('Invalid credentials', 401);
    }

    return user;
  } catch (error) {
    if (error.isOperational) throw error;
    
    // Fallback to local DB
    return verifyCredentialsLocal(email, password);
  }
}

/**
 * Fallback: Verify credentials against local database
 */
async function verifyCredentialsLocal(email, password) {
  const db = require('../db.json');
  const user = db.users.find(u => u.email === email);

  if (!user) {
    throw new AppError('Invalid credentials', 401);
  }

  const validPassword = await bcrypt.compare(password, user.password_hash);
  if (!validPassword) {
    throw new AppError('Invalid credentials', 401);
  }

  return user;
}

/**
 * Generate JWT tokens (access + refresh)
 * @param {string} userId - User ID
 * @param {string} role - User role
 * @returns {Object} { accessToken, refreshToken, sessionId }
 */
function generateTokens(userId, role) {
  const sessionId = require('crypto').randomUUID();
  
  const accessToken = jwt.sign(
    { userId, role, sessionId },
    process.env.JWT_SECRET,
    { expiresIn: '15m' }
  );

  const refreshToken = jwt.sign(
    { userId, sessionId },
    process.env.JWT_SECRET,
    { expiresIn: '7d' }
  );

  return { accessToken, refreshToken, sessionId };
}

/**
 * Activate pending user account
 * @param {string} userId - User ID
 * @param {string} auditUserId - User performing the action
 */
async function activateUser(userId, auditUserId = null) {
  try {
    const { error } = await supabase
      .from('users')
      .update({
        user_status: 'active',
        updated_at: new Date(),
        ...buildSyncDirtyPatch()
      })
      .eq('user_id', userId);

    if (error) throw error;

    if (auditUserId) {
      await logAuditEvent(auditUserId, 'USER_ACTIVATED', {
        user_id: userId,
        action: 'Auto-activation during login'
      });
    }
  } catch (error) {
    console.error('Error activating user:', error);
  }
}

/**
 * Terminate all existing sessions for user (except display accounts)
 * @param {string} userId - User ID
 * @param {string} role - User role
 */
async function terminateExistingSessions(userId, role) {
  // Display accounts allow multiple sessions
  if (role === 'display') return;

  try {
    // Invalidate all refresh tokens for this user
    const { error } = await supabase
      .from('user_sessions')
      .update({
        revoked: true,
        ...buildSyncDirtyPatch()
      })
      .eq('user_id', userId)
      .eq('revoked', false);

    if (error) console.error('Error terminating sessions:', error);
  } catch (error) {
    console.error('Error in terminateExistingSessions:', error);
  }
}

/**
 * Create and store user session
 * @param {string} userId - User ID
 * @param {string} sessionId - Session ID from token
 * @param {string} refreshToken - Refresh token
 */
async function createSession(userId, sessionId, refreshToken) {
  try {
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days

    const { error } = await supabase
      .from('user_sessions')
      .insert([{
        user_id: userId,
        session_id: sessionId,
        refresh_token: refreshToken,
        expires_at: expiresAt,
        revoked: false,
        created_at: new Date()
      }]);

    if (error) throw error;
  } catch (error) {
    console.error('Error creating session:', error);
  }
}

/**
 * Revoke user session
 * @param {string} userId - User ID
 * @param {string} sessionId - Session ID to revoke
 */
async function revokeSession(userId, sessionId) {
  try {
    const { error } = await supabase
      .from('user_sessions')
      .update({
        revoked: true,
        ...buildSyncDirtyPatch()
      })
      .eq('user_id', userId)
      .eq('session_id', sessionId);

    if (error) throw error;
  } catch (error) {
    console.error('Error revoking session:', error);
  }
}

/**
 * Verify session is valid (not revoked)
 * @param {string} userId - User ID
 * @param {string} sessionId - Session ID
 * @returns {Promise<boolean>}
 */
async function verifySession(userId, sessionId) {
  try {
    const { data, error } = await supabase
      .from('user_sessions')
      .select('*')
      .eq('user_id', userId)
      .eq('session_id', sessionId)
      .eq('revoked', false)
      .single();

    if (error || !data) return false;

    // Check if session expired
    return new Date(data.expires_at) > new Date();
  } catch (error) {
    return false;
  }
}

/**
 * Get user profile with related data
 * @param {string} userId - User ID
 * @returns {Promise<Object>} User profile object
 */
async function getUserProfile(userId) {
  try {
    const { data, error } = await supabase
      .from('users')
      .select('*')
      .eq('user_id', userId)
      .single();

    if (error) throw error;
    if (!data) throw new AppError('User not found', 404);

    return rowToUser(data);
  } catch (error) {
    if (error.isOperational) throw error;
    throw new AppError('Error fetching user profile', 500);
  }
}

/**
 * Update user profile
 * @param {string} userId - User ID
 * @param {Object} updates - Fields to update
 */
async function updateProfile(userId, updates) {
  const allowedFields = ['name', 'phone_number', 'address', 'updated_at'];
  const profileUpdate = {};

  for (const [key, value] of Object.entries(updates)) {
    if (allowedFields.includes(key) && value) {
      profileUpdate[key] = value;
    }
  }

  if (Object.keys(profileUpdate).length === 0) {
    throw new AppError('No valid fields to update', 400);
  }

  profileUpdate.updated_at = new Date();

  try {
    const { error } = await supabase
      .from('users')
      .update({
        ...profileUpdate,
        ...buildSyncDirtyPatch()
      })
      .eq('user_id', userId);

    if (error) throw error;

    return await getUserProfile(userId);
  } catch (error) {
    if (error.isOperational) throw error;
    throw new AppError('Error updating profile', 500);
  }
}

/**
 * Change user password
 * @param {string} userId - User ID
 * @param {string} currentPassword - Current password for verification
 * @param {string} newPassword - New password
 */
async function changePassword(userId, currentPassword, newPassword) {
  validatePassword(newPassword);

  // Get current user data bypassing DTO to grab the password hash securely
  const { data: userData, error: fetchError } = await supabase
    .from('users')
    .select('*')
    .eq('user_id', userId)
    .single();

  if (fetchError || !userData) {
    throw new AppError('User not found', 404);
  }

  // Verify current password
  const validPassword = await bcrypt.compare(currentPassword, userData.password_hash);
  if (!validPassword) {
    throw new AppError('Current password is incorrect', 400);
  }

  // Hash new password
  const hashedPassword = await bcrypt.hash(newPassword, 10);

  try {
    const { error } = await supabase
      .from('users')
      .update({
        password_hash: hashedPassword,
        updated_at: new Date(),
        ...buildSyncDirtyPatch()
      })
      .eq('user_id', userId);

    if (error) throw error;

    await logAuditEvent(userId, 'PASSWORD_CHANGED', {
      user_id: userId,
      timestamp: new Date()
    });
  } catch (error) {
    if (error.isOperational) throw error;
    throw new AppError('Error changing password', 500);
  }
}

/**
 * Accept invitation and create account
 * @param {string} token - Invitation token
 * @param {string} name - User name
 * @param {string} password - User password
 */
async function acceptInvitation(token, name, password) {
  validatePassword(password);

  if (!name || name.trim().length === 0) {
    throw new AppError('Name is required', 400);
  }

  try {
    // Find invitation by token
    const { data: invitationData, error: invError } = await supabase
      .from('invitations')
      .select('*')
      .eq('token', token)
      .single();

    if (invError || !invitationData) {
      throw new AppError('Invalid or expired invitation', 400);
    }

    const invitation = invitationData;

    // Check if invitation is still valid
    if (invitation.accepted_at || new Date(invitation.expires_at) < new Date()) {
      throw new AppError('Invitation has expired or already used', 400);
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);

    // Update user with password and activate
    const { error: updateError } = await supabase
      .from('users')
      .update({
        name,
        password_hash: hashedPassword,
        user_status: 'active',
        updated_at: new Date(),
        ...buildSyncDirtyPatch()
      })
      .eq('user_id', invitation.user_id);

    if (updateError) throw updateError;

    // Mark invitation as accepted
    const { error: invUpdateError } = await supabase
      .from('invitations')
      .update({
        accepted_at: new Date(),
        ...buildSyncDirtyPatch()
      })
      .eq('id', invitation.id);

    if (invUpdateError) console.error('Error marking invitation as accepted:', invUpdateError);

    // Log audit event
    await logAuditEvent(invitation.user_id, 'INVITATION_ACCEPTED', {
      user_id: invitation.user_id,
      email: invitation.email
    });

    return { success: true, userId: invitation.user_id };
  } catch (error) {
    if (error.isOperational) throw error;
    throw new AppError('Error accepting invitation', 500);
  }
}

/**
 * Verify invitation token
 * @param {string} token - Invitation token
 * @returns {Promise<Object>} Invitation data
 */
async function verifyInvitationToken(token) {
  try {
    const { data, error } = await supabase
      .from('invitations')
      .select('*')
      .eq('token', token)
      .single();

    if (error || !data) {
      throw new AppError('Invalid invitation token', 400);
    }

    const invitation = data;

    // Check expiration
    if (invitation.accepted_at || new Date(invitation.expires_at) < new Date()) {
      throw new AppError('Invitation has expired or already used', 400);
    }

    return {
      email: invitation.email,
      role: invitation.role,
      expiresAt: invitation.expires_at
    };
  } catch (error) {
    if (error.isOperational) throw error;
    throw new AppError('Error verifying invitation', 500);
  }
}

/**
 * Get role redirect URL
 * @param {string} role - User role
 * @returns {string} Redirect URL
 */
function getRoleRedirect(role) {
  const roleRedirects = {
    'superadmin': '/admin/dashboard',
    'hr': '/hr/dashboard',
    'head_dept': '/departmenthead/dashboard',
    'employee': '/employee/dashboard',
    'display': '/display/qr'
  };

  return roleRedirects[role] || '/dashboard';
}

/**
 * Handle forgotten password requests
 * @param {string} email - User email
 */
async function requestPasswordReset(email) {
  validateEmail(email);

  // 1. Find user by email
  const { data: user, error: userError } = await supabase
    .from('users')
    .select('user_id, status')
    .eq('username', email)
    .single();

  if (userError || !user) {
    // We do NOT want to leak whether the email exists. 
    // Always resolve "successfully" from a security standpoint.
    return { success: true, message: 'If the email exists, a reset link was sent.' };
  }

  if (user.status !== 'active') {
    // Cannot reset password for inactive users
    return { success: true, message: 'If the email exists, a reset link was sent.' };
  }

  // 2. Generate secure token
  const token = require('crypto').randomUUID();
  const tokenHash = require('crypto').createHash('sha256').update(token).digest('hex');
  const expiresAt = new Date(Date.now() + 30 * 60 * 1000); // 30 minutes from now

  // 3. Save to password_resets table
  const { error: resetError } = await supabase
    .from('password_resets')
    .insert([{
      user_id: user.user_id,
      token_hash: tokenHash,
      expires_at: expiresAt
    }]);

  if (resetError) {
    console.error('Error inserting password reset token:', resetError);
    // Still return generic success to avoid leaking internal state/email presence
    return { success: true, message: 'If the email exists, a reset link was sent.' };
  }

  // 4. Send email in background
  const EmailService = require('../utils/emailService');
  const emailService = new EmailService();

  const resetLink = `http://workline.local/pages/reset-password.html?token=${token}`;

  emailService.sendPasswordResetEmail({
    email,
    resetLink,
    expiresAt: expiresAt.toISOString()
  }).catch(err => {
    console.error('[requestPasswordReset] Background email failed:', err.message);
  });

  await logAuditEvent(user.user_id, 'PASSWORD_RESET_REQUESTED', { email });

  return { success: true, message: 'If the email exists, a reset link was sent.' };
}

/**
 * Apply new password using reset token
 * @param {string} token - The reset token
 * @param {string} newPassword - The new password
 */
async function resetPasswordWithToken(token, newPassword) {
  if (!token) throw new AppError('Invalid or missing token', 400);
  validatePassword(newPassword);

  const tokenHash = require('crypto').createHash('sha256').update(token).digest('hex');

  // 1. Find valid token
  const { data: resetRecord, error: resetError } = await supabase
    .from('password_resets')
    .select('id, user_id, expires_at, used')
    .eq('token_hash', tokenHash)
    .single();

  if (resetError || !resetRecord) {
    throw new AppError('Invalid or expired password reset token.', 400);
  }

  if (resetRecord.used) {
    throw new AppError('This reset link has already been used.', 400);
  }

  if (new Date(resetRecord.expires_at) < new Date()) {
    throw new AppError('This reset link has expired.', 400);
  }

  // 2. Hash new password & update
  const salt = await bcrypt.genSalt(10);
  const hashedPassword = await bcrypt.hash(newPassword, salt);

  const { error: updateError } = await supabase
    .from('users')
    .update({
      password_hash: hashedPassword,
      updated_at: new Date(),
      ...buildSyncDirtyPatch()
    })
    .eq('user_id', resetRecord.user_id);

  if (updateError) {
    throw new AppError('Failed to reset password. Please try again later.', 500);
  }

  // 3. Mark token as used
  await supabase
    .from('password_resets')
    .update({
      used: true,
      ...buildSyncDirtyPatch()
    })
    .eq('id', resetRecord.id);

  // 4. Invalidate all existing sessions (optional but highly recommended for security)
  await terminateExistingSessions(resetRecord.user_id, 'user'); // general invalidation

  await logAuditEvent(resetRecord.user_id, 'PASSWORD_RESET_COMPLETED', { reset_id: resetRecord.id });

  return { success: true, message: 'Password has been successfully reset.' };
}

module.exports = {
  verifyCredentials,
  generateTokens,
  activateUser,
  terminateExistingSessions,
  createSession,
  revokeSession,
  verifySession,
  getUserProfile,
  updateProfile,
  changePassword,
  acceptInvitation,
  verifyInvitationToken,
  getRoleRedirect,
  requestPasswordReset,
  resetPasswordWithToken
};
