/**
 * employees.js
 * HR Employee Management Module
 */

import { fetchWithAuth, escapeHtml, normalize, debounce, formatDate, formatLastLogin, formatRoleDisplay } from './utils.js';

let currentEmployees = [];
let filteredEmployees = [];
let currentPage = 1;
let rowsPerPage = 10;
let currentSort = 'newest';
let selectedEmployees = new Set();
let currentEditingShiftTypeId = null;

// DOM Elements
function getElements() {
  return {
    tbody: document.getElementById('employeesTableBody'),
    searchInput: document.getElementById('hr-search'),
    deptSelect: document.getElementById('hr-dept'),
    sortSelect: document.getElementById('hr-sort'),
    rowsSelect: document.getElementById('rowsPerPage'),
    prevBtn: document.getElementById('prevPage'),
    nextBtn: document.getElementById('nextPage'),
    paginationInfo: document.getElementById('paginationInfo'),
    pageNumbers: document.getElementById('pageNumbers'),
    tableFooter: document.querySelector('.employees-pagination-footer') || document.querySelector('.table-footer'),
    selectAllCheckbox: document.getElementById('selectAll'),
    bulkActions: document.getElementById('bulkActions'),
    selectedCount: document.getElementById('selectedCount'),
    tableContainer: document.querySelector('.employees-table-container') || document.querySelector('.table-container')
  };
}

export async function initEmployeeManagement() {
  console.log('[HR] Initializing Employee Management...');
  const els = getElements();

  // Initial Load
  await loadAndRenderEmployees();

  // Event Listeners
  if (els.searchInput) els.searchInput.addEventListener('input', debounce(applyFilters, 300));
  if (els.deptSelect) els.deptSelect.addEventListener('change', applyFilters);
  if (els.sortSelect) {
    currentSort = els.sortSelect.value || currentSort;
    els.sortSelect.addEventListener('change', (e) => {
      currentSort = e.target.value || 'newest';
      filteredEmployees = sortEmployees(filteredEmployees);
      currentPage = 1;
      renderEmployeesTable();
    });
  }
  if (els.rowsSelect) {
    els.rowsSelect.addEventListener('change', (e) => {
      rowsPerPage = parseInt(e.target.value);
      currentPage = 1;
      renderEmployeesTable();
    });
  }

  if (els.prevBtn) els.prevBtn.addEventListener('click', () => { if (currentPage > 1) goToPage(currentPage - 1); });
  if (els.nextBtn) els.nextBtn.addEventListener('click', () => {
    const totalPages = Math.ceil(filteredEmployees.length / rowsPerPage);
    if (currentPage < totalPages) goToPage(currentPage + 1);
  });

  if (els.selectAllCheckbox) {
    els.selectAllCheckbox.addEventListener('change', (e) => {
      const isChecked = e.target.checked;
      if (isChecked) {
        const visibleEmployees = getVisibleEmployees();
        visibleEmployees.forEach(emp => selectedEmployees.add(emp.id));
      } else {
        selectedEmployees.clear();
      }
      renderEmployeesTable();
      updateBulkActions();
    });
  }

  if (els.tableContainer) {
    els.tableContainer.addEventListener('click', handleTableClick);
    els.tableContainer.addEventListener('mouseover', handleTableHover);
    els.tableContainer.addEventListener('mouseout', handleTableMouseOut);
  }

  // Initialize Bulk Actions
  const bulkDeactivateBtn = document.getElementById('bulkDeactivateBtn');
  if (bulkDeactivateBtn) bulkDeactivateBtn.addEventListener('click', bulkDeactivateEmployees);

  // Expose needed functions globally for now if legacy code needs them, 
  // though we aim to encapsulate everything.
  window.loadAndRenderEmployees = loadAndRenderEmployees;
}

