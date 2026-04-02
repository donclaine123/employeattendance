
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

        const controllerFactory = window.ProfilePageController;
        if (controllerFactory && typeof controllerFactory.createStandardController === 'function') {
            const controller = controllerFactory.createStandardController({
                user,
                renderHeader: updateUIWithEmployeeData,
                renderForm: populateProfileForm,
                notify: showToast,
                logoutSelectors: ['#logoutBtn', '#sidebarLogoutBtn', '#profileSidebarLogoutBtn', '#profileMobileLogoutBtn'],
                onLogout: handleLogout,
                afterInit: () => {
                    const viewScheduleBtn = document.getElementById('viewScheduleBtn');
                    if (viewScheduleBtn) {
                        viewScheduleBtn.addEventListener('click', handleViewSchedule);
                    }
                }
            });

            controller.init();
        }

        return user;
    } catch (e) {
        console.error('[Profile] Init error:', e);
        return null;
    }
}

function populateProfileForm(user) {
    if (!user) return;

    // Header Info
    const initialsEl = document.getElementById('profile-page-initials');
    const nameEl = document.getElementById('profile-page-name');
    const emailHeaderEl = document.getElementById('profile-page-email');

    const firstName = user.first_name || user.username?.split('@')[0] || 'Employee';
    const lastName = user.last_name || '';
    const initials = (firstName.charAt(0) + (lastName.charAt(0) || '')).toUpperCase();
    const displayName = (firstName && lastName) ? `${firstName} ${lastName}` : firstName;

    if (initialsEl) initialsEl.textContent = initials;
    if (nameEl) nameEl.textContent = displayName;
    if (emailHeaderEl) emailHeaderEl.textContent = user.email || '';

    // Form Fields
    setValue('profile-first-name', user.first_name);
    setValue('profile-last-name', user.last_name);
    setValue('profile-email', user.email);
    setValue('profile-phone', user.phone_number || user.phone);
    setValue('profile-address', user.address);

    // Employment
    setValue('profile-position', user.position);
    setValue('profile-department', user.department_name || user.department_id);
    setValue('profile-hire-date', user.hire_date ? user.hire_date.split('T')[0] : '');
    setValue('profile-status', user.status);
    setValue('profile-employee-id', user.employee_id);
    setValue('profile-role', user.role);
}

function setValue(id, val) {
    const el = document.getElementById(id);
    if (el) el.value = val || '';
}

function showToast(message, type = 'info') {
    const container = document.getElementById('messageContainer') || createToastContainer();
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.textContent = message;
    container.appendChild(toast);

    setTimeout(() => {
        toast.remove();
    }, 3000);
}

function createToastContainer() {
    const div = document.createElement('div');
    div.id = 'messageContainer';
    div.className = 'toast-container';
    document.body.appendChild(div);
    return div;
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
    const profilePageAvatarEl = document.querySelector('#section-profile .profile-avatar');

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

    // Generate deterministic gradient based on name
    const gradient = generateAvatarGradient(displayName || emp.email || 'User');

    // Update Sidebar/Nav Avatar (Small)
    if (avatarEl) {
        avatarEl.textContent = initials.toUpperCase();
        avatarEl.style.background = gradient;
        // Ensure text is readable on any gradient
        avatarEl.style.color = '#FFFFFF';
        // Add subtle shadow matching the gradient
        avatarEl.style.boxShadow = '0 2px 4px rgba(0,0,0,0.1)';
    }

    // Update Profile Page Avatar (Big)
    if (profilePageAvatarEl) {
        profilePageAvatarEl.style.background = gradient;
        // Ensure text is readable
        const initialsSpan = profilePageAvatarEl.querySelector('.avatar-initials');
        if (initialsSpan) initialsSpan.style.color = '#FFFFFF';
    }

    const idEl = document.getElementById('empId'); if (idEl) idEl.textContent = emp.employee_id || (emp.id ? String(emp.id) : '—'); // Prefer employee_id string

    // Update Hero Card with greeting and date
    updateHeroCard(displayName);
}

/**
 * Generates a deterministic gradient based on a string (name)
 */
function generateAvatarGradient(name) {
    let hash = 0;
    for (let i = 0; i < name.length; i++) {
        hash = name.charCodeAt(i) + ((hash << 5) - hash);
    }

    // Generate two distinct hues
    const h1 = Math.abs(hash % 360);
    const h2 = (h1 + 40) % 360; // 40 degree shift for analogous colors

    // Use satisfying saturation and lightness for vibrant gradients
    const c1 = `hsl(${h1}, 70%, 60%)`;
    const c2 = `hsl(${h2}, 85%, 55%)`;

    return `linear-gradient(135deg, ${c1}, ${c2})`;
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
