
import { showStatus, getSessionUser } from './utils.js';

export async function initProfile() {
    // Populate employee header from backend
    try {
        const user = await getSessionUser();
        // Redirect if no user
        if (!user) {
            console.log('[Profile] No user found, redirecting to login');
            window.location.href = '../index.html';
            return null;
        }

        console.log('[Profile] User found:', user);

        // set today text
        const todayEl = document.getElementById('todayText');
        if (todayEl) {
            const d = new Date();
            todayEl.textContent = d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: '2-digit', year: 'numeric' });
        }

        // Populate initial info
        populateEmployeeInfo(user);

        // Fetch detailed info if email exists
        const email = user.email;
        if (email) {
            const apiBase = window.API_URL || '/api';
            try {
                // Try to get more detailed info
                const response = await window.fetchWithAuth(`${apiBase}/employee/by-email?email=${encodeURIComponent(email)}`, {});
                if (response.ok) {
                    const emp = await response.json();

                    // Update the user object with more details FIRST
                    // We use a safe merge to avoid overwriting existing valid keys with nulls if api returns inconsistent data
                    Object.keys(emp).forEach(key => {
                        if (emp[key] !== null && emp[key] !== undefined && emp[key] !== '') {
                            user[key] = emp[key];
                        }
                    });

                    // Re-render with the fully merged user object
                    updateUIWithEmployeeData(user);
                }
            } catch (e) {
                console.warn('[Profile] Failed to fetch detailed employee data', e);
            }
        }

        // Setup Profile Button to open the Modal
        const profileBtn = document.getElementById('profileBtn');
        if (profileBtn) {
            // Remove old listeners by cloning
            const newBtn = profileBtn.cloneNode(true);
            profileBtn.parentNode.replaceChild(newBtn, profileBtn);

            newBtn.addEventListener('click', () => {
                if (window.ProfileModal) {
                    window.ProfileModal.open('employee', user);
                } else {
                    console.error('ProfileModal shared library not loaded');
                }
            });
        }

        // Also setup Sidebar Profile Button (Mobile)
        const sidebarProfileBtn = document.getElementById('sidebarProfileBtn');
        if (sidebarProfileBtn) {
            sidebarProfileBtn.addEventListener('click', () => {
                if (window.ProfileModal) {
                    window.ProfileModal.open('employee', user);
                    // Close sidebar on mobile after clicking
                    document.querySelector('.sidebar')?.classList.remove('open');
                    document.getElementById('menuOverlay')?.classList.remove('active');
                }
            });
        }

        // Setup Logout
        const logoutBtn = document.getElementById('logoutBtn');
        if (logoutBtn) logoutBtn.addEventListener('click', handleLogout);

        // Setup Sidebar Logout (Mobile)
        const sidebarLogoutBtn = document.getElementById('sidebarLogoutBtn');
        if (sidebarLogoutBtn) sidebarLogoutBtn.addEventListener('click', handleLogout);

        // Setup View Schedule Button
        const viewScheduleBtn = document.getElementById('viewScheduleBtn');
        if (viewScheduleBtn) {
            viewScheduleBtn.addEventListener('click', handleViewSchedule);
        }

        return user;
    } catch (e) {
        console.error('[Profile] Init error:', e);
        return null;
    }
}

// Populate employee info into the header card (basic info from session)
function populateEmployeeInfo(user) {
    if (!user) return;
    updateUIWithEmployeeData(user);
}

function updateUIWithEmployeeData(emp) {
    // Construct full name if available
    let fullName = emp.name || emp.full_name;
    if (emp.first_name || emp.last_name) {
        fullName = `${emp.first_name || ''} ${emp.last_name || ''}`.trim();
    }
    const displayName = fullName || emp.email || 'Employee';

    const nameEl = document.getElementById('empName');
    if (nameEl) nameEl.textContent = displayName;

    // Update sidebar info if present
    const sidebarName = document.getElementById('userName');
    if (sidebarName) sidebarName.textContent = displayName;

    const deptEl = document.getElementById('empDept'); if (deptEl) deptEl.textContent = emp.department || '—';
    const sidebarRole = document.getElementById('userRole'); if (sidebarRole) sidebarRole.textContent = emp.role || 'Employee';

    // Update Avatar Initials
    const avatarEl = document.getElementById('sidebarAvatar');
    if (avatarEl) {
        let initials = 'U';
        if (emp.first_name && emp.last_name) {
            initials = (emp.first_name[0] || '') + (emp.last_name[0] || '');
        } else if (displayName && displayName !== 'Employee') {
            const parts = displayName.split(' ');
            initials = parts[0][0];
            if (parts.length > 1) initials += parts[parts.length - 1][0];
        } else if (emp.email) {
            initials = emp.email[0];
        }
        avatarEl.textContent = initials.toUpperCase();
    }

    const idEl = document.getElementById('empId'); if (idEl) idEl.textContent = emp.employee_id || (emp.id ? String(emp.id) : '—'); // Prefer employee_id string
    
    // Update Hero Card with greeting and date
    updateHeroCard(displayName);
}

/**
 * Update hero card with greeting and date
 */
function updateHeroCard(displayName) {
    const heroTitle = document.getElementById('userNameHero');
    const heroDate = document.getElementById('heroDate');
    
    if (heroTitle) {
        heroTitle.textContent = getGreeting(displayName);
    }
    
    if (heroDate) {
        heroDate.textContent = formatHeroDate(new Date());
    }
}

/**
 * Get greeting based on time of day and user name
 */
function getGreeting(name) {
    const hour = new Date().getHours();
    let greeting = 'Good Morning';
    
    if (hour >= 12 && hour < 17) {
        greeting = 'Good Afternoon';
    } else if (hour >= 17) {
        greeting = 'Good Evening';
    }
    
    return `${greeting}, ${name}!`;
}

/**
 * Format date as "Monday, February 9, 2026"
 */
function formatHeroDate(date) {
    return date.toLocaleDateString(undefined, {
        weekday: 'long',
        month: 'long',
        day: 'numeric',
        year: 'numeric'
    });
}

// Logout handler
async function handleLogout() {
    try { if (window.AppApi && window.AppApi.logout) await window.AppApi.logout(); } catch (e) { }
    try { sessionStorage.removeItem('workline_token'); if (window.clearProfileCache) window.clearProfileCache(); } catch (e) { }
    window.location.href = '../index.html';
}

/**
 * Handle "View Schedule" button click
 */
function handleViewSchedule() {
    // Switch to Schedule tab
    const scheduleTab = document.querySelector('[data-section="schedule"]');
    if (scheduleTab) {
        scheduleTab.click();
    } else {
        console.warn('Schedule tab not found');
    }
}

// Global helper to refresh UI after profile update
window.updateUserInterface = function (updatedUser) {
    updateUIWithEmployeeData(updatedUser);
};
