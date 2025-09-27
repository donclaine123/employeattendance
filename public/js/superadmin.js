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
    async function fetchUsers(page = 1, search = '', role = 'all', limit = null) {
        if (isFetchingUsers) return;
        isFetchingUsers = true;

        const token = sessionStorage.getItem('workline_token');
        if (!token) {
            console.error('No auth token found.');
            isFetchingUsers = false;
            return [];
        }

        const pageSize = limit || getCurrentPageSize();
        const params = new URLSearchParams({
            _page: page,
            _limit: pageSize,
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
            const users = await response.json();
            
            // Update pagination controls after fetching
            setTimeout(() => updatePaginationControls(), 0);
            
            return users;
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
            tableBody.innerHTML = '<tr><td colspan="10" style="text-align:center;padding:24px;color:var(--muted-foreground);">No users found.</td></tr>';
        } else {
            users.forEach(user => {
                userCache.set(String(user.user_id), user);
                const lastLogin = user.last_login ? new Date(user.last_login).toLocaleString() : 'Never';
                const createdOn = user.created_at ? new Date(user.created_at).toLocaleDateString() : 'Unknown';
                const lastModifiedBy = user.last_modified_by || 'System';
                const roleClass = getRoleClass(user.role_name);
                const statusClass = getStatusClass(user.status);

                const row = `
                    <tr data-user-id="${user.user_id}">
                        <td class="checkbox-column">
                            <input type="checkbox" class="row-checkbox" data-user-id="${user.user_id}">
                        </td>
                        <td>${escapeHtml(user.full_name || `${user.first_name} ${user.last_name}`)}</td>
                        <td>${escapeHtml(user.username)}</td>
                        <td><span class="status ${roleClass}">${escapeHtml(user.role_name)}</span></td>
                        <td>${escapeHtml(user.department_name || 'Not Assigned')}</td>
                        <td><span class="status ${statusClass}">${escapeHtml(user.status)}</span></td>
                        <td>${escapeHtml(createdOn)}</td>
                        <td>${escapeHtml(lastLogin)}</td>
                        <td>${escapeHtml(lastModifiedBy)}</td>
                        <td class="actions-column">
                            <div class="action-buttons">
                                <button class="action-btn edit-btn" data-user-id="${user.user_id}" title="Edit User">
                                    <svg xmlns="http://www.w3.org/2000/svg" width="25" height="25" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="action-icon">
                                        <path stroke="none" d="M0 0h24v24H0z" fill="none"/>
                                        <path d="M7 7h-1a2 2 0 0 0 -2 2v9a2 2 0 0 0 2 2h9a2 2 0 0 0 2 -2v-1" />
                                        <path d="M20.385 6.585a2.1 2.1 0 0 0 -2.97 -2.97l-8.415 8.385v3h3l8.385 -8.415z" />
                                        <path d="M16 5l3 3" />
                                    </svg>
                                </button>
                                <button class="action-btn reset-btn" data-user-id="${user.user_id}" title="Reset Password">
                                    <svg xmlns="http://www.w3.org/2000/svg" width="25" height="25" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="action-icon">
                                        <path stroke="none" d="M0 0h24v24H0z" fill="none"/>
                                        <path d="M16.555 3.843l3.602 3.602a2.877 2.877 0 0 1 0 4.069l-2.643 2.643a2.877 2.877 0 0 1 -4.069 0l-.301 -.301l-6.558 6.558a2 2 0 0 1 -1.239 .578l-.175 .008h-1.172a1 1 0 0 1 -.993 -.883l-.007 -.117v-1.172a2 2 0 0 1 .467 -1.284l.119 -.13l.414 -.414h2v-2h2v-2l2.144 -2.144l-.301 -.301a2.877 2.877 0 0 1 0 -4.069l2.643 -2.643a2.877 2.877 0 0 1 4.069 0z" />
                                        <path d="M15 9h.01" />
                                    </svg>
                                </button>
                                <button class="action-btn ${user.status.toLowerCase() === 'active' ? 'deactivate-btn' : 'reactivate-btn'}" 
                                        data-user-id="${user.user_id}" 
                                        title="${user.status.toLowerCase() === 'active' ? 'Deactivate User' : 'Reactivate User'}">
                                    ${user.status.toLowerCase() === 'active' ? 
                                        `<svg xmlns="http://www.w3.org/2000/svg" width="25" height="25" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="action-icon">
                                            <path stroke="none" d="M0 0h24v24H0z" fill="none"/>
                                            <path d="M17 22v-2" />
                                            <path d="M9 15l6 -6" />
                                            <path d="M11 6l.463 -.536a5 5 0 0 1 7.071 7.072l-.534 .464" />
                                            <path d="M13 18l-.397 .534a5.068 5.068 0 0 1 -7.127 0a4.972 4.972 0 0 1 0 -7.071l.524 -.463" />
                                            <path d="M20 17h2" />
                                            <path d="M2 7h2" />
                                            <path d="M7 2v2" />
                                        </svg>` : 
                                        `<svg xmlns="http://www.w3.org/2000/svg" width="25" height="25" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="action-icon">
                                            <path stroke="none" d="M0 0h24v24H0z" fill="none"/>
                                            <path d="M9 15l6 -6" />
                                            <path d="M11 6l.463 -.536a5 5 0 0 1 7.071 7.072l-.534 .464" />
                                            <path d="M13 18l-.397 .534a5.068 5.068 0 0 1 -7.127 0a4.972 4.972 0 0 1 0 -7.071l.524 -.463" />
                                        </svg>`
                                    }
                                </button>
                            </div>
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

        // Update horizontal scroll indicators after rendering
        setTimeout(() => {
            const tableContainer = document.querySelector('#user-management-section .table-container');
            if (tableContainer) {
                const hasHorizontalScroll = tableContainer.scrollWidth > tableContainer.clientWidth;
                tableContainer.classList.toggle('has-horizontal-scroll', hasHorizontalScroll);
                console.log('After rendering - table container dimensions:', {
                    scrollWidth: tableContainer.scrollWidth,
                    clientWidth: tableContainer.clientWidth,
                    hasHorizontalScroll: hasHorizontalScroll
                });
            }
        }, 100);
    }
    
    async function refreshUserList() {
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

            // Check if the clicked element is an action button or its icon
            const button = e.target.closest('.action-btn');
            if (!button) return;

            if (button.classList.contains('edit-btn')) {
                const userInfo = userCache.get(String(userId));
                if (userInfo) openModal('edit', userInfo);
            } else if (button.classList.contains('deactivate-btn')) {
                handleDeactivate(userId);
            } else if (button.classList.contains('reactivate-btn')) {
                handleReactivate(userId);
            } else if (button.classList.contains('reset-btn')) {
                handleResetPassword(userId);
            }
        });
        
        // Setup bulk actions and pagination
        setupBulkActions();
        setupPagination();
    }

    // --- Bulk Actions Functionality ---
    function setupBulkActions() {
        const selectAllCheckbox = document.getElementById('select-all-users');
        const bulkActionsDiv = document.getElementById('bulk-actions');
        const selectedCountSpan = bulkActionsDiv.querySelector('.selected-count');
        const bulkDeactivateBtn = document.getElementById('bulk-deactivate-btn');
        const bulkReactivateBtn = document.getElementById('bulk-reactivate-btn');

        // Select all functionality
        selectAllCheckbox.addEventListener('change', function() {
            const checkboxes = document.querySelectorAll('.row-checkbox');
            checkboxes.forEach(checkbox => {
                checkbox.checked = this.checked;
            });
            updateBulkActionsVisibility();
        });

        // Individual checkbox change
        document.addEventListener('change', function(e) {
            if (e.target.classList.contains('row-checkbox')) {
                updateBulkActionsVisibility();
                
                // Update select all checkbox state
                const checkboxes = document.querySelectorAll('.row-checkbox');
                const checkedBoxes = document.querySelectorAll('.row-checkbox:checked');
                const selectAll = document.getElementById('select-all-users');
                
                if (checkedBoxes.length === 0) {
                    selectAll.indeterminate = false;
                    selectAll.checked = false;
                } else if (checkedBoxes.length === checkboxes.length) {
                    selectAll.indeterminate = false;
                    selectAll.checked = true;
                } else {
                    selectAll.indeterminate = true;
                    selectAll.checked = false;
                }
            }
        });

        // Bulk deactivate
        bulkDeactivateBtn.addEventListener('click', async () => {
            const selectedUsers = getSelectedUsers();
            if (selectedUsers.length === 0) return;
            
            if (!confirm(`Are you sure you want to deactivate ${selectedUsers.length} user(s)?`)) return;
            
            await performBulkAction(selectedUsers, 'deactivate');
        });

        // Bulk reactivate
        bulkReactivateBtn.addEventListener('click', async () => {
            const selectedUsers = getSelectedUsers();
            if (selectedUsers.length === 0) return;
            
            if (!confirm(`Are you sure you want to reactivate ${selectedUsers.length} user(s)?`)) return;
            
            await performBulkAction(selectedUsers, 'reactivate');
        });

        function updateBulkActionsVisibility() {
            const checkedBoxes = document.querySelectorAll('.row-checkbox:checked');
            const count = checkedBoxes.length;
            
            if (count > 0) {
                bulkActionsDiv.style.display = 'flex';
                selectedCountSpan.textContent = `${count} user${count === 1 ? '' : 's'} selected`;
            } else {
                bulkActionsDiv.style.display = 'none';
            }
        }

        function getSelectedUsers() {
            const checkedBoxes = document.querySelectorAll('.row-checkbox:checked');
            return Array.from(checkedBoxes).map(checkbox => checkbox.dataset.userId);
        }

        async function performBulkAction(userIds, action) {
            const token = sessionStorage.getItem('workline_token');
            const errors = [];
            
            for (const userId of userIds) {
                try {
                    let response;
                    if (action === 'deactivate') {
                        response = await fetch(`${API_URL}/admin/users/${userId}`, {
                            method: 'DELETE',
                            headers: { 'Authorization': `Bearer ${token}` }
                        });
                    } else if (action === 'reactivate') {
                        response = await fetch(`${API_URL}/admin/users/${userId}/reactivate`, {
                            method: 'PUT',
                            headers: { 'Authorization': `Bearer ${token}` }
                        });
                    }
                    
                    if (!response.ok) {
                        const error = await response.json();
                        errors.push(`User ${userId}: ${error.error}`);
                    }
                } catch (err) {
                    errors.push(`User ${userId}: Network error`);
                }
            }
            
            if (errors.length > 0) {
                alert(`Some actions failed:\n${errors.join('\n')}`);
            }
            
            // Clear selections and refresh
            document.getElementById('select-all-users').checked = false;
            document.getElementById('select-all-users').indeterminate = false;
            refreshUserList();
        }
    }

    // --- Horizontal Scroll Functionality ---
    function setupHorizontalScroll() {
        // Target the table-container instead of wide-card
        const tableContainer = document.querySelector('#user-management-section .table-container');
        
        if (!tableContainer) {
            console.log('Table container not found');
            return;
        }

        console.log('Setting up horizontal scroll on:', tableContainer);

        // Add horizontal scrolling with mouse wheel
        tableContainer.addEventListener('wheel', function(e) {
            // Check if the table has horizontal overflow
            const hasHorizontalScroll = tableContainer.scrollWidth > tableContainer.clientWidth
            
            if (hasHorizontalScroll) {
                // Always prevent default behavior when over the table
                e.preventDefault();
                e.stopPropagation();
                
                // Calculate scroll amount (you can adjust the multiplier for faster/slower scrolling)
                const scrollAmount = e.deltaY * 3; // Increased for more responsive scrolling
                
                // Get current scroll position
                const currentScrollLeft = tableContainer.scrollLeft;
                const maxScrollLeft = tableContainer.scrollWidth - tableContainer.clientWidth;
                
                // Calculate new scroll position
                let newScrollLeft = currentScrollLeft + scrollAmount;
                
                // Clamp the value to prevent over-scrolling
                newScrollLeft = Math.max(0, Math.min(newScrollLeft, maxScrollLeft));
                                
                // Apply horizontal scroll
                tableContainer.scrollLeft = newScrollLeft;
                
                return false;
            }
        }, { passive: false, capture: true });

        // Also prevent scrolling on the table element itself
        const table = tableContainer.querySelector('table');
        if (table) {
            table.addEventListener('wheel', function(e) {
                const hasHorizontalScroll = tableContainer.scrollWidth > tableContainer.clientWidth;
                if (hasHorizontalScroll) {
                    e.preventDefault();
                    e.stopPropagation();
                    return false;
                }
            }, { passive: false, capture: true });
        }

        // Remove smooth scrolling behavior to prevent conflicts
        tableContainer.style.scrollBehavior = 'auto';
        
        // Optional: Add visual indicators for scroll capability
        function updateScrollIndicators() {
            const hasHorizontalScroll = tableContainer.scrollWidth > tableContainer.clientWidth;
            const isAtStart = tableContainer.scrollLeft <= 1; // Small tolerance
            const isAtEnd = tableContainer.scrollLeft >= (tableContainer.scrollWidth - tableContainer.clientWidth - 1);
                        
            // Add CSS classes for styling if needed
            tableContainer.classList.toggle('has-horizontal-scroll', hasHorizontalScroll);
            tableContainer.classList.toggle('scroll-at-start', isAtStart);
            tableContainer.classList.toggle('scroll-at-end', isAtEnd);
        }

        // Update indicators on scroll
        tableContainer.addEventListener('scroll', updateScrollIndicators);
        
        // Update indicators on resize
        window.addEventListener('resize', updateScrollIndicators);
        
        // Initial check
        setTimeout(updateScrollIndicators, 500); // Increased delay to ensure table is fully rendered and populated
    }

    // --- Pagination Functionality ---
    function setupPagination() {
        const rowsPerPageSelect = document.getElementById('rows-per-page');
        const prevPageBtn = document.getElementById('prev-page-btn');
        const nextPageBtn = document.getElementById('next-page-btn');

        rowsPerPageSelect.addEventListener('change', () => {
            userCurrentPage = 1;
            refreshUserList();
        });

        prevPageBtn.addEventListener('click', () => {
            if (userCurrentPage > 1) {
                userCurrentPage--;
                refreshUserList();
            }
        });

        nextPageBtn.addEventListener('click', () => {
            const totalPages = Math.ceil(userTotalCount / getCurrentPageSize());
            if (userCurrentPage < totalPages) {
                userCurrentPage++;
                refreshUserList();
            }
        });
    }

    function getCurrentPageSize() {
        const select = document.getElementById('rows-per-page');
        return parseInt(select.value) || 10;
    }

    function updatePaginationControls() {
        const pageSize = getCurrentPageSize();
        const totalPages = Math.ceil(userTotalCount / pageSize);
        const start = (userCurrentPage - 1) * pageSize + 1;
        const end = Math.min(userCurrentPage * pageSize, userTotalCount);
        
        // Update pagination text
        document.getElementById('pagination-text').textContent = 
            `Showing ${start}-${end} of ${userTotalCount} users`;
        
        // Update button states
        document.getElementById('prev-page-btn').disabled = userCurrentPage <= 1;
        document.getElementById('next-page-btn').disabled = userCurrentPage >= totalPages;
        
        // Update page numbers
        updatePageNumbers(userCurrentPage, totalPages);
    }

    function updatePageNumbers(currentPage, totalPages) {
        const pageNumbersContainer = document.getElementById('page-numbers');
        pageNumbersContainer.innerHTML = '';
        
        let startPage = Math.max(1, currentPage - 2);
        let endPage = Math.min(totalPages, currentPage + 2);
        
        // Adjust range if we're near the beginning or end
        if (endPage - startPage < 4) {
            if (startPage === 1) {
                endPage = Math.min(totalPages, startPage + 4);
            } else if (endPage === totalPages) {
                startPage = Math.max(1, endPage - 4);
            }
        }
        
        for (let i = startPage; i <= endPage; i++) {
            const pageBtn = document.createElement('button');
            pageBtn.className = `page-number ${i === currentPage ? 'active' : ''}`;
            pageBtn.textContent = i;
            pageBtn.addEventListener('click', () => {
                userCurrentPage = i;
                refreshUserList();
            });
            pageNumbersContainer.appendChild(pageBtn);
        }
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

    async function handleReactivate(userId) {
        if (!confirm('Are you sure you want to reactivate this user? This will change their status to active.')) return;

        const token = sessionStorage.getItem('workline_token');
        try {
            const response = await fetch(`${API_URL}/admin/users/${userId}/reactivate`, {
                method: 'PUT',
                headers: { 'Authorization': `Bearer ${token}` }
            });

            if (response.status === 200 || response.ok) {
                refreshUserList();
            } else {
                const error = await response.json();
                alert(`Error: ${error.error}`);
            }
        } catch (err) {
            console.error('Failed to reactivate user:', err);
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
            const actionType = formatActionType(log.action_type);
            const description = formatAuditDescription(log);
            
            const row = `
                <tr>
                    <td>${escapeHtml(timestamp)}</td>
                    <td>${escapeHtml(log.username || `User ID: ${log.user_id}`)}</td>
                    <td><span class="status action-${log.action_type.toLowerCase()}">${escapeHtml(actionType)}</span></td>
                    <td class="audit-description">${description}</td>
                </tr>
            `;
            auditLogsTbody.insertAdjacentHTML('beforeend', row);
        });
    }

    function formatActionType(actionType) {
        const actionTypeMap = {
            'PROFILE_FIELD_UPDATED': 'Profile Updated',
            'USER_CREATED': 'User Created',
            'USER_DEACTIVATED': 'User Deactivated',
            'PASSWORD_CHANGED': 'Password Changed',
            'LOGIN': 'Login',
            'LOGOUT': 'Logout'
        };
        return actionTypeMap[actionType] || actionType.replace(/_/g, ' ');
    }

    function formatAuditDescription(log) {
        const details = log.details || {};
        
        // Handle specific action types with enhanced descriptions
        switch (log.action_type) {
            case 'PROFILE_FIELD_UPDATED':
                if (details.changeDescription) {
                    const context = details.selfUpdate ? '(Self-update)' : `(Updated by ${details.updatedByRole})`;
                    return `<span class="field-change">${escapeHtml(details.changeDescription)}</span> <span class="context">${context}</span>`;
                }
                break;
                
            case 'USER_CREATED':
                if (details.description) {
                    return `<span class="user-action">${escapeHtml(details.description)}</span>`;
                }
                break;
                
            case 'USER_DEACTIVATED':
                if (details.description) {
                    return `<span class="user-action">${escapeHtml(details.description)}</span>`;
                }
                break;
                
            case 'PASSWORD_CHANGED':
                return '<span class="security-action">Password was changed</span>';
                
            default:
                // Fallback to JSON display for other action types
                if (Object.keys(details).length > 0) {
                    return `<pre class="json-details">${escapeHtml(JSON.stringify(details, null, 2))}</pre>`;
                }
                return '<span class="no-details">No additional details</span>';
        }
        
        return '<span class="no-details">No details available</span>';
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
        
        // Setup horizontal scrolling after table is populated
        setupHorizontalScroll();

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
