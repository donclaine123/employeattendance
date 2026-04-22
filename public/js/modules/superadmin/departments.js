/**
 * departments.js
 * Department Management
 */

import { fetchWithAuth, escapeHtml, safeAdd, showConfirmDialog, showToast } from './utils.js';

let activeDepartmentActionMenuTrigger = null;

export async function fetchDepartments() {
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

export async function fetchEmployees() {
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

export function renderDepartments(depts, employees = []) {
  const tbody = document.getElementById('departments-tbody');
  if (!tbody) return;

  closeDepartmentActionMenu();
  tbody.innerHTML = '';
  if (!depts || depts.length === 0) {
    // Simple, inline fallback row with plain text and an Add button
    tbody.innerHTML = `
            <tr class="no-depts-row">
                <td colspan="6">
                    <div class="no-depts-content">
                        <div class="no-depts-title">No departments yet</div>
              <div class="no-depts-desc">Create your first department to organize employees and track staffing.</div>
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

    // Status badge logic
    const isAssigned = headName !== 'Not Assigned' && headName !== 'Unassigned' && headName !== '';
    const statusClass = isAssigned ? 'on-time' : 'absent';
    const statusText = isAssigned ? 'Active' : 'Missing Head';

    const row = `
            <tr data-dept-id="${d.dept_id || ''}">
                <td><span class="id-badge">${escapeHtml(String(d.dept_id || ''))}</span></td>
                <td><div style="font-weight: 600; color: var(--text-primary);">${escapeHtml(d.dept_name || '')}</div></td>
                <td>
                    <div style="display: flex; align-items: center; gap: 8px;">
                        <span class="status-badge ${statusClass}">${statusText}</span>
                        <span style="font-size: 0.9em;">${escapeHtml(headName)}</span>
                    </div>
                </td>
                <td style="max-width: 300px; font-size: 0.9em; color: var(--text-secondary); line-height: 1.4;">${description}</td>
                <td>
                    <div class="employee-pill">
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path><circle cx="9" cy="7" r="4"></circle><path d="M23 21v-2a4 4 0 0 0-3-3.87"></path><path d="M16 3.13a4 4 0 0 1 0 7.75"></path></svg>
                        <span>${count}</span>
                    </div>
                </td>
                <td class="actions-column">
                  <div class="action-menu">
                    <button type="button" class="action-menu-trigger" aria-haspopup="menu" aria-expanded="false" aria-controls="superadmin-dept-action-menu" title="Open department actions" aria-label="Open department actions" data-dept-id="${escapeHtml(String(d.dept_id || ''))}" data-dept-name="${escapeHtml(d.dept_name || '')}">
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
    tbody.insertAdjacentHTML('beforeend', row);
  });

  attachDepartmentActionListeners();
}

function getDepartmentActionMenu() {
  let menu = document.getElementById('superadmin-dept-action-menu');
  if (menu) return menu;

  menu = document.createElement('div');
  menu.id = 'superadmin-dept-action-menu';
  menu.className = 'user-action-menu';
  menu.hidden = true;
  menu.setAttribute('role', 'menu');
  document.body.appendChild(menu);

  safeAdd(menu, 'click', handleDepartmentActionMenuClick);
  return menu;
}

function buildDepartmentActionMenuMarkup() {
  return `
    <button type="button" class="user-action-menu-item user-action-menu-item--edit" data-dept-action="edit" role="menuitem">
      <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
        <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
      </svg>
      <span>Edit department</span>
    </button>
    <button type="button" class="user-action-menu-item user-action-menu-item--danger" data-dept-action="delete" role="menuitem">
      <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <polyline points="3 6 5 6 21 6"></polyline>
        <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
      </svg>
      <span>Delete department</span>
    </button>
  `;
}

function positionDepartmentActionMenu(menu, trigger) {
  const rect = trigger.getBoundingClientRect();
  const menuRect = menu.getBoundingClientRect();
  const openAbove = window.innerHeight - rect.bottom < menuRect.height + 16;
  const top = openAbove ? Math.max(12, rect.top - menuRect.height - 8) : rect.bottom + 8;

  menu.style.top = `${top}px`;
  menu.style.right = `${Math.max(12, window.innerWidth - rect.right)}px`;
  menu.style.left = 'auto';
}

function openDepartmentActionMenu(trigger, dept) {
  const menu = getDepartmentActionMenu();
  const isSameTrigger = activeDepartmentActionMenuTrigger === trigger && !menu.hidden;

  if (isSameTrigger) {
    closeDepartmentActionMenu();
    return;
  }

  closeDepartmentActionMenu();

  menu.innerHTML = buildDepartmentActionMenuMarkup();
  menu.dataset.deptId = String(dept?.dept_id || '');
  menu.dataset.deptName = String(dept?.dept_name || '');
  menu.hidden = false;
  menu.style.display = 'flex';
  menu.style.visibility = 'hidden';
  menu.style.opacity = '0';

  activeDepartmentActionMenuTrigger = trigger;
  trigger.setAttribute('aria-expanded', 'true');

  positionDepartmentActionMenu(menu, trigger);

  menu.style.visibility = 'visible';
  menu.style.opacity = '1';
}

function closeDepartmentActionMenu() {
  const menu = document.getElementById('superadmin-dept-action-menu');
  if (menu) {
    menu.hidden = true;
    menu.style.display = 'none';
    menu.style.visibility = '';
    menu.style.opacity = '';
    menu.style.top = '';
    menu.style.right = '';
    menu.style.left = '';
    menu.dataset.deptId = '';
    menu.dataset.deptName = '';
    menu.innerHTML = '';
  }

  if (activeDepartmentActionMenuTrigger) {
    activeDepartmentActionMenuTrigger.setAttribute('aria-expanded', 'false');
    activeDepartmentActionMenuTrigger = null;
  }
}

async function handleDepartmentActionMenuClick(event) {
  const actionButton = event.target.closest('[data-dept-action]');
  if (!actionButton) return;

  event.preventDefault();
  event.stopPropagation();

  const menu = actionButton.closest('.user-action-menu');
  const deptId = menu?.dataset.deptId;
  const deptName = menu?.dataset.deptName || 'Department';
  const action = actionButton.getAttribute('data-dept-action');

  closeDepartmentActionMenu();

  if (!deptId || !action) return;

  if (action === 'edit') {
    openDeptModal(deptId);
    return;
  }

  if (action === 'delete') {
    const confirmed = await showConfirmDialog(
      'Delete Department',
      `Are you sure you want to delete the department "${deptName}"?\n\nThis action cannot be undone.`
    );

    if (!confirmed) return;

    try {
      const resp = await fetchWithAuth(`/admin/departments/${deptId}`, {
        method: 'DELETE'
      });

      if (resp && resp.ok) {
        await initializeDepartments();
        showToast(`Department "${deptName}" deleted successfully`, 'success');
      } else {
        const err = resp ? await resp.json().catch(() => ({})) : { error: 'Request failed' };
        showToast(`Failed to delete department: ${err.error || 'Unknown error'}`, 'error');
      }
    } catch (err) {
      console.error('Delete department request failed:', err);
      showToast('Failed to delete department due to network error.', 'error');
    }
  }
}

export function openDeptModal(deptId = null) {
  closeDepartmentActionMenu();
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
      const idInput = document.getElementById('dept-id');
      if (idInput) idInput.value = deptId;

      const nameInput = document.getElementById('dept_name');
      if (nameInput) nameInput.value = cells[1].textContent;

      // Get description but clear it if it says "No description"
      const descText = cells[3].textContent.trim();
      const descInput = document.getElementById('dept_description');
      if (descInput) descInput.value = (descText === 'No description' || descText === 'ND') ? '' : descText;
    }
  } else {
    // Create mode
    if (title) title.textContent = 'Create Department';
    if (submitBtn) submitBtn.textContent = 'Save Department';
    const idInput = document.getElementById('dept-id');
    if (idInput) idInput.value = '';
  }

  modal.style.display = 'flex';
}

