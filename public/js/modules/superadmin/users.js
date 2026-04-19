/**
 * users.js
 * User Management Module
 */

import { fetchWithAuth, escapeHtml, safeAdd, showToast, showConfirmDialog } from './utils.js';

// Internal State
let userCurrentPage = 1;
let userCurrentSearch = '';
let userCurrentRole = 'all';
let userTotalCount = 0;
let isFetchingUsers = false;
let departmentCache = null;
const userCache = new Map();
let activeUserActionMenuTrigger = null;

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

  closeUserActionMenu();

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
                    <td>${displayName ? escapeHtml(displayName) : '<span style="color: #999; font-style: italic;">-</span>'}</td>
                    <td>${escapeHtml(user.username)}</td>
                    <td><span class="status ${roleClass}">${escapeHtml(getDisplayRole(user.role_name))}</span></td>
                    <td><span class="status ${statusClass}">${escapeHtml(user.status)}</span></td>
                    <td>${escapeHtml(lastLogin)}</td>
                    <td>${escapeHtml(user.last_login_ip || 'N/A')}</td>
                    <td>${escapeHtml(user.failed_login_attempts > 0 ? String(user.failed_login_attempts) : 'None')}</td>
                    <td class="actions-column">
                      <div class="action-menu">
                            <button type="button" class="action-menu-trigger" data-user-id="${user.user_id}" aria-haspopup="menu" aria-controls="superadmin-user-action-menu" aria-expanded="false" aria-label="Open user actions" title="Open actions">
                          <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                            <circle cx="12" cy="5" r="1.5"></circle>
                            <circle cx="12" cy="12" r="1.5"></circle>
                            <circle cx="12" cy="19" r="1.5"></circle>
                          </svg>
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
  closeUserActionMenu();
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

function getUserActionMenu() {
  let menu = document.getElementById('superadmin-user-action-menu');
  if (menu) return menu;

  menu = document.createElement('div');
  menu.id = 'superadmin-user-action-menu';
  menu.className = 'user-action-menu';
  menu.hidden = true;
  menu.setAttribute('role', 'menu');
  document.body.appendChild(menu);

  safeAdd(menu, 'click', handleUserActionMenuClick);
  return menu;
}

function buildUserActionMenuMarkup(user) {
  const isActive = (user.status || '').toLowerCase() === 'active';
  const statusLabel = isActive ? 'Deactivate user' : 'Reactivate user';
  const statusClass = isActive ? 'user-action-menu-item--danger' : 'user-action-menu-item--success';
  const statusIcon = isActive
    ? `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M17 22v-2" /><path d="M9 15l6 -6" /><path d="M11 6l.463 -.536a5 5 0 0 1 7.071 7.072l-.534 .464" /><path d="M13 18l-.397 .534a5.068 5.068 0 0 1 -7.127 0a4.972 4.972 0 0 1 0 -7.071l.524 -.463" /><path d="M20 17h2" /><path d="M2 7h2" /><path d="M7 2v2" /></svg>`
    : `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 15l6 -6" /><path d="M11 6l.463 -.536a5 5 0 0 1 7.071 7.072l-.534 .464" /><path d="M13 18l-.397 .534a5.068 5.068 0 0 1 -7.127 0a4.972 4.972 0 0 1 0 -7.071l.524 -.463" /></svg>`;

  return `
    <button type="button" class="user-action-menu-item user-action-menu-item--edit" data-user-action="edit" role="menuitem">
      <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path stroke="none" d="M0 0h24v24H0z" fill="none" />
        <path d="M7 7h-1a2 2 0 0 0 -2 2v9a2 2 0 0 0 2 2h9a2 2 0 0 0 2 -2v-1" />
        <path d="M20.385 6.585a2.1 2.1 0 0 0 -2.97 -2.97l-8.415 8.385v3h3l8.385 -8.415z" />
        <path d="M16 5l3 3" />
      </svg>
      <span>Edit user</span>
    </button>
    <button type="button" class="user-action-menu-item user-action-menu-item--reset" data-user-action="reset" role="menuitem">
      <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path stroke="none" d="M0 0h24v24H0z" fill="none" />
        <path d="M16.555 3.843l3.602 3.602a2.877 2.877 0 0 1 0 4.069l-2.643 2.643a2.877 2.877 0 0 1 -4.069 0l-.301 -.301l-6.558 6.558a2 2 0 0 1 -1.239 .578l-.175 .008h-1.172a1 1 0 0 1 -.993 -.883l-.007 -.117v-1.172a2 2 0 0 1 .467 -1.284l.119 -.13l.414 -.414h2v-2h2v-2l2.144 -2.144l-.301 -.301a2.877 2.877 0 0 1 0 -4.069l2.643 -2.643a2.877 2.877 0 0 1 4.069 0z" />
        <path d="M15 9h.01" />
      </svg>
      <span>Reset password</span>
    </button>
    <button type="button" class="user-action-menu-item ${statusClass}" data-user-action="toggle-status" role="menuitem">
      ${statusIcon}
      <span>${statusLabel}</span>
    </button>
  `;
}

