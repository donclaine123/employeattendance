const { supabase, bcrypt } = require('./init');
const { logAuditEvent } = require('./utilities');

// Create a new invitation 
async function createInvitation(invitationData, creatorId) {
    if (!supabase) return null;
    
    try {
        const { email, role_id, dept_id, token_hash, expires_at, metadata } = invitationData;
        
        console.log('[createInvitation] Creating invitation with creatorId:', creatorId);
        console.log('[createInvitation] Invitation data:', invitationData);
        
        // Helper: check user email exists
        const checkUserEmailExists = async (email) => {
            try {
                const { data, error } = await supabase
                    .from('users')
                    .select('user_id')
                    .eq('username', email)
                    .limit(1)
                    .single();
                    
                if (error) {
                    if (error.code === 'PGRST116') return false;
                    throw error;
                }
                
                return !!data;
            } catch (error) {
                console.error('[supabase] Check user email exists error:', error.message);
                return null;
            }
        };
        
        // Check if user already exists with this email
        const existingUser = await checkUserEmailExists(email);
        if (existingUser) {
            return { success: false, error: 'A user with this email already exists.' };
        }
        
        // RESTRAINT: Cancel any existing pending invitations for this email
        // This ensures only one active invitation per email address
        const { data: existingInvitations, error: fetchError } = await supabase
            .from('invitations')
            .select('id')
            .eq('email', email.toLowerCase().trim())
            .eq('used', false)
            .gt('expires_at', new Date().toISOString());
        
        if (fetchError) {
            console.error('[createInvitation] Error checking existing invitations:', fetchError);
            // Continue anyway - don't block on this error
        } else if (existingInvitations && existingInvitations.length > 0) {
            // Delete previous pending invitations for this email
            console.log(`[createInvitation] Canceling ${existingInvitations.length} previous invitation(s) for ${email}`);
            for (const inv of existingInvitations) {
                const { error: deleteError } = await supabase
                    .from('invitations')
                    .delete()
                    .eq('id', inv.id);
                
                if (deleteError) {
                    console.warn(`[createInvitation] Failed to delete old invitation ${inv.id}:`, deleteError);
                } else {
                    console.log(`[createInvitation] Cancelled previous invitation: ${inv.id}`);
                    // Log this cancellation
                    await logAuditEvent(creatorId, 'INVITATION_SUPERSEDED', {
                        oldInvitationId: inv.id,
                        email: email,
                        reason: 'New invitation created for same email'
                    });
                }
            }
        }
        
        // Create invitation record
        const { data, error } = await supabase
            .from('invitations')
            .insert({
                email: email.toLowerCase().trim(),
                role_id,
                dept_id,
                token_hash,
                expires_at,
                created_by: creatorId,
                metadata: metadata || {}
            })
            .select(`
                id,
                email,
                role_id,
                dept_id,
                expires_at,
                created_at,
                created_by,
                roles!inner(role_name),
                departments(dept_name)
            `)
            .single();
        
        console.log('[createInvitation] Insert result:', { data, error });
        
        if (error) {
            console.error('[supabase] Create invitation error:', error);
            if (error.code === '23505') { // Unique constraint violation
                return { success: false, error: 'An invitation for this email is already pending.' };
            }
            return { success: false, error: 'Failed to create invitation.' };
        }
        
        // Log audit event
        await logAuditEvent(creatorId, 'INVITATION_CREATED', {
            invitationId: data.id,
            email: data.email,
            role: data.roles.role_name,
            department: data.departments?.dept_name,
            expiresAt: data.expires_at
        });
        
        return {
            success: true,
            invitation: {
                id: data.id,
                email: data.email,
                role_name: data.roles.role_name,
                dept_name: data.departments?.dept_name,
                expires_at: data.expires_at,
                created_at: data.created_at
            }
        };
        
    } catch (error) {
        console.error('[supabase] Exception in createInvitation:', error.message);
        return { success: false, error: 'Failed to create invitation.' };
    }
}

