/**
 * Unified Invitation Manager
 * Handles invitations for both HR and Superadmin roles with context-aware modals
 */
class InvitationManager {
    constructor(context = 'hr') {
        // Context can be 'hr' or 'superadmin'
        this.context = context;
        this.invitations = [];
        this.filteredInvitations = [];
        this.roles = [];
        this.departments = [];
        this.statusFilter = 'active'; // 'active' or 'expired'
        this.pollingIntervals = new Map(); // Track polling timers per invitation
        this.hrEmployeeRoleId = null;

        // Element references (context-aware lookups)
        let modal, form, inviteError, inviteSuccess, sendBtn;

        if (this.context === 'hr') {
            modal = document.getElementById('inviteModal');
            form = document.getElementById('inviteForm');
            inviteError = document.getElementById('inviteError');
            inviteSuccess = document.getElementById('inviteSuccess');
            sendBtn = document.getElementById('sendInviteBtn');
        } else if (this.context === 'superadmin') {
            modal = document.getElementById('section-invite'); // Use subpage instead of modal wrap
            form = document.getElementById('inviteUserForm');
            inviteError = document.getElementById('inviteUserError');
            inviteSuccess = document.getElementById('inviteUserSuccess');
            sendBtn = document.getElementById('sendUserInviteBtn');
        }

        this.elements = {
            modal: modal,
            form: form,
            table: document.getElementById('invitationsTable'),
            tableBody: document.getElementById('invitationsTableBody'),
            emptyState: document.getElementById('invitationsEmptyState'),
            roleFilter: document.getElementById('roleFilter') || null,
            departmentFilter: document.getElementById('departmentFilter') || null,
            statusBtnActive: document.getElementById('inviteStatusActive') || null,
            statusBtnExpired: document.getElementById('inviteStatusExpired') || null,
            inviteError: inviteError,
            inviteSuccess: inviteSuccess,
            sendBtn: sendBtn
        };

        this.init();
    }

    async init() {
        console.log(`[InvitationManager] Initializing for context: ${this.context}`);

        // Skip if essential elements don't exist
        if (!this.elements.form) {
            console.warn('[InvitationManager] Form element not found, skipping initialization');
            return;
        }

        await this.loadRolesAndDepartments();
        this.setupFormHandler();

        // Attach filter listeners if present
        if (this.elements.roleFilter) {
            this.elements.roleFilter.addEventListener('change', () => this.applyFilters());
        }
        if (this.elements.departmentFilter) {
            this.elements.departmentFilter.addEventListener('change', () => this.applyFilters());
        }

        // Initial refresh of invitations if table exists
        if (this.elements.tableBody) {
            this.refreshInvitations();
        }
    }

    async loadRolesAndDepartments() {
        try {
            const rolesResponse = await window.AppApi.apiFetch('/roles');
            this.roles = rolesResponse.data || rolesResponse;
            this.populateRoleSelectors();

            try {
                // Use HR endpoint which is accessible by both HR and Superadmin
                const deptsResponse = await window.AppApi.apiFetch('/hr/departments');
                this.departments = deptsResponse.data || deptsResponse;
                this.populateDepartmentSelectors();
            } catch (deptError) {
                console.error('[InvitationManager] Error fetching departments:', deptError);
                // Fallback or empty departments list
            }

        } catch (error) {
            console.error('[InvitationManager] Error loading roles:', error);
        }
    }

    populateRoleSelectors() {
        // For HR context, lock the role to Employee
        if (this.context === 'hr') {
            const employeeRole = this.roles.find(role => role.role_name.toLowerCase() === 'employee');
            const roleDisplay = document.getElementById('inviteRoleDisplay');
            const roleInput = document.getElementById('inviteRoleId');

            this.hrEmployeeRoleId = employeeRole ? String(employeeRole.role_id) : null;

            if (roleInput) {
                const roleValue = this.hrEmployeeRoleId || '';
                roleInput.value = roleValue;
                roleInput.defaultValue = roleValue;
            }

            if (roleDisplay) {
                roleDisplay.textContent = 'Employee';
            }
        }
        // For Superadmin context, use radio buttons
        else if (this.context === 'superadmin') {
            const roleRadioMap = [
                { selector: 'input[id="inviteUserRoleEmployee"]', roleName: 'employee' },
                { selector: 'input[id="inviteUserRoleHeadDept"]', roleName: 'head_dept' },
                { selector: 'input[id="inviteUserRole"]', roleName: 'hr' },
                { selector: 'input[id="inviteUserRoleSuperadmin"]', roleName: 'superadmin' }
            ];

            roleRadioMap.forEach(({ selector, roleName }) => {
                const radio = document.querySelector(selector);
                const role = this.roles.find(item => item.role_name.toLowerCase() === roleName);

                if (radio && role) {
                    radio.value = role.role_id;
                }
            });
        }
    }