function positionUserActionMenu(menu, trigger) {
  const rect = trigger.getBoundingClientRect();
  const menuRect = menu.getBoundingClientRect();
  const openAbove = window.innerHeight - rect.bottom < menuRect.height + 16;
  const top = openAbove ? Math.max(12, rect.top - menuRect.height - 8) : rect.bottom + 8;

  menu.style.top = `${top}px`;
  menu.style.right = `${Math.max(12, window.innerWidth - rect.right)}px`;
  menu.style.left = 'auto';
}

function openUserActionMenu(trigger, user) {
  const menu = getUserActionMenu();
  const isSameTrigger = activeUserActionMenuTrigger === trigger && !menu.hidden;

  if (isSameTrigger) {
    closeUserActionMenu();
    return;
  }

  closeUserActionMenu();

  menu.innerHTML = buildUserActionMenuMarkup(user);
  menu.dataset.userId = String(user.user_id);
  menu.dataset.userStatus = (user.status || '').toLowerCase();
  menu.hidden = false;
  menu.style.display = 'flex';
  menu.style.visibility = 'hidden';
  menu.style.opacity = '0';

  activeUserActionMenuTrigger = trigger;
  trigger.setAttribute('aria-expanded', 'true');

  positionUserActionMenu(menu, trigger);

  menu.style.visibility = 'visible';
  menu.style.opacity = '1';
}

function closeUserActionMenu() {
  const menu = document.getElementById('superadmin-user-action-menu');
  if (menu) {
    menu.hidden = true;
    menu.style.display = 'none';
    menu.style.visibility = '';
    menu.style.opacity = '';
    menu.style.top = '';
    menu.style.right = '';
    menu.style.left = '';
    menu.dataset.userId = '';
    menu.dataset.userStatus = '';
    menu.innerHTML = '';
  }

  if (activeUserActionMenuTrigger) {
    activeUserActionMenuTrigger.setAttribute('aria-expanded', 'false');
    activeUserActionMenuTrigger = null;
  }
}

