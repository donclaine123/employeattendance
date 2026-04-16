
import { escapeHtml } from './utils.js';

let departmentEmployees = [];
let currentDepartmentName = '';
let searchListenerBound = false;
let inviteRefreshListenerBound = false;

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
  const status = (employee.status || 'active').toLowerCase() === 'active' ? 'active' : 'inactive';
  // Use last_login if available, otherwise fake it or show "Never"
  const lastLogin = employee.last_login ? new Date(employee.last_login).toLocaleString() : 'Never';
  const email = employee.email || 'N/A';
  const id = employee.employee_id || employee.id || '';
  
  // Format ID with hash if it's a number, or just show it
  const displayId = id.toString().startsWith('#') ? id : `#${id}`;

  // Avatar Initials
  const initials = ((employee.first_name?.[0] || '') + (employee.last_name?.[0] || '')).toUpperCase() || 'EMP';

  return `
    <tr class="employee-list-item" data-employee-id="${id}">
        <!-- Col 1: ID -->
        <td style="padding-left: 24px;">
            <span class="l-value" style="font-weight: 600; font-size: 0.8rem; color: var(--text-tertiary);">${escapeHtml(displayId)}</span>
        </td>

        <!-- Col 2: Name -->
        <td>
            <div class="employee-profile-cell">
                <div class="employee-info-text">
                    <span class="employee-name-text">${escapeHtml(employee.first_name || '')} ${escapeHtml(employee.last_name || '')}</span>
                </div>
            </div>
        </td>
        
        <!-- Col 3: Email -->
        <td>
            <span class="l-value text-muted">${escapeHtml(email)}</span>
        </td>

        <!-- Col 4: Last Login -->
        <td>
            <div class="login-time">
                ${employee.last_login ? `
                <div style="display:flex; align-items:center; gap:6px;">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="color:var(--text-tertiary)">
                        <circle cx="12" cy="12" r="10"></circle>
                        <polyline points="12 6 12 12 16 14"></polyline>
                    </svg>
                    ${lastLogin}
                </div>` : '<span style="color:var(--text-tertiary)">Never</span>'}
            </div>
        </td>
        
        <!-- Col 5: Status -->
        <td>
            <span class="status-badge ${status}">
               <span class="status-dot"></span>
               ${status}
            </span>
        </td>

        <!-- Col 6: Actions -->
        <td style="position: relative;">
            <button class="action-menu-btn" title="Actions" data-employee-id="${id}">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="pointer-events: none;">
                    <circle cx="12" cy="12" r="1"></circle>
                    <circle cx="19" cy="12" r="1"></circle>
                    <circle cx="5" cy="12" r="1"></circle>
                </svg>
            </button>
            <div class="emp-action-dropdown" id="dropdown-${id}" style="display: none; background: white; border: 1px solid var(--border-color, #e0e0e0); box-shadow: 0 4px 12px rgba(0,0,0,0.1); border-radius: 6px; z-index: 9999; min-width: 200px; padding: 4px 0; flex-direction: column;">
                <button class="emp-action-item" data-action="attendance" data-id="${id}" style="text-align: left; background: none; border: none; padding: 10px 16px; width: 100%; cursor: pointer; font-size: 0.85rem; color: var(--text-primary, #333);">
                    View Timeliness/Attendance
                </button>
                <button class="emp-action-item" data-action="subjects" data-id="${id}" style="text-align: left; background: none; border: none; padding: 10px 16px; width: 100%; cursor: pointer; font-size: 0.85rem; color: var(--text-primary, #333);">
                    Assign Subjects
                </button>
            </div>
        </td>
    </tr>
  `;
}

// Ensure event listener is only added once
let isEventDelegated = false;

