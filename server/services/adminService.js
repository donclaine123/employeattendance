const { supabase } = require('../conn-supabase');
const { AppError } = require('../middleware/errorHandler');
const { logAuditEvent } = require('../utils/audit');

/**
 * List audit logs with filters
 * @param {Object} filters - Filter criteria {userId, actionType, startDate, endDate}
 * @param {number} page - Page number
 * @param {number} limit - Records per page
 * @returns {Promise<Object>} Paginated audit logs
 */
async function getAuditLogs(filters = {}, page = 1, limit = 50) {
  try {
    let query = supabase
      .from('audit_logs')
      .select('*, users(name, email)', { count: 'exact' });

    if (filters.userId) {
      query = query.eq('user_id', filters.userId);
    }

    if (filters.actionType) {
      query = query.eq('action_type', filters.actionType);
    }

    if (filters.startDate && filters.endDate) {
      query = query
        .gte('created_at', filters.startDate)
        .lte('created_at', filters.endDate);
    }

    const offset = (page - 1) * limit;
    query = query
      .range(offset, offset + limit - 1)
      .order('created_at', { ascending: false });

    const { data, count, error } = await query;

    if (error) throw error;

    return {
      data: data.map(log => ({
        id: log.id,
        userId: log.user_id,
        userName: log.users?.name,
        userEmail: log.users?.email,
        actionType: log.action_type,
        details: log.details,
        ipAddress: log.ip_address,
        userAgent: log.user_agent,
        createdAt: log.created_at
      })),
      pagination: {
        page,
        limit,
        total: count,
        pages: Math.ceil(count / limit)
      }
    };
  } catch (error) {
    if (error.isOperational) throw error;
    throw new AppError('Error fetching audit logs', 500);
  }
}

/**
 * Get system settings
 * @returns {Promise<Object>} System settings
 */
async function getSystemSettings() {
  try {
    const { data, error } = await supabase
      .from('system_settings')
      .select('*');

    if (error) throw error;

    // Convert array to object
    const settings = {};
    if (Array.isArray(data)) {
      data.forEach(setting => {
        settings[setting.key] = setting.value;
      });
    }

    return settings;
  } catch (error) {
    if (error.isOperational) throw error;
    throw new AppError('Error fetching settings', 500);
  }
}

/**
 * Update system settings
 * @param {Object} updates - Settings to update
 * @param {string} updatedBy - User ID
 */
async function updateSystemSettings(updates, updatedBy) {
  try {
    const updatePromises = Object.entries(updates).map(([key, value]) => {
      return supabase
        .from('system_settings')
        .update({ value })
        .eq('key', key);
    });

    await Promise.all(updatePromises);

    await logAuditEvent(updatedBy, 'SYSTEM_SETTINGS_UPDATED', {
      changes: updates
    });

    return { success: true, message: 'Settings updated' };
  } catch (error) {
    if (error.isOperational) throw error;
    throw new AppError('Error updating settings', 500);
  }
}

/**
 * List active sessions
 * @param {number} page - Page number
 * @param {number} limit - Records per page
 * @returns {Promise<Object>} Paginated sessions
 */
async function getActiveSessions(page = 1, limit = 20) {
  try {
    let query = supabase
      .from('user_sessions')
      .select('*, users(id, name, email)', { count: 'exact' })
      .eq('revoked', false)
      .gte('expires_at', new Date().toISOString());

    const offset = (page - 1) * limit;
    query = query
      .range(offset, offset + limit - 1)
      .order('created_at', { ascending: false });

    const { data, count, error } = await query;

    if (error) throw error;

    return {
      data: data.map(session => ({
        id: session.id,
        userId: session.user_id,
        userName: session.users?.name,
        userEmail: session.users?.email,
        sessionId: session.session_id,
        createdAt: session.created_at,
        expiresAt: session.expires_at
      })),
      pagination: {
        page,
        limit,
        total: count,
        pages: Math.ceil(count / limit)
      }
    };
  } catch (error) {
    if (error.isOperational) throw error;
    throw new AppError('Error fetching sessions', 500);
  }
}

/**
 * Force logout user (revoke session)
 * @param {string} userId - User ID to logout
 * @param {string} revokedBy - User ID who revoked
 */
async function forceLogout(userId, revokedBy) {
  try {
    const { error } = await supabase
      .from('user_sessions')
      .update({ revoked: true })
      .eq('user_id', userId)
      .eq('revoked', false);

    if (error) throw error;

    await logAuditEvent(revokedBy, 'USER_FORCE_LOGOUT', {
      user_id: userId,
      force_logout: true
    });

    return { success: true, message: 'User logged out' };
  } catch (error) {
    if (error.isOperational) throw error;
    throw new AppError('Error forcing logout', 500);
  }
}

