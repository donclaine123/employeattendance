const { supabase } = require('./init');
const { buildSyncDirtyPatch } = require('../utils/syncDirty');

const HEAD_DEPARTMENT_ROLE_NAMES = ['head_dept', 'department_head'];
let headDeptRoleIdsCache = null;

async function getHeadDeptRoleIds() {
    if (headDeptRoleIdsCache) {
        return headDeptRoleIdsCache;
    }

    try {
        const { data, error } = await supabase
            .from('roles')
            .select('role_id, role_name')
            .in('role_name', HEAD_DEPARTMENT_ROLE_NAMES);

        if (error || !Array.isArray(data) || data.length === 0) {
            return null;
        }

        headDeptRoleIdsCache = [...new Set(
            data
                .map((role) => role.role_id)
                .filter((roleId) => roleId != null)
        )];

        return headDeptRoleIdsCache.length > 0 ? headDeptRoleIdsCache : null;
    } catch (error) {
        console.error('[getHeadDeptRoleIds] Error:', error);
        return null;
    }
}

async function resolveLegacyDepartmentHeadDisplay(headId) {
    if (!headId) {
        return {
            head_id: null,
            head_name: null,
            head_username: null
        };
    }

    try {
        const [employeeResult, userResult] = await Promise.all([
            supabase
                .from('employees')
                .select('employee_id, full_name, first_name, last_name, email')
                .eq('employee_id', headId)
                .single(),
            supabase
                .from('users')
                .select('user_id, username')
                .eq('user_id', headId)
                .single()
        ]);

        const employee = employeeResult?.data;
        const user = userResult?.data;
        const employeeName = employee?.full_name || [employee?.first_name, employee?.last_name].filter(Boolean).join(' ').trim();

        return {
            head_id: user?.user_id || employee?.employee_id || headId,
            head_name: employeeName || user?.username || employee?.email || null,
            head_username: user?.username || employee?.email || null
        };
    } catch (error) {
        console.error(`[resolveLegacyDepartmentHeadDisplay] Error resolving head ${headId}:`, error);
        return {
            head_id: headId,
            head_name: null,
            head_username: null
        };
    }
}

async function buildDepartmentHeadLookup() {
    try {
        const headRoleIds = await getHeadDeptRoleIds();
        if (!headRoleIds) {
            return {
                headByDeptId: new Map()
            };
        }

        const [usersResult, employeesResult] = await Promise.all([
            supabase
                .from('users')
                .select('user_id, username, status, role_id, created_at, updated_at')
                .in('role_id', headRoleIds)
                .eq('status', 'active'),
            supabase
                .from('employees')
                .select('employee_id, email, full_name, first_name, last_name, dept_id, status')
                .eq('status', 'active')
        ]);

        const headUsers = (usersResult?.data || [])
            .slice()
            .sort((left, right) => {
                const leftTime = new Date(left.updated_at || left.created_at || 0).getTime();
                const rightTime = new Date(right.updated_at || right.created_at || 0).getTime();

                if (rightTime !== leftTime) {
                    return rightTime - leftTime;
                }

                return Number(right.user_id || 0) - Number(left.user_id || 0);
            });
        const employees = employeesResult?.data || [];

        const employeeById = new Map();
        const employeeByEmail = new Map();
        const headByDeptId = new Map();

        employees.forEach((employee) => {
            employeeById.set(employee.employee_id, employee);
            if (employee.email) {
                employeeByEmail.set(employee.email.toLowerCase(), employee);
            }
        });

        headUsers.forEach((user) => {
            const employee = employeeById.get(user.user_id)
                || (user.username ? employeeByEmail.get(user.username.toLowerCase()) : null);

            if (!employee || employee.dept_id == null) {
                return;
            }

            const employeeName = employee.full_name || [employee.first_name, employee.last_name].filter(Boolean).join(' ').trim();
            const deptKey = String(employee.dept_id);
            const currentHeads = headByDeptId.get(deptKey) || [];
            const headRecord = {
                head_id: user.user_id || employee.employee_id || null,
                head_name: employeeName || user.username || employee.email || null,
                head_username: user.username || employee.email || null,
                updated_at: user.updated_at || user.created_at || null
            };

            if (!currentHeads.some((head) => String(head.head_id) === String(headRecord.head_id))) {
                currentHeads.push(headRecord);
            }

            headByDeptId.set(deptKey, currentHeads);
        });

        return {
            headByDeptId
        };
    } catch (error) {
        console.error('[buildDepartmentHeadLookup] Error:', error);
        return {
            headByDeptId: new Map()
        };
    }
}

