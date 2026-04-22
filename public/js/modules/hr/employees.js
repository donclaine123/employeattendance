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

  if (els.tableContainer) {
    els.tableContainer.addEventListener('click', handleTableClick);
    els.tableContainer.addEventListener('mouseover', handleTableHover);
    els.tableContainer.addEventListener('mouseout', handleTableMouseOut);
  }

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
      const roleName = (e.role_name || e.role || '').toLowerCase();
      const roleId = Number(e.role_id ?? 0);
      const excludedRoleNames = new Set(['superadmin', 'head_dept', 'hr', 'monitoring']);
      const excludedRoleIds = new Set([1, 2, 3]);
      if (roleName) return !excludedRoleNames.has(roleName);
      if (roleId) return !excludedRoleIds.has(roleId);
      return true;
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
      role: e.role || e.role_name || '',
      role_id: e.role_id || null,
      role_name: e.role_name || e.role || ''
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

    const statusClass = (emp.status || '').toLowerCase();

    tr.innerHTML = `
          <td>${escapeHtml(emp.employee_id)}</td>
          <td class="employee-name" data-employee-id="${emp.id}">${escapeHtml(emp.name)}</td>
          <td>${escapeHtml(emp.email)}</td>
          <td>${escapeHtml(emp.department)}</td>
          <td>${formatLastLogin(emp.last_login)}</td>
          <td><span class="status ${statusClass}">${escapeHtml(emp.status)}</span></td>
          <td class="actions-column">
            <div class="action-buttons">
              <button class="action-btn info-btn" data-employee-id="${emp.id}" title="View Information" aria-label="View employee information">
                <svg xmlns="http://www.w3.org/2000/svg" width="25" height="25" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="action-icon">
                  <path stroke="none" d="M0 0h24v24H0z" fill="none"/>
                  <path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6-10-6-10-6z" />
                  <circle cx="12" cy="12" r="3" />
                </svg>
              </button>
            </div>
          </td>
        `;
    els.tbody.appendChild(tr);
  });

  updatePagination();
}