/**
 * List pending invitations
 * @param {number} page - Page number
 * @param {number} limit - Records per page
 * @returns {Promise<Object>} Paginated invitations
 */
async function listInvitations(page = 1, limit = 20) {
  try {
    let query = supabase
      .from('invitations')
      .select('*, users(name, email)', { count: 'exact' });

    const offset = (page - 1) * limit;
    query = query
      .range(offset, offset + limit - 1)
      .order('created_at', { ascending: false });

    const { data, count, error } = await query;

    if (error) throw error;

    return {
      data: data.map(inv => ({
        id: inv.id,
        email: inv.email,
        role: inv.role,
        status: inv.accepted_at ? 'accepted' : 'pending',
        createdAt: inv.created_at,
        expiresAt: inv.expires_at,
        acceptedAt: inv.accepted_at
      })),
      pagination: {
        page,
        limit,
        total: count,
        pages: Math.ceil(count / limit)
      }
    };
  } catch (error) {
    if (error.isOperational) throw error;
    throw new AppError('Error fetching invitations', 500);
  }
}

/**
 * Create invitation
 * @param {string} email - Email to invite
 * @param {string} role - Role for invited user
 * @param {string} createdBy - User ID
 */
async function createInvitation(email, role, createdBy) {
  const validRoles = ['hr', 'head_dept', 'employee', 'display'];

  if (!validRoles.includes(role)) {
    throw new AppError(`Invalid role: ${role}`, 400);
  }

  try {
    // Check if invitation already exists
    const { data: existingInv } = await supabase
      .from('invitations')
      .select('id')
      .eq('email', email)
      .is('accepted_at', null)
      .single();

    if (existingInv) {
      throw new AppError('Invitation already pending for this email', 409);
    }

    const token = require('crypto').randomUUID();
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days

    const { data: newInvitation, error } = await supabase
      .from('invitations')
      .insert([{
        email,
        role,
        token,
        expires_at: expiresAt,
        created_by: createdBy,
        created_at: new Date()
      }])
      .select()
      .single();

    if (error) throw error;

    await logAuditEvent(createdBy, 'INVITATION_CREATED', {
      email,
      role,
      invitation_id: newInvitation.id
    });

    return {
      id: newInvitation.id,
      email,
      role,
      token,
      expiresAt
    };
  } catch (error) {
    if (error.isOperational) throw error;
    throw new AppError('Error creating invitation', 500);
  }
}

/**
 * Get invitation
 * @param {string} invitationId - Invitation ID
 * @returns {Promise<Object>} Invitation
 */
async function getInvitation(invitationId) {
  try {
    const { data, error } = await supabase
      .from('invitations')
      .select('*')
      .eq('id', invitationId)
      .single();

    if (error || !data) {
      throw new AppError('Invitation not found', 404);
    }

    return {
      id: data.id,
      email: data.email,
      role: data.role,
      status: data.accepted_at ? 'accepted' : 'pending',
      createdAt: data.created_at,
      expiresAt: data.expires_at,
      acceptedAt: data.accepted_at
    };
  } catch (error) {
    if (error.isOperational) throw error;
    throw new AppError('Error fetching invitation', 500);
  }
}

/**
 * Resend invitation
 * @param {string} invitationId - Invitation ID
 * @param {string} resendBy - User ID
 */
async function resendInvitation(invitationId, resendBy) {
  try {
    const invitation = await getInvitation(invitationId);

    if (invitation.status === 'accepted') {
      throw new AppError('Cannot resend accepted invitation', 400);
    }

    await logAuditEvent(resendBy, 'INVITATION_RESENT', {
      invitation_id: invitationId,
      email: invitation.email
    });

    return { success: true, message: 'Invitation resent' };
  } catch (error) {
    if (error.isOperational) throw error;
    throw new AppError('Error resending invitation', 500);
  }
}

/**
 * Delete invitation
 * @param {string} invitationId - Invitation ID
 * @param {string} deletedBy - User ID
 */
async function deleteInvitation(invitationId, deletedBy) {
  try {
    const invitation = await getInvitation(invitationId);

    const { error } = await supabase
      .from('invitations')
      .delete()
      .eq('id', invitationId);

    if (error) throw error;

    await logAuditEvent(deletedBy, 'INVITATION_DELETED', {
      invitation_id: invitationId,
      email: invitation.email
    });

    return { success: true, message: 'Invitation deleted' };
  } catch (error) {
    if (error.isOperational) throw error;
    throw new AppError('Error deleting invitation', 500);
  }
}

module.exports = {
  getAuditLogs,
  getSystemSettings,
  updateSystemSettings,
  getActiveSessions,
  forceLogout,
  listInvitations,
  createInvitation,
  getInvitation,
  resendInvitation,
  deleteInvitation
};
