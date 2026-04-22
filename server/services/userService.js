const bcrypt = require('bcryptjs');
const { supabase } = require('../conn-supabase');
const { AppError } = require('../middleware/errorHandler');
const { logAuditEvent, logFieldChanges, generateFieldChanges, getUserUpdateFieldMappings } = require('../utils/audit');
const { validateEmail, validatePassword, validatePhoneNumber } = require('../utils/validators');
const { buildSyncDirtyPatch } = require('../utils/syncDirty');
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
      .select(`
        *,
        employee:employees(
          first_name,
          last_name,
          email,
          departments(dept_name)
        ),
        roles(role_name)
      `)
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
      .select(`
        *,
        employee:employees(
          first_name,
          last_name,
          email,
          departments(dept_name)
        ),
        roles(role_name)
      `)
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
 * @param {Object} filters - Filter criteria {role, status, search, dept_id}
 * @param {number} page - Page number
 * @param {number} limit - Records per page
 * @returns {Promise<Object>} Paginated users
 */
async function listUsers(filters = {}, page = 1, limit = 20) {
  try {
    let query = supabase.from('users').select('*, roles(role_name)', { count: 'exact' });

    // Apply filters
    if (filters.role && filters.role !== 'all') {
      const { data: roleData } = await supabase
        .from('roles')
        .select('role_id')
        .eq('role_name', filters.role)
        .single();
        
      if (roleData && roleData.role_id) {
        query = query.eq('role_id', roleData.role_id);
      } else if (!isNaN(parseInt(filters.role))) {
        query = query.eq('role_id', parseInt(filters.role));
      }
    }

    if (filters.status && filters.status !== 'all') {
      query = query.eq('status', filters.status);
    }

    if (filters.dept_id && filters.dept_id !== 'all') {
      const deptIdValue = Number.parseInt(filters.dept_id, 10);
      let departmentQuery = supabase
        .from('employees')
        .select('employee_id');

      departmentQuery = Number.isNaN(deptIdValue)
        ? departmentQuery.eq('dept_id', filters.dept_id)
        : departmentQuery.eq('dept_id', deptIdValue);

      const { data: matchingEmployees, error: deptError } = await departmentQuery;

      if (deptError) {
        throw deptError;
      }

      const departmentUserIds = (matchingEmployees || [])
        .map(employee => employee.employee_id)
        .filter(Boolean);

      if (departmentUserIds.length === 0) {
        return {
          data: [],
          pagination: {
            page,
            limit,
            total: 0,
            pages: 0
          }
        };
      }

      query = query.in('user_id', departmentUserIds);
    }

    if (filters.search) {
      const searchTerm = `%${filters.search}%`;
      
      // First, find any employees matching the name so we can include them
      const { data: matchingEmps } = await supabase
        .from('employees')
        .select('employee_id')
        .or(`first_name.ilike.${searchTerm},last_name.ilike.${searchTerm}`);
        
      let empUserIds = [];
      if (matchingEmps && matchingEmps.length > 0) {
        empUserIds = matchingEmps.map(e => e.employee_id).filter(id => id);
      }
      
      if (empUserIds.length > 0) {
        query = query.or(`username.ilike.${searchTerm},user_id.in.(${empUserIds.join(',')})`);
      } else {
        query = query.or(`username.ilike.${searchTerm}`);
      }
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
    let departmentMap = {};

    if (data && data.length > 0) {
      const userIds = data.map(u => u.user_id);

      // Fetch employees by employee_id with department info
      const { data: employees, error: empError } = await supabase
        .from('employees')
        .select('employee_id, first_name, last_name, email, dept_id, departments(dept_id, dept_name)')
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
      .select(`
        *,
        employee:employees(
          first_name,
          last_name,
          email,
          departments(dept_name)
        ),
        roles(role_name)
      `)
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
  console.log('📝 [updateUser] START - userId:', userId);
  console.log('📝 [updateUser] updates received:', JSON.stringify(updates, null, 2));
  
  // Separate fields that belong to users vs employees table
  const usersFieldMapping = {
    'email': 'username',           // email from frontend maps to username in users table
    'role': 'role_id',             // role maps to role_id in users table
    'status': 'status',            // status field in users table
    'user_status': 'status'
  };

  const employeesFieldMapping = {
    'firstName': 'first_name',     // firstName maps to first_name in employees table
    'first_name': 'first_name',    // snake_case alias for first_name
    'lastName': 'last_name',       // lastName maps to last_name in employees table
    'last_name': 'last_name',      // snake_case alias for last_name
    'email': 'email',              // email also updates employees.email for consistency
    'phone': 'phone',              // phone maps to phone column in employees table
    'phone_number': 'phone',
    'address': 'address',
    'dept_id': 'dept_id'
  };

  const usersUpdate = {};
  const employeesUpdate = {};

  // Get current user for audit logging
  let currentUser;
  let currentEmployee = null;
  try {
    currentUser = await getUserById(userId);
    console.log('📝 [updateUser] currentUser fetched:', JSON.stringify(currentUser, null, 2));

    const { data: currentEmployeeData, error: currentEmployeeError } = await supabase
      .from('employees')
      .select('employee_id, first_name, last_name, email, phone, address, dept_id')
      .eq('employee_id', userId)
      .maybeSingle();

    if (currentEmployeeError) {
      console.warn('⚠️ [updateUser] current employee lookup failed:', currentEmployeeError.message || currentEmployeeError);
    } else {
      currentEmployee = currentEmployeeData || null;
      console.log('📝 [updateUser] currentEmployee fetched:', JSON.stringify(currentEmployee, null, 2));
      if (currentEmployee) {
        currentUser.first_name = currentEmployee.first_name ?? currentUser.first_name;
        currentUser.last_name = currentEmployee.last_name ?? currentUser.last_name;
        currentUser.email = currentEmployee.email ?? currentUser.email;
        currentUser.phone = currentEmployee.phone ?? currentUser.phone;
        currentUser.address = currentEmployee.address ?? currentUser.address;
        currentUser.dept_id = currentEmployee.dept_id ?? currentUser.dept_id;
      }
    }
  } catch (getUserError) {
    throw getUserError;
  }

  // Process updates
  for (const [key, value] of Object.entries(updates)) {
    // Skip userId field, it's not updateable
    if (key === 'userId') {
      continue;
    }

    // Check if field belongs to users table
    if (usersFieldMapping.hasOwnProperty(key) && value) {
      const dbColumn = usersFieldMapping[key];

      // Special handling for role: convert role name string to role_id
      if (key === 'role' && typeof value === 'string') {
        usersUpdate[dbColumn] = value; // Store temporarily as string, will convert below
      } else {
        usersUpdate[dbColumn] = value;
      }
    }

    // Check if field belongs to employees table
    if (employeesFieldMapping.hasOwnProperty(key) && value) {
      const dbColumn = employeesFieldMapping[key];
      employeesUpdate[dbColumn] = value;
    }
  }
  
  console.log('📝 [updateUser] usersUpdate after parsing:', JSON.stringify(usersUpdate, null, 2));
  console.log('📝 [updateUser] employeesUpdate after parsing:', JSON.stringify(employeesUpdate, null, 2));

  // Convert role name to role_id if needed
  if (usersUpdate.role_id && typeof usersUpdate.role_id === 'string') {
    try {
      const { data: roleData, error: roleError } = await supabase
        .from('roles')
        .select('role_id')
        .eq('role_name', usersUpdate.role_id)
        .single();

      if (roleError || !roleData) {
        throw new AppError('Invalid role: ' + usersUpdate.role_id, 400);
      }
      usersUpdate.role_id = roleData.role_id;
    } catch (roleError) {
      throw roleError;
    }
  }

  if (Object.prototype.hasOwnProperty.call(employeesUpdate, 'dept_id')) {
    const deptIdNum = Number(employeesUpdate.dept_id);

    if (!Number.isFinite(deptIdNum)) {
      throw new AppError(`Invalid department: ${employeesUpdate.dept_id}`, 400);
    }

    const { data: deptData, error: deptError } = await supabase
      .from('departments')
      .select('dept_id, dept_name')
      .eq('dept_id', deptIdNum)
      .single();

    if (deptError || !deptData) {
      throw new AppError(`Invalid department: ${deptIdNum}`, 400);
    }

    employeesUpdate.dept_id = deptIdNum;
  }

  // Check if there are any updates
  if (Object.keys(usersUpdate).length === 0 && Object.keys(employeesUpdate).length === 0) {
    throw new AppError('No valid fields to update', 400);
  }

  // Validate email if updating
  if (usersUpdate.username) {
    validateEmail(usersUpdate.username);
  }

  usersUpdate.updated_at = new Date();

  try {
    let updatedUser = null;
    let latestEmployeeRow = null;

    // Update users table if needed
    if (Object.keys(usersUpdate).length > 0) {
      const { data: userData, error: userError } = await supabase
        .from('users')
        .update({
          ...usersUpdate,
          ...buildSyncDirtyPatch()
        })
        .eq('user_id', userId)
        .select(`
          *,
          employee:employees(
            first_name,
            last_name,
            email,
            departments(dept_name)
          ),
          roles(role_name)
        `)
        .single();

      if (userError) {
        throw userError;
      }
      updatedUser = userData;
    }

    // Update employees table if needed
    if (Object.keys(employeesUpdate).length > 0) {
      console.log('📝 [updateUser] Attempting to update employees table with:', JSON.stringify(employeesUpdate, null, 2));
      
      const { data: empData, error: empError } = await supabase
        .from('employees')
        .update({
          ...employeesUpdate,
          ...buildSyncDirtyPatch()
        })
        .eq('employee_id', userId)
        .select();

      if (empError) {
        console.log('❌ [updateUser] Employee update error:', empError);
        throw empError;
      }
      
      console.log('📝 [updateUser] Employee update result:', JSON.stringify(empData, null, 2));
      latestEmployeeRow = Array.isArray(empData) && empData.length > 0 ? empData[0] : null;
      
      // If update returned 0 rows, employee doesn't exist - CREATE it instead
      if (!empData || empData.length === 0) {
        console.log('⚠️ [updateUser] Employee record does not exist, creating new one for user_id:', userId);
        
        const newEmployeeRecord = {
          employee_id: userId,
          ...employeesUpdate,
          ...buildSyncDirtyPatch()
        };
        
        const { data: createData, error: createError } = await supabase
          .from('employees')
          .insert([newEmployeeRecord])
          .select();
        
        if (createError) {
          console.log('❌ [updateUser] Employee creation error:', createError);
          throw createError;
        }
        
        console.log('✅ [updateUser] New employee record created:', JSON.stringify(createData, null, 2));
        latestEmployeeRow = Array.isArray(createData) && createData.length > 0 ? createData[0] : null;
      }
    }

    // Ensure we have final employee row for audit comparison even when nested join is empty
    if (!latestEmployeeRow) {
      const { data: fallbackEmployee, error: fallbackEmployeeError } = await supabase
        .from('employees')
        .select('employee_id, first_name, last_name, email, phone, address, dept_id')
        .eq('employee_id', userId)
        .maybeSingle();

      if (fallbackEmployeeError) {
        console.warn('⚠️ [updateUser] fallback employee lookup failed:', fallbackEmployeeError.message || fallbackEmployeeError);
      } else {
        latestEmployeeRow = fallbackEmployee || null;
      }
    }

    // Always fetch the complete final updated user with all relationships
    const { data: finalUser, error: finalError } = await supabase
      .from('users')
      .select(`
        *,
        employee:employees(
          first_name,
          last_name,
          email,
          departments(dept_name)
        ),
        roles(role_name)
      `)
      .eq('user_id', userId)
      .single();

    if (finalError || !finalUser) {
      throw new Error('Error fetching updated user');
    }
    updatedUser = finalUser;
    console.log('📝 [updateUser] updatedUser (raw from DB):', JSON.stringify(updatedUser, null, 2));

    // Log field changes
    // Convert updatedUser to same structure as currentUser for comparison
    const convertedUpdatedUser = rowToUser(updatedUser);
    if (latestEmployeeRow) {
      convertedUpdatedUser.first_name = latestEmployeeRow.first_name ?? convertedUpdatedUser.first_name;
      convertedUpdatedUser.last_name = latestEmployeeRow.last_name ?? convertedUpdatedUser.last_name;
      convertedUpdatedUser.email = latestEmployeeRow.email ?? convertedUpdatedUser.email;
      convertedUpdatedUser.phone = latestEmployeeRow.phone ?? convertedUpdatedUser.phone;
      convertedUpdatedUser.address = latestEmployeeRow.address ?? convertedUpdatedUser.address;
      convertedUpdatedUser.dept_id = latestEmployeeRow.dept_id ?? convertedUpdatedUser.dept_id;
      convertedUpdatedUser.full_name = [convertedUpdatedUser.first_name, convertedUpdatedUser.last_name].filter(Boolean).join(' ') || convertedUpdatedUser.full_name;
    }
    console.log('📝 [updateUser] convertedUpdatedUser (after rowToUser):', JSON.stringify(convertedUpdatedUser, null, 2));
    
    const fieldMappings = getUserUpdateFieldMappings();
    console.log('📝 [updateUser] fieldMappings being used:', JSON.stringify(fieldMappings, null, 2));
    
    const changes = generateFieldChanges(currentUser, convertedUpdatedUser, fieldMappings);
    console.log('📝 [updateUser] changes detected:', JSON.stringify(changes, null, 2));
    console.log('📝 [updateUser] changes.length:', changes.length);

    if (changes.length > 0) {
      console.log('✅ [updateUser] Logging USER_UPDATED audit event with', changes.length, 'changes');
      await logFieldChanges(updatedBy, userId, 'USER_UPDATED', changes, {
        username: convertedUpdatedUser.username || `User #${userId}`
      });
    } else {
      console.log('⚠️ [updateUser] NO CHANGES DETECTED - audit log NOT created');
    }

    return convertedUpdatedUser;
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

    // Early exit: if role hasn't changed, skip update and audit logging
    if (currentUser.role_id === roleId) {
      console.log(`ℹ️ [changeUserRole] Role unchanged for user ${userId} (${newRole}), skipping update and audit log`);
      return rowToUser(currentUser);
    }

    const { data: updatedUser, error } = await supabase
      .from('users')
      .update({
        role_id: roleId,
        updated_at: new Date(),
        ...buildSyncDirtyPatch()
      })
      .eq('user_id', userId)
      .select(`
        *,
        employee:employees(
          first_name,
          last_name,
          email,
          departments(dept_name)
        ),
        roles(role_name)
      `)
      .single();

    if (error) {
      throw error;
    }

    // Log audit event
    await logAuditEvent(changedBy, 'ROLE_CHANGED', {
      user_id: userId,
      username: currentUser.username,
      old_role_id: currentUser.role_id,
      old_role_name: currentUser.role_name || 'unknown',
      new_role_id: roleId,
      new_role_name: newRole,
      description: `Changed role from "${currentUser.role_name || 'unknown'}" to "${newRole}" for "${currentUser.username}"`
    });

    return rowToUser(updatedUser);
  } catch (error) {
    if (error.isOperational) throw error;
    throw new AppError('Error changing user role', 500);
  }
}

/**
 * Change user department
 * @param {string} userId - User ID
 * @param {string} newDeptId - New department ID
 * @param {string} changedBy - User ID who made the change
 */
async function changeUserDepartment(userId, newDeptId, changedBy) {
  try {
    // Convert to number for proper comparison with DB values
    const newDeptIdNum = Number(newDeptId);
    console.log('🔄 [changeUserDepartment] START - userId:', userId, 'newDeptId:', newDeptIdNum, 'changedBy:', changedBy);

    // Validate that department exists
    console.log('🔄 [changeUserDepartment] Validating department exists...');
    const { data: deptData, error: deptError } = await supabase
      .from('departments')
      .select('dept_id')
      .eq('dept_id', newDeptIdNum)
      .single();

    console.log('✓ [changeUserDepartment] Department validation result:', { deptData, deptError: deptError?.message });

    if (deptError || !deptData) {
      throw new AppError(`Department not found: ${newDeptIdNum}`, 400);
    }

    // Get current employee record to find old dept_id
    console.log('🔄 [changeUserDepartment] Fetching current employee data...');
    const { data: currentEmployee, error: currentEmpError } = await supabase
      .from('employees')
      .select('employee_id, dept_id, departments(dept_name)')
      .eq('employee_id', userId)
      .maybeSingle();

    console.log('✓ [changeUserDepartment] Current employee result:', { 
      currentEmployee, 
      error: currentEmpError?.message 
    });

    if (currentEmpError) {
      console.error('❌ [changeUserDepartment] Error fetching current employee:', currentEmpError);
      throw new AppError('Error fetching current employee data', 500);
    }

    const oldDeptId = currentEmployee?.dept_id || null;
    const oldDeptName = currentEmployee?.departments?.dept_name || 'None';

    console.log('✓ [changeUserDepartment] Old department info - oldDeptId:', oldDeptId, 'oldDeptName:', oldDeptName);

    // Early exit: if no change needed, don't proceed with update or audit logging
    if (oldDeptId === newDeptIdNum) {
      console.log('ℹ️ [changeUserDepartment] Department unchanged (oldDeptId === newDeptId), skipping update and audit log');
      return { success: true, message: 'Department unchanged, no action taken' };
    }

    // Get current user info for audit log
    console.log('🔄 [changeUserDepartment] Fetching current user info...');
    const user = await getUserById(userId);
    console.log('✓ [changeUserDepartment] User fetched:', { user_id: user?.user_id, username: user?.username });

    // Update or create employee record with new department
    let updatedEmployee = null;
    
    if (currentEmployee) {
      // Employee exists, update it
      console.log('🔄 [changeUserDepartment] Employee exists, updating...');
      const { data: updateData, error: updateError } = await supabase
        .from('employees')
        .update({
          dept_id: newDeptIdNum,
          ...buildSyncDirtyPatch()
        })
        .eq('employee_id', userId)
        .select();

      console.log('✓ [changeUserDepartment] Employee update result:', { 
        updateData, 
        error: updateError?.message 
      });

      if (updateError) {
        console.error('❌ [changeUserDepartment] Error updating employee:', updateError);
        throw updateError;
      }
      
      updatedEmployee = Array.isArray(updateData) && updateData.length > 0 ? updateData[0] : null;
      console.log('✓ [changeUserDepartment] Updated employee:', updatedEmployee);
    } else {
      // Employee doesn't exist, create record
      console.log('🔄 [changeUserDepartment] Employee does not exist, creating new record...');
      const { data: createData, error: createError } = await supabase
        .from('employees')
        .insert([{
          employee_id: userId,
          dept_id: newDeptIdNum,
          created_at: new Date().toISOString(),
          ...buildSyncDirtyPatch()
        }])
        .select();

      console.log('✓ [changeUserDepartment] Employee create result:', { 
        createData, 
        error: createError?.message 
      });

      if (createError) {
        console.error('❌ [changeUserDepartment] Error creating employee:', createError);
        throw createError;
      }
      
      updatedEmployee = Array.isArray(createData) && createData.length > 0 ? createData[0] : null;
      console.log('✓ [changeUserDepartment] Created employee:', updatedEmployee);
    }

    // Get new department name
    console.log('🔄 [changeUserDepartment] Fetching new department name...');
    const { data: newDeptData, error: newDeptError } = await supabase
      .from('departments')
      .select('dept_name')
      .eq('dept_id', newDeptIdNum)
      .single();

    console.log('✓ [changeUserDepartment] New department result:', { 
      newDeptData, 
      error: newDeptError?.message 
    });

    const newDeptName = newDeptData?.dept_name || 'Unknown';
    console.log('✓ [changeUserDepartment] New department name:', newDeptName);

    // Log audit event
    console.log('🔄 [changeUserDepartment] Logging audit event...');
    await logAuditEvent(changedBy, 'DEPARTMENT_CHANGED', {
      user_id: userId,
      username: user.username,
      old_dept_id: oldDeptId,
      old_dept_name: oldDeptName,
      new_dept_id: newDeptIdNum,
      new_dept_name: newDeptName,
      description: `Changed department from "${oldDeptName}" to "${newDeptName}" for "${user.username}"`
    });
    console.log('✓ [changeUserDepartment] Audit event logged');

    console.log('✅ [changeUserDepartment] SUCCESS - Department updated for user:', userId);
    return { success: true, message: 'Department updated' };
  } catch (error) {
    console.error('❌ [changeUserDepartment] CATCH BLOCK - Error:', {
      message: error.message,
      code: error.code,
      isOperational: error.isOperational,
      stack: error.stack
    });
    if (error.isOperational) throw error;
    throw new AppError('Error changing user department', 500);
  }
}

/**
 * Atomically update both user role and department in a single transaction
 * @param {string} userId - User ID
 * @param {Object} updates - { role, dept_id }
 * @param {string} changedBy - User ID who made the change
 * @returns {Promise<Object>} Updated user
 */
async function updateUserPermissions(userId, { role, dept_id }, changedBy) {
  console.log('🔄 [updateUserPermissions] START - userId:', userId, 'updates:', { role, dept_id }, 'changedBy:', changedBy);

  try {
    // Validate inputs
    if (!role && !dept_id) {
      throw new AppError('At least one of role or dept_id must be provided', 400);
    }

    // Get current user and employee for audit comparison
    console.log('🔄 [updateUserPermissions] Fetching current user and employee data...');
    const currentUser = await getUserById(userId);
    
    const { data: currentEmployee, error: currentEmpError } = await supabase
      .from('employees')
      .select('employee_id, dept_id, departments(dept_name)')
      .eq('employee_id', userId)
      .maybeSingle();

    if (currentEmpError) {
      console.error('❌ [updateUserPermissions] Error fetching employee:', currentEmpError);
      throw new AppError('Error fetching employee data', 500);
    }

    console.log('✓ [updateUserPermissions] Current data fetched:', {
      username: currentUser?.username,
      current_role_id: currentUser?.role_id,
      current_role_name: currentUser?.role_name,
      current_dept_id: currentEmployee?.dept_id,
      current_dept_name: currentEmployee?.departments?.dept_name
    });

    // Prepare updates and validations
    const updatesUsersTable = {};
    const updatesEmployeesTable = {};
    const auditEvents = [];

    // Handle role update
    if (role) {
      console.log('🔄 [updateUserPermissions] Validating role:', role);
      const { data: roleData, error: roleError } = await supabase
        .from('roles')
        .select('role_id')
        .eq('role_name', role)
        .single();

      if (roleError || !roleData) {
        throw new AppError(`Invalid role: ${role}`, 400);
      }

      updatesUsersTable.role_id = roleData.role_id;
      
      if (currentUser.role_name !== role) {
        auditEvents.push({
          action: 'ROLE_CHANGED',
          details: {
            user_id: userId,
            username: currentUser.username,
            old_role_id: currentUser.role_id,
            old_role_name: currentUser.role_name || 'unknown',
            new_role_id: roleData.role_id,
            new_role_name: role,
            description: `Changed role from "${currentUser.role_name || 'unknown'}" to "${role}" for "${currentUser.username}"`
          }
        });
      }
    }

    // Handle department update
    if (dept_id) {
      // Convert to number for proper comparison
      const deptIdNum = Number(dept_id);
      
      console.log('🔄 [updateUserPermissions] Validating department:', deptIdNum);
      const { data: deptData, error: deptError } = await supabase
        .from('departments')
        .select('dept_id, dept_name')
        .eq('dept_id', deptIdNum)
        .single();

      if (deptError || !deptData) {
        throw new AppError(`Invalid department: ${deptIdNum}`, 400);
      }

      updatesEmployeesTable.dept_id = deptIdNum;

      // Only log department change if it's actually different
      if (currentEmployee?.dept_id !== deptIdNum) {
        const oldDeptName = currentEmployee?.departments?.dept_name || 'None';
        auditEvents.push({
          action: 'DEPARTMENT_CHANGED',
          details: {
            user_id: userId,
            username: currentUser.username,
            old_dept_id: currentEmployee?.dept_id || null,
            old_dept_name: oldDeptName,
            new_dept_id: deptIdNum,
            new_dept_name: deptData.dept_name,
            description: `Changed department from "${oldDeptName}" to "${deptData.dept_name}" for "${currentUser.username}"`
          }
        });
      }
    }

    // No changes needed
    if (Object.keys(updatesUsersTable).length === 0 && Object.keys(updatesEmployeesTable).length === 0) {
      console.log('⚠️ [updateUserPermissions] No changes detected');
      return await getUserById(userId);
    }

    // Execute atomic transaction for both updates
    console.log('🔄 [updateUserPermissions] EXECUTING TRANSACTION...');
    let updatedUser = null;

    // Update users table if needed
    if (Object.keys(updatesUsersTable).length > 0) {
      console.log('🔄 [updateUserPermissions] Updating users table:', updatesUsersTable);
      const { data: userData, error: userError } = await supabase
        .from('users')
        .update({
          ...updatesUsersTable,
          ...buildSyncDirtyPatch()
        })
        .eq('user_id', userId)
        .select(`
          *,
          employee:employees(
            first_name,
            last_name,
            email,
            departments(dept_name)
          ),
          roles(role_name)
        `)
        .single();

      if (userError) {
        console.error('❌ [updateUserPermissions] Users table update failed:', userError);
        throw userError;
      }
      updatedUser = userData;
      console.log('✓ [updateUserPermissions] Users table updated successfully');
    }

    // Update employees table if needed
    if (Object.keys(updatesEmployeesTable).length > 0) {
      console.log('🔄 [updateUserPermissions] Updating employees table:', updatesEmployeesTable);
      const { data: empData, error: empError } = await supabase
        .from('employees')
        .update({
          ...updatesEmployeesTable,
          ...buildSyncDirtyPatch()
        })
        .eq('employee_id', userId)
        .select();

      if (empError) {
        console.error('❌ [updateUserPermissions] Employees table update failed:', empError);
        // If users table was already updated, this is a critical failure
        throw empError;
      }
      console.log('✓ [updateUserPermissions] Employees table updated successfully');
    }

    // Fetch final updated user
    if (!updatedUser) {
      const { data: finalUser, error: finalError } = await supabase
        .from('users')
        .select(`
          *,
          employee:employees(
            first_name,
            last_name,
            email,
            departments(dept_name)
          ),
          roles(role_name)
        `)
        .eq('user_id', userId)
        .single();

      if (finalError || !finalUser) {
        throw new Error('Error fetching updated user');
      }
      updatedUser = finalUser;
    }

    // Log all audit events
    console.log('🔄 [updateUserPermissions] Logging', auditEvents.length, 'audit events...');
    for (const event of auditEvents) {
      console.log(`  📝 Logging ${event.action}:`, event.details);
      await logAuditEvent(changedBy, event.action, event.details);
    }
    console.log('✓ [updateUserPermissions] All audit events logged');

    console.log('✅ [updateUserPermissions] SUCCESS - Permissions updated for user:', userId);
    return rowToUser(updatedUser);
  } catch (error) {
    console.error('❌ [updateUserPermissions] TRANSACTION FAILED:', {
      message: error.message,
      code: error.code,
      isOperational: error.isOperational
    });
    if (error.isOperational) throw error;
    throw new AppError('Error updating user permissions', 500);
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
        updated_at: new Date(),
        ...buildSyncDirtyPatch()
      })
      .eq('user_id', userId)
      .select()
      .single();

    if (error) throw error;

    // Log audit event - use user object already fetched
    await logAuditEvent(deletedBy, 'USER_DEACTIVATED', {
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
        updated_at: new Date(),
        ...buildSyncDirtyPatch()
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
        updated_at: new Date(),
        ...buildSyncDirtyPatch()
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
        updated_at: new Date(),
        ...buildSyncDirtyPatch()
      })
      .eq('id', userId)
      .select(`
        *,
        employee:employees(
          first_name,
          last_name,
          email,
          departments(dept_name)
        ),
        roles(role_name)
      `)
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
async function resetPassword(userId, newPassword, adminPassword, resetBy) {
  validatePassword(newPassword);

  if (!adminPassword) {
    throw new AppError('Admin password is required to authorize this action', 400);
  }

  try {
    // Verify admin password
    const { data: adminData, error: adminError } = await supabase
      .from('users')
      .select('password_hash')
      .eq('user_id', resetBy)
      .single();

    if (adminError || !adminData) {
      throw new AppError('Could not verify admin credentials', 500);
    }

    const isMatch = await bcrypt.compare(adminPassword, adminData.password_hash);
    if (!isMatch) {
      throw new AppError('Invalid admin password', 401);
    }

    const hashedPassword = await bcrypt.hash(newPassword, 10);

    const { data: updatedUser, error } = await supabase
      .from('users')
      .update({
        password_hash: hashedPassword,
        updated_at: new Date(),
        ...buildSyncDirtyPatch()
      })
      .eq('user_id', userId)
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
    console.error('Password reset backend error:', error);
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
  changeUserDepartment,
  updateUserPermissions,
  deleteUser,
  reactivateUser,
  lockUser,
  unlockUser,
  resetPassword
};
