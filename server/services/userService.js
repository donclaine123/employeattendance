const bcrypt = require('bcryptjs');
const { supabase } = require('../conn-supabase');
const { AppError } = require('../middleware/errorHandler');
const { logAuditEvent, logFieldChanges } = require('../utils/audit');
const { validateEmail, validatePassword, validatePhoneNumber } = require('../utils/validators');
const { rowToUser, rowToEmployee } = require('../utils/converters');

/**
 * Get user by ID
 * @param {string} userId - User ID
 * @returns {Promise<Object>} User object
 */
async function getUserById(userId) {
  try {
    const { data, error } = await supabase
      .from('users')
      .select('*')
      .eq('user_id', userId)
      .single();

    if (error || !data) {
      throw new AppError('User not found', 404);
    }

    return rowToUser(data);
  } catch (error) {
    if (error.isOperational) throw error;
    throw new AppError('Error fetching user', 500);
  }
}

/**
 * Get user by email
 * @param {string} email - User email
 * @returns {Promise<Object>} User object
 */
async function getUserByEmail(email) {
  try {
    validateEmail(email);

    const { data, error } = await supabase
      .from('users')
      .select('*')
      .eq('email', email)
      .single();

    if (error || !data) {
      throw new AppError('User not found', 404);
    }

    return rowToUser(data);
  } catch (error) {
    if (error.isOperational) throw error;
    throw new AppError('Error fetching user', 500);
  }
}

/**
 * List users with filters and pagination
 * @param {Object} filters - Filter criteria {role, status, search}
 * @param {number} page - Page number
 * @param {number} limit - Records per page
 * @returns {Promise<Object>} Paginated users
 */
