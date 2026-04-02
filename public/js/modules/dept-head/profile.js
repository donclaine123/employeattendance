/**
 * Department Head Profile Module
 * Handles profile section initialization, form population, and user updates
 */

export async function initProfile() {
    try {
        const user = await window.fetchUserProfile();
        
        if (!user) {
            console.log('[Profile] No user found, redirecting to login');
            window.location.href = '../index.html';
            return null;
        }

        console.log('[Profile] User found:', user);

        // Populate initial info
        populateEmployeeInfo(user);

        // Fetch detailed info if email exists
        const email = user.email;
        if (email) {
            const apiBase = window.API_URL || '/api';
            try {
                const response = await window.fetchWithAuth(`${apiBase}/employee/by-email?email=${encodeURIComponent(email)}`, {});
                if (response.ok) {
                    const emp = await response.json();

                    // Safely merge data without overwriting with nulls
                    Object.keys(emp).forEach(key => {
                        if (emp[key] !== null && emp[key] !== undefined && emp[key] !== '') {
                            user[key] = emp[key];
                        }
                    });

                    // Re-render with fully merged user object
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
                logoutSelectors: ['#logoutBtn', '#profileSidebarLogoutBtn', '#profileMobileLogoutBtn'],
                onLogout: handleLogout,
            });

            controller.init();
        }

        return user;
    } catch (e) {
        console.error('[Profile] Init error:', e);
        return null;
    }
}

function populateEmployeeInfo(user) {
    if (!user) return;

    const firstName = user.first_name || user.username?.split('@')[0] || 'Department';
    const lastName = user.last_name || 'Head';
    const initials = (firstName.charAt(0) + lastName.charAt(0)).toUpperCase();
    const displayName = `${firstName} ${lastName}`;

    const avatarEl = document.getElementById('sidebarAvatar');
    const userNameEl = document.getElementById('userName');

    if (avatarEl) {
        avatarEl.textContent = initials;
        avatarEl.style.background = generateAvatarGradient(displayName);
        avatarEl.style.color = '#FFFFFF';
    }

    if (userNameEl) {
        userNameEl.textContent = displayName;
    }
}

function updateUIWithEmployeeData(user) {
    if (!user) return;
    populateProfileForm(user);
    populateEmployeeInfo(user);
}

function populateProfileForm(user) {
    if (!user) return;

    // Header Info
    const initialsEl = document.getElementById('profile-page-initials');
    const nameEl = document.getElementById('profile-page-name');
    const emailHeaderEl = document.getElementById('profile-page-email');

    const firstName = user.first_name || user.username?.split('@')[0] || 'Department';
    const lastName = user.last_name || 'Head';
    const initials = (firstName.charAt(0) + lastName.charAt(0)).toUpperCase();
    const displayName = `${firstName} ${lastName}`;

    if (initialsEl) initialsEl.textContent = initials;
    if (nameEl) nameEl.textContent = displayName;
    if (emailHeaderEl) emailHeaderEl.textContent = user.email || '';

    // Form Fields
    setValue('profile-first-name', user.first_name);
    setValue('profile-last-name', user.last_name);
    setValue('profile-email', user.email);
    setValue('profile-phone', user.phone_number);
    setValue('profile-address', user.address);

    // Employment
    setValue('profile-position', user.position);
    setValue('profile-department', user.department_name || user.department);
    setValue('profile-hire-date', user.hire_date ? user.hire_date.split('T')[0] : '');
    setValue('profile-status', user.status);
    setValue('profile-employee-id', user.employee_id);
    setValue('profile-role', user.role);
}

function setValue(id, val) {
    const el = document.getElementById(id);
    if (el) el.value = val || '';
}

function handleLogout() {
    if (window.AuthGuard) {
        window.AuthGuard.logout();
    } else {
        console.error('AuthGuard not found for logout');
        window.location.href = '../index.html';
    }
}

function generateAvatarGradient(name) {
    let hash = 0;
    for (let i = 0; i < name.length; i++) {
        hash = name.charCodeAt(i) + ((hash << 5) - hash);
    }
    const h1 = Math.abs(hash % 360);
    const h2 = (h1 + 40) % 360;
    const c1 = `hsl(${h1}, 70%, 60%)`;
    const c2 = `hsl(${h2}, 70%, 60%)`;
    return `linear-gradient(135deg, ${c1}, ${c2})`;
}

function showToast(message, type = 'info') {
    console.log(`[Toast] ${type}: ${message}`);
    
    // Try to use existing toast system if available
    if (window.showStatus) {
        window.showStatus(message, type === 'error');
        return;
    }

    // Fallback to simple alert
    if (type === 'error') {
        alert('Error: ' + message);
    }
}
