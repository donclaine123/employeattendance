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
      .select('*, users(username)', { count: 'exact' });

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

    if (error) {
      console.error('[adminService.getAuditLogs] Supabase error:', error);
      throw error;
    }

    return {
      data: data.map(log => ({
        id: log.id,
        userId: log.user_id,
        userName: log.users?.username,
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
    console.error('[adminService.getAuditLogs] Error:', error);
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
        // Column names are setting_key and setting_value
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
    const updatePromises = Object.entries(updates).map(([key, value]) => {
      return supabase
        .from('system_settings')
        .upsert({ setting_key: key, setting_value: value })
        .eq('setting_key', key);
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
        login_time: session.login_time ? new Date(session.login_time).toLocaleString() : 'Invalid Date',
        logout_time: session.logout_time ? new Date(session.logout_time).toLocaleString() : null,
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
    // Get the session first to find the user_id
    const { data: sessionData, error: fetchError } = await supabase
      .from('user_sessions')
      .select('user_id, session_id')
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

    await logAuditEvent(revokedBy, 'USER_FORCE_LOGOUT', {
      user_id: userId,
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
        status: inv.used ? 'accepted' : 'pending',
        created_at: inv.created_at,
        created_by: inv.users?.username || 'System',
        expires_at: inv.expires_at,
        used_at: inv.used_at
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
        status: inv.used ? 'accepted' : 'pending',
        created_at: inv.created_at,
        created_by: inv.users?.username || 'System',
        expires_at: inv.expires_at,
        used_at: inv.used_at
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

    const { data: newInvitation, error } = await supabase
      .from('invitations')
      .insert([{
        email,
        role_id: roleId,
        dept_id: deptId,
        token_hash: tokenHash,
        expires_at: expiresAt,
        created_by: createdBy,
        created_at: new Date()
      }])
      .select()
      .single();

    if (error) {
      throw error;
    }

    // Send invitation email (Fire-and-forget)
    const EmailService = require('../utils/emailService');
    const emailService = new EmailService();

    const inviteLink = `http://workline.local/pages/accept-invite.html?token=${token}`;

    // Don't await - send in background
    emailService.sendInvitationEmail({
      email,
      inviteLink,
      roleName: role,
      inviterName: 'Administrator',
      expiresAt: expiresAt.toISOString()
    }).catch(err => {
      console.error('[createInvitation] Background email failed:', err.message);
    });

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

    // Generate new token and hash
    const token = require('crypto').randomUUID();
    const tokenHash = require('crypto').createHash('sha256').update(token).digest('hex');
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days

    // Update invitation with new token
    const { data: updatedInvitation, error: updateError } = await supabase
      .from('invitations')
      .update({
        token_hash: tokenHash,
        expires_at: expiresAt,
        created_at: new Date()
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

    // Send new invitation email (Fire-and-forget)
    const EmailService = require('../utils/emailService');
    const emailService = new EmailService();

    const inviteLink = `http://workline.local/pages/accept-invite.html?token=${token}`;

    // Don't await - send in background
    emailService.sendInvitationEmail({
      email: invitation.email,
      inviteLink,
      roleName: updatedInvitation.roles?.role_name || invitation.role,
      inviterName: 'Administrator',
      expiresAt: expiresAt.toISOString()
    }).catch(err => {
      console.error('[resendInvitation] Background email failed:', err.message);
    });

    await logAuditEvent(resendBy, 'INVITATION_RESENT', {
      invitation_id: invitationId,
      email: invitation.email
    });

    return { success: true, message: 'Invitation resent successfully' };
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

    await logAuditEvent(updatedBy, 'DEPARTMENT_UPDATED', {
      department_id: departmentId,
      department_name: dept_name
    });

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
    const { error } = await supabase
      .from('departments')
      .delete()
      .eq('dept_id', departmentId);

    if (error) {
      console.error('[adminService.deleteDepartment] Supabase error:', error);
      throw error;
    }

    await logAuditEvent(deletedBy, 'DEPARTMENT_DELETED', {
      department_id: departmentId
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
      .select('head_id')
      .eq('dept_id', departmentId)
      .single();

    if (deptError || !department) {
      throw new AppError('Department not found', 404);
    }

    const oldHeadId = department.head_id;

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

    // If assigning a new head, promote them to head_dept role
    if (userId && userId !== oldHeadId) {
      try {
        await userService.changeUserRole(userId, 'head_dept', assignedBy);
      } catch (err) {
        console.error('[adminService.assignDepartmentHead] Error promoting new head:', err);
      }
    }

    await logAuditEvent(assignedBy, 'DEPARTMENT_HEAD_ASSIGNED', {
      department_id: departmentId,
      user_id: userId,
      old_head_id: oldHeadId
    });

    return { success: true, message: 'Department head assigned' };
  } catch (error) {
    console.error('[adminService.assignDepartmentHead] Error:', error);
    if (error.isOperational) throw error;
    throw new AppError('Error assigning department head: ' + error.message, 500);
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
  deleteInvitation,
  createDepartment,
  updateDepartment,
  deleteDepartment,
  listDepartments,
  getDepartment,
  assignDepartmentHead
};
