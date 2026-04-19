const { supabase } = require('../conn-supabase');
const { AppError } = require('../middleware/errorHandler');
const { logAuditEvent } = require('../utils/audit');
const { AUDIT_ACTIONS } = require('../utils/constants');

const REMOVED_SYSTEM_SETTING_KEYS = new Set([
  'session_timeout',
  'password_policy_min_length',
  'password_policy_complexity'
]);

/**
 * List audit logs with filters
 * @param {Object} filters - Filter criteria {userId, userIds, actionType, actionTypes, startDate, endDate, ipAddress}
 * @param {number} page - Page number
 * @param {number} limit - Records per page
 * @returns {Promise<Object>} Paginated audit logs
 */
async function getAuditLogs(filters = {}, page = 1, limit = 50) {
  try {
    let query = supabase
      .from('audit_logs')
      .select('*, users(username, role_id, roles(role_name))', { count: 'exact' });

    if (filters.userIds) {
      const parsedIds = String(filters.userIds)
        .split(',')
        .map(id => parseInt(id, 10))
        .filter(id => Number.isInteger(id));

      if (parsedIds.length > 0) {
        query = query.in('user_id', parsedIds);
      }
    } else if (filters.userId !== undefined && filters.userId !== null && filters.userId !== '') {
      const parsedUserId = parseInt(filters.userId, 10);
      if (Number.isInteger(parsedUserId)) {
        query = query.eq('user_id', parsedUserId);
      }
    }

    const actionTypes = filters.actionTypes
      ? String(filters.actionTypes).split(',').map(value => value.trim()).filter(Boolean)
      : (filters.actionType ? [String(filters.actionType).trim()].filter(Boolean) : []);

    if (actionTypes.length > 0) {
      query = query.in('action_type', actionTypes);
    }

    if (filters.startDate && filters.endDate) {
      query = query
        .gte('created_at', filters.startDate)
        .lte('created_at', filters.endDate);
    }

    if (filters.ipAddress) {
      const ipSearch = String(filters.ipAddress).trim();
      if (ipSearch) {
        query = query.ilike('ip_address', `%${ipSearch}%`);
      }
    }

    query = query.or('details->>reason.is.null,details->>reason.neq.user_not_found');

    const offset = (page - 1) * limit;
    query = query
      .range(offset, offset + limit - 1)
      .order('created_at', { ascending: false });

    const { data, count, error } = await query;

    if (error) {
      console.error('[adminService.getAuditLogs] Supabase error:', error);
      throw error;
    }

    // Bulk resolve missing names for past logs where only IDs exist
    const userIdsToFetch = new Set();
    const employeeIdsToFetch = new Set();
    const departmentIdsToFetch = new Set();

    data.forEach(log => {
      const d = log.details || {};
      if (d.user_id && !d.username) userIdsToFetch.add(d.user_id);
      if (d.employee_id && !d.employee_name) employeeIdsToFetch.add(d.employee_id);
      if (d.department_id && !d.department_name) departmentIdsToFetch.add(d.department_id);
    });

    const userNames = {};
    const employeeNames = {};
    const departmentNames = {};

    if (userIdsToFetch.size > 0) {
      const { data: users } = await supabase.from('users').select('user_id, username').in('user_id', Array.from(userIdsToFetch));
      if (users) users.forEach(u => userNames[u.user_id] = u.username);
    }
    if (employeeIdsToFetch.size > 0) {
      const { data: employees } = await supabase.from('employees').select('employee_id, first_name, last_name, users(username)').in('employee_id', Array.from(employeeIdsToFetch));
      if (employees) employees.forEach(e => {
        employeeNames[e.employee_id] = e.first_name ? `${e.first_name} ${e.last_name}` : (e.users?.username || `Employee #${e.employee_id}`);
      });
    }
    if (departmentIdsToFetch.size > 0) {
      const { data: depts } = await supabase.from('departments').select('dept_id, dept_name').in('dept_id', Array.from(departmentIdsToFetch));
      if (depts) depts.forEach(d => departmentNames[d.dept_id] = d.dept_name);
    }

    return {
      data: data.map(log => {
        const d = { ...(log.details || {}) };
        
        // Inject resolved names into details for legacy logs
        if (d.user_id && !d.username && userNames[d.user_id]) d.username = userNames[d.user_id];
        if (d.employee_id && !d.employee_name && employeeNames[d.employee_id]) d.employee_name = employeeNames[d.employee_id];
        if (d.department_id && !d.department_name && departmentNames[d.department_id]) d.department_name = departmentNames[d.department_id];

        // Ensure missing fallback exists to prevent raw ID from showing raw numbers without context
        if (d.user_id && !d.username) d.username = `User #${d.user_id}`;
        if (d.employee_id && !d.employee_name) d.employee_name = `Employee #${d.employee_id}`;
        if (d.department_id && !d.department_name) d.department_name = `Dept #${d.department_id}`;

        return {
          id: log.id,
          userId: log.user_id,
          userName: log.users?.username,
          userRole: log.users?.roles?.role_name || null,
          actionType: log.action_type,
          details: d,
          ipAddress: log.ip_address,
          userAgent: log.user_agent,
          createdAt: log.created_at
        };
      }),
      pagination: {
        page,
        limit,
        total: count,
        pages: Math.ceil(count / limit)
      }
    };
  } catch (error) {
    console.error('[adminService.getAuditLogs] Error:', error);
    if (error.isOperational) throw error;
    throw new AppError('Error fetching audit logs', 500);
  }
}