// Verify invitation token and get invitation details
async function verifyInvitationToken(tokenHash) {
    if (!supabase) return null;
    
    try {
        const { data, error } = await supabase
            .from('invitations')
            .select(`
                id,
                email,
                role_id,
                dept_id,
                expires_at,
                used,
                used_at,
                created_by,
                roles!inner(role_name),
                departments(dept_name)
            `)
            .eq('token_hash', tokenHash)
            .single();
        
        if (error) {
            if (error.code === 'PGRST116') {
                return { valid: false, reason: 'Invalid invitation token' };
            }
            throw error;
        }
        
        // Check if already used
        if (data.used) {
            return { 
                valid: false, 
                reason: 'This invitation has already been used',
                used_at: data.used_at
            };
        }
        
        // Check if expired
        const now = new Date();
        const expiresAt = new Date(data.expires_at);
        if (now > expiresAt) {
            return { 
                valid: false, 
                reason: 'This invitation has expired',
                expires_at: data.expires_at
            };
        }
        
        // Fetch creator details separately to ensure we get the right user
        const { data: creatorData, error: creatorError } = await supabase
            .from('users')
            .select(`
                user_id,
                username
            `)
            .eq('user_id', data.created_by)
            .single();
        
        if (creatorError) {
            console.error('[verifyInvitationToken] Error fetching creator:', creatorError);
        }
        
        // Try to find creator's name by email (username field)
        let creatorName = 'System';
        
        if (creatorData?.username) {
            // Try to find employee by email (username is the email)
            const { data: empData } = await supabase
                .from('employees')
                .select('first_name, last_name')
                .eq('email', creatorData.username)
                .single();
            
            if (empData) {
                creatorName = `${empData.first_name} ${empData.last_name}`;
            } else {
                // Fallback to username if no employee found
                creatorName = creatorData.username;
            }
        }
        
        console.log('[verifyInvitationToken] Creator name resolved as:', creatorName, 'from user:', data.created_by);
            
        return {
            valid: true,
            invitation: {
                id: data.id,
                email: data.email,
                role_id: data.role_id,
                role_name: data.roles.role_name,
                dept_id: data.dept_id,
                dept_name: data.departments?.dept_name,
                expires_at: data.expires_at,
                created_by: data.created_by,
                invited_by: creatorName,
                metadata: data.metadata
            }
        };
        
    } catch (error) {
        console.error('[supabase] Verify invitation token error:', error.message);
        return { valid: false, reason: 'Token verification failed' };
    }
}