async function listUsers(filters = {}, page = 1, limit = 20) {
  try {
    let query = supabase.from('users').select('*, roles(role_name)', { count: 'exact' });

    // Apply filters
    if (filters.role && filters.role !== 'all') {
      query = query.eq('role_id', filters.role);
    }

    if (filters.status && filters.status !== 'all') {
      query = query.eq('status', filters.status);
    }

    if (filters.search) {
      query = query.or(`username.ilike.%${filters.search}%,email.ilike.%${filters.search}%`);
    }

    // Pagination
    const offset = (page - 1) * limit;
    query = query.range(offset, offset + limit - 1).order('created_at', { ascending: false });

    const { data, count, error } = await query;

    if (error) {
      throw error;
    }

    // Fetch employee data and last login for all returned users
    let employeeMap = {};
    let lastLoginMap = {};
    
    if (data && data.length > 0) {
      const userIds = data.map(u => u.user_id);
      
      // Fetch employees by employee_id
      const { data: employees, error: empError } = await supabase
        .from('employees')
        .select('employee_id, first_name, last_name, email')
        .in('employee_id', userIds);
      
      if (!empError && employees) {
        employees.forEach(emp => {
          employeeMap[emp.employee_id] = emp;
        });
      }
      
      // Fetch last login times from user_sessions
      const { data: sessions, error: sessError } = await supabase
        .from('user_sessions')
        .select('user_id, login_time')
        .in('user_id', userIds)
        .order('login_time', { ascending: false });
      
      if (!sessError && sessions) {
        // Map latest login time per user (first one since ordered descending)
        const seen = new Set();
        sessions.forEach(session => {
          if (!seen.has(session.user_id)) {
            lastLoginMap[session.user_id] = session.login_time;
            seen.add(session.user_id);
          }
        });
      }
    }

    return {
      data: data.map(user => rowToUser({ 
        ...user, 
        employee: employeeMap[user.user_id],
        last_login: lastLoginMap[user.user_id]
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
    throw new AppError('Error fetching users', 500);
  }
}

/**
 * Create new user
 * @param {Object} userData - User data {email, name, role, password}
 * @param {string} createdBy - User ID who created this user
 * @returns {Promise<Object>} Created user
 */
async function createUser(userData, createdBy) {
  const { email, name, role, password } = userData;

  validateEmail(email);
  validatePassword(password);

  if (!name || name.trim().length === 0) {
    throw new AppError('Name is required', 400);
  }

  if (!role) {
    throw new AppError('Role is required', 400);
  }

  try {
    // Check if user already exists
    const { data: existingUser } = await supabase
      .from('users')
      .select('id')
      .eq('email', email)
      .single();

    if (existingUser) {
      throw new AppError('User with this email already exists', 409);
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);

    // Create user
    const { data: newUser, error } = await supabase
      .from('users')
      .insert([{
        email,
        name,
        role,
        password_hash: hashedPassword,
        user_status: 'active',
        created_at: new Date()
      }])
      .select()
      .single();

    if (error) throw error;

    // Log audit event
    await logAuditEvent(createdBy, 'USER_CREATED', {
      user_id: newUser.id,
      email,
      role
    });

    return rowToUser(newUser);
  } catch (error) {
    if (error.isOperational) throw error;
    throw new AppError('Error creating user', 500);
  }
}

/**
 * Update user
 * @param {string} userId - User ID
 * @param {Object} updates - Fields to update
 * @param {string} updatedBy - User ID who made the update
 * @returns {Promise<Object>} Updated user
 */
async function updateUser(userId, updates, updatedBy) {
  const allowedFields = ['name', 'email', 'role', 'user_status', 'phone_number', 'address'];
  const userUpdate = {};

  // Get current user for audit logging
  const currentUser = await getUserById(userId);

  for (const [key, value] of Object.entries(updates)) {
    if (allowedFields.includes(key) && value) {
      userUpdate[key] = value;
    }
  }

  if (Object.keys(userUpdate).length === 0) {
    throw new AppError('No valid fields to update', 400);
  }

  if (userUpdate.email) {
    validateEmail(userUpdate.email);
  }

  userUpdate.updated_at = new Date();

  try {
    const { data: updatedUser, error } = await supabase
      .from('users')
      .update(userUpdate)
      .eq('id', userId)
      .select()
      .single();

    if (error) throw error;

    // Log field changes
    await logFieldChanges(updatedBy, 'USER_UPDATED', userId, 'users', currentUser, updatedUser);

    return rowToUser(updatedUser);
  } catch (error) {
    if (error.isOperational) throw error;
    throw new AppError('Error updating user', 500);
  }
}

/**
 * Change user role
 * @param {string} userId - User ID
 * @param {string} newRole - New role
 * @param {string} changedBy - User ID who made the change
 */
async function changeUserRole(userId, newRole, changedBy) {
  const validRoles = ['superadmin', 'hr', 'head_dept', 'employee', 'display'];

  if (!validRoles.includes(newRole)) {
    throw new AppError(`Invalid role: ${newRole}`, 400);
  }

  try {
    // First, get the role_id from the roles table
    const { data: roleData, error: roleError } = await supabase
      .from('roles')
      .select('role_id')
      .eq('role_name', newRole)
      .single();

    if (roleError || !roleData) {
      throw new AppError(`Role not found: ${newRole}`, 400);
    }

    const roleId = roleData.role_id;

    const currentUser = await getUserById(userId);

    const { data: updatedUser, error } = await supabase
      .from('users')
      .update({
        role_id: roleId,
        updated_at: new Date()
      })
      .eq('user_id', userId)
      .select()
      .single();

    if (error) {
      throw error;
    }

    // Log audit event
    await logAuditEvent(changedBy, 'ROLE_CHANGED', {
      user_id: userId,
      old_role_id: currentUser.role_id,
      new_role_id: roleId,
      new_role_name: newRole
    });

    return rowToUser(updatedUser);
  } catch (error) {
    if (error.isOperational) throw error;
    throw new AppError('Error changing user role', 500);
  }
}

/**
 * Delete user (soft delete - mark inactive)
 * @param {string} userId - User ID
 * @param {string} deletedBy - User ID who deleted
 */
async function deleteUser(userId, deletedBy) {
  try {
    const user = await getUserById(userId);

    const { data: deletedUser, error } = await supabase
      .from('users')
      .update({
        status: 'inactive',
        updated_at: new Date()
      })
      .eq('user_id', userId)
      .select()
      .single();

    if (error) throw error;

    // Log audit event - use user object already fetched
    await logAuditEvent(deletedBy, 'USER_DELETED', {
      user_id: userId,
      email: user.username // username is the email field
    });

    return { success: true, message: 'User deleted' };
  } catch (error) {
    console.error('[deleteUser] Error:', error.message, error);
    if (error.isOperational) throw error;
    throw new AppError('Error deleting user', 500);
  }
}

/**
 * Reactivate deleted user
 * @param {string} userId - User ID
 * @param {string} reactivatedBy - User ID who reactivated
 */
async function reactivateUser(userId, reactivatedBy) {
  try {
    const { data: reactivatedUser, error } = await supabase
      .from('users')
      .update({
        status: 'active',
        updated_at: new Date()
      })
      .eq('user_id', userId)
      .select()
      .single();

    if (error) throw error;

    // Log audit event - use data from update response
    await logAuditEvent(reactivatedBy, 'USER_REACTIVATED', {
      user_id: userId,
      email: reactivatedUser.username // username is the email field
    });

    // Fetch full user data with relationships for response
    const fullUser = await getUserById(userId);
    return fullUser;
  } catch (error) {
    console.error('[reactivateUser] Error:', error.message, error);
    if (error.isOperational) throw error;
    throw new AppError('Error reactivating user', 500);
  }
}

/**
 * Lock user account
 * @param {string} userId - User ID
 * @param {string} lockedBy - User ID who locked
 * @param {string} reason - Lock reason
 */
async function lockUser(userId, lockedBy, reason = '') {
  try {
    const { data: lockedUser, error } = await supabase
      .from('users')
      .update({
        user_status: 'locked',
        locked_at: new Date(),
        lock_reason: reason,
        updated_at: new Date()
      })
      .eq('id', userId)
      .select()
      .single();

    if (error) throw error;

    // Log audit event
    await logAuditEvent(lockedBy, 'USER_LOCKED', {
      user_id: userId,
      reason
    });

    return { success: true, message: 'User locked' };
  } catch (error) {
    if (error.isOperational) throw error;
    throw new AppError('Error locking user', 500);
  }
}

/**
 * Unlock user account
 * @param {string} userId - User ID
 * @param {string} unlockedBy - User ID who unlocked
 */
async function unlockUser(userId, unlockedBy) {
  try {
    const { data: unlockedUser, error } = await supabase
      .from('users')
      .update({
        user_status: 'active',
        locked_at: null,
        lock_reason: null,
        updated_at: new Date()
      })
      .eq('id', userId)
      .select()
      .single();

    if (error) throw error;

    // Log audit event
    await logAuditEvent(unlockedBy, 'USER_UNLOCKED', {
      user_id: userId
    });

    return rowToUser(unlockedUser);
  } catch (error) {
    if (error.isOperational) throw error;
    throw new AppError('Error unlocking user', 500);
  }
}

/**
 * Reset user password (admin function)
 * @param {string} userId - User ID
 * @param {string} newPassword - New password
 * @param {string} resetBy - User ID who reset
 */
async function resetPassword(userId, newPassword, resetBy) {
  validatePassword(newPassword);

  try {
    const hashedPassword = await bcrypt.hash(newPassword, 10);

    const { data: updatedUser, error } = await supabase
      .from('users')
      .update({
        password_hash: hashedPassword,
        password_changed_at: new Date(),
        updated_at: new Date()
      })
      .eq('id', userId)
      .select()
      .single();

    if (error) throw error;

    // Log audit event
    await logAuditEvent(resetBy, 'PASSWORD_RESET', {
      user_id: userId,
      reset_by_admin: true
    });

    return { success: true, message: 'Password reset' };
  } catch (error) {
    if (error.isOperational) throw error;
    throw new AppError('Error resetting password', 500);
  }
}

module.exports = {
  getUserById,
  getUserByEmail,
  listUsers,
  createUser,
  updateUser,
  changeUserRole,
  deleteUser,
  reactivateUser,
  lockUser,
  unlockUser,
  resetPassword
};
