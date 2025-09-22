// SuperAdmin Dashboard Logic
(function() {
    const API_URL = window.API_URL || '/api';

    // --- State for User Management ---
    let userCurrentPage = 1;
    let userCurrentSearch = '';
    let userCurrentRole = 'all';
    const usersPerPage = 10;
    let userTotalCount = 0;
    let isFetchingUsers = false;

    function escapeHtml(s) {
        return (s || '').toString().replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }

    // Helper: set role options depending on mode (add vs edit)
    function setRoleOptions(selectEl, mode) {
        if (!selectEl) return;
        const opts = mode === 'add'
            ? [
                { v: 'hr', text: 'HR' },
                { v: 'superadmin', text: 'Super Admin' }
              ]
            : [
                { v: 'employee', text: 'Employee' },
                { v: 'head_dept', text: 'Department Head' },
                { v: 'hr', text: 'HR' },
                { v: 'superadmin', text: 'Super Admin' }
              ];
        selectEl.innerHTML = opts.map(o => `<option value="${o.v}">${o.text}</option>`).join('');
    }

    // --- User Management Functions ---
    async function fetchUsers(page = 1, search = '', role = 'all') {
        if (isFetchingUsers) return;
        isFetchingUsers = true;

        const token = sessionStorage.getItem('workline_token');
        if (!token) {
            console.error('No auth token found.');
            isFetchingUsers = false;
            return [];
        }

        const params = new URLSearchParams({
            _page: page,
            _limit: usersPerPage,
            q: search,
            role: role
        });

        try {
            const response = await fetch(`${API_URL}/admin/users?${params.toString()}`, {
                headers: { 'Authorization': `Bearer ${token}` }
            });

            if (!response.ok) {
                console.error('Failed to fetch users:', response.statusText);
                return [];
            }
            
            userTotalCount = parseInt(response.headers.get('X-Total-Count') || '0', 10);
            return await response.json();
        } catch (e) {
            console.error('Error fetching users:', e);
            return [];
        } finally {
            isFetchingUsers = false;
        }
    }

    const userCache = new Map();

    function renderUsers(users, append = false) {
        const tableBody = document.getElementById('user-management-tbody');
        const loadMoreBtn = document.getElementById('load-more-users-btn');

        if (!append) {
            tableBody.innerHTML = '';
        }

        if (!users || users.length === 0 && !append) {
            tableBody.innerHTML = '<tr><td colspan="6" style="text-align:center;padding:24px;color:var(--muted-foreground);">No users found.</td></tr>';
        } else {
            users.forEach(user => {
                userCache.set(String(user.user_id), user);
                const lastLogin = user.last_login ? new Date(user.last_login).toLocaleString() : 'Never';
                const roleClass = getRoleClass(user.role_name);
                const statusClass = getStatusClass(user.status);

                const row = `
                    <tr data-user-id="${user.user_id}">
                        <td>${escapeHtml(user.full_name || `${user.first_name} ${user.last_name}`)}</td>
                        <td>${escapeHtml(user.username)}</td>
                        <td><span class="status ${roleClass}">${escapeHtml(user.role_name)}</span></td>
                        <td><span class="status ${statusClass}">${escapeHtml(user.status)}</span></td>
                        <td>${escapeHtml(lastLogin)}</td>
                        <td>
                            <button class="btn-secondary btn-edit">Edit</button>
                            <button class="btn-secondary btn-reset">Reset Password</button>
                            <button class="btn-secondary btn-deactivate">Deactivate</button>
                        </td>
                    </tr>
                `;
                tableBody.insertAdjacentHTML('beforeend', row);
            });
        }

        // Show/hide "Load more" button
        const currentRenderedCount = tableBody.querySelectorAll('tr').length;
        if (currentRenderedCount < userTotalCount) {
            loadMoreBtn.style.display = 'block';
        } else {
            loadMoreBtn.style.display = 'none';
        }
    }
    
    async function refreshUserList() {
        userCurrentPage = 1;
        const users = await fetchUsers(userCurrentPage, userCurrentSearch, userCurrentRole);
        renderUsers(users, false);
    }

    function getRoleClass(roleName) {
        if (!roleName) return '';
        switch (roleName.toLowerCase()) {
            case 'superadmin': return 'super-admin';
            case 'hr': return 'on-time';
            case 'head_dept': return 'late';
            default: return '';
        }
    }

    function getStatusClass(status) {
        if (!status) return '';
        switch (status.toLowerCase()) {
            case 'active': return 'on-time';
            case 'inactive': return 'absent';
            case 'locked': return 'late';
            default: return '';
        }
    }

    // --- Event Listeners for User Management ---
    function setupUserManagementListeners() {
        const searchInput = document.getElementById('user-search-input');
        const roleSelect = document.getElementById('role-filter-select');
        const loadMoreBtn = document.getElementById('load-more-users-btn');
        const addUserBtn = document.getElementById('add-user-btn');
        const userTableBody = document.getElementById('user-management-tbody');

        let searchTimeout;
        searchInput.addEventListener('input', (e) => {
            clearTimeout(searchTimeout);
            searchTimeout = setTimeout(() => {
                userCurrentSearch = e.target.value;
                refreshUserList();
            }, 300);
        });

        roleSelect.addEventListener('change', (e) => {
            userCurrentRole = e.target.value;
            refreshUserList();
        });

        loadMoreBtn.addEventListener('click', async () => {
            userCurrentPage++;
            const users = await fetchUsers(userCurrentPage, userCurrentSearch, userCurrentRole);
            renderUsers(users, true);
        });

        addUserBtn.addEventListener('click', () => openModal('add'));

        userTableBody.addEventListener('click', async (e) => {
            const row = e.target.closest('tr');
            if (!row) return;
            const userId = row.dataset.userId;

            if (e.target.classList.contains('btn-edit')) {
                const userInfo = userCache.get(String(userId));
                if (userInfo) openModal('edit', userInfo);
            } else if (e.target.classList.contains('btn-deactivate')) {
                handleDeactivate(userId);
            } else if (e.target.classList.contains('btn-reset')) {
                handleResetPassword(userId);
            }
        });
    }

    // --- Modal Handling ---
    const userModal = document.getElementById('user-modal');
    const modalTitle = document.getElementById('modal-title');
    const userForm = document.getElementById('user-form');
    const userIdInput = document.getElementById('user-id');
    const passwordInput = document.getElementById('password');

    function openModal(mode = 'add', user = null) {
        userForm.reset();
        const roleSelect = document.getElementById('role');
        if (mode === 'add') {
            setRoleOptions(roleSelect, 'add');
            modalTitle.textContent = 'Add New User';
            userIdInput.value = '';
            passwordInput.setAttribute('required', 'required');
            passwordInput.placeholder = "Required for new user";
        } else if (mode === 'edit' && user) {
            setRoleOptions(roleSelect, 'edit');
            modalTitle.textContent = 'Edit User';
            userIdInput.value = user.user_id;
            document.getElementById('firstName').value = user.first_name || '';
            document.getElementById('lastName').value = user.last_name || '';
            document.getElementById('email').value = user.username;
            const currentRole = (user.role_name || user.role || '').toLowerCase();
            if (currentRole) {
                roleSelect.value = currentRole;
            }
            document.getElementById('status').value = user.status;
            passwordInput.removeAttribute('required');
            passwordInput.placeholder = "Leave blank to keep existing";
        }
        userModal.style.display = 'flex';
    }

    function closeModal() {
        userModal.style.display = 'none';
    }

    document.getElementById('modal-close-btn').addEventListener('click', closeModal);
    userModal.addEventListener('click', (e) => {
        if (e.target === userModal) closeModal();
    });

    // --- API Actions for User Form ---
    async function handleFormSubmit(e) {
        e.preventDefault();
        const token = sessionStorage.getItem('workline_token');
        const formData = new FormData(userForm);
        const userId = formData.get('userId');
        const data = Object.fromEntries(formData.entries());
        
        // The backend expects `role`, not `role_name`. The form gives us `role`.
        // No conversion is needed if the form is correct.
        if (data.password === '') {
            delete data.password;
        }

        const url = userId ? `${API_URL}/admin/users/${userId}` : `${API_URL}/admin/users`;
        const method = userId ? 'PUT' : 'POST';

        try {
            const response = await fetch(url, {
                method: method,
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify(data)
            });

            if (response.ok) {
                closeModal();
                refreshUserList();
            } else {
                const error = await response.json();
                alert(`Error: ${error.error}`);
            }
        } catch (err) {
            console.error('Failed to save user:', err);
            alert('An unexpected error occurred.');
        }
    }

    userForm.addEventListener('submit', handleFormSubmit);

    async function handleDeactivate(userId) {
        if (!confirm('Are you sure you want to deactivate this user? This changes their status to inactive.')) return;

        const token = sessionStorage.getItem('workline_token');
        try {
            const response = await fetch(`${API_URL}/admin/users/${userId}`, {
                method: 'DELETE',
                headers: { 'Authorization': `Bearer ${token}` }
            });

            if (response.status === 204 || response.ok) {
                refreshUserList();
            } else {
                const error = await response.json();
                alert(`Error: ${error.error}`);
            }
        } catch (err) {
            console.error('Failed to deactivate user:', err);
            alert('An unexpected error occurred.');
        }
    }

    async function handleResetPassword(userId) {
        const newPassword = prompt('Enter a new password for this user:');
        if (!newPassword) return;
        const token = sessionStorage.getItem('workline_token');
        try {
            const response = await fetch(`${API_URL}/admin/users/${userId}`, {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify({ password: newPassword })
            });
            if (response.ok) {
                alert('Password has been reset.');
            } else {
                const error = await response.json();
                alert(`Error: ${error.error}`);
            }
        } catch (e) {
            console.error('Failed to reset password:', e);
            alert('An unexpected error occurred.');
        }
    }

    // --- System Settings ---
    const settingsForm = document.getElementById('settings-form');

    async function fetchAndRenderSettings() {
        const token = sessionStorage.getItem('workline_token');
        try {
            const response = await fetch(`${API_URL}/admin/settings`, {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            if (response.ok) {
                const settings = await response.json();
                // Settings come as raw values already from backend
                document.getElementById('session_timeout_minutes').value = settings.session_timeout_minutes ?? 15;
                document.getElementById('qr_validity_hours').value = settings.qr_validity_hours ?? 24;
                document.getElementById('geolocation_restriction_enabled').value = String(settings.geolocation_restriction_enabled ?? true);
                document.getElementById('ip_restriction_enabled').value = String(settings.ip_restriction_enabled ?? false);
            } else {
                console.error('Failed to fetch settings');
            }
        } catch (e) {
            console.error('Error fetching settings:', e);
        }
    }

    async function handleSettingsSubmit(e) {
        e.preventDefault();
        const token = sessionStorage.getItem('workline_token');
        const formData = new FormData(settingsForm);
        const data = {
            session_timeout_minutes: parseInt(formData.get('session_timeout_minutes'), 10),
            qr_validity_hours: parseInt(formData.get('qr_validity_hours'), 10),
            geolocation_restriction_enabled: formData.get('geolocation_restriction_enabled') === 'true',
            ip_restriction_enabled: formData.get('ip_restriction_enabled') === 'true',
        };

        try {
            const response = await fetch(`${API_URL}/admin/settings`, {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify(data)
            });

            if (response.ok) {
                alert('Settings saved successfully!');
                fetchAndRenderSettings();
            } else {
                const error = await response.json();
                alert(`Error: ${error.error}`);
            }
        } catch (err) {
            console.error('Failed to save settings:', err);
            alert('An unexpected error occurred.');
        }
    }

    settingsForm.addEventListener('submit', handleSettingsSubmit);
    document.getElementById('revert-settings-btn').addEventListener('click', fetchAndRenderSettings);

    // --- Audit Logs ---
    const auditFilterForm = document.getElementById('audit-filter-form');
    const auditLogsTbody = document.getElementById('audit-logs-tbody');
    const auditUserFilter = document.getElementById('audit-user-filter');

    async function fetchAuditLogs(filters = {}) {
        const token = sessionStorage.getItem('workline_token');
        const query = new URLSearchParams(filters).toString();
        try {
            const response = await fetch(`${API_URL}/admin/audit-logs?${query}`, {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            if (response.ok) {
                return await response.json();
            } else {
                console.error('Failed to fetch audit logs');
                return [];
            }
        } catch (e) {
            console.error('Error fetching audit logs:', e);
            return [];
        }
    }

    function renderAuditLogs(logs) {
        auditLogsTbody.innerHTML = '';
        if (!logs || logs.length === 0) {
            auditLogsTbody.innerHTML = '<tr><td colspan="4" style="text-align:center;padding:24px;color:var(--muted-foreground);">No audit logs found for the selected criteria.</td></tr>';
            return;
        }

        logs.forEach(log => {
            const timestamp = new Date(log.created_at).toLocaleString();
            const details = log.details ? JSON.stringify(log.details, null, 2) : '{}';
            const row = `
                <tr>
                    <td>${escapeHtml(timestamp)}</td>
                    <td>${escapeHtml(log.username || `User ID: ${log.user_id}`)}</td>
                    <td><span class="status">${escapeHtml(log.action_type)}</span></td>
                    <td><pre>${escapeHtml(details)}</pre></td>
                </tr>
            `;
            auditLogsTbody.insertAdjacentHTML('beforeend', row);
        });
    }

    async function populateUserFilter() {
        const users = await fetchUsers(1, '', 'all'); // Fetch all users for filter
        auditUserFilter.innerHTML = '<option value="">All Users</option>'; // Reset
        users.forEach(user => {
            const option = document.createElement('option');
            option.value = user.user_id;
            option.textContent = `${user.full_name || user.username} (${user.username})`;
            auditUserFilter.appendChild(option);
        });
    }

    async function handleAuditFilterSubmit(e) {
        e.preventDefault();
        const formData = new FormData(auditFilterForm);
        const filters = Object.fromEntries(formData.entries());
        for (const key in filters) {
            if (!filters[key]) delete filters[key];
        }
        const logs = await fetchAuditLogs(filters);
        renderAuditLogs(logs);
    }

    auditFilterForm.addEventListener('submit', handleAuditFilterSubmit);

    // --- Activity Monitor ---
    const activityMonitorTbody = document.getElementById('activity-monitor-tbody');

    async function fetchActiveSessions() {
        const token = sessionStorage.getItem('workline_token');
        try {
            const response = await fetch(`${API_URL}/admin/sessions`, {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            if (response.ok) return await response.json();
            return [];
        } catch (e) {
            console.error('Error fetching active sessions:', e);
            return [];
        }
    }

    function renderActiveSessions(sessions) {
        activityMonitorTbody.innerHTML = '';
        if (!sessions || sessions.length === 0) {
            activityMonitorTbody.innerHTML = '<tr><td colspan="4" style="text-align:center;padding:24px;color:var(--muted-foreground);">No active sessions found.</td></tr>';
            return;
        }
        sessions.forEach(session => {
            const loginTime = new Date(session.login_time).toLocaleString();
            const row = `
                <tr data-session-id="${session.session_id}">
                    <td>${escapeHtml(session.full_name || session.username)}</td>
                    <td>${escapeHtml(loginTime)}</td>
                    <td>${escapeHtml(session.ip_address)}</td>
                    <td><button class="btn-secondary btn-logout-session">Logout</button></td>
                </tr>
            `;
            activityMonitorTbody.insertAdjacentHTML('beforeend', row);
        });
    }

    async function handleForceLogout(sessionId) {
        if (!confirm('Are you sure you want to forcefully log out this session?')) return;
        const token = sessionStorage.getItem('workline_token');
        try {
            const response = await fetch(`${API_URL}/admin/sessions/${sessionId}/logout`, {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${token}` }
            });
            if (response.ok) {
                alert('Session logged out.');
                initializeActivityMonitor();
            } else {
                const error = await response.json();
                alert(`Error: ${error.error}`);
            }
        } catch (err) {
            console.error('Failed to force logout:', err);
            alert('An unexpected error occurred.');
        }
    }

    activityMonitorTbody.addEventListener('click', (e) => {
        if (e.target.classList.contains('btn-logout-session')) {
            const sessionId = e.target.closest('tr').dataset.sessionId;
            handleForceLogout(sessionId);
        }
    });

    async function initializeActivityMonitor() {
        const sessions = await fetchActiveSessions();
        renderActiveSessions(sessions);
    }

    document.getElementById('refresh-sessions-btn').addEventListener('click', initializeActivityMonitor);

    // --- Initial Load ---
    async function initialize() {
        // User Management
        setupUserManagementListeners();
        await refreshUserList();

        // System Settings
        fetchAndRenderSettings();

        // Audit Logs
        await populateUserFilter();
        const logs = await fetchAuditLogs();
        renderAuditLogs(logs);

        // Activity Monitor
        initializeActivityMonitor();
    }

    // --- Tab Navigation ---
    function initializeTabNavigation() {
        const tabs = document.querySelectorAll('.hr-tabs .tab');
        const sections = {
            'User Management': document.getElementById('user-management-section'),
            'System Settings': document.getElementById('system-settings-section'),
            'Backup & Restore': document.getElementById('backup-restore-section'),
            'Audit Logs': document.getElementById('audit-logs-section'),
            'Activity Monitor': document.getElementById('activity-monitor-section')
        };

        // Dashboard overview section (main card) is only visible on User Management
        const dashboardOverview = document.getElementById('dashboard-overview-section');

        function showSection(sectionName) {
            // Hide all sections
            Object.values(sections).forEach(section => {
                if (section) section.style.display = 'none';
            });
            
            // Hide dashboard overview by default
            if (dashboardOverview) dashboardOverview.style.display = 'none';

            // Show the selected section
            const targetSection = sections[sectionName];
            if (targetSection) {
                targetSection.style.display = 'block';
            }

            // Show dashboard overview only for User Management
            if (sectionName === 'User Management' && dashboardOverview) {
                dashboardOverview.style.display = 'block';
            }

            // Update tab active states
            tabs.forEach(tab => {
                tab.classList.remove('active');
                if (tab.textContent.trim() === sectionName) {
                    tab.classList.add('active');
                }
            });
        }

        // Add click listeners to tabs
        tabs.forEach(tab => {
            tab.addEventListener('click', () => {
                const tabName = tab.textContent.trim();
                showSection(tabName);
            });
        });

        // Show User Management by default (includes dashboard overview)
        showSection('User Management');
    }

    document.addEventListener('DOMContentLoaded', () => {
        initialize();
        initializeTabNavigation();
    });

})();
