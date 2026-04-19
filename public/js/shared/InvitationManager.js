/**
 * Unified Invitation Manager
 * Handles invitations for HR, Department Head, and Superadmin roles with context-aware panels
 */
class InvitationManager {
    constructor(context = 'hr') {
        // Context can be 'hr', 'dept-head', or 'superadmin'
        this.context = context;
        this.invitations = [];
        this.filteredInvitations = [];
        this.roles = [];
        this.departments = [];
        this.statusFilter = 'active'; // 'active' or 'expired'
        this.pollingIntervals = new Map(); // Track polling timers per invitation
        this.hrEmployeeRoleId = null;
        this.departmentName = '';
        this.departmentId = null;
        this.instanceKey = this.context === 'dept-head' ? 'deptHeadInvitations' : 'invitationManager';
        this.invitationActionMenuBound = false;
        this.invitationLinkMenuBound = false;
        this.activeInvitationLinkMenuTrigger = null;
        this.currentInvitationLinks = null;
        this.invitationLinkCache = new Map();

        this.loadInvitationLinkCache();

        // Element references (context-aware lookups)
        let modal, form, inviteError, inviteSuccess, sendBtn;

        if (this.context === 'hr') {
            modal = document.getElementById('inviteModal');
            form = document.getElementById('inviteForm');
            inviteError = document.getElementById('inviteError');
            inviteSuccess = document.getElementById('inviteSuccess');
            sendBtn = document.getElementById('sendInviteBtn');
        } else if (this.context === 'dept-head') {
            modal = document.getElementById('inviteModal');
            form = document.getElementById('inviteForm');
            inviteError = document.getElementById('inviteError');
            inviteSuccess = document.getElementById('inviteSuccess');
            sendBtn = document.getElementById('sendInviteBtn');
        } else if (this.context === 'superadmin') {
            modal = document.getElementById('inviteModal');
            form = document.getElementById('inviteUserForm');
            inviteError = document.getElementById('inviteUserError');
            inviteSuccess = document.getElementById('inviteUserSuccess');
            sendBtn = document.getElementById('sendUserInviteBtn');
        }

        this.elements = {
            modal: modal,
            form: form,
            table: document.getElementById('invitationsTable'),
            tableContainer: document.getElementById('invitationsTable')?.closest('.table-container') || null,
            tableBody: document.getElementById('invitationsTableBody'),
            emptyState: document.getElementById('invitationsEmptyState'),
            roleFilter: document.getElementById('roleFilter') || null,
            departmentFilter: document.getElementById('departmentFilter') || null,
            statusBtnActive: document.getElementById('inviteStatusActive') || null,
            statusBtnExpired: document.getElementById('inviteStatusExpired') || null,
            departmentDisplay: document.getElementById('inviteDepartmentDisplay') || null,
            departmentIdInput: document.getElementById('inviteDepartmentId') || null,
            inviteError: inviteError,
            inviteSuccess: inviteSuccess,
            sendBtn: sendBtn
        };

        if (this.elements.table) {
            this.elements.table.classList.add('invitations-modern-table');
        }

        this.init();
    }

