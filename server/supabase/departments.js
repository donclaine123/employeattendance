const { supabase } = require('./init');

// Get departments list with head information
async function getDepartments() {
    if (!supabase) return null;
    
    try {
        // Get department data with head information
        const { data, error } = await supabase
            .from('departments')
            .select(`
                dept_id, 
                dept_name, 
                description, 
                head_id
            `)
            .order('dept_name', { ascending: true });
            
        if (error) throw error;
        
        console.log('[getDepartments] Retrieved', data?.length || 0, 'departments');
        
        // For each department, fetch the head's name if head_id exists
        const departmentsWithHeads = await Promise.all(
            data.map(async (dept) => {
                let head_name = null;
                let head_username = null;
                
                if (dept.head_id) {
                    try {
                        // Query employees table using employee_id = head_id (1:1 relationship)
                        const { data: empData } = await supabase
                            .from('employees')
                            .select('full_name, first_name, last_name')
                            .eq('employee_id', dept.head_id)
                            .single();
                        
                        if (empData) {
                            head_name = empData.full_name || `${empData.first_name} ${empData.last_name}`;
                        }
                        
                        // Also get username from users table
                        const { data: userData } = await supabase
                            .from('users')
                            .select('username')
                            .eq('user_id', dept.head_id)
                            .single();
                        
                        if (userData) {
                            head_username = userData.username;
                        }
                        
                        console.log(`[getDepartments] Dept ${dept.dept_id}: head_id=${dept.head_id}, head_name="${head_name}"`);
                    } catch (err) {
                        console.warn(`[getDepartments] Failed to get head info for dept ${dept.dept_id}:`, err.message);
                    }
                }
                
                return {
                    dept_id: dept.dept_id,
                    dept_name: dept.dept_name,
                    description: dept.description,
                    head_id: dept.head_id,
                    head_name: head_name,
                    head_username: head_username
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
        
        // Step 2: If there's a previous head and we're either removing them or assigning someone different, demote them
        const isDifferentHead = !headId || (headId !== previousHeadId);
        console.log(`[updateDepartmentHead] isDifferentHead: ${isDifferentHead}, previousHeadId: ${previousHeadId}`);
        
        if (previousHeadId && isDifferentHead) {
            console.log(`[updateDepartmentHead] ===== DEMOTING PREVIOUS HEAD ${previousHeadId} =====`);
            console.log(`[updateDepartmentHead] Will update: employee_id=${previousHeadId} AND dept_id=${deptId}`);
            
            // First, get the previous head's employee record to see what we're demoting
            const { data: empBefore, error: empBeforeError } = await supabase
                .from('employees')
                .select('employee_id, full_name, position, dept_id')
                .eq('employee_id', previousHeadId);
                
            console.log(`[updateDepartmentHead] All employee records for employee_id ${previousHeadId}:`, empBefore);
            
            if (!empBeforeError && empBefore) {
                const targetEmployee = empBefore.find(e => e.dept_id === deptId);
                if (targetEmployee) {
                    console.log(`[updateDepartmentHead] BEFORE demotion - Employee ${previousHeadId} in dept ${deptId}: position="${targetEmployee.position}", dept_id=${targetEmployee.dept_id}`);
                } else {
                    console.log(`[updateDepartmentHead] WARNING: Employee ${previousHeadId} NOT FOUND in dept ${deptId}!`);
                }
            }
            
            // Update previous head's role to employee (role_id = 4)
            const { data: userData, error: demoteError } = await supabase
                .from('users')
                .update({ role_id: 4 })
                .eq('user_id', previousHeadId)
                .select();
                
            if (demoteError) {
                console.error('[updateDepartmentHead] Error demoting previous head in users table:', demoteError);
                throw demoteError;
            }
            console.log('[updateDepartmentHead] ✓ Users table updated for demotion:', userData);
            
            // Update previous head's position and dept_id in employees table
            // Make sure to only update the one in this department using both employee_id AND dept_id
            console.log(`[updateDepartmentHead] Attempting to update employees: WHERE employee_id=${previousHeadId} AND dept_id=${deptId}`);
            const { data: empData, error: empUpdateError } = await supabase
                .from('employees')
                .update({ 
                    position: 'Employee'
                    // IMPORTANT: Keep dept_id unchanged - employee stays in their department
                })
                .eq('employee_id', previousHeadId)
                .eq('dept_id', deptId)  // IMPORTANT: Also check they're in this department
                .select();
                
            if (empUpdateError) {
                console.error('[updateDepartmentHead] Error updating previous head in employees table:', empUpdateError);
                throw empUpdateError;
            }
            
            console.log('[updateDepartmentHead] ✓ Employees table update result:', empData);
            if (empData && empData.length > 0) {
                console.log(`[updateDepartmentHead] ✓✓ SUCCESS - Demotion completed for ${empData.length} row(s)`);
                console.log(`[updateDepartmentHead] AFTER demotion - Employee ${previousHeadId}: position="${empData[0].position}", dept_id=${empData[0].dept_id}`);
            } else {
                console.log(`[updateDepartmentHead] ✗✗ CRITICAL: NO ROWS UPDATED! Employee ${previousHeadId} may not be in dept ${deptId}`);
            }
            
            console.log(`[updateDepartmentHead] ===== DEMOTION COMPLETE =====`);
        } else {
            console.log(`[updateDepartmentHead] No demotion needed (previousHeadId: ${previousHeadId}, isDifferentHead: ${isDifferentHead})`);
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
                .update({ role_id: 3 })
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
                    dept_id: deptId
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
            .update({ head_id: headId || null })
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
                head_id
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
            .select('dept_id, dept_name')
            .eq('dept_id', deptId)
            .limit(1)
            .single();
            
        if (error) {
            if (error.code === 'PGRST116') return null; // No rows found
            throw error;
        }
        
        return data;
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
