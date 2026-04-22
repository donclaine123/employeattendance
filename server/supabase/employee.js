const { supabase, bcrypt } = require('./init');
const { buildSyncDirtyPatch } = require('../utils/syncDirty');

// Get employee by ID with full profile
async function getEmployeeById(employeeId) {
    try {
        const { data, error } = await supabase
            .from('employees')
            .select(`
                employee_id,
                first_name,
                last_name,
                full_name,
                email,
                phone,
                position,
                dept_id,
                departments(dept_name),
                status,
                hire_date,
                created_at,
                users(username, role_id, roles(role_name))
            `)
            .eq('employee_id', employeeId)
            .single();
        
        if (error) {
            console.error('Error getting employee by ID:', error);
            return null;
        }
        
        // Format response to match expected structure
        const result = {
            ...data,
            department: data.departments?.dept_name || null,
            username: data.users?.username || null,
            role: data.users?.roles?.role_name || null
        };
        
        // Clean up nested data
        delete result.departments;
        delete result.users;
        
        return result;
    } catch (err) {
        console.error('Exception in getEmployeeById:', err);
        return null;
    }
}

// Update employee information
async function updateEmployee(employeeId, employeeData) {
    try {
        // Note: full_name is a generated column and is automatically computed from first_name and last_name
        // Do not attempt to update it directly
        
        const { data, error } = await supabase
            .from('employees')
            .update({
                first_name: employeeData.first_name,
                last_name: employeeData.last_name,
                email: employeeData.email,
                phone: employeeData.phone,
                address: employeeData.address,
                position: employeeData.position,
                dept_id: employeeData.dept_id,
                status: employeeData.status,
                ...buildSyncDirtyPatch()
            })
            .eq('employee_id', employeeId)
            .select('employee_id, first_name, last_name, full_name, email, phone, address, position, dept_id, status, hire_date')
            .single();
        
        if (error) {
            console.error('Error updating employee:', error);
            return null;
        }
        
        return data;
    } catch (err) {
        console.error('Exception in updateEmployee:', err);
        return null;
    }
}

// Soft delete employee (deactivate)
async function deactivateEmployee(employeeId) {
    try {
        const { data, error } = await supabase
            .from('employees')
            .update({
                status: 'inactive',
                ...buildSyncDirtyPatch()
            })
            .eq('employee_id', employeeId)
            .select('employee_id, full_name, email')
            .single();
        
        if (error) {
            console.error('Error deactivating employee:', error);
            return null;
        }
        
        return data;
    } catch (err) {
        console.error('Exception in deactivateEmployee:', err);
        return null;
    }
}

// Create HR employee with user account
async function createHREmployee(employeeData, creatorId) {
    try {
        const { 
            first_name, last_name, email, phone, address, position, 
            role, status, dept_id, hire_date, password 
        } = employeeData;
        
        // Hash the password
        const hashedPassword = await bcrypt.hash(password, 10);
        
        // Get role ID
        const { data: roleData, error: roleError } = await supabase
            .from('roles')
            .select('role_id')
            .eq('role_name', role)
            .single();
        
        if (roleError || !roleData) {
            console.error('Role not found:', roleError);
            return { success: false, error: `Role '${role}' not found in database` };
        }
        
        // Create user account first
        const { data: userData, error: userError } = await supabase
            .from('users')
            .insert({
                username: email,
                password_hash: hashedPassword,
                role_id: roleData.role_id,
                first_login: true,
                created_by: creatorId
            })
            .select('user_id')
            .single();
        
        if (userError) {
            console.error('Error creating user account:', userError);
            if (userError.code === '23505') { // Unique constraint violation
                return { success: false, error: 'A user with this email already exists.' };
            }
            return { success: false, error: 'Failed to create user account.' };
        }
        
        const userId = userData.user_id;
        
        // Auto-set position based on role if not provided
        let finalPosition = position;
        if (!finalPosition) {
            switch (role.toLowerCase()) {
                case 'superadmin':
                    finalPosition = 'SuperAdmin';
                    break;
                case 'hr':
                    finalPosition = 'Human Resource';
                    break;
                case 'head_dept':
                    finalPosition = 'Department Head';
                    break;
                default:
                    finalPosition = position; // Keep original or null
            }
        }
        
        // Create employee record with matching employee_id
        const { data: newEmployeeData, error: employeeError } = await supabase
            .from('employees')
            .insert({
                employee_id: userId,
                first_name,
                last_name,
                email,
                phone,
                address,
                position: finalPosition,
                dept_id,
                hire_date,
                status,
                created_by: creatorId
            })
            .select()
            .single();
        
        if (employeeError) {
            console.error('Error creating employee record:', employeeError);
            // Should ideally rollback user creation, but for now log the issue
            return { success: false, error: 'Failed to create employee record.' };
        }
        
        return { 
            success: true, 
            employee: newEmployeeData,
            userId: userId,
            message: 'Employee created successfully.' 
        };
    } catch (err) {
        console.error('Exception in createHREmployee:', err);
        return { success: false, error: err.message || 'Failed to create employee.' };
    }
}