export async function loadAndRenderEmployees() {
  try {
    const resp = await fetchWithAuth('/hr/employees', {});
  if (!resp.ok) throw new Error('failed');
  const responseData = await resp.json();
  const employees = responseData.data || responseData;

  // Store and filter
  currentEmployees = employees
    .filter(e => {
      const roleName = e.role_name || e.role || '';
      return roleName !== 'superadmin' && roleName !== 'head_dept' && roleName !== 'hr';
    })
    .map(e => ({
      id: String(e.employee_id || e.id),
      name: e.name || e.full_name || '',
      employee_id: e.employee_id || (e.id ? String(e.id) : ''),
      position: e.position || 'Not specified',
      email: e.email || 'No email',
      department: e.department || e.dept_name || '',
      dept_id: e.dept_id,
      hire_date: e.hire_date || 'Not specified',
      last_login: e.last_login || 'Never',
      status: e.status || 'Active',
      phone: e.phone || 'Not provided',
      role: e.role || ''
    }));

  filteredEmployees = sortEmployees(currentEmployees);

  populateDepartmentFilter();
  renderEmployeesTable();

} catch (e) {
  console.error('Failed to load employees', e);
  showEmptyState();
}
}

function populateDepartmentFilter() {
  const els = getElements();
  if (!els.deptSelect) return;

  // Clear except first
  while (els.deptSelect.options.length > 1) els.deptSelect.remove(1);

  const deptSet = new Set();
  currentEmployees.forEach(emp => {
    if (emp.department) deptSet.add(emp.department.trim());
  });

  Array.from(deptSet).sort().forEach(dept => {
    const opt = document.createElement('option');
    opt.value = dept;
    opt.textContent = dept.charAt(0).toUpperCase() + dept.slice(1);
    els.deptSelect.appendChild(opt);
  });
}

function getLastLoginTimestamp(lastLogin) {
  if (!lastLogin || lastLogin === 'Never') return null;
  const timestamp = new Date(lastLogin).getTime();
  return Number.isFinite(timestamp) ? timestamp : null;
}

function sortEmployees(records) {
  const sortedRecords = [...records];

  switch (currentSort) {
    case 'oldest':
      sortedRecords.sort((a, b) => {
        const aTime = getLastLoginTimestamp(a.last_login);
        const bTime = getLastLoginTimestamp(b.last_login);

        if (aTime === null && bTime === null) {
          return normalize(a.name).localeCompare(normalize(b.name));
        }

        if (aTime === null) return 1;
        if (bTime === null) return -1;

        if (aTime === bTime) {
          return normalize(a.name).localeCompare(normalize(b.name));
        }

        return aTime - bTime;
      });
      break;

    case 'name-asc':
      sortedRecords.sort((a, b) => normalize(a.name).localeCompare(normalize(b.name)));
      break;

    case 'name-desc':
      sortedRecords.sort((a, b) => normalize(b.name).localeCompare(normalize(a.name)));
      break;

    case 'newest':
    default:
      sortedRecords.sort((a, b) => {
        const aTime = getLastLoginTimestamp(a.last_login);
        const bTime = getLastLoginTimestamp(b.last_login);

        if (aTime === null && bTime === null) {
          return normalize(a.name).localeCompare(normalize(b.name));
        }

        if (aTime === null) return 1;
        if (bTime === null) return -1;

        if (aTime === bTime) {
          return normalize(b.name).localeCompare(normalize(a.name));
        }

        return bTime - aTime;
      });
      break;
  }

  return sortedRecords;
}