    async init() {
        console.log(`[InvitationManager] Initializing for context: ${this.context}`);

        // Skip if essential elements don't exist
        if (!this.elements.form) {
            console.warn('[InvitationManager] Form element not found, skipping initialization');
            return;
        }

        if (this.context === 'dept-head') {
            await this.loadDeptHeadContext();
        } else {
            await this.loadRolesAndDepartments();
        }

        this.setupFormHandler();
        this.setupInvitationActionMenu();
        this.setupInvitationLinkMenu();
        this.setupWebSocketListener();

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

    async loadDeptHeadContext() {
        try {
            if (typeof window.fetchUserProfile === 'function') {
                const user = await window.fetchUserProfile(true);
                if (user) {
                    this.departmentId = user.dept_id || user.department_id || user.department?.dept_id || null;
                    const departmentValue = user.department_name || user.department?.dept_name || user.department?.name || user.department || '';
                    this.departmentName = String(departmentValue || '').trim();
                }
            }
        } catch (error) {
            console.error('[InvitationManager] Error loading Department Head context:', error);
        }

        this.handleRoleChangeDeptHead();
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
        else if (this.context === 'dept-head') {
            return;
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

    normalizeInvitationRecord(invitation) {
        const acceptedAt = invitation.accepted_at || invitation.used_at || invitation.acceptedAt || null;
        const createdAt = invitation.created_at || invitation.createdAt || null;
        const createdBy = invitation.created_by || invitation.createdBy || invitation.invited_by || 'System';
        const deptName = invitation.dept_name || invitation.department_name || invitation.department?.dept_name || invitation.department?.name || null;
        const roleName = invitation.role_name || invitation.role || '';

        return {
            ...invitation,
            role_name: String(roleName || '').toLowerCase(),
            dept_name: deptName,
            created_by: createdBy,
            created_at: createdAt,
            accepted_at: acceptedAt,
            used_at: invitation.used_at || acceptedAt,
            used: Boolean(invitation.used || acceptedAt),
            metadata: invitation.metadata || {}
        };
    }

    loadInvitationLinkCache() {
        try {
            const storedCache = sessionStorage.getItem('invitationLinkCache');
            if (!storedCache) return;

            const parsedCache = JSON.parse(storedCache);
            Object.entries(parsedCache || {}).forEach(([key, value]) => {
                if (value && typeof value === 'object') {
                    this.invitationLinkCache.set(String(key), value);
                }
            });
        } catch (error) {
            console.warn('[InvitationManager] Failed to load invitation link cache:', error);
        }
    }

    saveInvitationLinkCache() {
        try {
            const serializableCache = Object.fromEntries(this.invitationLinkCache.entries());
            sessionStorage.setItem('invitationLinkCache', JSON.stringify(serializableCache));
        } catch (error) {
            console.warn('[InvitationManager] Failed to save invitation link cache:', error);
        }
    }

    cacheInvitationLinks(invitationId, links, email = null) {
        if (!invitationId || !links) return;

        this.invitationLinkCache.set(String(invitationId), links);

        if (email) {
            this.invitationLinkCache.set(`email:${String(email).toLowerCase()}`, links);
        }

        this.saveInvitationLinkCache();
    }

    getInvitationToken(invitation) {
        if (!invitation) return null;

        return invitation.metadata?.inviteToken
            || invitation.metadata?.invite_token
            || invitation.inviteToken
            || invitation.invite_token
            || invitation.token
            || null;
    }

    getInvitationLinksForInvitation(invitation) {
        if (!invitation) return null;

        const cachedById = this.invitationLinkCache.get(String(invitation.id));
        if (cachedById) return cachedById;

        const cachedByEmail = invitation.email
            ? this.invitationLinkCache.get(`email:${String(invitation.email).toLowerCase()}`)
            : null;
        if (cachedByEmail) return cachedByEmail;

        const token = this.getInvitationToken(invitation);
        if (!token) return null;

        return this.buildInvitationLinks(token);
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
        } else if (this.context === 'dept-head') {
            this.handleRoleChangeDeptHead();
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
            positionInput.disabled = false;
            positionInput.readOnly = false;
            if (positionInput.value === 'Department Head') {
                positionInput.value = '';
            }
        }
    }

    handleRoleChangeDeptHead() {
        if (this.elements.departmentDisplay) {
            this.elements.departmentDisplay.value = this.departmentName || 'Current Department';
        }

        if (this.elements.departmentIdInput) {
            this.elements.departmentIdInput.value = this.departmentId || '';
        }

        const positionGroup = document.getElementById('positionGroup');
        const positionInput = document.getElementById('invitePosition');

        if (positionGroup) positionGroup.style.display = 'block';
        if (positionInput) {
            positionInput.required = true;
            positionInput.disabled = false;
            positionInput.readOnly = false;
        }
    }

    handleRoleChangeSuperadmin() {
        const departmentGroup = document.getElementById('inviteUserDepartmentGroup');
        const departmentSelect = document.getElementById('inviteUserDepartment');
        const positionGroup = document.getElementById('positionGroup');
        const positionInput = document.getElementById('invitePosition');
        const selectedRole = document.querySelector('input[name="role_id"]:checked');
        const selectedRoleName = selectedRole ? this.getRoleNameById(selectedRole.value) : '';
        const requiresDepartment = ['employee', 'head_dept'].includes(selectedRoleName);
        const requiresPosition = selectedRoleName === 'employee';

        if (departmentGroup) {
            departmentGroup.style.display = requiresDepartment ? 'block' : 'none';
        }

        if (departmentSelect) {
            departmentSelect.disabled = !requiresDepartment;
            departmentSelect.required = requiresDepartment;
        }

        if (positionGroup) {
            positionGroup.style.display = requiresPosition ? 'block' : 'none';
        }

        if (positionInput) {
            positionInput.disabled = !requiresPosition;
            positionInput.required = requiresPosition;
            positionInput.readOnly = false;
        }
    }

    openCreateModal() {
        if (this.context === 'dept-head') {
            if (this.elements.modal) {
                this.elements.modal.style.display = 'flex';
                this.elements.modal.setAttribute('aria-hidden', 'false');
            }

            this.clearForm();
            this.hideMessages();
            this.handleRoleChangeDeptHead();
            return;
        }

        if (!this.elements.modal) return;
        this.elements.modal.style.display = this.context === 'superadmin' ? 'flex' : 'block';
        this.elements.modal.setAttribute('aria-hidden', 'false');
        this.clearForm();
        this.hideMessages();
        this.handleRoleChange(); // Apply role change rules on open
    }

    closeCreateModal() {
        if (this.context === 'dept-head') {
            if (this.elements.modal) {
                this.elements.modal.style.display = 'none';
                this.elements.modal.setAttribute('aria-hidden', 'true');
            }

            this.clearForm();
            return;
        }

        if (this.context === 'superadmin') {
            if (this.elements.modal) {
                this.elements.modal.style.display = 'none';
                this.elements.modal.setAttribute('aria-hidden', 'true');
            }
            this.clearForm();
            return;
        } else if (this.elements.modal) {
            this.elements.modal.style.display = 'none';
            this.elements.modal.setAttribute('aria-hidden', 'true');
        }
        this.clearForm();
    }

    clearForm() {
        if (this.elements.form) this.elements.form.reset();
        this.hideMessages();
        this.closeInvitationLinkMenu();
        this.currentInvitationLinks = null;

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
        } else if (this.context === 'dept-head') {
            const closeBtn = document.querySelector('#inviteModal .modal-footer .btn-secondary');
            if (closeBtn) {
                closeBtn.textContent = 'Cancel';
                closeBtn.className = 'btn-secondary';
            }
        }

        this.handleRoleChange();
    }

    isLocalInvitationEnvironment() {
        const hostname = window.location.hostname || '';
        return hostname === 'localhost'
            || hostname === '127.0.0.1'
            || hostname === '::1'
            || hostname.includes('local.');
    }

    getInvitationLinkProtocol() {
        const hostname = window.location.hostname || '';

        if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1') {
            return 'https:';
        }

        return window.location.protocol || 'https:';
    }