function renderEmployeesList(employees) {
  const container = document.getElementById('employeesList');
  if (!container) return;

  if (employees.length === 0) {
    container.innerHTML = `
        <tr>
            <td colspan="6">
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
            </td>
        </tr>
    `;
    return;
  }

  const html = employees.map(emp => renderEmployeeCard(emp)).join('');
  container.innerHTML = html;

  if (!isEventDelegated) {
    // Handle opening/closing dropdowns and clicking items
    document.body.addEventListener('click', (e) => {
        const btn = e.target.closest('.action-menu-btn');
        if (btn) {
            e.stopPropagation();
            const id = btn.getAttribute('data-employee-id');
            const dropdown = document.getElementById(`dropdown-${id}`);
            
            // Close all other dropdowns
            document.querySelectorAll('.emp-action-dropdown').forEach(menu => {
                if (menu !== dropdown) menu.style.display = 'none';
            });
            
            // Toggle current dropdown
            if (dropdown) {
                if (dropdown.style.display !== 'flex') {
                    // Append to body to avoid overflow issues
                    document.body.appendChild(dropdown);
                    
                    const rect = btn.getBoundingClientRect();
                    dropdown.style.position = 'fixed';
                    dropdown.style.top = (rect.bottom + 4) + 'px';
                    dropdown.style.left = (rect.right - 200) + 'px'; // width is 200px
                    dropdown.style.display = 'flex';
                } else {
                    dropdown.style.display = 'none';
                }
            }
            return;
        }

        const actionItem = e.target.closest('.emp-action-item');
        if (actionItem) {
            const action = actionItem.getAttribute('data-action');
            const empId = actionItem.getAttribute('data-id');
            
            // Hide dropdown after click
            actionItem.closest('.emp-action-dropdown').style.display = 'none';
            
            // Trigger appropriate action based on selection
            if (action === 'attendance') {
                console.log(`Action: View Attendance for ${empId}`);
                // Future Implementation: filter attendance section by this ID and switch to it
                const attendanceSearch = document.getElementById('filter-employee');
                if (attendanceSearch) {
                    attendanceSearch.value = empId;
                    attendanceSearch.dispatchEvent(new Event('input', { bubbles: true }));
                }
                const attendanceTab = document.querySelector('[data-section="attendance"]');
                if (attendanceTab) attendanceTab.click();
            } else if (action === 'subjects') {
                console.log(`Action: Assign Subjects for ${empId}`);
                // Future Implementation: switch to assign professors section
                const curriculumTab = document.querySelector('[data-section="curriculum"]');
                if (curriculumTab) curriculumTab.click();
            }
            return;
        }

        // Close dropdowns if clicked outside
        document.querySelectorAll('.emp-action-dropdown').forEach(menu => {
            menu.style.display = 'none';
        });
    });

    isEventDelegated = true;
  }
}

function bindInviteRefreshListener() {
  if (inviteRefreshListenerBound) {
    return;
  }

  window.addEventListener('dept-head:employee-invitation-created', async () => {
    await refreshEmployeesSection();

    if (window.deptHeadInvitations && typeof window.deptHeadInvitations.refreshInvitations === 'function') {
      await window.deptHeadInvitations.refreshInvitations();
    }
  });

  inviteRefreshListenerBound = true;
}

export async function refreshEmployeesSection() {
  if (!currentDepartmentName) {
    await initEmployeesSection();
    return;
  }

  const employees = await fetchDepartmentEmployees(currentDepartmentName);
  renderEmployeesList(employees);
}

export async function initEmployeesSection() {
  try {
    // Force refresh to get latest profile with updated department
    const user = await window.fetchUserProfile(true);
    if (!user) {
      console.warn('[employees] No user profile found');
      return;
    }

    const departmentValue = typeof user.department === 'object'
      ? user.department?.dept_name || user.department?.name || ''
      : user.department;
    const department = user.department_name || departmentValue || 'Unknown';
    currentDepartmentName = department;
    console.log('[employees] initEmployeesSection using department:', department);
    const nameDisplay = document.getElementById('empDeptName');
    if (nameDisplay) nameDisplay.textContent = department;

    const employees = await fetchDepartmentEmployees(department);
    renderEmployeesList(employees);

    bindInviteRefreshListener();

    // Setup search
    const searchInput = document.getElementById('employeeSearch');
    if (searchInput && !searchListenerBound) {
      searchInput.addEventListener('input', (e) => {
        const query = e.target.value.toLowerCase();
        const filtered = departmentEmployees.filter(emp => {
          const name = (emp.first_name + ' ' + emp.last_name).toLowerCase();
          const email = (emp.email || emp.username || '').toLowerCase();
          return name.includes(query) || email.includes(query);
        });
        renderEmployeesList(filtered);
      });

      searchListenerBound = true;
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
  window.refreshEmployeesSection = refreshEmployeesSection;
}