async function resolveDepartmentHeadDisplay(department, lookup = null) {
    const deptId = typeof department === 'object' ? department?.dept_id : department;
    const fallbackHeadId = typeof department === 'object' ? department?.head_id : null;
    const headLookup = lookup || await buildDepartmentHeadLookup();
    const deptKey = deptId == null ? null : String(deptId);
    const roleBasedHeads = deptKey ? (headLookup.headByDeptId.get(deptKey) || []) : [];
    const heads = [...roleBasedHeads];

    if (fallbackHeadId && !heads.some((head) => String(head.head_id) === String(fallbackHeadId))) {
        const fallbackHead = await resolveLegacyDepartmentHeadDisplay(fallbackHeadId);
        if (fallbackHead.head_id || fallbackHead.head_name || fallbackHead.head_username) {
            heads.push({
                ...fallbackHead,
                updated_at: null
            });
        }
    }

    if (heads.length > 0) {
        const headNames = heads.map((head) => head.head_name).filter(Boolean);
        const headUsernames = heads.map((head) => head.head_username).filter(Boolean);
        const headIds = heads.map((head) => head.head_id).filter(Boolean);

        return {
            head_id: headIds[0] || null,
            head_name: headNames.join(', '),
            head_username: headUsernames.join(', '),
            head_names: headNames,
            head_usernames: headUsernames,
            head_ids: headIds,
            head_count: heads.length
        };
    }

    if (fallbackHeadId) {
        return resolveLegacyDepartmentHeadDisplay(fallbackHeadId);
    }

    return {
        head_id: null,
        head_name: null,
        head_username: null
    };
}

// Get departments list with head information
async function getDepartments() {
    if (!supabase) return null;
    
    try {
        const { data, error } = await supabase
            .from('departments')
            .select('dept_id, dept_name, description, head_id')
            .order('dept_name', { ascending: true });
            
        if (error) throw error;
        
        console.log('[getDepartments] Retrieved', data?.length || 0, 'departments');

        const headLookup = await buildDepartmentHeadLookup();
        const departmentsWithHeads = await Promise.all(
            data.map(async (dept) => {
                const headDisplay = await resolveDepartmentHeadDisplay(dept, headLookup);

                return {
                    dept_id: dept.dept_id,
                    dept_name: dept.dept_name,
                    description: dept.description,
                    head_id: dept.head_id,
                    ...headDisplay
                };
            })
        );
        
        return departmentsWithHeads;
    } catch (error) {
        console.error('[supabase] Get departments error:', error.message);
        throw error;
    }
}