    buildInvitationLinks(token) {
        const safeToken = encodeURIComponent(String(token || '').trim());
        const protocol = this.getInvitationLinkProtocol();

        return {
            local: `${protocol}//local.employeeattendance.me/pages/accept-invite.html?token=${safeToken}`,
            cloud: `${protocol}//employeeattendance.me/pages/accept-invite.html?token=${safeToken}`
        };
    }

    getPreferredInvitationLinkType() {
        return this.isLocalInvitationEnvironment() ? 'local' : 'cloud';
    }

    setupInvitationLinkMenu() {
        if (this.invitationLinkMenuBound || !this.elements.inviteSuccess) return;

        this.elements.inviteSuccess.addEventListener('click', (event) => {
            const trigger = event.target.closest('[data-invitation-link-trigger]');
            if (!trigger) return;

            event.preventDefault();
            event.stopPropagation();

            if (!this.currentInvitationLinks) return;

            this.openInvitationLinkMenu(trigger);
        });

        this.invitationLinkMenuBound = true;
    }

    getInvitationLinkMenu(trigger) {
        let menu = document.getElementById('invitation-link-copy-menu');

        if (menu) {
            if (menu.parentElement !== document.body) {
                document.body.appendChild(menu);
            }
            return menu;
        }

        menu = document.createElement('div');
        menu.id = 'invitation-link-copy-menu';
        menu.className = 'user-action-menu';
        menu.hidden = true;
        menu.setAttribute('role', 'menu');
        document.body.appendChild(menu);

        menu.addEventListener('click', (event) => this.handleInvitationLinkMenuClick(event));
        return menu;
    }

    buildInvitationLinkMenuMarkup() {
        return `
            <button type="button" class="user-action-menu-item user-action-menu-item--edit" data-invitation-link-action="cloud" role="menuitem">
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                    <path d="M10 13a5 5 0 0 1 0-7l1-1a5 5 0 0 1 7 7l-1 1"></path>
                    <path d="M14 11a5 5 0 0 1 0 7l-1 1a5 5 0 0 1-7-7l1-1"></path>
                </svg>
                <span>Copy cloud link</span>
            </button>
            <button type="button" class="user-action-menu-item user-action-menu-item--success" data-invitation-link-action="local" role="menuitem">
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                    <path d="M10 13a5 5 0 0 1 0-7l1-1a5 5 0 0 1 7 7l-1 1"></path>
                    <path d="M14 11a5 5 0 0 1 0 7l-1 1a5 5 0 0 1-7-7l1-1"></path>
                </svg>
                <span>Copy local link</span>
            </button>
        `;
    }

    positionInvitationLinkMenu(menu, trigger) {
        menu.style.position = 'fixed';
        this.positionInvitationActionMenu(menu, trigger);
        menu.style.zIndex = '9200';
    }

    openInvitationLinkMenu(trigger) {
        const menu = this.getInvitationLinkMenu(trigger);

        this.closeInvitationActionMenu();
        this.closeInvitationLinkMenu();

        menu.innerHTML = this.buildInvitationLinkMenuMarkup();
        menu.hidden = false;
        menu.style.display = 'flex';
        menu.style.visibility = 'hidden';
        menu.style.opacity = '0';

        this.activeInvitationLinkMenuTrigger = trigger;
        trigger.setAttribute('aria-expanded', 'true');

        this.positionInvitationLinkMenu(menu, trigger);

        menu.style.visibility = 'visible';
        menu.style.opacity = '1';
    }

    closeInvitationLinkMenu() {
        const menu = document.getElementById('invitation-link-copy-menu');
        if (menu) {
            menu.hidden = true;
            menu.style.display = 'none';
            menu.style.visibility = '';
            menu.style.opacity = '';
            menu.style.top = '';
            menu.style.right = '';
            menu.style.left = '';
            menu.style.position = '';
            menu.style.zIndex = '';
            menu.innerHTML = '';
        }

        if (this.activeInvitationLinkMenuTrigger) {
            this.activeInvitationLinkMenuTrigger.setAttribute('aria-expanded', 'false');
            this.activeInvitationLinkMenuTrigger = null;
        }
    }

    async copyToClipboard(text) {
        if (!text) return false;

        try {
            if (navigator.clipboard?.writeText) {
                await navigator.clipboard.writeText(text);
                return true;
            }
        } catch (error) {
            console.warn('[InvitationManager] Clipboard API copy failed:', error);
        }

        try {
            const textarea = document.createElement('textarea');
            textarea.value = text;
            textarea.setAttribute('readonly', 'true');
            textarea.style.position = 'fixed';
            textarea.style.top = '-9999px';
            textarea.style.opacity = '0';
            document.body.appendChild(textarea);
            textarea.select();
            const copied = document.execCommand('copy');
            textarea.remove();
            return copied;
        } catch (error) {
            console.warn('[InvitationManager] Fallback clipboard copy failed:', error);
            return false;
        }
    }