function showEmptyState() {
  const els = getElements();
  if (!els.tbody) return;
  els.tbody.innerHTML = `
        <tr id="hr-empty-row">
          <td colspan="7" style="text-align:center;color:var(--muted-foreground);padding:18px;">
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

function handleTableClick(e) {
  const target = e.target;

  // View Info Btn
  if (target.closest('.info-btn')) {
    const btn = target.closest('.info-btn');
    const employeeId = btn.dataset.employeeId;
    const employee = currentEmployees.find(e => e.id === employeeId);
    if (employee) openEmployeeInfoModal(employee);
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

async function openEmployeeInfoModal(existingEmployee) {
  if (document.querySelector('.hr-view-modal')) return;

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
  backdrop.className = 'modal-backdrop hr-view-modal-backdrop';
  const modal = document.createElement('div');
  modal.className = 'reset-modal hr-view-modal';
  modal.style.maxWidth = '760px';
  modal.style.width = 'min(92vw, 760px)';

  modal.innerHTML = `
        <div class="modal-card" style="max-width: 760px; width: 100%;">
          <button class="modal-close-btn" type="button">✕</button>
          <div class="modal-header">
            <h3 class="modal-title">View Employee Information</h3>
          </div>
          <div class="modal-body" style="display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 16px;">
            <div class="form-group" style="grid-column: 1 / -1;">
              <label for="viewEmployeeName">Employee Name</label>
              <input id="viewEmployeeName" class="name" type="text" readonly aria-readonly="true" />
            </div>
            <div class="form-group" style="grid-column: 1 / -1;">
              <label for="editEmployeeEmail">Email Address</label>
              <input id="editEmployeeEmail" class="email" type="email" autocomplete="email" readonly title="Email cannot be changed" aria-readonly="true" />
            </div>
            <div class="form-group">
              <label for="viewEmployeeId">Employee ID</label>
              <input id="viewEmployeeId" class="employee-id" type="text" readonly aria-readonly="true" />
            </div>
            <div class="form-group">
              <label for="editEmployeePosition">Position</label>
              <input id="editEmployeePosition" class="position" type="text" autocomplete="organization-title" readonly title="Position cannot be changed" aria-readonly="true" />
            </div>
            <div class="form-group">
              <label for="editEmployeeDepartment">Department</label>
              <input id="editEmployeeDepartment" class="department" type="text" readonly title="Department cannot be changed" aria-readonly="true" />
            </div>
            <div class="form-group">
              <label for="viewEmployeeStatus">Status</label>
              <input id="viewEmployeeStatus" class="status" type="text" readonly aria-readonly="true" />
            </div>
            <div class="form-group">
              <label for="editEmployeeHireDate">Hire Date</label>
              <input id="editEmployeeHireDate" class="hire-date" type="date" autocomplete="off" readonly title="Hire date cannot be changed" aria-readonly="true" />
            </div>
            <div class="form-group">
              <label for="viewEmployeePhone">Phone Number</label>
              <input id="viewEmployeePhone" class="phone" type="text" readonly aria-readonly="true" />
            </div>
          </div>
          <div class="modal-footer">
            <button class="btn-secondary hr-view-close-btn" type="button">Close</button>
          </div>
        </div>
    `;

  document.body.appendChild(backdrop);
  document.body.appendChild(modal);

  const close = () => { modal.remove(); backdrop.remove(); };
  modal.querySelector('.modal-close-btn').addEventListener('click', close);
  modal.querySelector('.hr-view-close-btn').addEventListener('click', close);
  backdrop.addEventListener('click', close);

  const nameInput = modal.querySelector('.name');
  const emailInput = modal.querySelector('.email');
  const idInput = modal.querySelector('.employee-id');
  const posInput = modal.querySelector('.position');
  const deptInput = modal.querySelector('.department');
  const statusInput = modal.querySelector('.status');
  const dateInput = modal.querySelector('.hire-date');
  const phoneInput = modal.querySelector('.phone');

  if (nameInput) {
    nameInput.readOnly = true;
    nameInput.setAttribute('aria-readonly', 'true');
    nameInput.style.backgroundColor = 'var(--bg-tertiary)';
    nameInput.style.color = 'var(--text-secondary)';
    nameInput.style.cursor = 'not-allowed';
    nameInput.style.borderColor = 'var(--border-primary)';
  }

  if (emailInput) {
    emailInput.readOnly = true;
    emailInput.setAttribute('aria-readonly', 'true');
    emailInput.style.backgroundColor = 'var(--bg-tertiary)';
    emailInput.style.color = 'var(--text-secondary)';
    emailInput.style.cursor = 'not-allowed';
    emailInput.style.borderColor = 'var(--border-primary)';
  }

  if (idInput) {
    idInput.readOnly = true;
    idInput.setAttribute('aria-readonly', 'true');
    idInput.style.backgroundColor = 'var(--bg-tertiary)';
    idInput.style.color = 'var(--text-secondary)';
    idInput.style.cursor = 'not-allowed';
    idInput.style.borderColor = 'var(--border-primary)';
  }

  if (posInput) {
    posInput.readOnly = true;
    posInput.setAttribute('aria-readonly', 'true');
    posInput.style.backgroundColor = 'var(--bg-tertiary)';
    posInput.style.color = 'var(--text-secondary)';
    posInput.style.cursor = 'not-allowed';
    posInput.style.borderColor = 'var(--border-primary)';
  }

  if (statusInput) {
    statusInput.readOnly = true;
    statusInput.setAttribute('aria-readonly', 'true');
    statusInput.style.backgroundColor = 'var(--bg-tertiary)';
    statusInput.style.color = 'var(--text-secondary)';
    statusInput.style.cursor = 'not-allowed';
    statusInput.style.borderColor = 'var(--border-primary)';
  }

  if (dateInput) {
    dateInput.readOnly = true;
    dateInput.setAttribute('aria-readonly', 'true');
    dateInput.style.backgroundColor = 'var(--bg-tertiary)';
    dateInput.style.color = 'var(--text-secondary)';
    dateInput.style.cursor = 'not-allowed';
    dateInput.style.borderColor = 'var(--border-primary)';
  }

  if (deptInput) {
    deptInput.readOnly = true;
    deptInput.setAttribute('aria-readonly', 'true');
    deptInput.style.backgroundColor = 'var(--bg-tertiary)';
    deptInput.style.color = 'var(--text-secondary)';
    deptInput.style.cursor = 'not-allowed';
    deptInput.style.borderColor = 'var(--border-primary)';
  }

  if (phoneInput) {
    phoneInput.readOnly = true;
    phoneInput.setAttribute('aria-readonly', 'true');
    phoneInput.style.backgroundColor = 'var(--bg-tertiary)';
    phoneInput.style.color = 'var(--text-secondary)';
    phoneInput.style.cursor = 'not-allowed';
    phoneInput.style.borderColor = 'var(--border-primary)';
  }

  // Fill Data
  if (nameInput) {
    nameInput.value = employeeData.name || employeeData.full_name || '';
  }
  emailInput.value = employeeData.email || '';
  if (idInput) {
    idInput.value = employeeData.employee_id || employeeData.id || '';
  }
  if (posInput) {
    posInput.value = employeeData.position || '';
  }
  if (deptInput) {
    deptInput.value = employeeData.department || employeeData.dept_name || employeeData.department_name || '';
  }
  if (statusInput) {
    statusInput.value = employeeData.status || 'Active';
  }
  if (employeeData.hire_date) dateInput.value = employeeData.hire_date.split('T')[0];
  if (phoneInput) {
    phoneInput.value = employeeData.phone || employeeData.mobile || 'Not provided';
  }
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