// Update department head
async function updateDepartmentHead(deptId, headId) {
    if (!supabase) return null;
    
    try {
        console.log(`[updateDepartmentHead] Starting head assignment for dept ${deptId}, new head: ${headId}`);
        
        // Step 1: Get current department head
        const { data: deptData, error: deptError } = await supabase
            .from('departments')
            .select('head_id, dept_name')
            .eq('dept_id', deptId)
            .single();
            
        if (deptError) {
            console.error('[updateDepartmentHead] Error fetching department:', deptError);
            throw deptError;
        }
        
        const previousHeadId = deptData.head_id;
        console.log(`[updateDepartmentHead] Current head: ${previousHeadId}, New head: ${headId}`);
        
        // Step 2: Keep any existing heads in place so a department can have multiple heads.
        if (previousHeadId && headId && headId !== previousHeadId) {
            console.log(`[updateDepartmentHead] Retaining previous head ${previousHeadId} and adding ${headId}`);
        } else {
            console.log(`[updateDepartmentHead] No existing head demotion needed`);
        }
        
        // Step 3: If new head is being assigned (not null), promote them (role_id 4 -> 3)
        if (headId) {
            console.log(`[updateDepartmentHead] ===== PROMOTING NEW HEAD ${headId} =====`);
            console.log(`[updateDepartmentHead] Will update: employee_id=${headId} for dept ${deptId}`);
            
            // First, get the new head's employee record to see what we're promoting
            const { data: empBefore, error: empBeforeError } = await supabase
                .from('employees')
                .select('employee_id, full_name, position, dept_id')
                .eq('employee_id', headId);
                
            console.log(`[updateDepartmentHead] All employee records for employee_id ${headId}:`, empBefore);
            
            if (!empBeforeError && empBefore && empBefore.length > 0) {
                console.log(`[updateDepartmentHead] BEFORE promotion - Employee ${headId}: position="${empBefore[0].position}", dept_id=${empBefore[0].dept_id}`);
            }
            
            // Update new head's role to head_dept (role_id = 3)
            const { data: promoteData, error: promoteError } = await supabase
                .from('users')
                .update({
                    role_id: 3,
                    ...buildSyncDirtyPatch()
                })
                .eq('user_id', headId)
                .select();
                
            if (promoteError) {
                console.error('[updateDepartmentHead] Error promoting new head in users table:', promoteError);
                throw promoteError;
            }
            console.log('[updateDepartmentHead] ✓ Users table updated for promotion:', promoteData);
            
            // Update new head's position and dept_id in employees table
            console.log(`[updateDepartmentHead] Attempting to update employees: WHERE employee_id=${headId}`);
            const { data: newEmpData, error: newEmpError } = await supabase
                .from('employees')
                .update({ 
                    position: `Department Head - ${deptData.dept_name}`,
                    dept_id: deptId,
                    ...buildSyncDirtyPatch()
                })
                .eq('employee_id', headId)
                .select();
                
            if (newEmpError) {
                console.error('[updateDepartmentHead] Error updating new head in employees table:', newEmpError);
                throw newEmpError;
            }
            console.log('[updateDepartmentHead] ✓ Employees table update result:', newEmpData);
            if (newEmpData && newEmpData.length > 0) {
                console.log(`[updateDepartmentHead] ✓✓ SUCCESS - Promotion completed for ${newEmpData.length} row(s)`);
                console.log(`[updateDepartmentHead] AFTER promotion - Employee ${headId}: position="${newEmpData[0].position}", dept_id=${newEmpData[0].dept_id}`);
            } else {
                console.log(`[updateDepartmentHead] ✗✗ CRITICAL: NO ROWS UPDATED! Employee ${headId} not found`);
            }
            
            console.log(`[updateDepartmentHead] ===== PROMOTION COMPLETE =====`);
        } else {
            console.log(`[updateDepartmentHead] No new head assigned - department head removed`);
        }
        
        // Step 4: Update department's head_id
        console.log(`[updateDepartmentHead] ===== UPDATING DEPARTMENTS TABLE =====`);
        console.log(`[updateDepartmentHead] Setting departments.head_id = ${headId || null} WHERE dept_id = ${deptId}`);
        
        const { data: updateData, error: updateError } = await supabase
            .from('departments')
            .update({
                head_id: headId || null,
                ...buildSyncDirtyPatch()
            })
            .eq('dept_id', deptId)
            .select();
            
        if (updateError) {
            console.error('[updateDepartmentHead] ✗ Error updating department head_id:', updateError);
            throw updateError;
        }
        
        console.log('[updateDepartmentHead] ✓ Departments table update result:', updateData);
        if (updateData && updateData.length > 0) {
            console.log(`[updateDepartmentHead] ✓✓ SUCCESS - Department head_id set to ${updateData[0].head_id}`);
        } else {
            console.log(`[updateDepartmentHead] ✗✗ CRITICAL: NO ROWS UPDATED in departments table!`);
        }
        
        console.log(`[updateDepartmentHead] ===== ALL UPDATES COMPLETE =====`);
        console.log(`[updateDepartmentHead] SUCCESS - Department head successfully updated`);
        return updateData;
        
    } catch (error) {
        console.error('[supabase] Update department head error:', error.message);
        throw error;
    }
}

// Create department
async function createDepartment({ dept_name, description = null, head_id = null }) {
    if (!supabase) return { success: false, error: 'Supabase client not initialized' };

    try {
        const name = (dept_name || '').trim();
        if (!name) return { success: false, error: 'Department name is required' };

        // Check for existing department with same name (case-insensitive)
        try {
            const { data: existing, error: existingErr } = await supabase
                .from('departments')
                .select('dept_id')
                .ilike('dept_name', name)
                .limit(1)
                .maybeSingle();

            if (existingErr) {
                console.warn('[supabase] Department existence check error:', existingErr.message);
            }
            
            if (existing) {
                return { success: false, error: 'Department already exists' };
            }
        } catch (e) {
            // If the check errors, continue to attempt insert (we'll catch unique constraint on insert)
            console.warn('[supabase] Department existence check failed:', e && e.message);
        }

        const { data, error } = await supabase
            .from('departments')
            .insert({ dept_name: name, description, head_id })
            .select()
            .single();

        if (error) {
            console.error('[supabase] Create department error:', error.message || error);
            // Handle unique constraint gracefully
            if (String(error.message || '').toLowerCase().includes('unique') || error.code === '23505') {
                return { success: false, error: 'Department already exists' };
            }
            return { success: false, error: error.message || 'Failed to create department' };
        }

        return { success: true, department: data };
    } catch (err) {
        console.error('[supabase] Exception creating department:', err && err.message ? err.message : err);
        return { success: false, error: err.message || 'Failed to create department' };
    }
}