function handleUserActionMenuClick(event) {
  const actionButton = event.target.closest('[data-user-action]');
  if (!actionButton) return;

  event.preventDefault();
  event.stopPropagation();

  const menu = actionButton.closest('.user-action-menu');
  const userId = menu?.dataset.userId;
  const action = actionButton.getAttribute('data-user-action');
  const userStatus = menu?.dataset.userStatus || '';

  closeUserActionMenu();

  if (!userId || !action) return;

  const userInfo = userCache.get(String(userId));

  if (action === 'edit') {
    if (userInfo) openModal('edit', userInfo);
    return;
  }

  if (action === 'reset') {
    handleResetPassword(userId);
    return;
  }

  if (action === 'toggle-status') {
    const isActive = userStatus.toLowerCase() === 'active';
    if (isActive) handleDeactivate(userId);
    else handleReactivate(userId);
  }
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
  const openInviteModalBtn = document.getElementById('open-invite-modal-btn');

  if (openInviteModalBtn) {
    safeAdd(openInviteModalBtn, 'click', () => {
        if (window.switchToSection) {
            window.switchToSection('invite');
        }
        if (window.invitationManager) {
            window.invitationManager.clearForm();
        } else {
            console.error('InvitationManager not initialized');
        }
    });
  }

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
    const trigger = e.target.closest('.action-menu-trigger');
    if (!trigger) return;

    const userId = trigger.getAttribute('data-user-id');
    const userInfo = userCache.get(String(userId));
    if (!userInfo) {
      closeUserActionMenu();
      return;
    }

    openUserActionMenu(trigger, userInfo);
  });

  safeAdd(document, 'click', (e) => {
    if (e.target.closest('.action-menu') || e.target.closest('.action-menu-trigger')) return;
    closeUserActionMenu();
  });

  safeAdd(document, 'keydown', (e) => {
    if (e.key === 'Escape') closeUserActionMenu();
  });

  safeAdd(window, 'resize', closeUserActionMenu);
  safeAdd(document, 'scroll', closeUserActionMenu, true);

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
  setupResetPasswordModal();
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
    const confirmed = await showConfirmDialog(
      'Deactivate Users',
      `Are you sure you want to deactivate ${selectedUsers.length} user(s)?`
    );
    if (!confirmed) return;
    await performBulkAction(selectedUsers, 'deactivate');
  });

  safeAdd(bulkReactivateBtn, 'click', async () => {
    const selectedUsers = getSelectedUsers();
    if (selectedUsers.length === 0) return;
    const confirmed = await showConfirmDialog(
      'Reactivate Users',
      `Are you sure you want to reactivate ${selectedUsers.length} user(s)?`
    );
    if (!confirmed) return;
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
  const confirmed = await showConfirmDialog(
    'Deactivate User',
    'Are you sure you want to deactivate this user?'
  );
  if (!confirmed) return;
  try {
    const response = await fetchWithAuth(`/admin/users/${userId}`, { method: 'DELETE' });
    if (response.status === 204 || response.ok) {
      refreshUserList();
      showToast('User deactivated successfully', 'success');
    } else {
      const error = await response.json();
      showToast(`Error: ${error.error}`, 'error');
    }
  } catch (err) {
    showToast('An unexpected error occurred.', 'error');
  }
}

async function handleReactivate(userId) {
  const confirmed = await showConfirmDialog(
    'Reactivate User',
    'Are you sure you want to reactivate this user?'
  );
  if (!confirmed) return;
  try {
    const response = await fetchWithAuth(`/admin/users/${userId}/reactivate`, { method: 'PUT' });
    if (response.status === 200 || response.ok) {
      refreshUserList();
      showToast('User reactivated successfully', 'success');
    } else {
      const error = await response.json();
      showToast(`Error: ${error.error}`, 'error');
    }
  } catch (err) {
    showToast('An unexpected error occurred.', 'error');
  }
}

async function handleResetPassword(userId) {
  const user = Array.from(userCache.values()).find(u => String(u.user_id) === String(userId));
  openResetPasswordModal(userId, user);
}

function setupResetPasswordModal() {
  const modal = document.getElementById('reset-password-modal');
  const form = document.getElementById('reset-password-form');
  if (!modal || !form || form.dataset.listenerAttached) return;

  const closeBtn = document.getElementById('close-reset-password-modal');
  const cancelBtn = document.getElementById('cancel-reset-password-btn');
  const generateBtn = document.getElementById('generate-password-btn');
  const copyBtn = document.getElementById('copy-password-btn');
  const passwordInput = document.getElementById('new-password');

  const closeModal = () => {
    modal.style.display = 'none';
    form.reset();
    const msgDiv = document.getElementById('reset-password-message');
    if (msgDiv) msgDiv.style.display = 'none';
  };

  const showMessage = (msg, isError = true) => {
    const msgDiv = document.getElementById('reset-password-message');
    if (!msgDiv) return;
    msgDiv.textContent = msg;
    msgDiv.style.display = 'block';
    
    if (isError) {
      msgDiv.style.backgroundColor = 'rgba(239, 68, 68, 0.1)';
      msgDiv.style.color = '#ef4444'; 
      msgDiv.style.border = '1px solid rgba(239, 68, 68, 0.2)';
    } else {
      msgDiv.style.backgroundColor = 'rgba(34, 197, 94, 0.1)';
      msgDiv.style.color = '#22c55e';
      msgDiv.style.border = '1px solid rgba(34, 197, 94, 0.2)';
    }
  };

  safeAdd(closeBtn, 'click', closeModal);
  safeAdd(cancelBtn, 'click', closeModal);
  safeAdd(modal, 'click', (e) => {
    if (e.target === modal) closeModal();
  });

  safeAdd(generateBtn, 'click', () => {
    const chars = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%^&*";
    let pass = "";
    for (let i = 0; i < 12; i++) {
        pass += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    passwordInput.value = pass;
  });

  safeAdd(copyBtn, 'click', async () => {
    if (!passwordInput.value) return;
    try {
        await navigator.clipboard.writeText(passwordInput.value);
        const originalText = copyBtn.innerHTML;
        copyBtn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="margin-right: 6px;"><polyline points="20 6 9 17 4 12"></polyline></svg> Copied!';
        setTimeout(() => { copyBtn.innerHTML = originalText; }, 2000);
    } catch (err) {
        console.error('Failed to copy', err);
    }
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    
    const msgDiv = document.getElementById('reset-password-message');
    if (msgDiv) msgDiv.style.display = 'none';
    
    const formData = new FormData(form);
    const userId = formData.get('userId');
    const newPassword = formData.get('password');
    const adminPassword = formData.get('adminPassword');
    
    if (!newPassword || newPassword.length < 8) {
        return showMessage('New password must be at least 8 characters long.', true);
    }
    if (!adminPassword) {
        return showMessage('Please enter your admin password to verify.', true);
    }
    
    const submitBtn = document.getElementById('save-new-password-btn');
    const originalText = submitBtn.textContent;
    submitBtn.textContent = 'Saving...';
    submitBtn.disabled = true;

    try {
      const response = await fetchWithAuth(`/admin/users/${userId}/reset-password`, {
        method: 'PUT',
        body: JSON.stringify({ password: newPassword, adminPassword })
      });
      if (response.ok) {
        showMessage('Password has been successfully reset.', false);
        setTimeout(() => closeModal(), 1500);
      } else {
        const error = await response.json();
        showMessage(`Error: ${error.error || 'Invalid admin password'}`, true);
      }
    } catch (err) {
      showMessage('An unexpected error occurred.', true);
    } finally {
      submitBtn.textContent = originalText;
      submitBtn.disabled = false;
    }
  });
  
  form.dataset.listenerAttached = 'true';
}

function openResetPasswordModal(userId, user) {
  const modal = document.getElementById('reset-password-modal');
  if (!modal) return;
  
  document.getElementById('reset-user-id').value = userId;
  document.getElementById('reset-user-name').textContent = user ? (user.full_name || user.username) : 'this user';
  document.getElementById('new-password').value = '';
  modal.style.display = 'flex';
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
    const role = formData.get('role');
    const dept_id = formData.get('dept_id');

    if (!userId) {
      showToast('Error: No user ID found for editing.', 'error');
      return;
    }

    if (!role && !dept_id) {
      showToast('Error: Must change at least role or department.', 'error');
      return;
    }

    try {
      // Send atomic request with both changes - ensures transactional consistency
      const response = await fetchWithAuth(`/admin/users/${userId}/permissions`, {
        method: 'PUT',
        body: JSON.stringify({ role, dept_id })
      });

      if (!response.ok) {
        const errorData = await response.json();
        showToast(`Error: ${errorData.error || 'Failed to update permissions'}`, 'error');
        return;
      }

      // Success! Both role and department atomically updated
      closeModal();
      refreshUserList();
      showToast('Permissions updated successfully', 'success');
    } catch (err) {
      console.error('Failed to save permissions:', err);
      showToast('An unexpected error occurred.', 'error');
    }
  });
  userForm.dataset.listenerAttached = 'true';
}