// Accept invitation and create user account
async function acceptInvitation(tokenHash, userData) {
    if (!supabase) return null;
    
    try {
        const { first_name, last_name, password, pinCode } = userData;
        
        // First verify the token
        const verification = await verifyInvitationToken(tokenHash);
        if (!verification.valid) {
            return { success: false, error: verification.reason };
        }
        
        const invitation = verification.invitation;
        
        // Hash the password
        const hashedPassword = await bcrypt.hash(password, 10);
        
        // Start transaction by creating user first
        const { data: newUser, error: userError } = await supabase
            .from('users')
            .insert({
                username: invitation.email,
                password_hash: hashedPassword,
                role_id: invitation.role_id,
                status: 'active', // Set as active immediately, no first login required
                first_login: false, // No password change required
                created_by: invitation.created_by // Set the user who sent the invitation
            })
            .select('user_id')
            .single();
        
        if (userError) {
            console.error('[supabase] Create user error:', userError);
            if (userError.code === '23505') {
                return { success: false, error: 'A user with this email already exists.' };
            }
            return { success: false, error: 'Failed to create user account.' };
        }
        
        // Get position from invitation metadata or set based on role
        let position = invitation.metadata?.position;
        
        // Auto-set position based on role if not already provided
        if (!position) {
            switch (invitation.role_name.toLowerCase()) {
                case 'superadmin':
                    position = 'SuperAdmin';
                    break;
                case 'hr':
                    position = 'Monitoring';
                    break;
                case 'head_dept':
                    position = 'Department Head';
                    break;
                default:
                    position = null; // Will be set later for regular employees
            }
        }
        
        // Create employee record with PIN code
        const { error: employeeError } = await supabase
            .from('employees')
            .insert({
                employee_id: newUser.user_id,
                first_name,
                last_name,
                email: invitation.email,
                dept_id: invitation.dept_id,
                hire_date: new Date().toISOString().split('T')[0],
                position: position,
                status: 'active', // Employee status active immediately
                pin_hash: pinCode, // Save the hashed PIN code
                created_by: invitation.created_by // Set the user who sent the invitation
            });
        
        if (employeeError) {
            console.error('[supabase] Create employee error:', employeeError);
            // TODO: Should rollback user creation in a real transaction
            return { success: false, error: 'Failed to create employee record.' };
        }
        
        // If this is a department head role, update the departments table
        if (invitation.role_name && invitation.role_name.toLowerCase() === 'head_dept' && invitation.dept_id) {
            const { data: updateData, error: deptError } = await supabase
                .from('departments')
                .update({
                    head_id: newUser.user_id
                })
                .eq('dept_id', invitation.dept_id)
                .select();
            
            if (deptError) {
                console.error('[supabase] Update department head error:', deptError);
                console.warn('[supabase] Department head assignment failed, but user/employee records created');
                // Don't return error here - user account was created successfully
            }
        }
        
        // Mark invitation as used
        const { error: inviteError } = await supabase
            .from('invitations')
            .update({
                used: true,
                used_by: newUser.user_id,
                used_at: new Date().toISOString()
            })
            .eq('id', invitation.id);
        
        if (inviteError) {
            console.warn('[supabase] Failed to mark invitation as used:', inviteError.message);
        }
        
        // Log audit event
        await logAuditEvent(newUser.user_id, 'INVITATION_ACCEPTED', {
            invitationId: invitation.id,
            email: invitation.email,
            role: invitation.role_name,
            department: invitation.dept_name
        });
        
        return {
            success: true,
            user: {
                user_id: newUser.user_id,
                email: invitation.email,
                role: invitation.role_name,
                department: invitation.dept_name,
                first_name,
                last_name
            }
        };
        
    } catch (error) {
        console.error('[supabase] Exception in acceptInvitation:', error.message);
        return { success: false, error: 'Failed to accept invitation.' };
    }
}

// Get pending invitations (for admin view)
async function getPendingInvitations(filters = {}) {
    if (!supabase) return null;
    
    try {
        const { role, department, limit = 50, offset = 0 } = filters;
        
        let query = supabase
            .from('invitations')
            .select(`
                id,
                email,
                expires_at,
                created_at,
                created_by,
                roles!inner(role_name),
                departments(dept_name),
                users!invitations_created_by_fkey(
                    user_id,
                    username
                )
            `)
            .eq('used', false)
            .gt('expires_at', new Date().toISOString())
            .order('created_at', { ascending: false })
            .range(parseInt(offset), parseInt(offset) + parseInt(limit) - 1);
        
        if (role && role !== 'all') {
            query = query.eq('roles.role_name', role);
        }
        
        if (department && department !== 'all') {
            query = query.eq('departments.dept_name', department);
        }
        
        const { data, error } = await query;
        if (error) throw error;

        // Now fetch employee names for the creators
        const invitations = await Promise.all(data.map(async (invite) => {
            let createdBy = 'System';
            
            // Try to find employee by email (username is the email)
            if (invite.users?.username) {
                const { data: empData } = await supabase
                    .from('employees')
                    .select('first_name, last_name')
                    .eq('email', invite.users.username)
                    .single();
                
                if (empData) {
                    createdBy = `${empData.first_name} ${empData.last_name}`;
                } else {
                    // Fallback to username if no employee found
                    createdBy = invite.users.username;
                }
            }
            
            return {
                id: invite.id,
                email: invite.email,
                role_name: invite.roles.role_name,
                dept_name: invite.departments?.dept_name,
                created_by: createdBy,
                created_at: invite.created_at,
                expires_at: invite.expires_at
            };
        }));
        
        return invitations;
        
    } catch (error) {
        console.error('[supabase] Get pending invitations error:', error.message);
        return null;
    }
}