function renderEmployeesTable() {
  const els = getElements();
  if (!els.tbody) return;

  els.tbody.innerHTML = '';

  if (filteredEmployees.length === 0) {
    showEmptyState();
    return;
  }

  const startIndex = (currentPage - 1) * rowsPerPage;
  const endIndex = startIndex + rowsPerPage;
  const pageEmployees = filteredEmployees.slice(startIndex, endIndex);

  pageEmployees.forEach(emp => {
    const tr = document.createElement('tr');
    tr.dataset.employeeId = emp.id;
    tr.className = selectedEmployees.has(emp.id) ? 'selected' : '';

    const statusClass = (emp.status || '').toLowerCase();

    tr.innerHTML = `
          <td class="checkbox-column">
            <input type="checkbox" class="row-checkbox" data-employee-id="${emp.id}" ${selectedEmployees.has(emp.id) ? 'checked' : ''}>
          </td>
          <td>${escapeHtml(emp.employee_id)}</td>
          <td class="employee-name" data-employee-id="${emp.id}">${escapeHtml(emp.name)}</td>
          <td>${escapeHtml(emp.email)}</td>
          <td>${escapeHtml(emp.department)}</td>
          <td>${formatLastLogin(emp.last_login)}</td>
          <td><span class="status ${statusClass}">${escapeHtml(emp.status)}</span></td>
          <td class="actions-column">
            <div class="action-buttons">
              <button class="action-btn edit-btn" data-employee-id="${emp.id}" title="Edit Employee">
                <svg xmlns="http://www.w3.org/2000/svg" width="25" height="25" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="action-icon">
                  <path stroke="none" d="M0 0h24v24H0z" fill="none"/>
                  <path d="M7 7h-1a2 2 0 0 0 -2 2v9a2 2 0 0 0 2 2h9a2 2 0 0 0 2 -2v-1" />
                  <path d="M20.385 6.585a2.1 2.1 0 0 0 -2.97 -2.97l-8.415 8.385v3h3l8.385 -8.415z" />
                  <path d="M16 5l3 3" />
                </svg>
              </button>
              <button class="action-btn ${statusClass === 'active' ? 'deactivate-btn' : 'reactivate-btn'}" 
                      data-employee-id="${emp.id}" 
                      title="${statusClass === 'active' ? 'Deactivate Employee' : 'Reactivate Employee'}">
                ${statusClass === 'active' ?
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
        `;
    els.tbody.appendChild(tr);
  });

  updatePagination();
  updateBulkActions();
}

function showEmptyState() {
  const els = getElements();
  if (!els.tbody) return;
  els.tbody.innerHTML = `
        <tr id="hr-empty-row">
          <td colspan="9" style="text-align:center;color:var(--muted-foreground);padding:18px;">
            No employees found.
          </td>
        </tr>
    `;
  if (els.tableFooter) els.tableFooter.style.display = 'none';
}

function updatePagination() {
  const els = getElements();
  const totalEmployees = filteredEmployees.length;
  const totalPages = Math.ceil(totalEmployees / rowsPerPage);

  if (els.paginationInfo) {
    const startIndex = totalEmployees === 0 ? 0 : (currentPage - 1) * rowsPerPage + 1;
    const endIndex = Math.min(startIndex + rowsPerPage - 1, totalEmployees);
    els.paginationInfo.textContent = `Showing ${startIndex}-${endIndex} of ${totalEmployees} employees`;
  }

  if (els.prevBtn) els.prevBtn.disabled = currentPage === 1;
  if (els.nextBtn) els.nextBtn.disabled = currentPage === totalPages || totalPages === 0;

  if (els.pageNumbers) {
    els.pageNumbers.innerHTML = '';
    const maxVisible = 5;
    let startPage = Math.max(1, currentPage - Math.floor(maxVisible / 2));
    let endPage = Math.min(totalPages, startPage + maxVisible - 1);

    if (endPage - startPage < maxVisible - 1) {
      startPage = Math.max(1, endPage - maxVisible + 1);
    }

    for (let i = startPage; i <= endPage; i++) {
      const pageBtn = document.createElement('button');
      pageBtn.className = `page-number ${i === currentPage ? 'active' : ''}`;
      pageBtn.textContent = i;
      pageBtn.addEventListener('click', () => goToPage(i));
      els.pageNumbers.appendChild(pageBtn);
    }
  }

  if (els.tableFooter) els.tableFooter.style.display = totalEmployees > 0 ? 'flex' : 'none';
}

function goToPage(page) {
  currentPage = page;
  renderEmployeesTable();
}