async function openModal(mode = 'edit', user = null) {
  const userModal = document.getElementById('user-modal');
  const userForm = document.getElementById('user-form');
  const modalTitle = document.getElementById('modal-title');
  const roleSelect = document.getElementById('role');
  const deptSelect = document.getElementById('dept_id');
  const userIdInput = document.getElementById('user-id');
  const currentDeptDisplay = document.getElementById('current-dept-display');

  if (!userModal) return;

  userForm.reset();
  if (mode === 'edit' && user) {
    if (modalTitle) modalTitle.textContent = 'Manage Permissions';
    if (userIdInput) userIdInput.value = user.user_id;

    // Display current department
    if (currentDeptDisplay) {
      const deptName = user.dept_name || user.departments?.dept_name || 'Not assigned';
      currentDeptDisplay.textContent = deptName;
    }

    // Populate role
    const roleValue = user.role_name || user.role || '';
    if (roleSelect) {
      setRoleOptions(roleSelect, 'edit');
      roleSelect.value = roleValue.toLowerCase();
    }

    // Modal is ready to show
    userModal.style.display = 'flex';

    // Populate department dropdown in background (now fast due to cache)
    if (deptSelect) {
      populateDepartmentSelect(deptSelect, user.dept_id || null);
    }
  } else {
    userModal.style.display = 'flex';
  }
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

/**
 * Populate department dropdown and set selected value
 */
async function populateDepartmentSelect(selectEl, currentDeptId = null) {
  if (!selectEl) return;

  try {
    // Use cache if available
    let departments = departmentCache;

    if (!departments) {
      console.log('🔄 Fetching departments list (first time)...');
      const response = await fetchWithAuth('/admin/departments', {});
      if (!response.ok) {
        console.error('Failed to fetch departments');
        return;
      }

      const result = await response.json();
      departments = result.data || [];
      departmentCache = departments; // Store in cache
    }

    // Build options (keep the placeholder)
    const options = [
      { dept_id: '', dept_name: '-- Select Department --' },
      ...departments
    ];

    selectEl.innerHTML = options
      .map(d => `<option value="${d.dept_id || ''}">${d.dept_name || 'Unknown'}</option>`)
      .join('');

    // Set current department
    if (currentDeptId) {
      selectEl.value = String(currentDeptId);
    }
  } catch (error) {
    console.error('Error populating departments:', error);
  }
}