    getRoleNameById(roleId) {
        if (!roleId) return '';

        const role = this.roles.find(item => String(item.role_id) === String(roleId));
        return role?.role_name?.toLowerCase() || '';
    }

    populateDepartmentSelectors() {
        const deptSelect = document.getElementById('inviteDepartment') || document.getElementById('inviteUserDepartment');
        const filterSelect = this.elements.departmentFilter;

        if (deptSelect) {
            deptSelect.innerHTML = '<option value="">Select department</option>';

            this.departments.forEach(dept => {
                const option = document.createElement('option');
                option.value = dept.dept_id;
                option.textContent = dept.dept_name;
                deptSelect.appendChild(option);
            });
        }

        if (filterSelect) {
            filterSelect.innerHTML = '<option value="">All Departments</option>';

            this.departments.forEach(dept => {
                const option = document.createElement('option');
                option.value = dept.dept_name.toLowerCase();
                option.textContent = dept.dept_name;
                filterSelect.appendChild(option);
            });
        }
    }

    handleRoleChange() {
        // HR-specific role change handling
        if (this.context === 'hr') {
            this.handleRoleChangeHR();
        } else if (this.context === 'superadmin') {
            this.handleRoleChangeSuperadmin();
        }
    }

    handleRoleChangeHR() {
        const positionGroup = document.getElementById('positionGroup');
        const positionInput = document.getElementById('invitePosition');
        const departmentGroup = document.getElementById('departmentGroup');

        if (departmentGroup) departmentGroup.style.display = 'block';
        if (positionGroup) positionGroup.style.display = 'block';
        if (positionInput) {
            positionInput.required = true;
            positionInput.readOnly = false;
            if (positionInput.value === 'Department Head') {
                positionInput.value = '';
            }
        }
    }

    handleRoleChangeSuperadmin() {
        const departmentGroup = document.getElementById('inviteUserDepartmentGroup');
        const departmentSelect = document.getElementById('inviteUserDepartment');
        const selectedRole = document.querySelector('input[name="role_id"]:checked');
        const selectedRoleName = selectedRole ? this.getRoleNameById(selectedRole.value) : '';
        const requiresDepartment = ['employee', 'head_dept'].includes(selectedRoleName);

        if (departmentGroup) {
            departmentGroup.style.display = requiresDepartment ? 'block' : 'none';
        }

        if (departmentSelect) {
            departmentSelect.disabled = !requiresDepartment;
            departmentSelect.required = requiresDepartment;
        }
    }

    openCreateModal() {
        if (!this.elements.modal) return;
        this.elements.modal.style.display = 'block';
        this.clearForm();
        this.hideMessages();
        this.handleRoleChange(); // Apply role change rules on open
    }

    closeCreateModal() {
        if (this.context === 'superadmin') {
            if (window.switchToSection) window.switchToSection('users');
        } else if (this.elements.modal) {
            this.elements.modal.style.display = 'none';
        }
        this.clearForm();
    }

    clearForm() {
        if (this.elements.form) this.elements.form.reset();
        this.hideMessages();

        if (this.elements.sendBtn) {
            this.elements.sendBtn.style.display = '';
            this.elements.sendBtn.disabled = false;
            this.elements.sendBtn.textContent = this.context === 'hr' ? 'Send Invitation' : 'Generate Registration Link';
        }

        if (this.context === 'superadmin') {
            const closeBtn = document.getElementById('cancelInviteBtn');
            if (closeBtn) {
                closeBtn.textContent = 'Cancel';
                closeBtn.className = 'btn-secondary';
            }
        } else if (this.context === 'hr') {
            const closeBtn = document.querySelector('#inviteModal .modal-footer button:not(#sendInviteBtn)');
            if (closeBtn) {
                closeBtn.textContent = 'Cancel';
                closeBtn.className = 'btn-secondary';
            }
        }

        this.handleRoleChange();
    }

    setupFormHandler() {
        if (!this.elements.form) return;

        this.elements.form.addEventListener('submit', async (e) => {
            e.preventDefault();
            await this.handleCreateInvitation();
        });
    }