// Admin user creation
async function createAdminUser(userData, creatorId) {
    try {
        const { email, password, role, firstName, lastName, departmentId } = userData;
        
        // Hash the password
        const hashedPassword = await bcrypt.hash(password, 10);
        
        // Get role ID
        const { data: roleData, error: roleError } = await supabase
            .from('roles')
            .select('role_id')
            .ilike('role_name', role)
            .single();
        
        if (roleError || !roleData) {
            console.error('Invalid role specified:', roleError);
            return { success: false, error: 'Invalid role specified.' };
        }
        
        // Create user account
        const { data: newUserData, error: userError } = await supabase
            .from('users')
            .insert({
                username: email,
                password_hash: hashedPassword,
                role_id: roleData.role_id,
                created_by: creatorId
            })
            .select('user_id')
            .single();
        
        if (userError) {
            console.error('Error creating user:', userError);
            if (userError.code === '23505') { // Unique constraint violation
                return { success: false, error: 'A user with this email already exists.' };
            }
            return { success: false, error: 'Failed to create user account.' };
        }
        
        // Create employee record
        const { error: employeeError } = await supabase
            .from('employees')
            .insert({
                employee_id: newUserData.user_id,
                first_name: firstName,
                last_name: lastName,
                dept_id: departmentId,
                hire_date: new Date().toISOString().split('T')[0], // Today's date
                created_by: creatorId
            });
        
        if (employeeError) {
            console.error('Error creating employee record:', employeeError);
            // Should ideally rollback user creation, but for now log the issue
            return { success: false, error: 'Failed to create employee record.' };
        }
        
        return { 
            success: true, 
            userId: newUserData.user_id,
            message: `${role.toUpperCase()} user created successfully.` 
        };
    } catch (err) {
        console.error('Exception in createAdminUser:', err);
        return { success: false, error: err.message || 'Failed to create user.' };
    }
}

// Admin user update
async function updateAdminUser(userId, updateData, updaterId) {
    try {
        const { email, role, status, firstName, lastName, departmentId, password } = updateData;
        const auditDetails = { targetUserId: userId, changes: {} };
        
        // Update user table fields
        const userUpdates = {};
        if (email && email.trim()) {
            userUpdates.username = email.trim();
            auditDetails.changes.email = true;
        }
        if (status) {
            userUpdates.status = status;
            auditDetails.changes.status = status;
        }
        if (password && password.length > 0) {
            userUpdates.password_hash = await bcrypt.hash(password, 10);
            auditDetails.changes.passwordReset = true;
        }
        
        // Handle role update
        if (role) {
            const normalizedRole = String(role).toLowerCase();
            const allowedRoles = ['employee','head_dept','hr','superadmin'];
            if (!allowedRoles.includes(normalizedRole)) {
                return { success: false, error: 'Invalid role.' };
            }
            
            const { data: roleData, error: roleError } = await supabase
                .from('roles')
                .select('role_id')
                .ilike('role_name', normalizedRole)
                .single();
            
            if (roleError || !roleData) {
                return { success: false, error: 'Invalid role.' };
            }
            
            userUpdates.role_id = roleData.role_id;
            auditDetails.changes.role = role;
        }
        
        // Update user if there are changes
        if (Object.keys(userUpdates).length > 0) {
            userUpdates.updated_at = new Date().toISOString();
            
            const { error: userError } = await supabase
                .from('users')
                .update({
                    ...userUpdates,
                    ...buildSyncDirtyPatch()
                })
                .eq('user_id', userId);
            
            if (userError) {
                console.error('Error updating user:', userError);
                if (userError.code === '23505') { // Unique constraint violation
                    return { success: false, error: 'A user with this email already exists.' };
                }
                return { success: false, error: 'Failed to update user.' };
            }
        }
        
        // Update employee table fields
        const empUpdates = {};
        if (firstName && firstName.trim()) {
            empUpdates.first_name = firstName.trim();
            auditDetails.changes.firstName = true;
        }
        if (lastName && lastName.trim()) {
            empUpdates.last_name = lastName.trim();
            auditDetails.changes.lastName = true;
        }
        if (departmentId !== undefined && departmentId !== null) {
            empUpdates.dept_id = departmentId;
            auditDetails.changes.departmentId = departmentId;
        }
        
        // Update employee if there are changes
        if (Object.keys(empUpdates).length > 0) {
            const { error: empError } = await supabase
                .from('employees')
                .update({
                    ...empUpdates,
                    ...buildSyncDirtyPatch()
                })
                .eq('employee_id', userId);
            
            if (empError) {
                console.warn(`No employee record found for user_id ${userId} to update details.`);
            }
        }
        
        return { success: true, auditDetails };
    } catch (err) {
        console.error('Exception in updateAdminUser:', err);
        return { success: false, error: err.message || 'Failed to update user.' };
    }
}

// Validate department head role
async function validateDepartmentHead(employeeId) {
    try {
        console.log('[validateDepartmentHead] Checking if employee can be promoted:', employeeId);
        
        // Query users table directly using user_id = employee_id (1:1 relationship)
        // Now we accept employees (role_id=4) since we'll promote them to head_dept (role_id=3)
        const { data, error } = await supabase
            .from('users')
            .select(`
                user_id,
                role_id,
                roles!inner(role_name)
            `)
            .eq('user_id', employeeId)
            .single();
        
        if (error) {
            console.error('[validateDepartmentHead] Error:', error.message);
            return null;
        }
        
        console.log('[validateDepartmentHead] Raw data:', JSON.stringify(data, null, 2));
        
        // Get employee info separately
        const { data: empData } = await supabase
            .from('employees')
            .select('employee_id, full_name')
            .eq('employee_id', employeeId)
            .single();
        
        const result = {
            employee_id: employeeId,
            full_name: empData?.full_name || 'Unknown',
            user_id: data.user_id,
            role_id: data.role_id,
            role_name: data.roles?.role_name
        };
        
        console.log('[validateDepartmentHead] Employee validation result:', JSON.stringify(result, null, 2));
        
        return result;
    } catch (err) {
        console.error('[validateDepartmentHead] Exception:', err.message);
        return null;
    }
}

module.exports = {
    getEmployeeById,
    updateEmployee,
    deactivateEmployee,
    createHREmployee,
    createAdminUser,
    updateAdminUser,
    validateDepartmentHead
};