// Get single invitation by ID
async function getInvitationById(invitationId) {
    if (!supabase) return null;
    
    try {
        const { data: invite, error } = await supabase
            .from('invitations')
            .select(`
                id,
                email,
                expires_at,
                created_at,
                created_by,
                roles!inner(role_name),
                departments(dept_name),
                users!invitations_created_by_fkey(
                    user_id,
                    username
                )
            `)
            .eq('id', invitationId)
            .single();
        
        if (error) throw error;
        if (!invite) return null;

        let createdBy = 'System';
        if (invite.users?.username) {
            const { data: empData } = await supabase
                .from('employees')
                .select('first_name, last_name')
                .eq('email', invite.users.username)
                .single();
            
            if (empData) {
                createdBy = `${empData.first_name} ${empData.last_name}`;
            } else {
                createdBy = invite.users.username;
            }
        }
        
        return {
            id: invite.id,
            email: invite.email,
            role_name: invite.roles.role_name,
            dept_name: invite.departments?.dept_name,
            created_by: createdBy,
            created_at: invite.created_at,
            expires_at: invite.expires_at
        };
        
    } catch (error) {
        console.error('[supabase] Get invitation by ID error:', error.message);
        return null;
    }
}

// Resend invitation (create new token, invalidate old)
async function resendInvitation(invitationId, newTokenHash, newExpiresAt, adminId) {
    if (!supabase) return null;
    
    try {
        // Update invitation with new token and expiry
        const { data, error } = await supabase
            .from('invitations')
            .update({
                token_hash: newTokenHash,
                expires_at: newExpiresAt,
                created_at: new Date().toISOString() // Reset created time for new token
            })
            .eq('id', invitationId)
            .eq('used', false) // Only update unused invitations
            .select(`
                id,
                email,
                expires_at,
                roles!inner(role_name),
                departments(dept_name)
            `)
            .single();
        
        if (error) {
            if (error.code === 'PGRST116') {
                return { success: false, error: 'Invitation not found or already used.' };
            }
            throw error;
        }
        
        // Log audit event
        await logAuditEvent(adminId, 'INVITATION_RESENT', {
            invitationId: data.id,
            email: data.email,
            role: data.roles.role_name,
            department: data.departments?.dept_name,
            newExpiresAt: data.expires_at
        });
        
        return {
            success: true,
            invitation: {
                id: data.id,
                email: data.email,
                role_name: data.roles.role_name,
                dept_name: data.departments?.dept_name,
                expires_at: data.expires_at
            }
        };
        
    } catch (error) {
        console.error('[supabase] Resend invitation error:', error.message);
        return { success: false, error: 'Failed to resend invitation.' };
    }
}

// Cancel/revoke invitation
async function cancelInvitation(invitationId, adminId) {
    if (!supabase) return null;
    
    try {
        const { data, error } = await supabase
            .from('invitations')
            .delete()
            .eq('id', invitationId)
            .eq('used', false) // Only delete unused invitations
            .select(`
                id,
                email,
                roles!inner(role_name),
                departments(dept_name)
            `)
            .single();
        
        if (error) {
            if (error.code === 'PGRST116') {
                return { success: false, error: 'Invitation not found or already used.' };
            }
            throw error;
        }
        
        // Log audit event
        await logAuditEvent(adminId, 'INVITATION_CANCELLED', {
            invitationId: data.id,
            email: data.email,
            role: data.roles.role_name,
            department: data.departments?.dept_name
        });
        
        return { success: true };
        
    } catch (error) {
        console.error('[supabase] Cancel invitation error:', error.message);
        return { success: false, error: 'Failed to cancel invitation.' };
    }
}

module.exports = {
    createInvitation,
    verifyInvitationToken,
    acceptInvitation,
    getPendingInvitations,
    getInvitationById,
    resendInvitation,
    cancelInvitation
};