    async handleCreateInvitation() {
        const formData = new FormData(this.elements.form);
        const email = formData.get('email').trim().toLowerCase();

        console.log('[InvitationManager] Creating invitation for:', email);

        const selectedRoleId = this.context === 'hr'
            ? (this.hrEmployeeRoleId || formData.get('role_id'))
            : formData.get('role_id');
        const selectedRoleName = this.context === 'superadmin'
            ? this.getRoleNameById(selectedRoleId)
            : '';

        // Email validation
        if (!email.endsWith('@gmail.com')) {
            this.showError('Only @gmail.com email addresses are allowed');
            return;
        }

        // HR-specific validations
        if (this.context === 'hr') {
            if (!formData.get('position') || !formData.get('position').trim()) {
                this.showError('Position is required for employees');
                return;
            }
        } else if (this.context === 'superadmin') {
            const needsDepartment = ['employee', 'head_dept'].includes(selectedRoleName);
            const departmentId = formData.get('dept_id');

            if (needsDepartment && !departmentId) {
                this.showError('Department is required for employee and department head invitations');
                return;
            }
        }

        const roleId = parseInt(selectedRoleId, 10);
        if (!Number.isInteger(roleId)) {
            this.showError('Role configuration is missing');
            return;
        }

        const data = {
            email: email,
            role_id: roleId,
            dept_id: formData.get('dept_id') ? parseInt(formData.get('dept_id')) : null,
            expires_in_hours: parseInt(formData.get('expires_in_hours')),
            position: formData.get('position') ? formData.get('position').trim() : null
        };

        console.log('[InvitationManager] Sending invitation data:', data);

        this.elements.sendBtn.disabled = true;
        this.elements.sendBtn.textContent = 'Sending...';
        this.hideMessages();

        try {
            const response = await window.AppApi.apiFetch('/admin/invitations', {
                method: 'POST',
                body: JSON.stringify(data)
            });

            console.log('[InvitationManager] Invitation creation response:', response);

            // Store email_status from response
            if (response.email_status) {
                console.log('[InvitationManager] Email status from response:', response.email_status);
            } else {
                console.warn('[InvitationManager] No email_status in response');
            }

            if (response.data && response.data.token) {
                const inviteLink = `${window.location.origin}/pages/accept-invite.html?token=${response.data.token}`;
                if (this.elements.inviteSuccess) {
                    this.elements.inviteSuccess.innerHTML = `
                        <div style="margin-bottom: 8px; font-weight: 600; color: #155724;">✓ Invitation created successfully!</div>
                        <div style="font-size: 0.9em; color: var(--text-muted); margin-bottom: 8px; line-height: 1.4;">
                            An email is being sent. If the system is offline, you can manually copy and share this link:
                        </div>
                        <div style="display: flex; gap: 6px;">
                            <input type="text" readonly id="generatedInviteLink" value="${inviteLink}" style="flex: 1; min-width: 0; padding: 6px 8px; border: 1px solid var(--border-color); border-radius: 4px; background: var(--bg-hover); color: var(--text-primary); font-size: 0.85em; cursor: text;" onclick="this.select()">
                            <button type="button" class="btn-secondary" onclick="navigator.clipboard.writeText(document.getElementById('generatedInviteLink').value).then(() => { this.textContent='Copied!'; this.style.backgroundColor='#28a745'; this.style.color='white'; this.style.borderColor='#28a745'; setTimeout(()=>{this.textContent='Copy'; this.style.backgroundColor=''; this.style.color=''; this.style.borderColor='';}, 2000); })" style="padding: 6px 12px; font-size: 0.85em; white-space: nowrap;">
                                Copy
                            </button>
                        </div>
                    `;
                    this.elements.inviteSuccess.style.display = 'block';
                    this.elements.inviteSuccess.style.textAlign = 'left';
                    this.elements.inviteSuccess.style.padding = '12px';
                    this.elements.inviteSuccess.style.background = 'rgba(40, 167, 69, 0.1)';
                    this.elements.inviteSuccess.style.border = '1px solid rgba(40, 167, 69, 0.2)';
                    this.elements.inviteSuccess.style.borderRadius = 'var(--radius-md)';
                }
                if (this.elements.inviteError) {
                    this.elements.inviteError.style.display = 'none';
                }
                
                // Hide send button, update close button
                this.elements.sendBtn.style.display = 'none';
                let closeBtn = null;
                if (this.context === 'hr') {
                    closeBtn = document.querySelector('#inviteModal .modal-footer .btn-secondary');
                } else {
                    closeBtn = document.getElementById('cancelInviteBtn');
                }
                if (closeBtn) {
                    closeBtn.textContent = 'Back to Access Control';
                    closeBtn.className = 'btn-primary';
                }

                this.refreshInvitations();
            } else {
                this.showSuccess('Invitation created successfully!');
                setTimeout(() => {
                    this.closeCreateModal();
                    this.refreshInvitations();
                }, 1500);
            }

        } catch (error) {
            this.showError(error.message || 'Failed to send invitation');
        } finally {
            this.elements.sendBtn.disabled = false;
            this.elements.sendBtn.textContent = this.context === 'hr' ? 'Send Invitation' : 'Send Invitation';
        }
    }

