/**
 * users.js
 * User Management Module
 */

import { fetchWithAuth, escapeHtml, safeAdd } from './utils.js';

// Internal State
let userCurrentPage = 1;
let userCurrentSearch = '';
let userCurrentRole = 'all';
let userTotalCount = 0;
let isFetchingUsers = false;
const userCache = new Map();

// --- API Functions ---

export async function fetchUsers(page = 1, search = '', role = 'all', limit = null) {
  if (isFetchingUsers) return [];
  isFetchingUsers = true;

  const pageSize = limit || getCurrentPageSize();
  const params = new URLSearchParams({
    _page: page,
    _limit: pageSize,
    q: search,
    role: role
  });

  try {
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

// --- Render Functions ---

export function renderUsers(users, append = false) {
  const tableBody = document.getElementById('user-management-tbody');
  const loadMoreBtn = document.getElementById('load-more-users-btn');

  if (!tableBody) return;

  if (!append) {
    tableBody.innerHTML = '';
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

  // Toggle Load More
  if (loadMoreBtn) {
    const currentRenderedCount = tableBody.querySelectorAll('tr').length;
    loadMoreBtn.style.display = currentRenderedCount < userTotalCount ? 'block' : 'none';
  }

  // Setup scroll indicators and pagination updates
  setTimeout(setupHorizontalScroll, 100);
  updatePaginationControls();
}

export async function refreshUserList() {
  const users = await fetchUsers(userCurrentPage, userCurrentSearch, userCurrentRole);
  renderUsers(users, false);
}

// --- Helper Functions ---

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

function getCurrentPageSize() {
  const select = document.getElementById('rows-per-page');
  return select ? (parseInt(select.value) || 10) : 10;
}

function updatePaginationControls() {
  const pageSize = getCurrentPageSize();
  const totalPages = Math.ceil(userTotalCount / pageSize) || 1;
  const start = (userCurrentPage - 1) * pageSize + 1;
  const end = Math.min(userCurrentPage * pageSize, userTotalCount);

  // safe update
  const textEl = document.getElementById('pagination-text');
  if (textEl) textEl.textContent = `Showing ${userTotalCount > 0 ? start : 0}-${end} of ${userTotalCount} users`;

  const prevBtn = document.getElementById('prev-page-btn');
  if (prevBtn) prevBtn.disabled = userCurrentPage <= 1;

  const nextBtn = document.getElementById('next-page-btn');
  if (nextBtn) nextBtn.disabled = userCurrentPage >= totalPages;

  updatePageNumbers(userCurrentPage, totalPages);
}

function updatePageNumbers(currentPage, totalPages) {
  const pageNumbersContainer = document.getElementById('page-numbers');
  if (!pageNumbersContainer) return;

  pageNumbersContainer.innerHTML = '';

  let startPage = Math.max(1, currentPage - 2);
  let endPage = Math.min(totalPages, currentPage + 2);

  // Adjust range
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
      // Need to update internal state but it's not exported setter so we change module var?
      // No, we should export a way to change page, or just modify local var since we differ modules.
      // Since functions are in same module, we can mod local var.
      changePage(i);
    });
    pageNumbersContainer.appendChild(pageBtn);
  }
}

function changePage(pageNum) {
  userCurrentPage = pageNum;
  refreshUserList();
}

function setupHorizontalScroll() {
  const tableContainer = document.querySelector('#user-management-section .table-container');
  if (!tableContainer || tableContainer.dataset.scrollSetup) return;

  const updateScrollIndicators = () => {
    const hasHorizontalScroll = tableContainer.scrollWidth > tableContainer.clientWidth;
    tableContainer.classList.toggle('has-horizontal-scroll', hasHorizontalScroll);
  };

  tableContainer.addEventListener('scroll', updateScrollIndicators);
  window.addEventListener('resize', updateScrollIndicators);
  updateScrollIndicators();
  tableContainer.dataset.scrollSetup = 'true';
}

// --- Listeners & Actions ---