function applyFilters() {
  const els = getElements();
  const searchTerm = (els.searchInput?.value || '').toLowerCase().trim();
  const deptFilter = els.deptSelect?.value || '';

  filteredEmployees = currentEmployees.filter(emp => {
    const matchesSearch = !searchTerm ||
      (emp.name || '').toLowerCase().includes(searchTerm) ||
      String(emp.employee_id || '').toLowerCase().includes(searchTerm) ||
      (emp.department || '').toLowerCase().includes(searchTerm) ||
      (emp.email || '').toLowerCase().includes(searchTerm);

    const matchesDept = !deptFilter || emp.department === deptFilter;
    return matchesSearch && matchesDept;
  });

  filteredEmployees = sortEmployees(filteredEmployees);

  currentPage = 1;
  renderEmployeesTable();
}

function getVisibleEmployees() {
  const startIndex = (currentPage - 1) * rowsPerPage;
  const endIndex = startIndex + rowsPerPage;
  return filteredEmployees.slice(startIndex, endIndex);
}

function updateBulkActions() {
  const els = getElements();
  if (els.bulkActions && els.selectedCount) {
    const count = selectedEmployees.size;
    if (count > 0) {
      els.bulkActions.style.display = 'flex';
      els.selectedCount.textContent = `${count} selected`;
    } else {
      els.bulkActions.style.display = 'none';
    }
  }
}

function updateSelectAllCheckbox() {
  const els = getElements();
  if (!els.selectAllCheckbox) return;

  const visibleEmployees = getVisibleEmployees();
  const visibleSelectedCount = visibleEmployees.filter(emp => selectedEmployees.has(emp.id)).length;

  if (visibleSelectedCount === 0) {
    els.selectAllCheckbox.checked = false;
    els.selectAllCheckbox.indeterminate = false;
  } else if (visibleSelectedCount === visibleEmployees.length) {
    els.selectAllCheckbox.checked = true;
    els.selectAllCheckbox.indeterminate = false;
  } else {
    els.selectAllCheckbox.checked = false;
    els.selectAllCheckbox.indeterminate = true;
  }
}

function handleTableClick(e) {
  const target = e.target;

  // Checkbox
  if (target.classList.contains('row-checkbox')) {
    const employeeId = target.dataset.employeeId;
    if (target.checked) selectedEmployees.add(employeeId);
    else selectedEmployees.delete(employeeId);
    updateBulkActions();
    updateSelectAllCheckbox();
    return;
  }

  // Edit Btn
  if (target.closest('.edit-btn')) {
    const btn = target.closest('.edit-btn');
    const employeeId = btn.dataset.employeeId;
    const employee = currentEmployees.find(e => e.id === employeeId);
    if (employee) openEditModal(employee);
    return;
  }

  // Toggle Status Btn
  if (target.closest('.deactivate-btn') || target.closest('.reactivate-btn')) {
    const btn = target.closest('.deactivate-btn') || target.closest('.reactivate-btn');
    const employeeId = btn.dataset.employeeId;
    const action = btn.classList.contains('deactivate-btn') ? 'deactivate' : 'reactivate';
    toggleEmployeeStatus(employeeId, action);
    return;
  }

  // Detail Card
  if (target.classList.contains('employee-name')) {
    const employeeId = target.dataset.employeeId;
    showEmployeeDetailCard(e, employeeId);
  }
}

function handleTableHover(e) {
  if (e.target.classList.contains('employee-name')) {
    e.target.style.cursor = 'pointer';
    e.target.style.textDecoration = 'underline';
  }
}

function handleTableMouseOut(e) {
  if (e.target.classList.contains('employee-name')) {
    e.target.style.textDecoration = 'none';
  }
}

async function loadDepartments(selectElement) {
  try {
    const response = await fetchWithAuth(`${window.API_URL || '/api'}/hr/departments`, {});
    if (response.ok) {
      const responseData = await response.json();
      const departments = responseData.data || responseData;
      departments.forEach(dept => {
        const option = document.createElement('option');
        option.value = dept.dept_id;
        option.textContent = dept.dept_name;
        selectElement.appendChild(option);
      });
    }
  } catch (error) {
    console.error('Error loading departments:', error);
  }
}