// Update department
async function updateDepartment(deptId, { dept_name, description = null, head_id = null }) {
    if (!supabase) return { success: false, error: 'Supabase client not initialized' };

    try {
        const name = (dept_name || '').trim();
        if (!name) return { success: false, error: 'Department name is required' };

        // Check if department exists
        const { data: existing, error: existingError } = await supabase
            .from('departments')
            .select('dept_id')
            .eq('dept_id', deptId)
            .single();

        if (existingError || !existing) {
            return { success: false, error: 'Department not found' };
        }

        // Check for duplicate name (excluding current department)
        try {
            const { data: duplicate, error: dupError } = await supabase
                .from('departments')
                .select('dept_id')
                .ilike('dept_name', name)
                .neq('dept_id', deptId)
                .limit(1)
                .maybeSingle();

            if (dupError) {
                console.warn('[supabase] Duplicate name check error:', dupError.message);
            }
            
            if (duplicate) {
                console.log('[supabase] Duplicate department name found:', duplicate);
                return { success: false, error: 'Department name already exists' };
            }
        } catch (dupErr) {
            // Log and continue — if supabase returns an unexpected error, surface it
            console.warn('[supabase] Duplicate name check failed (non-fatal):', dupErr && dupErr.message ? dupErr.message : dupErr);
        }

        const { data, error } = await supabase
            .from('departments')
            .update({ 
                dept_name: name, 
                description, 
                head_id,
                ...buildSyncDirtyPatch()
            })
            .eq('dept_id', deptId)
            .select()
            .single();

        if (error) {
            console.error('[supabase] Update department error:', error.message || error);
            return { success: false, error: error.message || 'Failed to update department' };
        }

        return { success: true, department: data };
    } catch (err) {
        console.error('[supabase] Exception updating department:', err && err.message ? err.message : err);
        return { success: false, error: err.message || 'Failed to update department' };
    }
}

// Delete department
async function deleteDepartment(deptId) {
    if (!supabase) return { success: false, error: 'Supabase client not initialized' };

    try {
        // Check if department exists
        const { data: existing, error: existingError } = await supabase
            .from('departments')
            .select('dept_id')
            .eq('dept_id', deptId)
            .single();

        if (existingError || !existing) {
            return { success: false, error: 'Department not found' };
        }

        // Check if any employees are assigned to this department
        const { data: employees, error: employeesError } = await supabase
            .from('employees')
            .select('employee_id')
            .eq('dept_id', deptId)
            .limit(1);

        if (employeesError) {
            console.error('[supabase] Error checking employees:', employeesError);
            return { success: false, error: 'Failed to check department dependencies' };
        }

        if (employees && employees.length > 0) {
            return { success: false, error: 'Cannot delete department with assigned employees' };
        }

        const { error } = await supabase
            .from('departments')
            .delete()
            .eq('dept_id', deptId);

        if (error) {
            console.error('[supabase] Delete department error:', error.message || error);
            return { success: false, error: error.message || 'Failed to delete department' };
        }

        return { success: true };
    } catch (err) {
        console.error('[supabase] Exception deleting department:', err && err.message ? err.message : err);
        return { success: false, error: err.message || 'Failed to delete department' };
    }
}

// Get department by ID
async function getDepartmentById(deptId) {
    if (!supabase) return null;
    
    try {
        const { data, error } = await supabase
            .from('departments')
            .select('dept_id, dept_name, description, head_id')
            .eq('dept_id', deptId)
            .limit(1)
            .single();
            
        if (error) {
            if (error.code === 'PGRST116') return null; // No rows found
            throw error;
        }
        
        const headDisplay = await resolveDepartmentHeadDisplay(data);
        return {
            ...data,
            ...headDisplay
        };
    } catch (error) {
        console.error('[supabase] Get department by ID error:', error.message);
        return null;
    }
}

// Get basic departments list
async function getBasicDepartments() {
    try {
        const { data, error } = await supabase
            .from('departments')
            .select('dept_id, dept_name')
            .order('dept_name', { ascending: true });
        
        if (error) {
            console.error('Error getting basic departments:', error);
            return null;
        }
        
        return data;
    } catch (err) {
        console.error('Exception in getBasicDepartments:', err);
        return null;
    }
}

module.exports = {
    getDepartments,
    createDepartment,
    updateDepartment,
    deleteDepartment,
    updateDepartmentHead,
    getDepartmentById,
    getBasicDepartments
};