export function setupUserManagementListeners() {
  const searchInput = document.getElementById('user-search-input');
  const roleSelect = document.getElementById('role-filter-select');
  const loadMoreBtn = document.getElementById('load-more-users-btn');
  const userTableBody = document.getElementById('user-management-tbody');
  const rowsPerPageSelect = document.getElementById('rows-per-page');
  const prevPageBtn = document.getElementById('prev-page-btn');
  const nextPageBtn = document.getElementById('next-page-btn');

  let searchTimeout;
  safeAdd(searchInput, 'input', (e) => {
    clearTimeout(searchTimeout);
    searchTimeout = setTimeout(() => {
      userCurrentSearch = e.target.value;
      userCurrentPage = 1;
      refreshUserList();
    }, 300);
  });

  safeAdd(roleSelect, 'change', (e) => {
    userCurrentRole = e.target.value;
    userCurrentPage = 1;
    refreshUserList();
  });

  if (loadMoreBtn) {
    safeAdd(loadMoreBtn, 'click', () => {
      userCurrentPage++;
      fetchUsers(userCurrentPage, userCurrentSearch, userCurrentRole).then(users => {
        renderUsers(users, true);
      });
    });
  }

  safeAdd(userTableBody, 'click', (e) => {
    const row = e.target.closest('tr');
    if (!row) return;
    const userId = row.dataset.userId;
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

  // Pagination Listeners
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

  setupBulkActions();
  setupUserModal();
}

// --- Bulk Actions ---

function setupBulkActions() {
  const selectAllCheckbox = document.getElementById('select-all-users');
  const bulkActionsDiv = document.getElementById('bulk-actions');
  const selectedCountSpan = bulkActionsDiv ? bulkActionsDiv.querySelector('.selected-count') : null;
  const bulkDeactivateBtn = document.getElementById('bulk-deactivate-btn');
  const bulkReactivateBtn = document.getElementById('bulk-reactivate-btn');

  if (!selectAllCheckbox) return;

  safeAdd(selectAllCheckbox, 'change', function () {
    const checkboxes = document.querySelectorAll('.row-checkbox');
    checkboxes.forEach(checkbox => {
      checkbox.checked = this.checked;
    });
    updateBulkActionsVisibility();
  });

  // Re-attach delegation or specific checks? 
  document.addEventListener('change', function (e) {
    if (e.target.classList.contains('row-checkbox')) {
      updateBulkActionsVisibility();
      const checkboxes = document.querySelectorAll('.row-checkbox');
      const checkedBoxes = document.querySelectorAll('.row-checkbox:checked');

      if (checkedBoxes.length === 0) {
        selectAllCheckbox.indeterminate = false;
        selectAllCheckbox.checked = false;
      } else if (checkedBoxes.length === checkboxes.length) {
        selectAllCheckbox.indeterminate = false;
        selectAllCheckbox.checked = true;
      } else {
        selectAllCheckbox.indeterminate = true;
        selectAllCheckbox.checked = false;
      }
    }
  });

  safeAdd(bulkDeactivateBtn, 'click', async () => {
    const selectedUsers = getSelectedUsers();
    if (selectedUsers.length === 0) return;
    if (!confirm(`Are you sure you want to deactivate ${selectedUsers.length} user(s)?`)) return;
    await performBulkAction(selectedUsers, 'deactivate');
  });

  safeAdd(bulkReactivateBtn, 'click', async () => {
    const selectedUsers = getSelectedUsers();
    if (selectedUsers.length === 0) return;
    if (!confirm(`Are you sure you want to reactivate ${selectedUsers.length} user(s)?`)) return;
    await performBulkAction(selectedUsers, 'reactivate');
  });

  function updateBulkActionsVisibility() {
    const checkedBoxes = document.querySelectorAll('.row-checkbox:checked');
    const count = checkedBoxes.length;
    if (bulkActionsDiv) {
      bulkActionsDiv.style.display = count > 0 ? 'flex' : 'none';
      if (selectedCountSpan) selectedCountSpan.textContent = `${count} user${count === 1 ? '' : 's'} selected`;
    }
  }

  function getSelectedUsers() {
    const checkedBoxes = document.querySelectorAll('.row-checkbox:checked');
    return Array.from(checkedBoxes).map(checkbox => checkbox.dataset.userId);
  }
}

async function performBulkAction(userIds, action) {
  const errors = [];
  for (const userId of userIds) {
    try {
      let response;
      if (action === 'deactivate') {
        response = await fetchWithAuth(`/admin/users/${userId}`, { method: 'DELETE' });
      } else if (action === 'reactivate') {
        response = await fetchWithAuth(`/admin/users/${userId}/reactivate`, { method: 'PUT' });
      }

      if (!response.ok) {
        const error = await response.json();
        errors.push(`User ${userId}: ${error.error}`);
      }
    } catch (err) {
      errors.push(`User ${userId}: Network error`);
    }
  }

  if (errors.length > 0) alert(`Some actions failed:\n${errors.join('\n')}`);

  const selectAll = document.getElementById('select-all-users');
  if (selectAll) {
    selectAll.checked = false;
    selectAll.indeterminate = false;
  }
  refreshUserList();
}

// --- Single User Actions ---

async function handleDeactivate(userId) {
  if (!confirm('Are you sure you want to deactivate this user?')) return;
  try {
    const response = await fetchWithAuth(`/admin/users/${userId}`, { method: 'DELETE' });
    if (response.status === 204 || response.ok) refreshUserList();
    else {
      const error = await response.json();
      alert(`Error: ${error.error}`);
    }
  } catch (err) {
    alert('An unexpected error occurred.');
  }
}

async function handleReactivate(userId) {
  if (!confirm('Are you sure you want to reactivate this user?')) return;
  try {
    const response = await fetchWithAuth(`/admin/users/${userId}/reactivate`, { method: 'PUT' });
    if (response.status === 200 || response.ok) refreshUserList();
    else {
      const error = await response.json();
      alert(`Error: ${error.error}`);
    }
  } catch (err) {
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
    if (response.ok) alert('Password has been reset.');
    else {
      const error = await response.json();
      alert(`Error: ${error.error}`);
    }
  } catch (e) {
    alert('An unexpected error occurred.');
  }
}

// --- Modal ---

function setupUserModal() {
  const userModal = document.getElementById('user-modal');
  const userForm = document.getElementById('user-form');
  if (!userModal || !userForm || userForm.dataset.listenerAttached) return;

  safeAdd(document.getElementById('modal-close-btn'), 'click', closeModal);
  safeAdd(userModal, 'click', (e) => {
    if (e.target === userModal) closeModal();
  });

  userForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const formData = new FormData(userForm);
    const userId = formData.get('userId');
    const data = Object.fromEntries(formData.entries());

    if (!userId) {
      alert('Error: No user ID found for editing.');
      return;
    }

    try {
      const response = await fetchWithAuth(`/admin/users/${userId}`, {
        method: 'PUT',
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
  });
  userForm.dataset.listenerAttached = 'true';
}

function openModal(mode = 'edit', user = null) {
  const userModal = document.getElementById('user-modal');
  const userForm = document.getElementById('user-form');
  const modalTitle = document.getElementById('modal-title');
  const roleSelect = document.getElementById('role');
  const userIdInput = document.getElementById('user-id');

  if (!userModal) return;

  userForm.reset();
  if (mode === 'edit' && user) {
    if (modalTitle) modalTitle.textContent = 'Edit User';
    if (userIdInput) userIdInput.value = user.user_id;

    document.getElementById('firstName').value = user.first_name || '';
    document.getElementById('lastName').value = user.last_name || '';
    document.getElementById('email').value = user.username;

    const roleValue = user.role_name || user.role || '';
    if (roleSelect) {
      setRoleOptions(roleSelect, 'edit');
      roleSelect.value = roleValue.toLowerCase();
    }

    const statusSel = document.getElementById('status');
    if (statusSel) statusSel.value = user.status;
  }
  userModal.style.display = 'flex';
}

function closeModal() {
  const userModal = document.getElementById('user-modal');
  if (userModal) userModal.style.display = 'none';
}

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