/**
 * Get suspicious activity signals from recent audit logs
 * @param {number} windowMinutes - rolling window in minutes
 * @returns {Promise<Object>} suspicious activity summary
 */
async function getSuspiciousAuditSignals(windowMinutes = 15) {
  return getSecuritySignals(windowMinutes);
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
        // Column names are setting_key and setting_value
        if (REMOVED_SYSTEM_SETTING_KEYS.has(setting.setting_key)) {
          return;
        }
        settings[setting.setting_key] = setting.setting_value;
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
    const normalizedUpdates = Object.entries(updates || {}).reduce((accumulator, [key, value]) => {
      if (REMOVED_SYSTEM_SETTING_KEYS.has(key)) {
        return accumulator;
      }

      if (value === undefined || value === null) {
        return accumulator;
      }

      if (typeof value === 'string') {
        accumulator[key] = value.trim();
        return accumulator;
      }

      if (typeof value === 'boolean' || typeof value === 'number') {
        accumulator[key] = String(value);
        return accumulator;
      }

      accumulator[key] = value;
      return accumulator;
    }, {});

    await Promise.all(Array.from(REMOVED_SYSTEM_SETTING_KEYS).map((settingKey) => {
      return supabase
        .from('system_settings')
        .delete()
        .eq('setting_key', settingKey);
    }));

    const updatePromises = Object.entries(normalizedUpdates).map(([key, value]) => {
      return supabase
        .from('system_settings')
        .upsert({ setting_key: key, setting_value: value })
        .eq('setting_key', key);
    });

    await Promise.all(updatePromises);

    await logAuditEvent(updatedBy, 'SYSTEM_SETTINGS_UPDATED', {
      changes: normalizedUpdates
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
      .select('*, users(user_id, username, role_id, roles(role_name))', { count: 'exact' })
      .is('logout_time', null);

    const offset = (page - 1) * limit;
    query = query
      .range(offset, offset + limit - 1)
      .order('login_time', { ascending: false });

    const { data, count, error } = await query;

    if (error) {
      throw error;
    }

    if (!data || data.length === 0) {
      return {
        data: [],
        pagination: {
          page,
          limit,
          total: count,
          pages: Math.ceil(count / limit)
        }
      };
    }

    const mappedData = data.map((session) => {
      const mapped = {
        session_id: session.session_id,
        user_id: session.user_id,
        username: session.users?.username || 'Unknown',
        role: session.users?.roles?.role_name || 'N/A',
        login_time: session.login_time,
        logout_time: session.logout_time,
        ip_address: session.ip_address || 'N/A',
        device_info: session.device_info,
        full_name: session.users?.username || 'Unknown'
      };
      return mapped;
    });

    return {
      data: mappedData,
      pagination: {
        page,
        limit,
        total: count,
        pages: Math.ceil(count / limit)
      }
    };
  } catch (error) {
    console.error('[adminService.getActiveSessions] Error:', error);
    if (error.isOperational) throw error;
    throw new AppError('Error fetching sessions', 500);
  }
}

/**
 * Force logout user (revoke session)
 * @param {string} userId - User ID to logout
 * @param {string} revokedBy - User ID who revoked
 */
async function forceLogout(sessionId, revokedBy) {
  try {
    const { invalidateSessionValidationCache } = require('../middleware/auth');

    // Get the session first to find the user_id
    const { data: sessionData, error: fetchError } = await supabase
      .from('user_sessions')
      .select('user_id, session_id, users(username)')
      .eq('session_id', sessionId)
      .single();

    if (fetchError || !sessionData) {
      throw new AppError('Session not found', 404);
    }

    const userId = sessionData.user_id;

    // Update the session with logout_time
    const { data: updatedSession, error: updateError } = await supabase
      .from('user_sessions')
      .update({
        logout_time: new Date().toISOString()
      })
      .eq('session_id', sessionId)
      .select();

    if (updateError) {
      throw updateError;
    }

    invalidateSessionValidationCache(sessionId, userId);

    await logAuditEvent(revokedBy, 'USER_FORCE_LOGOUT', {
      user_id: userId,
      username: sessionData.users?.username || `User #${userId}`,
      session_id: sessionId,
      force_logout: true
    });

    return { success: true, message: 'Session logged out successfully' };
  } catch (error) {
    console.error('[forceLogout] Error:', error);
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
      .select('*, roles(role_name), departments(dept_name), users!invitations_created_by_fkey(username)', { count: 'exact' });

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
        role_id: inv.role_id,
        role_name: inv.roles?.role_name || 'Unknown',
        dept_id: inv.dept_id,
        dept_name: inv.departments?.dept_name || null,
        status: inv.accepted_at || inv.used_at || inv.used ? 'accepted' : 'pending',
        created_at: inv.created_at,
        created_by: inv.users?.username || 'System',
        expires_at: inv.expires_at,
        accepted_at: inv.accepted_at || inv.used_at || null,
        used_at: inv.used_at || inv.accepted_at || null,
        used: Boolean(inv.used || inv.accepted_at || inv.used_at),
        metadata: inv.metadata || {}
      })),
      pagination: {
        page,
        limit,
        total: count,
        pages: Math.ceil(count / limit)
      },
      invitations: data.map(inv => ({
        id: inv.id,
        email: inv.email,
        role_id: inv.role_id,
        role_name: inv.roles?.role_name || 'Unknown',
        dept_id: inv.dept_id,
        dept_name: inv.departments?.dept_name || null,
        status: inv.accepted_at || inv.used_at || inv.used ? 'accepted' : 'pending',
        created_at: inv.created_at,
        created_by: inv.users?.username || 'System',
        expires_at: inv.expires_at,
        accepted_at: inv.accepted_at || inv.used_at || null,
        used_at: inv.used_at || inv.accepted_at || null,
        used: Boolean(inv.used || inv.accepted_at || inv.used_at),
        metadata: inv.metadata || {}
      }))
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
async function createInvitation(email, role, createdBy, deptId = null, expiresIn = null) {
  const validRoles = ['hr', 'head_dept', 'employee', 'display', 'superadmin'];

  if (!validRoles.includes(role)) {
    throw new AppError(`Invalid role: ${role}`, 400);
  }

  try {
    // Get role_id from role name
    const { data: roleData, error: roleError } = await supabase
      .from('roles')
      .select('role_id')
      .eq('role_name', role)
      .single();

    if (roleError || !roleData) {
      throw new AppError(`Invalid role: ${role}`, 400);
    }

    const roleId = roleData.role_id;

    // Check if invitation already exists
    const { data: existingInv, error: existingError } = await supabase
      .from('invitations')
      .select('id')
      .eq('email', email)
      .eq('used', false)
      .single();

    if (existingInv) {
      throw new AppError('Invitation already pending for this email', 409);
    }

    const token = require('crypto').randomUUID();
    const tokenHash = require('crypto').createHash('sha256').update(token).digest('hex');
    // Use provided expiresIn (in milliseconds) or default to 7 days
    const expiresAt = new Date(Date.now() + (expiresIn || 7 * 24 * 60 * 60 * 1000));
    const invitationMetadata = { inviteToken: token };

    const { data: newInvitation, error } = await supabase
      .from('invitations')
      .insert([{
        email,
        role_id: roleId,
        dept_id: deptId,
        token_hash: tokenHash,
        expires_at: expiresAt,
        created_by: createdBy,
        created_at: new Date(),
        metadata: invitationMetadata
      }])
      .select()
      .single();

    if (error) {
      throw error;
    }

    const EmailService = require('../utils/emailService');
    const emailService = new EmailService();

    const inviteLink = `http://workline.local/pages/accept-invite.html?token=${token}`;
    let emailResult = null;

    try {
      emailResult = await emailService.sendInvitationEmail({
        email,
        inviteLink,
        roleName: role,
        inviterName: 'Administrator',
        expiresAt: expiresAt.toISOString()
      });
    } catch (emailError) {
      console.error('[createInvitation] Invitation email failed:', emailError.message);
      emailResult = { success: false, error: emailError.message || 'Failed to send invitation email' };
    }

    const emailStatus = {
      ...emailResult,
      provider: emailService.provider,
      recipient: email,
      sent: Boolean(emailResult?.success)
    };

    if (global.io && typeof global.io.emit === 'function') {
      global.io.emit('invitation:email_status_updated', {
        invitationId: newInvitation.id,
        email_status: emailStatus
      });
    }

    await logAuditEvent(createdBy, 'INVITATION_CREATED', {
      email,
      role,
      dept_id: deptId,
      invitation_id: newInvitation.id
    });

    return {
      id: newInvitation.id,
      email,
      role,
      dept_id: deptId,
      token,
      expiresAt,
      metadata: invitationMetadata,
      email_status: emailStatus
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
      status: data.accepted_at || data.used_at ? 'accepted' : 'pending',
      createdAt: data.created_at,
      expiresAt: data.expires_at,
      acceptedAt: data.accepted_at || data.used_at || null,
      usedAt: data.used_at || data.accepted_at || null,
      metadata: data.metadata || {}
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

    // Generate new token and hash
    const token = require('crypto').randomUUID();
    const tokenHash = require('crypto').createHash('sha256').update(token).digest('hex');
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days
    const invitationMetadata = {
      ...(invitation.metadata || {}),
      inviteToken: token
    };

    // Update invitation with new token
    const { data: updatedInvitation, error: updateError } = await supabase
      .from('invitations')
      .update({
        token_hash: tokenHash,
        expires_at: expiresAt,
        created_at: new Date(),
        metadata: invitationMetadata
      })
      .eq('id', invitationId)
      .select(`
        *,
        roles(role_name),
        departments(dept_name)
      `)
      .single();

    if (updateError || !updatedInvitation) {
      throw new AppError('Failed to update invitation', 500);
    }

    const EmailService = require('../utils/emailService');
    const emailService = new EmailService();

    const inviteLink = `http://workline.local/pages/accept-invite.html?token=${token}`;
    let emailResult = null;

    try {
      emailResult = await emailService.sendInvitationEmail({
        email: invitation.email,
        inviteLink,
        roleName: updatedInvitation.roles?.role_name || invitation.role,
        inviterName: 'Administrator',
        expiresAt: expiresAt.toISOString()
      });
    } catch (emailError) {
      console.error('[resendInvitation] Invitation email failed:', emailError.message);
      emailResult = { success: false, error: emailError.message || 'Failed to resend invitation email' };
    }

    const emailStatus = {
      ...emailResult,
      provider: emailService.provider,
      recipient: invitation.email,
      sent: Boolean(emailResult?.success)
    };

    if (global.io && typeof global.io.emit === 'function') {
      global.io.emit('invitation:email_status_updated', {
        invitationId: invitationId,
        email_status: emailStatus
      });
    }

    await logAuditEvent(resendBy, 'INVITATION_RESENT', {
      invitation_id: invitationId,
      email: invitation.email
    });

    return {
      success: true,
      message: 'Invitation resent successfully',
      token,
      metadata: invitationMetadata,
      email_status: emailStatus
    };
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

    await logAuditEvent(deletedBy, AUDIT_ACTIONS.INVITATION_CANCELLED, {
      invitation_id: invitationId,
      email: invitation.email
    });

    return { success: true, message: 'Invitation cancelled' };
  } catch (error) {
    if (error.isOperational) throw error;
    throw new AppError('Error cancelling invitation', 500);
  }
}

/**
 * Create a new department
 * @param {Object} data - Department data { dept_name, description }
 * @param {string} createdBy - User ID who created
 * @returns {Promise<Object>} Created department
 */
async function createDepartment(data, createdBy) {
  try {
    const { dept_name, description } = data;

    // Get the max dept_id to calculate the next one
    const { data: maxDept, error: maxError } = await supabase
      .from('departments')
      .select('dept_id')
      .order('dept_id', { ascending: false })
      .limit(1);

    if (maxError) {
      console.error('[adminService.createDepartment] Error getting max dept_id:', maxError);
      throw maxError;
    }

    // Calculate next dept_id
    const nextDeptId = (maxDept && maxDept.length > 0) ? maxDept[0].dept_id + 1 : 1;

    const { data: department, error } = await supabase
      .from('departments')
      .insert([{
        dept_id: nextDeptId,
        dept_name: dept_name,
        description: description || ''
      }])
      .select()
      .single();

    if (error) {
      console.error('[adminService.createDepartment] Supabase error:', error);
      throw error;
    }

    await logAuditEvent(createdBy, 'DEPARTMENT_CREATED', {
      department_id: department.dept_id,
      department_name: dept_name
    });

    return department;
  } catch (error) {
    console.error('[adminService.createDepartment] Error:', error);
    if (error.isOperational) throw error;
    throw new AppError('Error creating department: ' + error.message, 500);
  }
}

/**
 * Update a department
 * @param {string} departmentId - Department ID
 * @param {Object} data - Update data { dept_name, description }
 * @param {string} updatedBy - User ID who updated
 * @returns {Promise<Object>} Updated department
 */
async function updateDepartment(departmentId, data, updatedBy) {
  try {
    const { dept_name, description } = data;

    // Fetch old data for comparison
    const { data: oldData } = await supabase
      .from('departments')
      .select('dept_name, description')
      .eq('dept_id', departmentId)
      .single();

    const { data: department, error } = await supabase
      .from('departments')
      .update({
        dept_name: dept_name,
        description: description || ''
      })
      .eq('dept_id', departmentId)
      .select()
      .single();

    if (error) {
      console.error('[adminService.updateDepartment] Supabase error:', error);
      throw error;
    }

    if (oldData) {
      if (oldData.dept_name !== department.dept_name) {
        await logAuditEvent(updatedBy, 'DEPARTMENT_UPDATED', {
          department_id: departmentId,
          department_name: department.dept_name,
          fieldLabel: 'Name',
          oldValue: oldData.dept_name,
          newValue: department.dept_name
        });
      }
      
      const oldDesc = oldData.description || '';
      const newDesc = department.description || '';
      if (oldDesc !== newDesc) {
        await logAuditEvent(updatedBy, 'DEPARTMENT_UPDATED', {
          department_id: departmentId,
          department_name: department.dept_name,
          fieldLabel: 'Description',
          oldValue: oldDesc || 'No description',
          newValue: newDesc || 'No description'
        });
      }
    } else {
      await logAuditEvent(updatedBy, 'DEPARTMENT_UPDATED', {
        department_id: departmentId,
        department_name: dept_name
      });
    }

    return department;
  } catch (error) {
    console.error('[adminService.updateDepartment] Error:', error);
    if (error.isOperational) throw error;
    throw new AppError('Error updating department: ' + error.message, 500);
  }
}

/**
 * Delete a department
 * @param {string} departmentId - Department ID
 * @param {string} deletedBy - User ID
 * @returns {Promise<Object>} Success message
 */
async function deleteDepartment(departmentId, deletedBy) {
  try {
    const { data: deptToDel } = await supabase
      .from('departments')
      .select('dept_name')
      .eq('dept_id', departmentId)
      .single();

    const { error } = await supabase
      .from('departments')
      .delete()
      .eq('dept_id', departmentId);

    if (error) {
      console.error('[adminService.deleteDepartment] Supabase error:', error);
      throw error;
    }

    await logAuditEvent(deletedBy, 'DEPARTMENT_DELETED', {
      department_id: departmentId,
      department_name: deptToDel?.dept_name || `Dept #${departmentId}`
    });

    return { success: true, message: 'Department deleted' };
  } catch (error) {
    console.error('[adminService.deleteDepartment] Error:', error);
    if (error.isOperational) throw error;
    throw new AppError('Error deleting department: ' + error.message, 500);
  }
}

/**
 * List all departments
 * @returns {Promise<Array>} List of departments
 */
async function listDepartments() {
  try {
    const { data, error } = await supabase
      .from('departments')
      .select('*')
      .order('dept_name', { ascending: true });

    if (error) throw error;

    // Fetch head information if head_id exists
    const enrichedData = await Promise.all(data.map(async (dept) => {
      if (dept.head_id) {
        try {
          const { data: employee, error: empError } = await supabase
            .from('employees')
            .select('first_name, last_name')
            .eq('employee_id', dept.head_id)
            .single();

          if (!empError && employee) {
            const fullName = `${employee.first_name} ${employee.last_name}`.trim();
            return {
              ...dept,
              head_username: fullName,
              head_name: fullName
            };
          }
        } catch (err) {
          console.error(`[adminService.listDepartments] Error fetching employee ${dept.head_id}:`, err);
        }
      }
      return {
        ...dept,
        head_username: null,
        head_name: null
      };
    }));

    return enrichedData;
  } catch (error) {
    console.error('[adminService.listDepartments] Error:', error);
    if (error.isOperational) throw error;
    throw new AppError('Error fetching departments', 500);
  }
}

/**
 * Get department details
 * @param {string} departmentId - Department ID
 * @returns {Promise<Object>} Department
 */
async function getDepartment(departmentId) {
  try {
    const { data, error } = await supabase
      .from('departments')
      .select('*')
      .eq('dept_id', departmentId)
      .single();

    if (error || !data) {
      throw new AppError('Department not found', 404);
    }

    // Fetch head information if head_id exists
    let head_username = null;
    let head_name = null;

    if (data.head_id) {
      try {
        const { data: employee, error: empError } = await supabase
          .from('employees')
          .select('first_name, last_name')
          .eq('employee_id', data.head_id)
          .single();

        if (!empError && employee) {
          const fullName = `${employee.first_name} ${employee.last_name}`.trim();
          head_username = fullName;
          head_name = fullName;
        }
      } catch (err) {
        console.error(`[adminService.getDepartment] Error fetching employee ${data.head_id}:`, err);
      }
    }

    return {
      ...data,
      head_username,
      head_name
    };
  } catch (error) {
    console.error('[adminService.getDepartment] Error:', error);
    if (error.isOperational) throw error;
    throw new AppError('Error fetching department', 500);
  }
}

/**
 * Assign department head
 * @param {string} departmentId - Department ID
 * @param {string} userId - User ID to assign
 * @param {string} assignedBy - User ID who assigned
 */
async function assignDepartmentHead(departmentId, userId, assignedBy, userService) {
  try {
    // Get the current department to find the old head
    const { data: department, error: deptError } = await supabase
      .from('departments')
      .select('head_id, dept_name')
      .eq('dept_id', departmentId)
      .single();

    if (deptError || !department) {
      throw new AppError('Department not found', 404);
    }

    const oldHeadId = department.head_id;
    const departmentName = department.dept_name;

    // Get the new head's username if assigning one
    let newHeadUsername = null;
    let oldHeadUsername = null;
    
    if (userId) {
      const { data: userRecord } = await supabase
        .from('users')
        .select('username')
        .eq('user_id', userId)
        .single();
      if (userRecord) newHeadUsername = userRecord.username;
    }
    
    // Get old head's username (for both removing and swapping scenarios)
    if (oldHeadId) {
      const { data: oldUserRecord } = await supabase
        .from('users')
        .select('username')
        .eq('user_id', oldHeadId)
        .single();
      if (oldUserRecord) oldHeadUsername = oldUserRecord.username;
    }

    // Update the department with new head
    const { error: updateError } = await supabase
      .from('departments')
      .update({
        head_id: userId || null
      })
      .eq('dept_id', departmentId);

    if (updateError) {
      throw updateError;
    }

    // If there was an old head and we're removing them, demote to employee
    if (oldHeadId && !userId) {
      try {
        await userService.changeUserRole(oldHeadId, 'employee', assignedBy);
      } catch (err) {
        console.error('[adminService.assignDepartmentHead] Error demoting old head:', err);
      }
    }

    // If assigning a new head that replaces an existing one, demote the old head
    if (oldHeadId && userId && userId !== oldHeadId) {
      try {
        await userService.changeUserRole(oldHeadId, 'employee', assignedBy);
      } catch (err) {
        console.error('[adminService.assignDepartmentHead] Error demoting old head:', err);
      }
    }

    // If assigning a new head, promote them to head_dept role
    if (userId && userId !== oldHeadId) {
      try {
        await userService.changeUserRole(userId, 'head_dept', assignedBy);
      } catch (err) {
        console.error('[adminService.assignDepartmentHead] Error promoting new head:', err);
      }
    }

    // Log appropriate audit event based on action (assign vs remove vs swap)
    if (userId && !oldHeadId) {
      // Initial assignment (no previous head)
      await logAuditEvent(assignedBy, 'DEPARTMENT_HEAD_ASSIGNED', {
        department_id: departmentId,
        department_name: departmentName,
        user_id: userId,
        head_username: newHeadUsername || `User #${userId}`,
        old_head_id: oldHeadId
      });
    } else if (userId && oldHeadId && userId !== oldHeadId) {
      // Swapping/Replacing existing head
      await logAuditEvent(assignedBy, 'DEPARTMENT_HEAD_SWAPPED', {
        department_id: departmentId,
        department_name: departmentName,
        old_head_username: oldHeadUsername || `User #${oldHeadId}`,
        new_head_username: newHeadUsername || `User #${userId}`,
        old_head_id: oldHeadId,
        new_head_id: userId
      });
    } else if (!userId && oldHeadId) {
      // Removing the head
      await logAuditEvent(assignedBy, 'DEPARTMENT_HEAD_REMOVED', {
        department_id: departmentId,
        department_name: departmentName,
        removed_head_username: oldHeadUsername || `User #${oldHeadId}`,
        old_head_id: oldHeadId
      });
    }

    return { success: true, message: userId ? 'Department head assigned' : 'Department head removed' };
  } catch (error) {
    console.error('[adminService.assignDepartmentHead] Error:', error);
    if (error.isOperational) throw error;
    throw new AppError('Error assigning department head: ' + error.message, 500);
  }
}

/**
 * Get count of logins today (optimized backend query)
 * @returns {Promise<number>} Count of login events today
 */
const ADMIN_ACTION_TYPES = new Set([
  'USER_CREATED',
  'USER_UPDATED',
  'USER_DEACTIVATED',
  'USER_REACTIVATED',
  'ROLE_CHANGED',
  'DEPARTMENT_CHANGED',
  'PASSWORD_RESET',
  'PASSWORD_CHANGED',
  'DEPARTMENT_CREATED',
  'DEPARTMENT_UPDATED',
  'DEPARTMENT_DELETED',
  'DEPARTMENT_HEAD_ASSIGNED',
  'DEPARTMENT_HEAD_SWAPPED',
  'DEPARTMENT_HEAD_REMOVED',
  'BULK_USER_ACTIVATION',
  'SETTINGS_UPDATED',
  'INVITATION_CREATED',
  'INVITATION_SUPERSEDED',
  'INVITATION_ACCEPTED',
  'INVITATION_RESENT',
  'INVITATION_DELETED',
  'INVITATION_CANCELLED',
  'USER_FORCE_LOGOUT',
  'FORCE_LOGOUT'
]);

function normalizeDetails(details) {
  if (!details) return {};
  if (typeof details === 'object') return details;

  if (typeof details === 'string') {
    try {
      return JSON.parse(details);
    } catch (error) {
      return { raw: details };
    }
  }

  return { raw: String(details) };
}

function normalizeSignalEmail(value) {
  return String(value || 'unknown').trim().toLowerCase() || 'unknown';
}

function createSignalAlert(type, severity, title, description, count, extra = {}) {
  return {
    type,
    severity,
    title,
    message: description,
    description,
    count,
    context: extra,
    ...extra
  };
}

async function getLoginsToday() {
  try {
    const today = new Date();
    const startOfDay = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 0, 0, 0);
    const endOfDay = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 23, 59, 59);

    const { count, error } = await supabase
      .from('audit_logs')
      .select('*', { count: 'exact', head: true })
      .eq('action_type', 'USER_LOGIN')
      .gte('created_at', startOfDay.toISOString())
      .lte('created_at', endOfDay.toISOString());

    if (error) {
      console.error('[adminService.getLoginsToday] Error:', error);
      return 0;
    }

    return count || 0;
  } catch (error) {
    console.error('[adminService.getLoginsToday] Exception:', error);
    return 0;
  }
}