    async refreshInvitations() {
        if (!this.elements.tableBody) return;

        try {
            const response = await window.AppApi.apiFetch('/admin/invitations');
            this.invitations = response.invitations || [];
            console.log('[InvitationManager] Loaded invitations:', this.invitations);
            this.applyFilters();
        } catch (error) {
            console.error('[InvitationManager] Error loading invitations:', error);
            this.showTableError('Failed to load invitations');
        }
    }

    applyFilters() {
        const roleEl = this.elements.roleFilter;
        const deptEl = this.elements.departmentFilter;

        const roleFilter = roleEl && roleEl.value ? roleEl.value.toLowerCase() : '';
        const deptFilter = deptEl && deptEl.value ? deptEl.value.toLowerCase() : '';

        this.filteredInvitations = this.invitations.filter(invite => {
            // Role and department filtering
            const roleMatch = !roleFilter || (invite.role_name && invite.role_name.toLowerCase() === roleFilter);
            const deptMatch = !deptFilter || (invite.dept_name && invite.dept_name.toLowerCase() === deptFilter);

            // Status filtering (active vs expired)
            let statusMatch = true;
            if (this.statusFilter === 'active') {
                // Active: either accepted or not yet expired
                statusMatch = invite.accepted_at || new Date(invite.expires_at) >= new Date();
            } else if (this.statusFilter === 'expired') {
                // Expired: not accepted AND has expired
                statusMatch = !invite.accepted_at && new Date(invite.expires_at) < new Date();
            }

            return roleMatch && deptMatch && statusMatch;
        });

        this.renderInvitationsTable();
    }

    setStatusFilter(status) {
        this.statusFilter = status;
        console.log(`[InvitationManager] Status filter changed to: ${status}`);
        this.applyFilters();
    }

    renderInvitationsTable() {
        if (!this.elements.tableBody) return;

        if (this.filteredInvitations.length === 0) {
            if (this.elements.table) this.elements.table.style.display = 'none';
            if (this.elements.emptyState) this.elements.emptyState.style.display = 'flex';
            return;
        }

        if (this.elements.table) this.elements.table.style.display = 'table';
        if (this.elements.emptyState) this.elements.emptyState.style.display = 'none';

        const tbody = this.elements.tableBody;
        tbody.innerHTML = '';

        console.log('[InvitationManager] Rendering table with invitations:', this.filteredInvitations);

        this.filteredInvitations.forEach(invite => {
            const row = document.createElement('tr');

            const getTimeAgo = (dateStr) => {
                const date = new Date(dateStr);
                const now = new Date();
                const seconds = Math.floor((now - date) / 1000);

                if (seconds < 3600) {
                    const minutes = Math.floor(seconds / 60);
                    return `${minutes} minute${minutes !== 1 ? 's' : ''} ago`;
                } else if (seconds < 86400) {
                    const hours = Math.floor(seconds / 3600);
                    return `${hours} hour${hours !== 1 ? 's' : ''} ago`;
                } else {
                    const days = Math.floor(seconds / 86400);
                    return `${days} day${days !== 1 ? 's' : ''} ago`;
                }
            };

            let statusBadge = '<span class="badge-pending">pending</span>';
            if (invite.accepted_at) {
                statusBadge = '<span class="badge-accepted">accepted</span>';
            } else if (new Date(invite.expires_at) < new Date()) {
                statusBadge = '<span class="badge-expired">expired</span>';
            }

            // Helper to format role names
            const formatRole = (role) => {
                if (!role) return 'User';
                const map = {
                    'hr': 'Monitoring',
                    'superadmin': 'Super Admin',
                    'head_dept': 'Department Head',
                    'employee': 'Employee'
                };
                return map[role.toLowerCase()] || role;
            };

            row.innerHTML = `
                <td>${invite.email}</td>
                <td>${formatRole(invite.role_name)}</td>
                <td>${invite.dept_name || 'N/A'}</td>
                <td>${invite.created_by || 'Manager'}</td>
                <td>${getTimeAgo(invite.created_at)}</td>
                <td>${statusBadge}</td>
                <td>
                    <div class="action-buttons">
                        <button class="btn-resend" onclick="window.invitationManager.resendInvitation('${invite.id}')">Resend</button>
                        <button class="btn-cancel-invite" onclick="window.invitationManager.cancelInvitation('${invite.id}')" title="Cancel invitation">
                            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <path d="M18 6L6 18"></path>
                                <path d="M6 6l12 12"></path>
                            </svg>
                        </button>
                    </div>
                </td>
            `;

            row.setAttribute('data-invitation-id', invite.id);
            tbody.appendChild(row);
        });
    }

