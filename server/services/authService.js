const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { supabase } = require('../conn-supabase');
const { AppError } = require('../middleware/errorHandler');
const { logAuditEvent } = require('../utils/audit');
const { validateEmail, validatePassword } = require('../utils/validators');
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
      .update({ user_status: 'active', updated_at: new Date() })
      .eq('id', userId);

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
      .update({ revoked: true })
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
      .update({ revoked: true })
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
      .eq('id', userId)
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
      .update(profileUpdate)
      .eq('id', userId);

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

  // Get current user data
  const user = await getUserProfile(userId);

  // Verify current password
  const validPassword = await bcrypt.compare(currentPassword, user.password_hash);
  if (!validPassword) {
    throw new AppError('Current password is incorrect', 401);
  }

  // Hash new password
  const hashedPassword = await bcrypt.hash(newPassword, 10);

  try {
    const { error } = await supabase
      .from('users')
      .update({
        password_hash: hashedPassword,
        password_changed_at: new Date(),
        updated_at: new Date()
      })
      .eq('id', userId);

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
        updated_at: new Date()
      })
      .eq('id', invitation.user_id);

    if (updateError) throw updateError;

    // Mark invitation as accepted
    const { error: invUpdateError } = await supabase
      .from('invitations')
      .update({ accepted_at: new Date() })
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
  getRoleRedirect
};