    async handleInvitationLinkMenuClick(event) {
        const actionButton = event.target.closest('[data-invitation-link-action]');
        if (!actionButton) return;

        event.preventDefault();
        event.stopPropagation();

        const action = actionButton.getAttribute('data-invitation-link-action');
        const links = this.currentInvitationLinks || {};
        const link = action === 'local' ? links.local : links.cloud;

        this.closeInvitationLinkMenu();

        if (!link) {
            this.showToast('Invitation link is unavailable', 'error');
            return;
        }

        const copied = await this.copyToClipboard(link);
        if (copied) {
            this.showToast(action === 'local' ? 'Local invite link copied' : 'Production invite link copied', 'success');
        } else {
            this.showToast('Unable to copy the invitation link', 'error');
        }
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
            : this.context === 'dept-head'
                ? null
                : formData.get('role_id');
        const selectedRoleName = this.context === 'superadmin'
            ? this.getRoleNameById(selectedRoleId)
            : '';

        // Email validation
        if (!email.endsWith('@gmail.com')) {
            this.showError('Only @gmail.com email addresses are allowed');
            return;
        }

        // Department Head validations
        if (this.context === 'dept-head') {
            if (!this.departmentName) {
                this.showError('Department information is unavailable. Please refresh the page.');
                return;
            }

            if (!formData.get('position') || !formData.get('position').trim()) {
                this.showError('Position is required for employee invitations');
                return;
            }
        } else if (this.context === 'hr') {
            if (!formData.get('position') || !formData.get('position').trim()) {
                this.showError('Position is required for employee invitations');
                return;
            }
        } else if (this.context === 'superadmin') {
            const needsDepartment = ['employee', 'head_dept'].includes(selectedRoleName);
            const needsPosition = selectedRoleName === 'employee';
            const departmentId = formData.get('dept_id');

            if (needsDepartment && !departmentId) {
                this.showError('Department is required for employee and department head invitations');
                return;
            }

            if (needsPosition && !formData.get('position')?.trim()) {
                this.showError('Position is required for employee invitations');
                return;
            }
        }

        const roleId = parseInt(selectedRoleId, 10);
        if (this.context !== 'dept-head' && !Number.isInteger(roleId)) {
            this.showError('Role configuration is missing');
            return;
        }

        const data = {
            email: email,
            expires_in_hours: parseInt(formData.get('expires_in_hours')),
            position: formData.get('position') ? formData.get('position').trim() : null
        };

        if (this.context !== 'dept-head') {
            data.role_id = roleId;
            data.dept_id = formData.get('dept_id') ? parseInt(formData.get('dept_id')) : null;
        } else {
            data.dept_id = formData.get('dept_id') ? parseInt(formData.get('dept_id')) : null;
        }

        console.log('[InvitationManager] Sending invitation data:', data);

        this.elements.sendBtn.disabled = true;
        this.elements.sendBtn.textContent = 'Sending...';
        this.hideMessages();

        try {
            const endpoint = this.context === 'dept-head' ? '/departmenthead/invitations' : '/admin/invitations';
            const response = await window.AppApi.apiFetch(endpoint, {
                method: 'POST',
                body: JSON.stringify(data)
            });

            console.log('[InvitationManager] Invitation creation response:', response);

            const emailStatus = response.email_status || response.data?.email_status || null;

            // Store email_status from response
            if (emailStatus) {
                console.log('[InvitationManager] Email status from response:', emailStatus);
            } else {
                console.warn('[InvitationManager] No email_status in response');
            }

            if (response.data && response.data.token) {
                this.currentInvitationLinks = this.buildInvitationLinks(response.data.token);
                this.cacheInvitationLinks(response.data.id, this.currentInvitationLinks, response.data.email || email);
                const inviteLink = this.currentInvitationLinks[this.getPreferredInvitationLinkType()];
                const statusTone = emailStatus
                    ? (emailStatus.success ? 'success' : 'error')
                    : 'info';
                const statusStyles = {
                    success: {
                        color: '#155724',
                        background: 'rgba(40, 167, 69, 0.1)',
                        border: '1px solid rgba(40, 167, 69, 0.2)'
                    },
                    error: {
                        color: '#842029',
                        background: 'rgba(220, 53, 69, 0.1)',
                        border: '1px solid rgba(220, 53, 69, 0.25)'
                    },
                    info: {
                        color: 'var(--text-primary)',
                        background: 'rgba(13, 110, 253, 0.08)',
                        border: '1px solid rgba(13, 110, 253, 0.2)'
                    }
                }[statusTone];
                const successMessage = emailStatus
                    ? (emailStatus.success
                        ? `Invitation created and email sent to ${email}.`
                        : `Invitation created, but email delivery failed${emailStatus.error ? `: ${emailStatus.error}` : ''}. Copy and share the link below:`)
                    : 'Invitation created successfully. If delivery cannot be confirmed, you can manually copy and share this link:';

                if (this.elements.inviteSuccess) {
                    this.elements.inviteSuccess.innerHTML = `
                        <div style="margin-bottom: 8px; font-weight: 600; color: ${statusStyles.color};">✓ ${successMessage}</div>
                        <div style="font-size: 0.9em; color: var(--text-muted); margin-bottom: 8px; line-height: 1.4;">
                            Use the menu below to copy the local or cloud link:
                        </div>
                        <div style="display: flex; gap: 6px; align-items: center;">
                            <input type="text" readonly id="generatedInviteLink" value="${inviteLink}" style="flex: 1; min-width: 0; padding: 6px 8px; border: 1px solid var(--border-color); border-radius: 4px; background: var(--bg-hover); color: var(--text-primary); font-size: 0.85em; cursor: text;" onclick="this.select()">
                            <div class="action-menu">
                                <button type="button" class="action-menu-trigger" data-invitation-link-trigger="true" aria-haspopup="menu" aria-expanded="false" aria-controls="invitation-link-copy-menu" title="Copy invitation link options" aria-label="Copy invitation link options">
                                    <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                                        <circle cx="12" cy="5" r="1.5"></circle>
                                        <circle cx="12" cy="12" r="1.5"></circle>
                                        <circle cx="12" cy="19" r="1.5"></circle>
                                    </svg>
                                </button>
                            </div>
                        </div>
                    `;
                    this.elements.inviteSuccess.style.display = 'block';
                    this.elements.inviteSuccess.style.textAlign = 'left';
                    this.elements.inviteSuccess.style.padding = '12px';
                    this.elements.inviteSuccess.style.background = statusStyles.background;
                    this.elements.inviteSuccess.style.border = statusStyles.border;
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
                } else if (this.context === 'dept-head') {
                    closeBtn = document.querySelector('#inviteModal .modal-footer .btn-secondary');
                } else {
                    closeBtn = document.getElementById('cancelInviteBtn');
                }
                if (closeBtn) {
                    closeBtn.textContent = (this.context === 'dept-head' || this.context === 'superadmin') ? 'Close' : 'Back to Access Control';
                    closeBtn.className = (this.context === 'dept-head' || this.context === 'superadmin') ? 'btn-secondary' : 'btn-primary';
                }

                if (this.context === 'dept-head') {
                    window.dispatchEvent(new CustomEvent('dept-head:employee-invitation-created', {
                        detail: {
                            email,
                            invitation: response.data
                        }
                    }));
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
            this.elements.sendBtn.textContent = this.context === 'hr' ? 'Send Invitation' : 'Generate Registration Link';
        }
    }

    async refreshInvitations() {
        if (!this.elements.tableBody) return;

        try {
            const endpoint = this.context === 'dept-head' ? '/departmenthead/invitations' : '/admin/invitations';
            const response = await window.AppApi.apiFetch(`${endpoint}?_page=1&_limit=20`);
            const rawInvitations = Array.isArray(response.invitations)
                ? response.invitations
                : Array.isArray(response.data)
                    ? response.data
                    : [];
            this.invitations = rawInvitations.map((invitation) => this.normalizeInvitationRecord(invitation));
            this.invitations.forEach((invitation) => {
                const token = this.getInvitationToken(invitation);
                if (token) {
                    this.cacheInvitationLinks(invitation.id, this.buildInvitationLinks(token), invitation.email);
                }
            });
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
            const acceptedAt = invite.accepted_at || invite.used_at || null;
            const isExpired = Boolean(invite.expires_at) && new Date(invite.expires_at) < new Date();
            const isAccepted = Boolean(acceptedAt);

            // Status filtering (active vs expired)
            let statusMatch = true;
            if (this.statusFilter === 'active') {
                // Active: accepted invitations, or invitations that have not expired yet
                statusMatch = isAccepted || !isExpired;
            } else if (this.statusFilter === 'expired') {
                // Expired: not accepted and already past the expiry time
                statusMatch = !isAccepted && isExpired;
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

        this.closeInvitationActionMenu();

        if (this.filteredInvitations.length === 0) {
            if (this.elements.tableContainer) this.elements.tableContainer.style.display = 'none';
            if (this.elements.table) this.elements.table.style.display = 'none';
            if (this.elements.emptyState) this.elements.emptyState.style.display = 'flex';
            return;
        }

        if (this.elements.tableContainer) this.elements.tableContainer.style.display = '';
        if (this.elements.table) this.elements.table.style.display = 'table';
        if (this.elements.emptyState) this.elements.emptyState.style.display = 'none';

        const tbody = this.elements.tableBody;
        tbody.innerHTML = '';

        console.log('[InvitationManager] Rendering table with invitations:', this.filteredInvitations);

        this.filteredInvitations.forEach(invite => {
            const row = document.createElement('tr');
            const acceptedAt = invite.accepted_at || invite.used_at || null;

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
            if (acceptedAt) {
                statusBadge = '<span class="badge-accepted">accepted</span>';
            } else if (new Date(invite.expires_at) < new Date()) {
                statusBadge = '<span class="badge-expired">expired</span>';
            }

            row.innerHTML = `
                <td>${invite.email}</td>
                <td>${this.formatInvitationRole(invite.role_name)}</td>
                <td>${invite.dept_name || 'N/A'}</td>
                <td>${invite.created_by || 'Manager'}</td>
                <td>${getTimeAgo(invite.created_at)}</td>
                <td>${statusBadge}</td>
                <td>
                    <div class="action-menu">
                        <button type="button" class="action-menu-trigger" aria-haspopup="menu" aria-expanded="false" aria-controls="superadmin-invitation-action-menu" title="Open invitation actions" aria-label="Open invitation actions" data-invitation-id="${invite.id}">
                            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                                <circle cx="12" cy="5" r="1.5"></circle>
                                <circle cx="12" cy="12" r="1.5"></circle>
                                <circle cx="12" cy="19" r="1.5"></circle>
                            </svg>
                        </button>
                    </div>
                </td>
            `;

            row.setAttribute('data-invitation-id', invite.id);
            tbody.appendChild(row);
        });
    }

    setupInvitationActionMenu() {
        if (this.invitationActionMenuBound || !this.elements.tableBody) return;

        this.elements.tableBody.addEventListener('click', (event) => {
            const trigger = event.target.closest('.action-menu-trigger');
            if (!trigger) return;

            event.preventDefault();
            event.stopPropagation();

            const invitationId = trigger.getAttribute('data-invitation-id');
            const invitation = this.invitations.find(item => String(item.id) === String(invitationId)) || null;

            if (!invitation) {
                this.closeInvitationActionMenu();
                return;
            }

            this.openInvitationActionMenu(trigger, invitation);
        });

        if (!document.body.dataset.invitationActionMenuBound) {
            document.addEventListener('click', (event) => {
                if (event.target.closest('.action-menu') || event.target.closest('.action-menu-trigger') || event.target.closest('[data-invitation-link-trigger]')) return;
                this.closeInvitationActionMenu();
                this.closeInvitationLinkMenu();
            });

            document.addEventListener('keydown', (event) => {
                if (event.key === 'Escape') {
                    this.closeInvitationActionMenu();
                    this.closeInvitationLinkMenu();
                }
            });

            window.addEventListener('resize', () => {
                this.closeInvitationActionMenu();
                this.closeInvitationLinkMenu();
            });
            document.addEventListener('scroll', () => {
                this.closeInvitationActionMenu();
                this.closeInvitationLinkMenu();
            }, true);

            document.body.dataset.invitationActionMenuBound = 'true';
        }

        this.invitationActionMenuBound = true;
    }

    getInvitationActionMenu() {
        let menu = document.getElementById('superadmin-invitation-action-menu');
        if (menu) return menu;

        menu = document.createElement('div');
        menu.id = 'superadmin-invitation-action-menu';
        menu.className = 'user-action-menu';
        menu.hidden = true;
        menu.setAttribute('role', 'menu');
        document.body.appendChild(menu);

        menu.addEventListener('click', (event) => this.handleInvitationActionMenuClick(event));
        return menu;
    }

    buildInvitationActionMenuMarkup() {
        return `
            <button type="button" class="user-action-menu-item user-action-menu-item--edit" data-invitation-action="copy-local" role="menuitem">
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                    <path d="M10 13a5 5 0 0 1 0-7l1-1a5 5 0 0 1 7 7l-1 1"></path>
                    <path d="M14 11a5 5 0 0 1 0 7l-1 1a5 5 0 0 1-7-7l1-1"></path>
                </svg>
                <span>Copy local link</span>
            </button>
            <button type="button" class="user-action-menu-item user-action-menu-item--edit" data-invitation-action="copy-cloud" role="menuitem">
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                    <path d="M10 13a5 5 0 0 1 0-7l1-1a5 5 0 0 1 7 7l-1 1"></path>
                    <path d="M14 11a5 5 0 0 1 0 7l-1 1a5 5 0 0 1-7-7l1-1"></path>
                </svg>
                <span>Copy cloud link</span>
            </button>
            <button type="button" class="user-action-menu-item user-action-menu-item--success" data-invitation-action="resend" role="menuitem">
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                    <path d="M21 3v7h-7"></path>
                    <path d="M21 10a9 9 0 1 0 2.64 6.36"></path>
                </svg>
                <span>Resend invitation</span>
            </button>
            <button type="button" class="user-action-menu-item user-action-menu-item--danger" data-invitation-action="cancel" role="menuitem">
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                    <path d="M3 6h18"></path>
                    <path d="M8 6V4h8v2"></path>
                    <path d="M19 6l-1 13a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"></path>
                    <path d="M10 11v5"></path>
                    <path d="M14 11v5"></path>
                </svg>
                <span>Cancel invitation</span>
            </button>
        `;
    }

    positionInvitationActionMenu(menu, trigger) {
        const rect = trigger.getBoundingClientRect();
        const menuRect = menu.getBoundingClientRect();
        const openAbove = window.innerHeight - rect.bottom < menuRect.height + 16;
        const top = openAbove ? Math.max(12, rect.top - menuRect.height - 8) : rect.bottom + 8;

        menu.style.top = `${top}px`;
        menu.style.right = `${Math.max(12, window.innerWidth - rect.right)}px`;
        menu.style.left = 'auto';
    }

    openInvitationActionMenu(trigger, invitation) {
        const menu = this.getInvitationActionMenu();
        const isSameTrigger = this.activeInvitationActionMenuTrigger === trigger && !menu.hidden;

        if (isSameTrigger) {
            this.closeInvitationActionMenu();
            return;
        }

        this.closeInvitationActionMenu();
        this.closeInvitationLinkMenu();

        menu.innerHTML = this.buildInvitationActionMenuMarkup();
        menu.dataset.invitationId = String(invitation.id || '');
        menu.hidden = false;
        menu.style.display = 'flex';
        menu.style.visibility = 'hidden';
        menu.style.opacity = '0';

        this.activeInvitationActionMenuTrigger = trigger;
        trigger.setAttribute('aria-expanded', 'true');

        this.positionInvitationActionMenu(menu, trigger);

        menu.style.visibility = 'visible';
        menu.style.opacity = '1';
    }

    closeInvitationActionMenu() {
        const menu = document.getElementById('superadmin-invitation-action-menu');
        if (menu) {
            menu.hidden = true;
            menu.style.display = 'none';
            menu.style.visibility = '';
            menu.style.opacity = '';
            menu.style.top = '';
            menu.style.right = '';
            menu.style.left = '';
            menu.dataset.invitationId = '';
            menu.innerHTML = '';
        }

        if (this.activeInvitationActionMenuTrigger) {
            this.activeInvitationActionMenuTrigger.setAttribute('aria-expanded', 'false');
            this.activeInvitationActionMenuTrigger = null;
        }
    }

    handleInvitationActionMenuClick(event) {
        const actionButton = event.target.closest('[data-invitation-action]');
        if (!actionButton) return;

        event.preventDefault();
        event.stopPropagation();

        const menu = actionButton.closest('.user-action-menu');
        const invitationId = menu?.dataset.invitationId;
        const action = actionButton.getAttribute('data-invitation-action');
        const invitation = this.invitations.find(item => String(item.id) === String(invitationId)) || null;

        this.closeInvitationActionMenu();

        if (!invitationId || !action) return;

        if (action === 'copy-local' || action === 'copy-cloud') {
            this.copyInvitationLink(invitation, action === 'copy-local' ? 'local' : 'cloud');
            return;
        }

        if (action === 'resend') {
            this.resendInvitation(invitationId);
            return;
        }

        if (action === 'cancel') {
            this.cancelInvitation(invitationId);
        }
    }

    async copyInvitationLink(invitation, linkType) {
        const links = this.getInvitationLinksForInvitation(invitation);
        if (!links) {
            this.showToast('Invitation link is unavailable. Resend the invitation to generate a fresh link.', 'error');
            return;
        }

        const link = linkType === 'local' ? links.local : links.cloud;
        if (!link) {
            this.showToast('Invitation link is unavailable', 'error');
            return;
        }

        const copied = await this.copyToClipboard(link);
        if (copied) {
            this.showToast(linkType === 'local' ? 'Local invite link copied' : 'Production invite link copied', 'success');
        } else {
            this.showToast('Unable to copy the invitation link', 'error');
        }
    }

    async resendInvitation(invitationId) {
        const confirmed = await this.showInvitationActionDialog('resend', invitationId);
        if (!confirmed) return;

        try {
            const endpoint = this.context === 'dept-head' ? `/departmenthead/invitations/${invitationId}/resend` : `/admin/invitations/${invitationId}/resend`;
            const response = await window.AppApi.apiFetch(endpoint, {
                method: 'POST',
                body: JSON.stringify({ expires_in_hours: 24 })
            });

            const emailStatus = response.email_status || response.data?.email_status || null;
            if (emailStatus && !emailStatus.success) {
                this.showToast(`Invitation resent, but email delivery failed${emailStatus.error ? `: ${emailStatus.error}` : ''}`, 'error');
            } else {
                this.showToast('Invitation resent successfully', 'success');
            }

            const resendToken = response.token || response.data?.token || null;
            if (resendToken) {
                this.cacheInvitationLinks(invitationId, this.buildInvitationLinks(resendToken));
            }
            this.refreshInvitations();
        } catch (error) {
            this.showToast(error.message || 'Failed to resend invitation', 'error');
        }
    }

    async cancelInvitation(invitationId) {
        const confirmed = await this.showInvitationActionDialog('cancel', invitationId);
        if (!confirmed) return;

        try {
            const endpoint = this.context === 'dept-head' ? `/departmenthead/invitations/${invitationId}` : `/admin/invitations/${invitationId}`;
            await window.AppApi.apiFetch(endpoint, {
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
                <td colspan="7" class="error-row">
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

    formatInvitationRole(role) {
        if (!role) return 'User';

        const roleMap = {
            hr: 'Monitoring',
            superadmin: 'Super Admin',
            head_dept: 'Department Head',
            employee: 'Employee'
        };

        return roleMap[String(role).toLowerCase()] || role;
    }

    getInvitationState(invitation) {
        if (!invitation) return 'Unknown';

        if (invitation.accepted_at || invitation.acceptedAt) {
            return 'Accepted';
        }

        if (invitation.expires_at && new Date(invitation.expires_at) < new Date()) {
            return 'Expired';
        }

        return 'Pending';
    }

    buildInvitationSummary(invitation) {
        return {
            email: invitation?.email || 'Selected invitation',
            role: this.formatInvitationRole(invitation?.role_name),
            department: invitation?.dept_name || 'No department',
            status: this.getInvitationState(invitation)
        };
    }

    ensureInvitationConfirmSummary(modal) {
        const body = modal.querySelector('.modal-body');
        if (!body) return null;

        let summaryCard = modal.querySelector('#confirm-summary-card');
        if (summaryCard) return summaryCard;

        summaryCard = document.createElement('div');
        summaryCard.id = 'confirm-summary-card';
        summaryCard.className = 'confirm-summary-card';
        summaryCard.hidden = true;
        summaryCard.innerHTML = `
            <div class="confirm-summary-icon" aria-hidden="true"></div>
            <div class="confirm-summary-copy">
                <span class="confirm-summary-eyebrow"></span>
                <strong class="confirm-summary-title"></strong>
                <div class="confirm-summary-grid">
                    <div class="confirm-summary-field">
                        <span class="confirm-summary-field-label">Role</span>
                        <strong class="confirm-summary-field-value confirm-summary-role"></strong>
                    </div>
                    <div class="confirm-summary-field">
                        <span class="confirm-summary-field-label">Department</span>
                        <strong class="confirm-summary-field-value confirm-summary-department"></strong>
                    </div>
                    <div class="confirm-summary-field">
                        <span class="confirm-summary-field-label">Status</span>
                        <strong class="confirm-summary-field-value confirm-summary-status"></strong>
                    </div>
                </div>
            </div>
        `;

        const message = modal.querySelector('#confirm-message');
        if (message && message.parentNode === body) {
            body.insertBefore(summaryCard, message);
        } else {
            body.insertBefore(summaryCard, body.firstChild);
        }

        return summaryCard;
    }

    async showInvitationActionDialog(action, invitationId) {
        const invitation = this.invitations.find(item => String(item.id) === String(invitationId)) || null;
        const modal = document.getElementById('confirm-modal');
        const titleEl = document.getElementById('confirm-title');
        const messageEl = document.getElementById('confirm-message');
        const closeBtn = document.getElementById('confirm-close-btn');
        const cancelBtn = document.getElementById('confirm-cancel-btn');
        const okBtn = document.getElementById('confirm-ok-btn');

        if (!modal || !titleEl || !messageEl || !closeBtn || !cancelBtn || !okBtn) {
            console.warn('[InvitationManager] Confirmation modal not found for invitation action');
            this.showToast('Confirmation dialog is unavailable', 'error');
            return false;
        }

        const config = action === 'resend'
            ? {
                variant: 'info',
                title: 'Resend invitation?',
                message: 'A fresh registration link will be sent and the current 24-hour window will restart.',
                actionLabel: 'Resend invitation',
                eyebrow: 'Resend selected invite',
                icon: `
                    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                        <path d="M21 3v7h-7"></path>
                        <path d="M21 10a9 9 0 1 0 2.64 6.36"></path>
                    </svg>
                `
            }
            : {
                variant: 'danger',
                title: 'Cancel invitation?',
                message: 'This will invalidate the current link immediately and remove the invitation from the active list.',
                actionLabel: 'Cancel invitation',
                eyebrow: 'Remove selected invite',
                icon: `
                    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                        <path d="M3 6h18"></path>
                        <path d="M8 6V4h8v2"></path>
                        <path d="M19 6l-1 13a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"></path>
                        <path d="M10 11v5"></path>
                        <path d="M14 11v5"></path>
                    </svg>
                `
            };

        const summary = this.buildInvitationSummary(invitation);
        const summaryCard = this.ensureInvitationConfirmSummary(modal);
        const summaryIcon = summaryCard?.querySelector('.confirm-summary-icon');
        const summaryEyebrow = summaryCard?.querySelector('.confirm-summary-eyebrow');
        const summaryTitle = summaryCard?.querySelector('.confirm-summary-title');
        const summaryRole = summaryCard?.querySelector('.confirm-summary-role');
        const summaryDepartment = summaryCard?.querySelector('.confirm-summary-department');
        const summaryStatus = summaryCard?.querySelector('.confirm-summary-status');

        modal.dataset.confirmVariant = config.variant;
        titleEl.textContent = config.title;
        messageEl.textContent = config.message;
        okBtn.textContent = config.actionLabel;
        okBtn.dataset.confirmVariant = config.variant;
        okBtn.classList.add('confirm-action-btn', `confirm-action-btn--${config.variant}`);
        cancelBtn.classList.add('confirm-action-btn', 'confirm-action-btn--neutral');

        if (summaryCard && summaryIcon && summaryEyebrow && summaryTitle && summaryRole && summaryDepartment && summaryStatus) {
            summaryCard.hidden = false;
            summaryCard.dataset.confirmVariant = config.variant;
            summaryCard.querySelector('.confirm-summary-copy').dataset.confirmVariant = config.variant;
            summaryCard.style.setProperty('--confirm-accent', config.variant === 'danger' ? 'var(--red-primary)' : 'var(--accent-primary)');
            summaryIcon.innerHTML = config.icon;
            summaryEyebrow.textContent = config.eyebrow;
            summaryTitle.textContent = summary.email;
            summaryRole.textContent = summary.role;
            summaryDepartment.textContent = summary.department;
            summaryStatus.textContent = summary.status;
            summaryStatus.dataset.state = String(summary.status || '').toLowerCase();
        }

        modal.style.display = 'flex';

        return new Promise((resolve) => {
            const cleanup = (result) => {
                modal.style.display = 'none';
                modal.dataset.confirmVariant = '';
                okBtn.textContent = 'Confirm';
                okBtn.removeAttribute('data-confirm-variant');
                okBtn.classList.remove('confirm-action-btn', 'confirm-action-btn--danger', 'confirm-action-btn--info');
                cancelBtn.classList.remove('confirm-action-btn', 'confirm-action-btn--neutral');

                if (summaryCard) {
                    summaryCard.hidden = true;
                    summaryCard.dataset.confirmVariant = '';
                    summaryCard.style.removeProperty('--confirm-accent');
                }

                closeBtn.removeEventListener('click', handleCancel);
                cancelBtn.removeEventListener('click', handleCancel);
                okBtn.removeEventListener('click', handleConfirm);
                modal.removeEventListener('click', handleBackdrop);
                document.removeEventListener('keydown', handleEscape);

                resolve(result);
            };

            const handleConfirm = () => cleanup(true);
            const handleCancel = () => cleanup(false);
            const handleBackdrop = (event) => {
                if (event.target === modal) {
                    handleCancel();
                }
            };
            const handleEscape = (event) => {
                if (event.key === 'Escape') {
                    handleCancel();
                }
            };

            closeBtn.addEventListener('click', handleCancel);
            cancelBtn.addEventListener('click', handleCancel);
            okBtn.addEventListener('click', handleConfirm);
            modal.addEventListener('click', handleBackdrop);
            document.addEventListener('keydown', handleEscape);
            okBtn.focus?.();
        });
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

window.InvitationManager = InvitationManager;