export function closeDeptModal() {
  const modal = document.getElementById('dept-modal');
  if (modal) modal.style.display = 'none';
}

function attachDepartmentActionListeners() {
  const tbody = document.getElementById('departments-tbody');
  if (tbody && !tbody.dataset.actionMenuBound) {
    safeAdd(tbody, 'click', (event) => {
      const trigger = event.target.closest('.action-menu-trigger');
      if (!trigger) return;

      event.preventDefault();
      event.stopPropagation();

      const row = trigger.closest('tr');
      const deptId = row?.getAttribute('data-dept-id');
      const deptName = trigger.getAttribute('data-dept-name') || row?.querySelector('td:nth-child(2)')?.textContent?.trim() || 'Department';

      if (!deptId) return;

      openDepartmentActionMenu(trigger, {
        dept_id: deptId,
        dept_name: deptName
      });
    });

    tbody.dataset.actionMenuBound = 'true';
  }

  if (!document.body.dataset.departmentActionMenuBound) {
    safeAdd(document, 'click', (event) => {
      if (event.target.closest('.action-menu') || event.target.closest('.action-menu-trigger')) return;
      closeDepartmentActionMenu();
    });

    safeAdd(document, 'keydown', (event) => {
      if (event.key === 'Escape') closeDepartmentActionMenu();
    });

    safeAdd(window, 'resize', closeDepartmentActionMenu);
    safeAdd(document, 'scroll', closeDepartmentActionMenu, true);

    document.body.dataset.departmentActionMenuBound = 'true';
  }
}

