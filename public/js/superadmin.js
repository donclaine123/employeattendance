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

    // Safe event listener helper: attaches listener only if element exists
    function safeAdd(el, event, handler, options) {
        if (!el) {
            // element missing; avoid noisy logs in production but keep a debug message
            if (window && window.console && window.console.debug) {
                console.debug('[superadmin] safeAdd: element not found for event', event, el);
            }
            return;
        }
        // Mark element to track which events have been added to prevent duplicates
        if (!el.__safeAddListeners) {
            el.__safeAddListeners = {};
        }
        const key = event + '_' + handler.toString().substring(0, 50);
        if (!el.__safeAddListeners[key]) {
            el.addEventListener(event, handler, options || false);
            el.__safeAddListeners[key] = true;
        }
    }

    // Helper: set role options depending on mode (add vs edit)
    function setRoleOptions(selectEl, mode) {
        if (!selectEl) return;
        const opts = mode === 'add'
            ? [
                { v: 'hr', text: 'Monitoring' },
                { v: 'superadmin', text: 'Super Admin' }
              ]
            : [
                { v: 'employee', text: 'Employee' },
                { v: 'head_dept', text: 'Department Head' },
                { v: 'hr', text: 'Monitoring' },
                { v: 'superadmin', text: 'Super Admin' }
              ];
        selectEl.innerHTML = opts.map(o => `<option value="${o.v}">${o.text}</option>`).join('');
    }

    // --- User Management Functions ---
    async function fetchUsers(page = 1, search = '', role = 'all', limit = null) {
        if (isFetchingUsers) return;
        isFetchingUsers = true;

        const pageSize = limit || getCurrentPageSize();
        const params = new URLSearchParams({
            _page: page,
            _limit: pageSize,
            q: search,
            role: role
        });

        try {
            // Use cookie-based auth via fetchWithAuth
            const response = await fetchWithAuth(`/admin/users?${params.toString()}`, {});

            if (!response.ok) {
                console.error('Failed to fetch users:', response.statusText);
                return [];
            }
            
            userTotalCount = parseInt(response.headers.get('X-Total-Count') || '0', 10);
            const responseData = await response.json();
            const users = responseData.data || responseData || [];
            
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
        const loadMoreBtn = document.getElementById('load-more-users-btn'); // May not exist with new pagination

        if (!append) {
            tableBody.innerHTML = '';
        }

        // Helper function to get display name for role
        function getDisplayRole(roleName) {
            const roleMap = {
                'hr': 'Monitoring',
                'superadmin': 'Super Admin',
                'head_dept': 'Department Head',
                'employee': 'Employee',
                'display': 'Display'
            };
            return roleMap[roleName] || roleName;
        }

        if (!users || users.length === 0 && !append) {
            tableBody.innerHTML = '<tr><td colspan="10" style="text-align:center;padding:24px;color:var(--muted-foreground);">No users found.</td></tr>';
        } else {
            users.forEach(user => {
                userCache.set(String(user.user_id), user);
                const lastLogin = user.last_login ? new Date(user.last_login).toLocaleDateString() + ' ' + new Date(user.last_login).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'Never';
                const createdOn = user.created_at ? new Date(user.created_at).toLocaleDateString() : 'Unknown';
                const lastModifiedBy = user.last_modified_by || 'System';
                const roleClass = getRoleClass(user.role_name);
                const statusClass = getStatusClass(user.status);

                // Display name: use full_name (from employees table), show '-' if no name
                const displayName = user.full_name || '-';
                        
                const row = `
                    <tr data-user-id="${user.user_id}">
                        <td class="checkbox-column">
                            <input type="checkbox" class="row-checkbox" data-user-id="${user.user_id}">
                        </td>
                        <td>${displayName ? escapeHtml(displayName) : '<span style="color: #999; font-style: italic;">null</span>'}</td>
                        <td>${escapeHtml(user.username)}</td>
                        <td><span class="status ${roleClass}">${escapeHtml(getDisplayRole(user.role_name))}</span></td>
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

        // Show/hide "Load more" button (if it exists)
        if (loadMoreBtn) {
            const currentRenderedCount = tableBody.querySelectorAll('tr').length;
            if (currentRenderedCount < userTotalCount) {
                loadMoreBtn.style.display = 'block';
            } else {
                loadMoreBtn.style.display = 'none';
            }
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
        
        // Update pagination controls after rendering
        updatePaginationControls();
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
            default: return '';
        }
    }

    // --- Event Listeners for User Management ---
    function setupUserManagementListeners() {
    const searchInput = document.getElementById('user-search-input');
    const roleSelect = document.getElementById('role-filter-select');
    const loadMoreBtn = document.getElementById('load-more-users-btn');
    const userTableBody = document.getElementById('user-management-tbody');

        let searchTimeout;
        safeAdd(searchInput, 'input', (e) => {
            clearTimeout(searchTimeout);
            searchTimeout = setTimeout(() => {
                userCurrentSearch = e.target.value;
                refreshUserList();
            }, 300);
        });

        safeAdd(roleSelect, 'change', (e) => {
            userCurrentRole = e.target.value;
            refreshUserList();
        });

        // Load more button (optional - may not exist with new pagination)
        if (loadMoreBtn) {
            safeAdd(loadMoreBtn, 'click', async () => {
                userCurrentPage++;
                const users = await fetchUsers(userCurrentPage, userCurrentSearch, userCurrentRole);
                renderUsers(users, true);
            });
        }

        safeAdd(userTableBody, 'click', async (e) => {
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

    // --- Overview wiring (greeting, role, last login, quick stats) ---
    async function updateOverview() {
        try {
            // Fetch authoritative profile from server (do not rely on sessionStorage)
            let currentUser = {};
            try {
                const profileResp = await fetchWithAuth('/auth/profile');
                if (profileResp && (profileResp.ok || profileResp.status === 304)) {
                    // 304 may be returned by some caches; attempt to parse if available
                    try {
                        currentUser = profileResp.status === 304 ? (await profileResp.json().catch(() => ({}))) : await profileResp.json();
                    } catch (e) {
                        // If parsing fails for 304 or empty body, default to empty object
                        currentUser = {};
                    }
                }
            } catch (e) {
                console.warn('[superadmin] Failed to fetch profile for overview:', e);
                currentUser = {};
            }

            // Update greeting name using first/last name, falling back to username and finally 'Administrator'
            const greetingStrong = document.querySelector('.greeting strong');
            if (greetingStrong) {
                const displayName = currentUser.full_name || [(currentUser.first_name||''), (currentUser.last_name||'')].filter(Boolean).join(' ') || (currentUser.username || 'Administrator');
                greetingStrong.textContent = displayName;
            }

            // Update role and last login inside the left employee-card
            const cardRows = document.querySelectorAll('.employee-card .card-row');
            if (cardRows && cardRows.length >= 3) {
                // Role (row 0)
                const roleValue = cardRows[0].querySelector('.value');
                if (roleValue) roleValue.textContent = (currentUser.role || 'Super Admin');

                // Last Login (row 2)
                const lastLoginValue = cardRows[2].querySelector('.value');
                if (lastLoginValue) {
                    const last = currentUser.last_login || currentUser.lastLogin || currentUser.last_logged_in;
                    lastLoginValue.textContent = last ? new Date(last).toLocaleDateString() + ' ' + new Date(last).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'Never';
                }
            }

            // Fetch total users (count) and active sessions
            // Total users: call /api/admin/users with a small page size and read X-Total-Count header
            
            // Total Users
            try {
                const usersResp = await fetchWithAuth(`/admin/users?_page=1&_limit=1`);
                if (usersResp) {
                    // Some servers return 304 Not Modified when the resource is cached. Treat 200 and 304
                    // as acceptable for reading pagination headers. Response.ok is only true for 2xx.
                    const headerVal = usersResp.headers.get('X-Total-Count') || usersResp.headers.get('x-total-count');
                    const total = parseInt(headerVal || '0', 10);
                    const totalEl = document.querySelectorAll('.quick-stat .qs-value')[0];
                    if (totalEl) totalEl.textContent = String(total);
                }
            } catch (e) {
                console.warn('Failed to load total users:', e);
            }

            // Active Sessions
            try {
                const sessionsResp = await fetchWithAuth(`/admin/sessions`);
                if (sessionsResp && sessionsResp.ok) {
                    const sessions = await sessionsResp.json();
                    const activeEl = document.querySelectorAll('.quick-stat .qs-value')[1];
                    if (activeEl) activeEl.textContent = String(Array.isArray(sessions) ? sessions.length : 0);
                }
            } catch (e) {
                console.warn('Failed to load active sessions:', e);
            }
        } catch (e) {
            console.error('updateOverview error:', e);
        }
    }

    // --- Bulk Actions Functionality ---
    function setupBulkActions() {
    const selectAllCheckbox = document.getElementById('select-all-users');
    const bulkActionsDiv = document.getElementById('bulk-actions');
    const selectedCountSpan = bulkActionsDiv ? bulkActionsDiv.querySelector('.selected-count') : null;
    const bulkDeactivateBtn = document.getElementById('bulk-deactivate-btn');
    const bulkReactivateBtn = document.getElementById('bulk-reactivate-btn');

        // Select all functionality
        safeAdd(selectAllCheckbox, 'change', function() {
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
        safeAdd(bulkDeactivateBtn, 'click', async () => {
            const selectedUsers = getSelectedUsers();
            if (selectedUsers.length === 0) return;
            
            if (!confirm(`Are you sure you want to deactivate ${selectedUsers.length} user(s)?`)) return;
            
            await performBulkAction(selectedUsers, 'deactivate');
        });

        // Bulk reactivate
        safeAdd(bulkReactivateBtn, 'click', async () => {
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
            const errors = [];
            
            for (const userId of userIds) {
                try {
                    let response;
                    if (action === 'deactivate') {
                        response = await fetchWithAuth(`/admin/users/${userId}`, {
                            method: 'DELETE'
                        });
                    } else if (action === 'reactivate') {
                        response = await fetchWithAuth(`/admin/users/${userId}/reactivate`, {
                            method: 'PUT'
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

    // initialize page: wire overview, listeners, and initial fetch
    (function init() {
        try {
            // wire overview and then setup handlers
            updateOverview();
            setupUserManagementListeners();
        } catch (e) {
            console.error('Superadmin init error:', e);
        }
    })();

    // --- Pagination Functionality ---
    function setupPagination() {
        const rowsPerPageSelect = document.getElementById('rows-per-page');
        const prevPageBtn = document.getElementById('prev-page-btn');
        const nextPageBtn = document.getElementById('next-page-btn');

        safeAdd(rowsPerPageSelect, 'change', () => {
            userCurrentPage = 1;
            refreshUserList();
        });

        safeAdd(prevPageBtn, 'click', () => {
            if (userCurrentPage > 1) {
                userCurrentPage--;
                refreshUserList();
            }
        });

        safeAdd(nextPageBtn, 'click', () => {
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

    function openModal(mode = 'edit', user = null) {
        userForm.reset();
        const roleSelect = document.getElementById('role');
        if (mode === 'edit' && user) {
            setRoleOptions(roleSelect, 'edit');
            modalTitle.textContent = 'Edit User';
            userIdInput.value = user.user_id;
            document.getElementById('firstName').value = user.first_name || '';
            document.getElementById('lastName').value = user.last_name || '';
            document.getElementById('email').value = user.username;
            const roleValue = user.role_name || user.role || '';
            const currentRole = String(roleValue).toLowerCase();
            if (currentRole) {
                roleSelect.value = currentRole;
            }
            document.getElementById('status').value = user.status;
        } else {
            // Invalid mode, close modal
            closeModal();
            return;
        }
        userModal.style.display = 'flex';
    }

    function closeModal() {
        userModal.style.display = 'none';
    }

    safeAdd(document.getElementById('modal-close-btn'), 'click', closeModal);
    safeAdd(userModal, 'click', (e) => {
        if (e.target === userModal) closeModal();
    });

    // --- API Actions for User Form ---
    async function handleFormSubmit(e) {
        e.preventDefault();
        const formData = new FormData(userForm);
        const userId = formData.get('userId');
        const data = Object.fromEntries(formData.entries());
        
        // Only handle edit mode now, userId should always exist
        if (!userId) {
            alert('Error: No user ID found for editing.');
            return;
        }
        
        // The backend expects `role`, not `role_name`. The form gives us `role`.
        // No conversion is needed if the form is correct.

        const url = `/admin/users/${userId}`;
        const method = 'PUT';

        try {
            const response = await fetchWithAuth(url, {
                method: method,
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

        try {
            const response = await fetchWithAuth(`/admin/users/${userId}`, {
                method: 'DELETE'
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

        try {
            const response = await fetchWithAuth(`/admin/users/${userId}/reactivate`, {
                method: 'PUT'
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
        try {
            const response = await fetchWithAuth(`/admin/users/${userId}`, {
                method: 'PUT',
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
        try {
            const response = await fetchWithAuth(`/admin/settings`, {});
            if (response.ok) {
                const result = await response.json();
                const settings = result.data || result; // Handle both formats
                // QR Automation Settings only
                document.getElementById('qr_auto_generate_enabled').value = String(settings.qr_auto_generate_enabled ?? 'false');
                document.getElementById('qr_auto_interval_seconds').value = settings.qr_auto_interval_seconds ?? '60';
                document.getElementById('qr_session_schedule_start').value = settings.qr_session_schedule_start ?? '07:00';
                document.getElementById('qr_session_schedule_end').value = settings.qr_session_schedule_end ?? '18:00';
                document.getElementById('qr_active_days').value = settings.qr_active_days ?? '1,2,3,4,5';
                document.getElementById('qr_allow_hr_pause').value = String(settings.qr_allow_hr_pause ?? 'true');
                document.getElementById('qr_automation_location').value = settings.qr_automation_location ?? 'cloud';
            } else {
                console.error('Failed to fetch settings:', response.status);
            }
        } catch (e) {
            console.error('Error fetching settings:', e);
        }
    }

    async function handleSettingsSubmit(e) {
        e.preventDefault();
        const formData = new FormData(settingsForm);
        
        // Validate QR active days format
        const activeDays = formData.get('qr_active_days').trim();
        if (activeDays && !/^[1-7](,[1-7])*$/.test(activeDays)) {
            alert('Invalid active days format. Please use comma-separated numbers 1-7 (e.g., 1,2,3,4,5)');
            return;
        }
        
        // Validate interval range
        const interval = parseInt(formData.get('qr_auto_interval_seconds'), 10);
        if (interval < 30 || interval > 600) {
            alert('QR generation interval must be between 30 and 600 seconds.');
            return;
        }
        
        const data = {
            // QR Automation Settings only
            qr_auto_generate_enabled: formData.get('qr_auto_generate_enabled') === 'true',
            qr_auto_interval_seconds: interval,
            qr_session_schedule_start: formData.get('qr_session_schedule_start'),
            qr_session_schedule_end: formData.get('qr_session_schedule_end'),
            qr_active_days: activeDays,
            qr_allow_hr_pause: formData.get('qr_allow_hr_pause') === 'true',
            qr_automation_location: formData.get('qr_automation_location') || 'cloud'
        };

        try {
            const response = await fetchWithAuth(`/admin/settings`, {
                method: 'PUT',
                body: JSON.stringify(data)
            });

            if (response.ok) {
                alert('Settings saved successfully! Changes will take effect on the next QR generation cycle.');
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

    safeAdd(settingsForm, 'submit', handleSettingsSubmit);
    safeAdd(document.getElementById('revert-settings-btn'), 'click', fetchAndRenderSettings);

    // --- Audit Logs ---
    const auditLogsTbody = document.getElementById('audit-logs-tbody');
    const auditUserFilter = document.getElementById('audit-user-filter');
    const auditStartDate = document.getElementById('audit-start-date');
    const auditEndDate = document.getElementById('audit-end-date');
    const auditActionFilter = document.getElementById('audit-action-filter');
    
    // Action type mapping: display name -> database value
    const actionTypeMap = {
        'USER_UPDATED': 'User Updated',
        'USER_DEACTIVATED': 'User Deactivated',
        'USER_REACTIVATED': 'User Reactivated',
        'SESSION_LOGOUT_FORCED': 'Session Logout Forced',
        'QR_PAUSED': 'QR Code Paused',
        'QR_RESUMED': 'QR Code Resumed',
        'EMPLOYEE_CREATED': 'Employee Created',
        'EMPLOYEE_UPDATED': 'Employee Updated',
        'EMPLOYEE_DELETED': 'Employee Deleted',
        'EMPLOYEE_ROLE_UPDATED': 'Employee Role Updated',
        'ATTENDANCE_OVERRIDE': 'Attendance Override',
        'DEPARTMENT_CREATED': 'Department Created',
        'DEPARTMENT_UPDATED': 'Department Updated',
        'DEPARTMENT_DELETED': 'Department Deleted',
        'DEPARTMENT_HEAD_ASSIGNED': 'Department Head Assigned',
        'BULK_USER_ACTIVATION': 'Bulk User Activation',
        'SETTINGS_UPDATED': 'Settings Updated',
        'INVITATION_CREATED': 'Invitation Created',
        'INVITATION_SUPERSEDED': 'Invitation Superseded',
        'INVITATION_ACCEPTED': 'Invitation Accepted',
        'INVITATION_RESENT': 'Invitation Resent',
        'INVITATION_CANCELLED': 'Invitation Cancelled'
    };
    
    // Reverse mapping for lookup
    const displayToDbActionMap = Object.entries(actionTypeMap).reduce((acc, [db, display]) => {
        acc[display] = db;
        return acc;
    }, {});

    async function fetchAuditLogs(filters = {}) {
        const query = new URLSearchParams(filters).toString();
        try {
            const response = await fetchWithAuth(`/admin/audit-logs?${query}`, {
                credentials: 'include',
                headers: { 'Content-Type': 'application/json' }
            });
            if (response.ok) {
                const responseData = await response.json();
                return responseData.data || responseData || [];
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

        logs.forEach((log, index) => {
            const timestamp = new Date(log.createdAt).toLocaleString();
            const actionType = formatActionType(log.actionType);
            const username = log.userName || `User ID: ${log.userId || 'Unknown'}`;
            
            const row = `
                <tr>
                    <td>${escapeHtml(timestamp)}</td>
                    <td>${escapeHtml(username)}</td>
                    <td><span class="status action-${(log.actionType || '').toLowerCase()}">${escapeHtml(actionType)}</span></td>
                    <td><button class="btn-small" onclick="openAuditDetailsModal(${index})" style="padding: 4px 12px; font-size: 0.875rem;">View</button></td>
                </tr>
            `;
            auditLogsTbody.insertAdjacentHTML('beforeend', row);
        });
        
        // Store logs for modal access
        window.auditLogsData = logs;
    }

    function formatActionType(actionType) {
        if (!actionType) return 'Unknown';
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

    function populateActionFilter() {
        auditActionFilter.innerHTML = '<option value="">All Actions</option>';
        Object.entries(actionTypeMap).forEach(([dbValue, displayName]) => {
            const option = document.createElement('option');
            option.value = dbValue;
            option.textContent = displayName;
            auditActionFilter.appendChild(option);
        });
    }

    async function populateUserFilter() {
        try {
            const users = await fetchUsers(1, '', 'all'); // Fetch all users for filter
            if (!users || !Array.isArray(users)) {
                console.warn('populateUserFilter: users data is invalid', users);
                return;
            }
            auditUserFilter.innerHTML = '<option value="">All Users</option>'; // Reset
            users.forEach(user => {
                const option = document.createElement('option');
                option.value = user.user_id;
                option.textContent = `${user.full_name || user.username} (${user.username})`;
                auditUserFilter.appendChild(option);
            });
        } catch (error) {
            console.error('Error populating user filter:', error);
        }
    }

    async function applyAuditFilters() {
        const filters = {};
        if (auditStartDate.value) filters.startDate = auditStartDate.value;
        if (auditEndDate.value) filters.endDate = auditEndDate.value;
        if (auditUserFilter.value) filters.userId = auditUserFilter.value;
        if (auditActionFilter.value) filters.actionType = auditActionFilter.value;
        
        const logs = await fetchAuditLogs(filters);
        renderAuditLogs(logs);
    }

    // Immediate update for all filter changes (no debounce needed for dropdowns)
    safeAdd(auditStartDate, 'change', applyAuditFilters);
    safeAdd(auditEndDate, 'change', applyAuditFilters);
    safeAdd(auditUserFilter, 'change', applyAuditFilters);
    safeAdd(auditActionFilter, 'change', applyAuditFilters);

    // Initialize audit filters on page load
    populateActionFilter();
    
    // Populate user filter on first use (lazy load) to avoid auth timing issues
    let userFilterPopulated = false;
    auditUserFilter.addEventListener('click', async function(e) {
        if (!userFilterPopulated && auditUserFilter.children.length === 1) {
            userFilterPopulated = true;
            await populateUserFilter();
        }
    });

    // --- Activity Monitor ---
    const activityMonitorTbody = document.getElementById('activity-monitor-tbody');

    async function fetchActiveSessions() {
        try {
            const response = await fetchWithAuth(`/admin/sessions`, {});
            if (response.ok) {
                const responseData = await response.json();
                return responseData.data || responseData || [];
            }
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
        // Update stats: active sessions count
        const activeCountEl = document.getElementById('stat-active-sessions');
        if (activeCountEl) activeCountEl.textContent = String(sessions.length);

        // Compute avg session duration if possible (session.duration in seconds or compute from start)
        const durations = sessions.map(s => {
            if (s.duration_seconds) return Number(s.duration_seconds);
            if (s.login_time && s.last_seen) {
                const start = new Date(s.login_time);
                const end = new Date(s.last_seen);
                return Math.max(0, Math.round((end - start) / 1000));
            }
            return 0;
        }).filter(d => d > 0);

        const avgSeconds = durations.length ? Math.round(durations.reduce((a,b) => a+b, 0) / durations.length) : 0;
        const avgDisplay = avgSeconds ? (avgSeconds < 3600 ? `${Math.round(avgSeconds/60)}m` : `${(avgSeconds/3600).toFixed(1)}h`) : '—';
        const avgEl = document.getElementById('stat-avg-duration');
        if (avgEl) avgEl.textContent = avgDisplay;

        sessions.forEach(session => {
            const loginTime = new Date(session.login_time).toLocaleString();
            const row = `
                <tr data-session-id="${session.session_id}">
                    <td>${escapeHtml(session.full_name || session.username)}</td>
                    <td>${escapeHtml(loginTime)}</td>
                    <td>${escapeHtml(session.ip_address)}</td>
                    <td><button class="btn-force-logout" data-session-id="${session.session_id}">Force Logout</button></td>
                </tr>
            `;
            activityMonitorTbody.insertAdjacentHTML('beforeend', row);
        });

        // Update total logins today by querying audit logs for LOGIN events today
        try {
            // Fetch recent audit logs and count today's LOGIN events client-side
            fetchAuditLogs().then(logs => {
                try {
                    const today = new Date();
                    const start = new Date(today.getFullYear(), today.getMonth(), today.getDate());
                    const end = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 23, 59, 59);
                    const count = (logs || []).filter(l => {
                        if (!l || !l.action_type || !l.created_at) return false;
                        if (l.action_type !== 'LOGIN') return false;
                        const d = new Date(l.created_at);
                        return d >= start && d <= end;
                    }).length;
                    const totalLoginsEl = document.getElementById('stat-total-logins');
                    if (totalLoginsEl) totalLoginsEl.textContent = String(count);
                } catch (err) {
                    console.warn('Failed to compute total logins from audit logs:', err);
                }
            }).catch(e => console.warn('Failed to fetch audit logs for stats:', e));
        } catch (e) {
            console.warn('Error updating total logins stat:', e);
        }
    }

    async function handleForceLogout(sessionId) {
        if (!confirm('Are you sure you want to forcefully log out this session?')) return;
        try {
            const response = await fetchWithAuth(`/admin/sessions/${sessionId}/logout`, {
                method: 'POST'
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
        // Support legacy btn-logout-session and new btn-force-logout
        const target = e.target;
        if (target.classList.contains('btn-logout-session') || target.classList.contains('btn-force-logout')) {
            const sessionId = target.dataset.sessionId || target.closest('tr').dataset.sessionId;
            handleForceLogout(sessionId);
        }
    });

    async function initializeActivityMonitor() {
        const sessions = await fetchActiveSessions();
        renderActiveSessions(sessions);
    }

    safeAdd(document.getElementById('refresh-sessions-btn'), 'click', initializeActivityMonitor);

    // --- Departments management (API-driven) ---
    async function fetchDepartments() {
        try {
            const resp = await fetchWithAuth('/admin/departments');
            if (resp && resp.ok) {
                const data = await resp.json();
                return data.data || data || [];
            }
        } catch (e) {
            // endpoint may not exist yet, silently ignore
        }
        return [];
    }

    async function fetchEmployees() {
        try {
            const resp = await fetchWithAuth('/hr/employees');
            if (resp && resp.ok) {
                const data = await resp.json();
                return data.data || data || [];
            }
        } catch (e) {
            // endpoint may not exist yet, silently ignore
        }
        return [];
    }

    function renderDepartments(depts, employees = []) {
        const tbody = document.getElementById('departments-tbody');
        if (!tbody) return;
        tbody.innerHTML = '';
        if (!depts || depts.length === 0) {
            // Simple, inline fallback row with plain text and an Add button
            tbody.innerHTML = `
                <tr class="no-depts-row">
                    <td colspan="6">
                        <div class="no-depts-content">
                            <div class="no-depts-title">No departments yet</div>
                            <div class="no-depts-desc">Create your first department to organize employees and assign heads.</div>
                        </div>
                    </td>
                </tr>
            `;
            return;
        }

        // Calculate employee count per department
        const employeeCount = {};
        employees.forEach(emp => {
            const deptName = emp.dept_name || emp.department;
            if (deptName) {
                employeeCount[deptName] = (employeeCount[deptName] || 0) + 1;
            }
        });

        depts.forEach(d => {
            const headName = d.head_name || d.head_username || 'Not Assigned';
            const count = employeeCount[d.dept_name] || 0;
            const description = d.description ? escapeHtml(d.description) : '<em style="color: #999;">No description</em>';
            const row = `
                <tr data-dept-id="${d.dept_id || ''}">
                    <td>${escapeHtml(String(d.dept_id || ''))}</td>
                    <td>${escapeHtml(d.dept_name || '')}</td>
                    <td>${escapeHtml(headName)}</td>
                    <td>${description}</td>
                    <td class="employee-count-cell">${count}</td>
                    <td>
                        <div class="action-buttons">
                            <button class="action-btn action-btn-assign assign-head-btn" title="Assign Department Head" data-dept-id="${d.dept_id}" data-dept-name="${escapeHtml(d.dept_name || '')}">
                                <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="action-icon">
                                    <path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path>
                                    <circle cx="8.5" cy="7" r="4"></circle>
                                    <line x1="20" y1="8" x2="20" y2="14"></line>
                                    <line x1="23" y1="11" x2="17" y2="11"></line>
                                </svg>
                            </button>
                            <button class="action-btn action-btn-edit btn-edit-dept" title="Edit Department">
                                <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="action-icon">
                                    <path stroke="none" d="M0 0h24v24H0z" fill="none"/>
                                    <path d="M7 7h-1a2 2 0 0 0 -2 2v9a2 2 0 0 0 2 2h9a2 2 0 0 0 2 -2v-1" />
                                    <path d="M20.385 6.585a2.1 2.1 0 0 0 -2.97 -2.97l-8.415 8.385v3h3l8.385 -8.415z" />
                                    <path d="M16 5l3 3" />
                                </svg>
                            </button>
                            <button class="action-btn action-btn-delete btn-delete-dept" title="Delete Department">
                                <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="action-icon">
                                    <path stroke="none" d="M0 0h24v24H0z" fill="none"/>
                                    <path d="M4 7l16 0" />
                                    <path d="M10 11l0 6" />
                                    <path d="M14 11l0 6" />
                                    <path d="M5 7l1 12a2 2 0 0 0 2 2h8a2 2 0 0 0 2 -2l1 -12" />
                                    <path d="M9 7v-3a1 1 0 0 1 1 -1h4a1 1 0 0 1 1 1v3" />
                                </svg>
                            </button>
                        </div>
                    </td>
                </tr>
            `;
            tbody.insertAdjacentHTML('beforeend', row);
        });

        // Attach event listeners to edit and delete buttons
        attachDepartmentActionListeners();
    }

    // Refresh departments table - called after assigning/removing heads
    window.loadDepartmentsTable = async function() {
        try {
            const depts = await fetchDepartments();
            const employees = await fetchEmployees();
            renderDepartments(depts, employees);
        } catch (e) {
            console.error('Failed to refresh departments table:', e);
        }
    };

    function openDeptModal(deptId = null) {
        const modal = document.getElementById('dept-modal');
        if (!modal) return;
        const form = document.getElementById('dept-form');
        const title = document.getElementById('dept-modal-title');
        const submitBtn = document.getElementById('dept-create-btn');
        
        if (form) form.reset();
        
        if (deptId) {
            // Edit mode
            if (title) title.textContent = 'Edit Department';
            if (submitBtn) submitBtn.textContent = 'Update Department';
            
            // Find and populate department data
            const row = document.querySelector(`tr[data-dept-id="${deptId}"]`);
            if (row) {
                const cells = row.querySelectorAll('td');
                document.getElementById('dept-id').value = deptId;
                document.getElementById('dept_name').value = cells[1].textContent;
                
                // Get description but clear it if it says "No description"
                const descText = cells[3].textContent.trim();
                document.getElementById('dept_description').value = (descText === 'No description' || descText === 'ND') ? '' : descText;
                
                // Store the original head from the table for comparison
                const headCell = cells[2] ? cells[2].textContent.trim() : 'Not Assigned';
                modal.dataset.initialHead = headCell;
                console.log('[DEBUG] Modal opened for edit, initial head:', headCell);
            }
        } else {
            // Create mode
            if (title) title.textContent = 'Create Department';
            if (submitBtn) submitBtn.textContent = 'Save Department';
            document.getElementById('dept-id').value = '';
            modal.dataset.initialHead = 'Not Assigned';
        }
        
        modal.style.display = 'flex';
    }

    // ensure departments are loaded during initial load
    async function initializeDepartments() {
        const tableBody = document.getElementById('departments-table-body');
        if (tableBody) {
            tableBody.innerHTML = '<tr><td colspan="5" style="text-align: center; padding: 20px;">Loading departments...</td></tr>';
        }

        try {
            const depts = await fetchDepartments();
            const employees = await fetchEmployees();
            renderDepartments(depts, employees);
            setupDepartmentsUI();
            attachDepartmentActionListeners();
        } catch (err) {
            console.error('Failed to initialize departments:', err);
            if (tableBody) {
                tableBody.innerHTML = '<tr><td colspan="5" style="text-align: center; color: red; padding: 20px;">Error loading departments</td></tr>';
            }
        }
    }

    function closeDeptModal() {
        const modal = document.getElementById('dept-modal');
        if (modal) modal.style.display = 'none';
    }

    function attachDepartmentActionListeners() {
        // Assign head buttons
        document.querySelectorAll('.assign-head-btn').forEach(btn => {
            btn.addEventListener('click', async function(e) {
                e.stopPropagation();
                const deptId = this.getAttribute('data-dept-id');
                const deptName = this.getAttribute('data-dept-name');
                
                if (!deptId) return;

                try {
                    const resp = await fetchWithAuth('/api/admin/department-heads');
                    if (resp && resp.ok) {
                        const heads = await resp.json();
                        showAssignHeadModal(deptId, deptName, heads);
                    } else {
                        alert('Failed to fetch department heads');
                    }
                } catch (err) {
                    console.error('Failed to fetch department heads:', err);
                    alert('Failed to fetch department heads due to network error.');
                }
            });
        });

        // Edit buttons
        document.querySelectorAll('.btn-edit-dept').forEach(btn => {
            btn.addEventListener('click', function(e) {
                e.stopPropagation();
                const row = this.closest('tr');
                const deptId = row.getAttribute('data-dept-id');
                if (deptId) {
                    openDeptModal(deptId);
                }
            });
        });

        // Delete buttons
        document.querySelectorAll('.btn-delete-dept').forEach(btn => {
            btn.addEventListener('click', async function(e) {
                e.stopPropagation();
                const row = this.closest('tr');
                const deptId = row.getAttribute('data-dept-id');
                const deptName = row.querySelectorAll('td')[1].textContent;
                
                if (!deptId) return;

                if (!confirm(`Are you sure you want to delete the department "${deptName}"?\n\nThis action cannot be undone.`)) {
                    return;
                }

                try {
                    const resp = await fetchWithAuth(`/admin/departments/${deptId}`, {
                        method: 'DELETE'
                    });

                    if (resp && resp.ok) {
                        const depts = await fetchDepartments();
                        const employees = await fetchEmployees();
                        renderDepartments(depts, employees);
                    } else {
                        const err = resp ? await resp.json().catch(() => ({})) : { error: 'Request failed' };
                        alert(`Failed to delete department: ${err.error || 'Unknown error'}`);
                    }
                } catch (err) {
                    console.error('Delete department request failed:', err);
                    alert('Failed to delete department due to network error.');
                }
            });
        });
    }

    function setupDepartmentsUI() {
        const openBtn = document.getElementById('open-dept-modal-btn');
        if (openBtn) openBtn.addEventListener('click', () => openDeptModal());

        const modalClose = document.getElementById('dept-modal-close');
        if (modalClose) modalClose.addEventListener('click', closeDeptModal);

        const cancelBtn = document.getElementById('dept-cancel-btn');
        if (cancelBtn) cancelBtn.addEventListener('click', closeDeptModal);

        const form = document.getElementById('dept-form');
        if (form) {
            // Remove all previous submit listeners to prevent duplicates
            const newForm = form.cloneNode(true);
            form.parentNode.replaceChild(newForm, form);
            
            // Add fresh submit listener to the new form
            newForm.addEventListener('submit', async (e) => {
                e.preventDefault();
                const deptId = document.getElementById('dept-id').value;
                const name = document.getElementById('dept_name').value.trim();
                const desc = document.getElementById('dept_description').value.trim();
                
                if (!name) { 
                    alert('Department name is required'); 
                    return; 
                }

                try {
                    const isEdit = !!deptId;
                    
                    // Ask for confirmation before creating/updating
                    const action = isEdit ? 'update' : 'create';
                    const confirmMsg = isEdit 
                        ? `Update department "${name}"?` 
                        : `Create new department "${name}"?`;
                    
                    const confirmed = confirm(confirmMsg);
                    if (!confirmed) return;
                    
                    const url = isEdit ? `/admin/departments/${deptId}` : '/admin/departments';
                    const method = isEdit ? 'PUT' : 'POST';

                    const resp = await fetchWithAuth(url, {
                        method: method,
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ 
                            dept_name: name, 
                            description: desc || null
                        })
                    });

                    if (resp && resp.ok) {
                        // Refresh the departments table
                        const depts = await fetchDepartments();
                        const employees = await fetchEmployees();
                        renderDepartments(depts, employees);
                        closeDeptModal();
                    } else {
                        const err = resp ? await resp.json().catch(() => ({})) : { error: 'Request failed' };
                        alert(`Failed to ${isEdit ? 'update' : 'create'} department: ${err.error || 'Unknown error'}`);
                    }
                } catch (err) {
                    console.error('Department request failed:', err);
                    alert(`Failed to ${deptId ? 'update' : 'create'} department due to network error.`);
                }
            });
        }
    }

    // ensure departments are loaded during initial load
    async function initializeDepartments() {
        try {
            setupDepartmentsUI();
            
            // Show loading state
            const tbody = document.getElementById('departments-tbody');
            if (tbody) {
                tbody.innerHTML = '<tr><td colspan="6" style="text-align: center; padding: 20px;"><div style="display: inline-flex; align-items: center; gap: 10px;"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="animation: spin 1s linear infinite;"><circle cx="12" cy="12" r="10"></circle><path d="M12 6v6l4 2"></path></svg> Loading departments...</div></td></tr>';
            }
            
            const depts = await fetchDepartments();
            const employees = await fetchEmployees();
            renderDepartments(depts, employees);
        } catch (e) {
            console.error('Failed to initialize departments UI:', e);
        }
    }

    // --- Dashboard Functions ---
    async function loadDashboardStats() {
        try {
            // Fetch all users
            const usersResp = await fetchWithAuth('/admin/users?_page=1&_limit=1000', {});
            const usersData = usersResp.ok ? await usersResp.json() : {};
            const users = usersData.data || usersData || [];
            
            // Fetch all departments
            const deptsResp = await fetchWithAuth('/api/admin/departments', {});
            const deptsData = deptsResp.ok ? await deptsResp.json() : {};
            const departments = deptsData.data || deptsData || [];
            
            // Fetch all employees (correct endpoint)
            const empResp = await fetchWithAuth('/api/hr/employees?_page=1&_limit=1000', {});
            const empData = empResp.ok ? await empResp.json() : {};
            const employees = empData.data || empData || [];
            
            // Calculate stats
            const totalUsers = Array.isArray(users) ? users.length : 0;
            const activeUsers = Array.isArray(users) ? users.filter(u => u.status && u.status.toLowerCase() === 'active').length : 0;
            const totalDepartments = Array.isArray(departments) ? departments.length : 0;
            const totalEmployees = Array.isArray(employees) ? employees.length : 0;
            
            // Update dashboard display
            const el = (id) => document.getElementById(id);
            if (el('total-users')) el('total-users').textContent = totalUsers;
            if (el('active-users')) el('active-users').textContent = activeUsers;
            if (el('total-departments')) el('total-departments').textContent = totalDepartments;
            if (el('total-employees')) el('total-employees').textContent = totalEmployees;
            
            console.log('[dashboard] Stats loaded:', { totalUsers, activeUsers, totalDepartments, totalEmployees });
        } catch (error) {
            console.error('[dashboard] Failed to load stats:', error);
        }
    }

    // --- Section Navigation ---
    function setupSectionNavigation() {
        const navItems = document.querySelectorAll('.nav-item');
        const pageTitle = document.getElementById('pageTitle');
        
        const sectionTitles = {
            'dashboard': 'Dashboard',
            'users': 'User Management',
            'departments': 'Departments',
            'settings': 'System Settings',
            'backup': 'Backup & Restore',
            'audit': 'Audit Logs',
            'activity': 'Activity Monitor',
            'invitations': 'Employee Registration',
            'attendance': 'Attendance'
        };
        
        navItems.forEach(item => {
            item.addEventListener('click', () => {
                const section = item.getAttribute('data-section');
                if (!section) return;
                
                // Hide all sections
                document.querySelectorAll('.content-section').forEach(sec => {
                    sec.classList.remove('active');
                });
                
                // Show selected section
                const targetSection = document.getElementById(`section-${section}`);
                if (targetSection) {
                    targetSection.classList.add('active');
                }
                
                // Update active nav item
                navItems.forEach(ni => ni.classList.remove('active'));
                item.classList.add('active');
                
                // Update page title
                if (pageTitle && sectionTitles[section]) {
                    pageTitle.textContent = sectionTitles[section];
                }
                
                // Reload dashboard data when switching to dashboard
                if (section === 'dashboard') {
                    loadDashboardStats();
                }
                
                // Reload departments data when switching to departments section
                if (section === 'departments') {
                    initializeDepartments();
                }
            });
        });
    }

    // --- Initial Load ---
    async function initialize() {
        // Dashboard
        await loadDashboardStats();
        
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
        
        // Departments
        await initializeDepartments();
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
        // Departments section should only be visible under User Management
        const departmentsSection = document.getElementById('departments-section');

        function showSection(sectionName) {
            // Hide all sections
            Object.values(sections).forEach(section => {
                if (section) section.style.display = 'none';
            });
            // Also hide departments by default (it is not part of the sections mapping)
            if (departmentsSection) departmentsSection.style.display = 'none';

            // Hide dashboard overview by default
            if (dashboardOverview) dashboardOverview.style.display = 'none';

            // Show the selected section
            const targetSection = sections[sectionName];
            if (targetSection) {
                targetSection.style.display = 'block';
            }

            // Show departments only for User Management
            if (sectionName === 'User Management' && departmentsSection) {
                departmentsSection.style.display = 'block';
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

    // --- Attendance Functions for Superadmin ---
    async function loadAndRenderAttendanceSuperadmin(){
        try{
            console.log('[Superadmin] Loading all attendance data from:', API_URL);
            
            // fetch employees + attendance from server using HR endpoints (include credentials for cookie auth)
            const [empsResp, attResp] = await Promise.all([
                fetchWithAuth(API_URL + '/hr/employees', {}),
                fetchWithAuth(API_URL + '/hr/attendance', {})
            ]);
            console.log('[Superadmin] Employees response:', empsResp.status);
            console.log('[Superadmin] Attendance response:', attResp.status);
            
            if (!empsResp.ok || !attResp.ok) throw new Error('Failed to load data');
            const empsResult = await empsResp.json();
            const attResult = await attResp.json();
            
            // Extract data from response (API returns {success: true, data: [], pagination: {...}})
            const employees = empsResult.data || empsResult || [];
            const attendance = attResult.data || attResult || [];
            console.log('[Superadmin] Fetched employees:', employees?.length, 'attendance records:', attendance?.length);

            // build a map employee_id -> name
            const empMap = new Map();
            if (Array.isArray(employees)){
                for (const e of employees){ 
                    if (e.employee_id) empMap.set(e.employee_id, e.name || e.full_name); 
                    if (e.id) empMap.set(String(e.id), e.name || e.full_name); 
                    if (e.email) empMap.set((e.email||'').toLowerCase(), e.name || e.full_name); 
                }
            }

            // Get the attendance table for superadmin
            const attTable = document.getElementById('attendanceTableSuperadmin');
            if (!attTable) {
                console.warn('Could not find attendance table for superadmin');
                return;
            }
            
            const tbody = attTable.querySelector('tbody') || attTable.appendChild(document.createElement('tbody'));
            tbody.innerHTML = '';

            // Use all attendance records from server
            const allRecords = Array.isArray(attendance) ? attendance : [];

            if (allRecords.length === 0){
                const tr = document.createElement('tr');
                tr.innerHTML = '<td colspan="7" style="text-align:center;color:var(--muted-foreground);padding:12px;">No attendance records found.</td>';
                tbody.appendChild(tr);
            } else {
                // render rows sorted by date and time (newest first)
                allRecords.sort((a,b) => {
                    const dateComp = (b.date || '').localeCompare(a.date || '');
                    if (dateComp !== 0) return dateComp;
                    return (b.time_in || '').localeCompare(a.time_in || '');
                });
                for (const r of allRecords){
                    const tr = document.createElement('tr');
                    const name = r.employee_name || empMap.get(r.employee_id) || empMap.get(String(r.employee_id)) || r.employee_id || r.email || 'Unknown';
                    const idCell = String(r.employee_id || '');
                    const date = r.date ? new Date(r.date).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: '2-digit' }) : '—';
                    const timeIn = r.time_in ? new Date(`${r.date}T${r.time_in}`).toLocaleTimeString() : (r.timestamp ? new Date(r.timestamp).toLocaleTimeString() : '—');
                    const timeOut = r.time_out ? new Date(`${r.date}T${r.time_out}`).toLocaleTimeString() : '—';
                    const dept = r.employee_department || '—';
                    const status = String(r.status || 'Present');
                    tr.innerHTML = `<td>${escapeHtml(idCell)}</td><td>${escapeHtml(String(name))}</td><td>${escapeHtml(date)}</td><td>${escapeHtml(String(timeIn))}</td><td>${escapeHtml(String(timeOut))}</td><td>${escapeHtml(dept)}</td><td><span class="status ${status.toLowerCase().includes('late')? 'late':'on-time'}">${escapeHtml(status)}</span></td>`;
                    tbody.appendChild(tr);
                }
            }

            // compute overview counts from all attendance records
            const counts = { present: 0, late: 0, absent: 0 };
            for (const r of allRecords){
                const s = (r.status || '').toLowerCase();
                if (s.includes('late')) counts.late += 1;
                else if (s.includes('absent')) counts.absent += 1;
                else counts.present += 1;
            }

            // update attendance section stat cards for superadmin
            try{ const el = document.getElementById('presentCountSuperadmin'); if (el) el.textContent = String(counts.present); }catch(e){}
            try{ const el = document.getElementById('lateCountSuperadmin'); if (el) el.textContent = String(counts.late); }catch(e){}
            try{ const el = document.getElementById('absentCountSuperadmin'); if (el) el.textContent = String(counts.absent); }catch(e){}
        }catch(e){ 
            console.error('[Superadmin] Failed to load attendance', e); 
        }
    }

    // Attendance table filtering for Superadmin
    (function(){
        const deptFilter = document.getElementById('attendanceDeptFilterSuperadmin');
        const statusFilter = document.getElementById('attendanceStatusFilterSuperadmin');
        const searchFilter = document.getElementById('attendanceSearchFilterSuperadmin');
        const tbody = document.querySelector('#attendanceTableSuperadmin tbody');

        if (!deptFilter || !statusFilter || !searchFilter || !tbody) return;

        function applyFilters() {
            const selectedDept = deptFilter.value.toLowerCase();
            const selectedStatus = statusFilter.value.toLowerCase();
            const searchTerm = searchFilter.value.toLowerCase();

            // Get all data rows (not the loading row)
            const rows = tbody.querySelectorAll('tr');
            let visibleCount = 0;

            rows.forEach(row => {
                if (row.querySelector('.attendance-loading-cell')) return; // Skip loading row

                const cells = row.querySelectorAll('td');
                if (cells.length === 0) return;

                // Extract data: ID, Name, Date, TimeIn, TimeOut, Dept, Status
                const employeeId = cells[0]?.textContent.trim() || '';
                const name = cells[1]?.textContent.trim() || '';
                const dept = cells[5]?.textContent.trim() || '';
                const statusCell = cells[6]?.textContent.trim().toLowerCase() || '';

                let show = true;

                // Apply department filter
                if (selectedDept && !dept.toLowerCase().includes(selectedDept)) {
                    show = false;
                }

                // Apply status filter
                if (selectedStatus && !statusCell.includes(selectedStatus)) {
                    show = false;
                }

                // Apply search filter (name or ID)
                if (searchTerm && !name.toLowerCase().includes(searchTerm) && !employeeId.includes(searchTerm)) {
                    show = false;
                }

                row.style.display = show ? '' : 'none';
                if (show) visibleCount++;
            });

            // Populate department filter dropdown if empty
            if (deptFilter.options.length === 1) {
                const depts = new Set();
                rows.forEach(row => {
                    const cells = row.querySelectorAll('td');
                    if (cells.length > 5) {
                        const dept = cells[5]?.textContent.trim();
                        if (dept && dept !== '—') depts.add(dept);
                    }
                });
                depts.forEach(dept => {
                    const option = document.createElement('option');
                    option.value = dept;
                    option.textContent = dept;
                    deptFilter.appendChild(option);
                });
            }
        }

        // Wire filter event listeners
        deptFilter.addEventListener('change', applyFilters);
        statusFilter.addEventListener('change', applyFilters);
        searchFilter.addEventListener('input', applyFilters);
    })();

    // File input handler for restore backup
    (function(){
        const fileInput = document.getElementById('restore-backup-file');
        const fileLabel = document.querySelector('.file-input-label');
        const fileFeedback = document.getElementById('file-feedback');
        const restoreBtn = document.getElementById('restore-backup-btn');

        if (!fileInput || !fileLabel || !fileFeedback || !restoreBtn) return;

        // Handle file selection
        fileInput.addEventListener('change', (e) => {
            const file = e.target.files[0];
            if (file) {
                fileFeedback.textContent = `Selected: ${file.name} (${(file.size / 1024).toFixed(2)} KB)`;
                restoreBtn.disabled = false;
            } else {
                fileFeedback.textContent = 'No file selected';
                restoreBtn.disabled = true;
            }
        });

        // Make label clickable to open file picker
        fileLabel.addEventListener('click', (e) => {
            e.preventDefault();
            fileInput.click();
        });

        // Drag and drop support
        fileLabel.addEventListener('dragover', (e) => {
            e.preventDefault();
            fileLabel.style.backgroundColor = 'var(--bg-input)';
            fileLabel.style.borderColor = 'var(--accent-primary)';
        });

        fileLabel.addEventListener('dragleave', (e) => {
            e.preventDefault();
            fileLabel.style.backgroundColor = '';
            fileLabel.style.borderColor = '';
        });

        fileLabel.addEventListener('drop', (e) => {
            e.preventDefault();
            fileLabel.style.backgroundColor = '';
            fileLabel.style.borderColor = '';
            
            const files = e.dataTransfer.files;
            if (files.length > 0) {
                fileInput.files = files;
                // Trigger change event
                const event = new Event('change', { bubbles: true });
                fileInput.dispatchEvent(event);
            }
        });
    })();

    // Audit Details Modal Functions
    window.openAuditDetailsModal = function(logIndex) {
        const log = window.auditLogsData[logIndex];
        if (!log) {
            console.warn('Log data not found at index:', logIndex);
            return;
        }

        const timestamp = new Date(log.createdAt).toLocaleString();
        const actionType = formatActionType(log.actionType);
        const username = log.userName || `User ID: ${log.userId || 'Unknown'}`;
        const details = log.details || {};

        // Populate modal fields
        document.getElementById('audit-detail-timestamp').textContent = timestamp;
        document.getElementById('audit-detail-user').textContent = username;
        document.getElementById('audit-detail-action').textContent = actionType;

        // Format and display details
        const detailsContent = document.getElementById('audit-detail-content');
        if (details && Object.keys(details).length > 0) {
            detailsContent.innerHTML = `<pre style="margin: 0; white-space: pre-wrap; word-wrap: break-word;">${escapeHtml(JSON.stringify(details, null, 2))}</pre>`;
        } else {
            detailsContent.textContent = 'No additional details available';
        }

        // Show modal
        const modal = document.getElementById('audit-details-modal');
        if (modal) {
            modal.style.display = 'flex';
        } else {
            console.error('Modal element not found');
        }
    };

    window.closeAuditDetailsModal = function() {
        const modal = document.getElementById('audit-details-modal');
        if (modal) {
            modal.style.display = 'none';
        }
    };

    // Close modal when clicking outside
    document.addEventListener('click', (e) => {
        const modal = document.getElementById('audit-details-modal');
        if (e.target === modal) {
            closeAuditDetailsModal();
        }
    });

    document.addEventListener('DOMContentLoaded', () => {
        setupSectionNavigation();
        initialize();
        initializeTabNavigation();
        // Load attendance data when page loads
        loadAndRenderAttendanceSuperadmin();
    });

})();