async function openEditModal(existingEmployee) {
  if (document.querySelector('.hr-edit-modal')) return;

  // We might need fresh full data
  let employeeData = existingEmployee;
  try {
    const response = await fetchWithAuth(`/hr/employees/${existingEmployee.id}`, {});
    if (response.ok) {
      const data = await response.json();
      employeeData = data.data || data;
    }
  } catch (e) {
    console.warn('Could not fetch fresh details, using existing table data', e);
  }

  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop hr-edit-modal-backdrop';
  const modal = document.createElement('div');
  modal.className = 'reset-modal hr-edit-modal';
  modal.style.maxWidth = '760px';
  modal.style.width = 'min(92vw, 760px)';

  modal.innerHTML = `
        <div class="modal-card" style="max-width: 760px; width: 100%;">
          <button class="modal-close-btn" type="button">✕</button>
          <div class="modal-header">
            <h3 class="modal-title">Edit Employee</h3>
          </div>
          <div class="modal-body" style="display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 16px;">
            <div class="form-group">
              <label for="editEmployeeFirstName">First name *</label>
              <input id="editEmployeeFirstName" class="first-name" type="text" required autocomplete="given-name" />
            </div>
            <div class="form-group">
              <label for="editEmployeeLastName">Last name *</label>
              <input id="editEmployeeLastName" class="last-name" type="text" required autocomplete="family-name" />
            </div>
            <div class="form-group" style="grid-column: 1 / -1;">
              <label for="editEmployeeEmail">Email Address *</label>
              <input id="editEmployeeEmail" class="email" type="email" required autocomplete="email" />
            </div>
            <div class="form-group">
              <label for="editEmployeePhone">Phone</label>
              <input id="editEmployeePhone" class="phone" type="tel" autocomplete="tel" />
            </div>
            <div class="form-group">
              <label for="editEmployeePosition">Position</label>
              <input id="editEmployeePosition" class="position" type="text" autocomplete="organization-title" />
            </div>
            <div class="form-group">
              <label for="editEmployeeDepartment">Department</label>
              <select id="editEmployeeDepartment" class="dept-select"><option value="">Select Department</option></select>
            </div>
            <div class="form-group">
              <label for="editEmployeeStatus">Employee Status *</label>
              <select id="editEmployeeStatus" class="status-select" required>
                <option value="active">Active</option>
                <option value="inactive">Inactive</option>
                <option value="suspended">Suspended</option>
              </select>
            </div>
            <div class="form-group">
              <label for="editEmployeeHireDate">Hire Date</label>
              <input id="editEmployeeHireDate" class="hire-date" type="date" autocomplete="off" />
            </div>
          </div>
          <div class="modal-footer">
            <button class="btn-secondary hr-edit-cancel-btn" type="button">Cancel</button>
            <button class="modal-send-btn" type="button">Update Employee</button>
          </div>
        </div>
    `;

  document.body.appendChild(backdrop);
  document.body.appendChild(modal);

  const close = () => { modal.remove(); backdrop.remove(); };
  modal.querySelector('.modal-close-btn').addEventListener('click', close);
  modal.querySelector('.hr-edit-cancel-btn').addEventListener('click', close);
  backdrop.addEventListener('click', close);

  const fnInput = modal.querySelector('.first-name');
  const lnInput = modal.querySelector('.last-name');
  const emailInput = modal.querySelector('.email');
  const phoneInput = modal.querySelector('.phone');
  const posInput = modal.querySelector('.position');
  const deptSelect = modal.querySelector('.dept-select');
  const statusSelect = modal.querySelector('.status-select');
  const dateInput = modal.querySelector('.hire-date');
  const sendBtn = modal.querySelector('.modal-send-btn');

  await loadDepartments(deptSelect);

  // Fill Data
  fnInput.value = employeeData.first_name || '';
  lnInput.value = employeeData.last_name || '';
  emailInput.value = employeeData.email || '';
  phoneInput.value = employeeData.phone || '';
  posInput.value = employeeData.position || '';
  statusSelect.value = (employeeData.status || 'active').toLowerCase();
  if (employeeData.dept_id) deptSelect.value = employeeData.dept_id;
  if (employeeData.hire_date) dateInput.value = employeeData.hire_date.split('T')[0];

  sendBtn.addEventListener('click', async () => {
    const payload = {
      first_name: fnInput.value.trim(),
      last_name: lnInput.value.trim(),
      email: emailInput.value.trim(),
      phone: phoneInput.value.trim(),
      position: posInput.value.trim(),
      status: statusSelect.value,
      dept_id: deptSelect.value ? parseInt(deptSelect.value) : null,
      hire_date: dateInput.value || null
    };

    if (!payload.first_name || !payload.last_name || !payload.email) {
      alert('Missing required fields');
      return;
    }

    try {
      sendBtn.textContent = 'Updating...';
      sendBtn.disabled = true;
      const res = await fetchWithAuth(`/hr/employees/${employeeData.id || employeeData.employee_id}`, {
        method: 'PUT',
        body: JSON.stringify(payload)
      });
      if (!res.ok) throw new Error('Update failed');
      alert('Employee updated!');
      close();
      loadAndRenderEmployees();
    } catch (e) {
      console.error(e);
      alert('Error updating: ' + e.message);
    } finally {
      sendBtn.textContent = 'Update Employee';
      sendBtn.disabled = false;
    }
  });
}