// --- Setup and Init ---

function setupDepartmentsUI() {
  const openBtn = document.getElementById('open-dept-modal-btn');
  if (openBtn) safeAdd(openBtn, 'click', () => openDeptModal());

  const modalClose = document.getElementById('dept-modal-close');
  if (modalClose) safeAdd(modalClose, 'click', closeDeptModal);

  const cancelBtn = document.getElementById('dept-cancel-btn');
  if (cancelBtn) safeAdd(cancelBtn, 'click', closeDeptModal);

  // Add search listener
  const searchInput = document.getElementById('dept-search-input');
  if (searchInput && !searchInput.dataset.listenerAttached) {
    searchInput.addEventListener('input', (e) => {
      const query = e.target.value.toLowerCase();
      const rows = document.querySelectorAll('#departments-tbody tr:not(.no-depts-row)');
      
      let visibleCount = 0;
      rows.forEach(row => {
        const text = row.textContent.toLowerCase();
        const isVisible = text.includes(query);
        row.style.display = isVisible ? '' : 'none';
        if (isVisible) visibleCount++;
      });

      // Handle "No results"
      const tbody = document.getElementById('departments-tbody');
      const noResultsRow = document.getElementById('dept-no-results');
      if (visibleCount === 0 && query !== '') {
        if (!noResultsRow) {
          tbody.insertAdjacentHTML('beforeend', `
            <tr id="dept-no-results">
              <td colspan="6" style="text-align: center; padding: 40px; color: var(--text-secondary);">
                <div style="margin-bottom: 8px;"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg></div>
                No departments found matching "${escapeHtml(query)}"
              </td>
            </tr>
          `);
        }
      } else if (noResultsRow) {
        noResultsRow.remove();
      }
    });
    searchInput.dataset.listenerAttached = 'true';
  }

  const form = document.getElementById('dept-form');
  // We can't easily remove anonymous listeners, but we can clone/replacenode or use safeAdd with a check
  // safeAdd uses a flag, so it's fine.

  if (form) {
    // We use a dedicated handler function to ensure we don't duplicate logic
    const submitHandler = async (e) => {
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
        const title = isEdit ? 'Update Department' : 'Create Department';
        const confirmMsg = isEdit
          ? `Are you sure you want to update department "${name}"?`
          : `Are you sure you want to create new department "${name}"?`;

        const confirmed = await showConfirmDialog(title, confirmMsg);
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
          await initializeDepartments();
          closeDeptModal();
          showToast(`Department "${name}" ${isEdit ? 'updated' : 'created'} successfully`, 'success');
        } else {
          const err = resp ? await resp.json().catch(() => ({})) : { error: 'Request failed' };
          showToast(`Failed to ${isEdit ? 'update' : 'create'} department: ${err.error || 'Unknown error'}`, 'error');
        }
      } catch (err) {
        console.error('Department request failed:', err);
        showToast(`Failed to ${deptId ? 'update' : 'create'} department due to network error.`, 'error');
      }
    };

    // Remove old if possible? No. Just use safeAdd or assume fresh load.
    // If we switch tabs and re-exec, we might duplicate.
    // Cloning the form removes listeners.
    if (!form.dataset.listenerAttached) {
      form.addEventListener('submit', submitHandler);
      form.dataset.listenerAttached = 'true';
    }
  }
}

export async function initializeDepartments() {
  try {
    setupDepartmentsUI();

    // Show loading state
    const tbody = document.getElementById('departments-tbody');
    if (tbody) {
      tbody.innerHTML = '<tr><td colspan="6" style="text-align: center; padding: 20px;"><div style="display: inline-flex; align-items: center; gap: 10px;">Loading departments...</div></td></tr>';
    }

    const depts = await fetchDepartments();
    const employees = await fetchEmployees();
    renderDepartments(depts, employees);
  } catch (e) {
    console.error('Failed to initialize departments UI:', e);
    const tbody = document.getElementById('departments-tbody');
    if (tbody) {
      tbody.innerHTML = '<tr><td colspan="6" style="text-align: center; color: red; padding: 20px;">Error loading departments</td></tr>';
    }
  }
}
