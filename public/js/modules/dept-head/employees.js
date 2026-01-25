
import { fetchHeadInfo, escapeHtml } from './utils.js';

let departmentEmployees = [];

async function fetchDepartmentEmployees(department) {
  try {
    const apiBase = window.API_URL || '/api';
    const url = apiBase + '/departmenthead/employees?department=' + encodeURIComponent(department) + '&_t=' + Date.now();

    const resp = await window.fetchWithAuth(url, {});
    if (!resp.ok) {
      console.error('[employees] Failed to fetch employees:', resp.status);
      return [];
    }

    const data = await resp.json();
    departmentEmployees = Array.isArray(data) ? data : (data.data || data.employees || []);
    console.log('[employees] Fetched', departmentEmployees.length, 'employees for department:', department);
    return departmentEmployees;
  } catch (err) {
    console.error('[employees] Error fetching:', err);
    return [];
  }
}

function renderEmployeeCard(employee) {
  const status = employee.status === 'active' ? 'active' : 'inactive';
  // Use last_login if available, otherwise fake it or show "Never"
  const lastLogin = employee.last_login ? new Date(employee.last_login).toLocaleString() : 'Never';
  const email = employee.email || 'N/A';

  return `
    <div class="employee-list-item" data-employee-id="${employee.employee_id || employee.id}">
        <!-- Col 1: ID -->
        <div class="list-col-id">
            <span class="l-value">${escapeHtml(employee.employee_id || 'N/A')}</span>
        </div>

        <!-- Col 2: Name -->
        <div class="list-col-name">
            <div class="list-name">${escapeHtml(employee.first_name || '')} ${escapeHtml(employee.last_name || '')}</div>
        </div>
        
        <!-- Col 3: Email -->
        <div class="list-col-email">
            <span class="l-value text-muted">${escapeHtml(email)}</span>
        </div>

        <!-- Col 4: Last Login -->
        <div class="list-col-login">
             <div class="login-time">${lastLogin}</div>
        </div>
        
        <!-- Col 6: Status -->
        <div class="list-col-status">
            <span class="status-text ${status}">${status}</span>
        </div>
    </div>
  `;
}

function renderEmployeesList(employees) {
  const container = document.getElementById('employeesList');
  if (!container) return;

  if (employees.length === 0) {
    container.innerHTML = `
                <div class="employees-empty">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path>
                        <circle cx="9" cy="7" r="4"></circle>
                        <path d="M23 21v-2a4 4 0 0 0-3-3.87"></path>
                        <path d="M16 3.13a4 4 0 0 1 0 7.75"></path>
                    </svg>
                    <h4>No Employees Found</h4>
                    <p>There are no employees in this department.</p>
                </div>
            `;
    return;
  }

  const html = employees.map(emp => renderEmployeeCard(emp)).join('');
  container.innerHTML = html;

  // Add event listeners
  document.querySelectorAll('.view-details-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      const card = btn.closest('.employee-card');
      const empId = card.dataset.employeeId;
      console.log('[employees] Viewing details for employee:', empId);
      // TODO: Open employee details modal
    });
  });

  document.querySelectorAll('.contact-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      const card = btn.closest('.employee-card');
      const empId = card.dataset.employeeId;
      console.log('[employees] Contacting employee:', empId);
      // TODO: Open contact modal
    });
  });
}

export async function initEmployeesSection() {
  try {
    // Force refresh to get latest profile with updated department
    const user = await window.fetchUserProfile(true);
    if (!user) {
      console.warn('[employees] No user profile found');
      return;
    }

    const department = user.department || 'Unknown';
    console.log('[employees] initEmployeesSection using department:', department);
    const nameDisplay = document.getElementById('empDeptName');
    if (nameDisplay) nameDisplay.textContent = department;

    const employees = await fetchDepartmentEmployees(department);
    renderEmployeesList(employees);

    // Setup search
    const searchInput = document.getElementById('employeeSearch');
    if (searchInput) {
      searchInput.addEventListener('input', (e) => {
        const query = e.target.value.toLowerCase();
        const filtered = departmentEmployees.filter(emp => {
          const name = (emp.first_name + ' ' + emp.last_name).toLowerCase();
          const email = (emp.email || emp.username || '').toLowerCase();
          return name.includes(query) || email.includes(query);
        });
        renderEmployeesList(filtered);
      });
    }
  } catch (err) {
    console.error('[employees] Error initializing:', err);
  }
}

// Observe section changes to lazy load
export function observeEmployeesSection() {
  const employeesSection = document.getElementById('section-employees');
  if (employeesSection) {
    const observer = new MutationObserver((mutations) => {
      mutations.forEach((mutation) => {
        if (mutation.attributeName === 'class') {
          if (employeesSection.classList.contains('active') && departmentEmployees.length === 0) {
            initEmployeesSection();
          }
        }
      });
    });

    observer.observe(employeesSection, { attributes: true });

    // Initial check
    if (employeesSection.classList.contains('active')) {
      initEmployeesSection();
    }
  }
  window.refreshEmployees = initEmployeesSection;
}