function showEmployeeDetailCard(event, employeeId) {
  const employee = currentEmployees.find(e => e.id === employeeId);
  if (!employee) return;

  const existing = document.querySelector('.employee-detail-card');
  if (existing) existing.remove();

  const card = document.createElement('div');
  card.className = 'employee-detail-card show';
  const initials = (employee.name || 'U').split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase();

  card.innerHTML = `
        <div class="detail-card-header">
          <div class="detail-card-avatar">${initials}</div>
          <div>
            <h4 class="detail-card-name">${escapeHtml(employee.name)}</h4>
            <p class="detail-card-role">${escapeHtml(employee.position)}</p>
          </div>
        </div>
        <div class="detail-card-body">
          <div class="detail-row"><span class="detail-label">Email:</span> ${escapeHtml(employee.email)}</div>
          <div class="detail-row"><span class="detail-label">Phone:</span> ${escapeHtml(employee.phone)}</div>
          <div class="detail-row"><span class="detail-label">Dept:</span> ${escapeHtml(employee.department)}</div>
          <div class="detail-row"><span class="detail-label">Status:</span> ${escapeHtml(employee.status)}</div>
        </div>
    `;

  const rect = event.target.getBoundingClientRect();
  card.style.left = `${rect.right + 10}px`;
  card.style.top = `${rect.top}px`;
  document.body.appendChild(card);

  const remove = () => card.remove();
  setTimeout(remove, 4000);
  document.addEventListener('click', function h(e) {
    if (!card.contains(e.target) && e.target !== event.target) {
      remove();
      document.removeEventListener('click', h);
    }
  });
}

async function bulkDeactivateEmployees() {
  if (selectedEmployees.size === 0) return;
  if (!confirm(`Deactivate ${selectedEmployees.size} employees?`)) return;
  alert('Bulk actions not fully implemented on backend yet.');
}

async function toggleEmployeeStatus(id, action) {
  if (!confirm(`Are you sure you want to ${action} this employee?`)) return;
  try {
    const newStatus = action === 'deactivate' ? 'inactive' : 'active';
    // We need full employee object first to respect PUT requirements often
    // But let's assume we can patch or put. HR.js used PUT with full object.
    // We will fetch then PUT.
    const resGet = await fetchWithAuth(`/hr/employees/${id}`);
    const data = await resGet.json();
    const emp = data.data || data;

    const res = await fetchWithAuth(`/hr/employees/${id}`, {
      method: 'PUT',
      body: JSON.stringify({ ...emp, status: newStatus })
    });
    if (!res.ok) throw new Error('Failed to update status');
    loadAndRenderEmployees();
  } catch (e) {
    alert(e.message);
  }
}