    async resendInvitation(invitationId) {
        if (!confirm('Are you sure you want to resend this invitation?')) return;

        try {
            await window.AppApi.apiFetch(`/admin/invitations/${invitationId}/resend`, {
                method: 'POST',
                body: JSON.stringify({ expires_in_hours: 24 })
            });

            this.showToast('Invitation resent successfully', 'success');
            this.refreshInvitations();
        } catch (error) {
            this.showToast(error.message || 'Failed to resend invitation', 'error');
        }
    }

    async cancelInvitation(invitationId) {
        if (!confirm('Are you sure you want to cancel this invitation? This cannot be undone.')) return;

        try {
            await window.AppApi.apiFetch(`/admin/invitations/${invitationId}`, {
                method: 'DELETE'
            });

            this.showToast('Invitation cancelled successfully', 'success');
            this.refreshInvitations();
        } catch (error) {
            this.showToast(error.message || 'Failed to cancel invitation', 'error');
        }
    }

    showError(message) {
        if (this.elements.inviteError) {
            this.elements.inviteError.textContent = message;
            this.elements.inviteError.style.display = 'block';
        }
        if (this.elements.inviteSuccess) {
            this.elements.inviteSuccess.style.display = 'none';
        }
    }

    showSuccess(message) {
        if (this.elements.inviteSuccess) {
            this.elements.inviteSuccess.textContent = message;
            this.elements.inviteSuccess.style.display = 'block';
        }
        if (this.elements.inviteError) {
            this.elements.inviteError.style.display = 'none';
        }
    }

    hideMessages() {
        if (this.elements.inviteError) this.elements.inviteError.style.display = 'none';
        if (this.elements.inviteSuccess) this.elements.inviteSuccess.style.display = 'none';
    }

    showTableError(message) {
        if (!this.elements.tableBody) return;

        this.elements.tableBody.innerHTML = `
            <tr>
                <td colspan="8" class="error-row">
                    <svg width="16" height="16" style="margin-right: 6px;" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <circle cx="12" cy="12" r="10"></circle>
                        <line x1="15" y1="9" x2="9" y2="15"></line>
                        <line x1="9" y1="9" x2="15" y2="15"></line>
                    </svg>
                    ${message}
                </td>
            </tr>
        `;
    }

    showToast(message, type = 'info') {
        const toast = document.createElement('div');
        toast.className = `toast toast-${type}`;
        toast.textContent = message;
        toast.style.cssText = `
            position: fixed;
            top: 20px;
            right: 20px;
            padding: 12px 20px;
            background: ${type === 'success' ? '#28a745' : type === 'error' ? '#dc3545' : '#007bff'};
            color: var(--bg-primary);
            border-radius: 6px;
            z-index: 10000;
            font-weight: 500;
        `;

        document.body.appendChild(toast);

        setTimeout(() => {
            toast.remove();
        }, 3000);
    }

    // Method to load invitations when tab becomes active
    async loadInvitations() {
        await this.refreshInvitations();
    }

    setupWebSocketListener() {
        // Check if WebSocket is available (optional feature for real-time updates)
        if (window.socket && window.socket.connected) {
            window.socket.on('invitation:email_status_updated', (data) => {
                if (!data.invitationId) return;

                // Update invitation data
                const index = this.invitations.findIndex(i => i.id === data.invitationId);
                if (index !== -1) {
                    this.invitations[index] = {
                        ...this.invitations[index],
                        email_status: data.email_status
                    };

                    // Update row
                    this.updateInvitationRow(data.invitationId, this.invitations[index]);

                    // Stop polling if sent
                    if (data.email_status?.sent) {
                        const interval = this.pollingIntervals.get(data.invitationId);
                        if (interval) {
                            clearInterval(interval);
                            this.pollingIntervals.delete(data.invitationId);
                        }
                    }
                }
            });
        }
    }
}
