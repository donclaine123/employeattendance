const { supabase } = require('./init');
const { logAuditEvent } = require('./utilities');

// ============================================================
// SESSION MANAGEMENT
// ============================================================

async function forceLogoutSession(sessionId) {
    try {
        // Step 1: Update user_sessions table to mark logout
        const { data, error } = await supabase
            .from('user_sessions')
            .update({ 
                logout_time: new Date().toISOString()
            })
            .eq('session_id', sessionId)
            .is('logout_time', null)
            .select('user_id')
            .single();
        
        if (error) {
            console.error('Error forcing logout session:', error);
            return null;
        }
        
        if (data && data.user_id) {
            // Step 2: Revoke all refresh tokens for this user to force immediate logout
            console.log(`[forceLogoutSession] Revoking all refresh tokens for user ${data.user_id}`);
            const { error: revokeError } = await supabase
                .from('refresh_tokens')
                .update({
                    revoked: true,
                    revoked_at: new Date().toISOString()
                })
                .eq('user_id', data.user_id)
                .eq('revoked', false);
            
            if (revokeError) {
                console.error('[forceLogoutSession] Error revoking refresh tokens:', revokeError);
                // Continue anyway - session is logged out even if token revocation fails
            } else {
                console.log(`[forceLogoutSession] Successfully revoked refresh tokens for user ${data.user_id}`);
            }
        }
        
        return data;
    } catch (err) {
        console.error('Exception in forceLogoutSession:', err);
        return null;
    }
}

// ============================================================
// REQUEST OPERATIONS
// ============================================================

async function getPendingRequests(userAuth, department = null) {
    try {
        const { role, id } = userAuth;
        
        console.log('[getPendingRequests] Starting query...');
        console.log('[getPendingRequests] User role:', role);
        console.log('[getPendingRequests] User ID:', id);
        console.log('[getPendingRequests] Department filter:', department);
        
        // Use LEFT joins so requests are returned even when related employee/department records are missing
        let query = supabase
            .from('requests')
            .select(`
                request_id,
                type,
                details,
                status,
                created_at,
                employees!left(
                    full_name,
                    departments!left(
                        dept_name,
                        head_id
                    )
                )
            `)
            .eq('status', 'pending')
            .order('created_at', { ascending: true });
        
        // Apply filtering: prioritize department parameter if provided
        if (department) {
            console.log('[getPendingRequests] Applying department filter from parameter:', department);
            query = query.ilike('employees.departments.dept_name', department);
        } else if (role === 'head_dept') {
            console.log('[getPendingRequests] Applying head_dept filter: head_id ==', id);
            query = query.eq('employees.departments.head_id', id);
        }
        
        const { data, error } = await query;
        
        console.log('[getPendingRequests] Supabase query error:', error);
        console.log('[getPendingRequests] Supabase query data count:', data?.length || 0);
        console.log('[getPendingRequests] Raw data:', data);
        
        if (error) {
            console.error('Error getting pending requests:', error);
            return null;
        }
        
        // Format response to match expected structure
        const formattedData = data.map(request => {
            const startDate = request.details?.start_date || request.details?.date;
            const endDate = request.details?.end_date || request.details?.date;
            const reason = request.details?.reason || request.details?.description;
            
            return {
                id: request.request_id,
                request_type: request.type,
                details: request.details,
                status: request.status,
                employee_name: request.employees.full_name,
                dept_name: request.employees.departments.dept_name,
                start_date: startDate,
                end_date: endDate,
                reason: reason,
                raw_details: request.details
            };
        });
        
        console.log('[getPendingRequests] Formatted data:', formattedData);
        return formattedData;
    } catch (err) {
        console.error('Exception in getPendingRequests:', err);
        return null;
    }
}

async function updateRequestStatus(requestId, status, approverId) {
    try {
        const { data, error } = await supabase
            .from('requests')
            .update({ 
                status: status,
                approved_by: approverId,
                updated_at: new Date().toISOString()
            })
            .eq('request_id', requestId)
            .eq('status', 'pending')
            .select()
            .single();
        
        if (error) {
            console.error('Error updating request status:', error);
            return null;
        }
        
        return data;
    } catch (err) {
        console.error('Exception in updateRequestStatus:', err);
        return null;
    }
}

async function approveRequestWithNotification(requestId, status, approverId, approverRole) {
    try {
        // If department head, check permission first
        if (approverRole === 'department_head') {
            const { data: permissionCheck, error: permError } = await supabase
                .from('requests')
                .select(`
                    *,
                    employees!inner(
                        dept_id,
                        departments!inner(head_id)
                    )
                `)
                .eq('request_id', requestId)
                .eq('employees.departments.head_id', approverId)
                .single();
            
            if (permError || !permissionCheck) {
                console.error('Permission check failed:', permError);
                throw new Error('Forbidden: You can only approve requests from your department.');
            }
        }

        // Update request status
        const { data: updatedRequest, error: updateError } = await supabase
            .from('requests')
            .update({ 
                status: status,
                approved_by: approverId,
                updated_at: new Date().toISOString()
            })
            .eq('request_id', requestId)
            .eq('status', 'pending')
            .select()
            .single();
        
        if (updateError || !updatedRequest) {
            console.error('Error updating request:', updateError);
            throw new Error('Request not found, already actioned, or you do not have permission.');
        }
        
        // Create notification
        const message = `Your ${updatedRequest.type} request (ID: ${updatedRequest.request_id}) has been ${status}.`;
        const { error: notifError } = await supabase
            .from('notifications')
            .insert({
                user_id: updatedRequest.employee_id,
                message: message,
                status: 'unread'
            });
        
        if (notifError) {
            console.error('Error creating notification:', notifError);
            // Don't fail the whole operation for notification error
        } else {
            console.log(`[notifications] Created notification for user ${updatedRequest.employee_id}`);
        }
        
        return updatedRequest;
    } catch (err) {
        console.error('Exception in approveRequestWithNotification:', err);
        throw err;
    }
}

async function approveRequestWithChecks(requestId, status, approverId, employeeId) {
    try {
        // Check if the request exists and the approver has permission
        const { data: checkData, error: checkError } = await supabase
            .from('requests')
            .select(`
                *,
                employees!inner(*)
            `)
            .eq('request_id', requestId)
            .eq('employees.employee_id', employeeId)
            .single();
        
        if (checkError || !checkData) {
            console.error('Error checking request permission:', checkError);
            return null;
        }
        
        // Update the request
        const { data, error } = await supabase
            .from('requests')
            .update({ 
                status: status,
                approved_by: approverId,
                updated_at: new Date().toISOString()
            })
            .eq('request_id', requestId)
            .select()
            .single();
        
        if (error) {
            console.error('Error approving request:', error);
            return null;
        }
        
        return data;
    } catch (err) {
        console.error('Exception in approveRequestWithChecks:', err);
        return null;
    }
}

// Create a new request
async function createRequest(employeeId, requestType, details) {
    try {
        const { data, error } = await supabase
            .from('requests')
            .insert({
                employee_id: employeeId,
                type: requestType,
                details: details,
                status: 'pending'
            })
            .select()
            .single();
        
        if (error) {
            console.error('Error creating request:', error);
            return null;
        }
        
        return data;
    } catch (err) {
        console.error('Exception in createRequest:', err);
        return null;
    }
}

module.exports = {
    // Sessions
    forceLogoutSession,
    // Requests
    getPendingRequests,
    updateRequestStatus,
    approveRequestWithNotification,
    approveRequestWithChecks,
    createRequest
};