/**
 * Get rolling security signals from recent audit/session activity
 * @param {number} windowMinutes - rolling window in minutes
 * @returns {Promise<Object>} summary + alerts
 */
async function getSecuritySignals(windowMinutes = 15) {
  try {
    const parsedWindow = Math.max(5, Math.min(parseInt(windowMinutes, 10) || 15, 1440));
    const cutoff = new Date(Date.now() - parsedWindow * 60 * 1000).toISOString();

    const { data, error } = await supabase
      .from('audit_logs')
      .select('log_id, user_id, action_type, details, created_at')
      .gte('created_at', cutoff)
      .or('details->>reason.is.null,details->>reason.neq.user_not_found')
      .order('created_at', { ascending: false });

    if (error) {
      console.error('[adminService.getSecuritySignals] Supabase error:', error);
      throw error;
    }

    const events = (data || []).map((log) => ({
      id: log.log_id,
      userId: log.user_id,
      actionType: log.action_type,
      details: normalizeDetails(log.details),
      createdAt: log.created_at,
      username: null,
      role: null
    }));

    const failedLoginEvents = events.filter(event => event.actionType === 'AUTH_LOGIN_FAILED');
    const loginEvents = events.filter(event => event.actionType === 'USER_LOGIN');
    const logoutEvents = events.filter(event => event.actionType === 'USER_LOGOUT');
    const authEvents = events.filter(event => ['AUTH_LOGIN_FAILED', 'USER_LOGIN', 'USER_LOGOUT'].includes(event.actionType));
    const forceLogoutEvents = events.filter(event => ['USER_FORCE_LOGOUT', 'FORCE_LOGOUT'].includes(event.actionType));
    const adminEvents = events.filter(event => ADMIN_ACTION_TYPES.has(event.actionType));

    const alerts = [];

    // Repeated failed logins by email or username
    const failedByEmail = new Map();
    failedLoginEvents.forEach((event) => {
      const email = normalizeSignalEmail(event.details.email || event.username || event.details.username || 'unknown');
      if (!failedByEmail.has(email)) failedByEmail.set(email, []);
      failedByEmail.get(email).push(event);
    });

    failedByEmail.forEach((items, email) => {
      if (items.length < 3) return;

      const hasSuccessfulLogin = loginEvents.some((event) => {
        const eventEmail = normalizeSignalEmail(event.details.email || event.username || event.details.username);
        return eventEmail === email;
      });

      alerts.push(createSignalAlert(
        'failed_login_burst',
        items.length >= 5 || hasSuccessfulLogin ? 'critical' : 'warning',
        hasSuccessfulLogin ? 'Login after failure burst' : 'Repeated failed logins',
        hasSuccessfulLogin
          ? `${email === 'unknown' ? 'An account' : email} had ${items.length} failed login attempts before a successful login.`
          : `${items.length} failed login attempts were recorded for ${email === 'unknown' ? 'an unknown account' : email}.`,
        items.length,
        { email, hasSuccessfulLogin }
      ));
    });

    // Rapid login/logout bursts per user
    const authBurstByUser = new Map();
    authEvents.forEach((event) => {
      const key = String(event.userId || event.details.user_id || event.details.targetUserId || event.details.userId || 'unknown');
      if (!authBurstByUser.has(key)) authBurstByUser.set(key, []);
      authBurstByUser.get(key).push(event);
    });

    authBurstByUser.forEach((items, userId) => {
      if (items.length < 4) return;

      alerts.push(createSignalAlert(
        'auth_burst',
        items.length >= 6 ? 'critical' : 'warning',
        'Rapid login/logout burst',
        `${items.length} login/logout/failure events were recorded for user ${userId} within ${parsedWindow} minutes.`,
        items.length,
        { userId }
      ));
    });

    // Repeated force logouts on the same account
    const forceByTargetUser = new Map();
    forceLogoutEvents.forEach((event) => {
      const targetUserId = event.details.targetUserId || event.details.user_id || event.details.userId || event.userId || 'unknown';
      const key = String(targetUserId);
      if (!forceByTargetUser.has(key)) forceByTargetUser.set(key, []);
      forceByTargetUser.get(key).push(event);
    });

    forceByTargetUser.forEach((items, targetUserId) => {
      if (items.length < 2) return;

      alerts.push(createSignalAlert(
        'force_logout_spike',
        items.length >= 3 ? 'critical' : 'warning',
        'Repeated force logouts',
        `${items.length} force logout events were recorded for account ${targetUserId}.`,
        items.length,
        { targetUserId }
      ));
    });

    // Admin action spike
    if (adminEvents.length >= 8) {
      alerts.push(createSignalAlert(
        'admin_action_spike',
        adminEvents.length >= 15 ? 'critical' : 'warning',
        'Admin action spike',
        `${adminEvents.length} admin actions were recorded in the last ${parsedWindow} minutes.`,
        adminEvents.length
      ));
    }

    // Sort alerts by severity, then by count descending
    const severityRank = { critical: 3, warning: 2, info: 1 };
    alerts.sort((left, right) => {
      const severityDiff = (severityRank[right.severity] || 0) - (severityRank[left.severity] || 0);
      if (severityDiff !== 0) return severityDiff;
      return (right.count || 0) - (left.count || 0);
    });

    return {
      windowMinutes: parsedWindow,
      totals: {
        events: events.length,
        failedLogins: failedLoginEvents.length,
        loginEvents: loginEvents.length,
        logoutEvents: logoutEvents.length,
        forceLogouts: forceLogoutEvents.length,
        adminActions: adminEvents.length,
        alertCount: alerts.length
      },
      alerts,
      recentEvents: events.slice(0, 10)
    };
  } catch (error) {
    console.error('[adminService.getSecuritySignals] Error:', error);
    if (error.isOperational) throw error;
    throw new AppError('Error fetching security signals', 500);
  }
}


module.exports = {
  getAuditLogs,
  getSystemSettings,
  updateSystemSettings,
  getSuspiciousAuditSignals,
  listInvitations,
  createInvitation,
  getInvitation,
  resendInvitation,
  deleteInvitation,
  createDepartment,
  updateDepartment,
  deleteDepartment,
  listDepartments,
  getDepartment,
  assignDepartmentHead,
};
