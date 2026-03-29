
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

        // Setup Profile UI Logic (for the section)
        initializeProfileSection(user);

        // Setup Logout
        const logoutBtn = document.getElementById('logoutBtn');
        if (logoutBtn) logoutBtn.addEventListener('click', handleLogout);

        // Setup Sidebar Logout (Mobile)
        const sidebarLogoutBtn = document.getElementById('sidebarLogoutBtn');
        if (sidebarLogoutBtn) sidebarLogoutBtn.addEventListener('click', handleLogout);

        // Setup Profile Sidebar Logout (Mobile App Layout)
        const profileSidebarLogoutBtn = document.getElementById('profileSidebarLogoutBtn');
        if (profileSidebarLogoutBtn) profileSidebarLogoutBtn.addEventListener('click', handleLogout);

        // Setup Mobile-only Sign Out button (bottom of profile page on small screens)
        const profileMobileLogoutBtn = document.getElementById('profileMobileLogoutBtn');
        if (profileMobileLogoutBtn) profileMobileLogoutBtn.addEventListener('click', handleLogout);

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

/**
 * Initializes the logic for the profile SECTION (not modal)
 */
function initializeProfileSection(user) {
    const profileSection = document.getElementById('section-profile');
    if (!profileSection) return;

    // 1. Setup Tab Navigation — supports new ep-tab-item and legacy profile-nav-item
    const navItems = profileSection.querySelectorAll('.ep-tab-item, .profile-nav-item');
    const contentSections = profileSection.querySelectorAll('.ep-tab-panel, .profile-content-section');

    navItems.forEach(item => {
        item.addEventListener('click', () => {
            navItems.forEach(nav => nav.classList.remove('active'));
            contentSections.forEach(section => section.classList.remove('active'));

            item.classList.add('active');

            const sectionId = item.dataset.section;
            const targetSection = profileSection.querySelector(`#${sectionId}-section`);
            if (targetSection) {
                targetSection.classList.add('active');
            }
        });
    });

    // 2. Populate Fields (Initial Load)
    populateProfileForm(user);

    // 3. Edit Mode — clicking Edit enables inputs and shows footer
    profileSection.querySelectorAll('.ep-btn-edit').forEach(editBtn => {
        editBtn.addEventListener('click', () => {
            const panelId = editBtn.dataset.panel;
            const panel = profileSection.querySelector(`#${panelId}`);
            if (!panel) return;
            panel.classList.add('ep-editing');
            editBtn.style.display = 'none'; // hide Edit while in edit mode
        });
    });

    // 4. Cancel — revert values and exit edit mode
    profileSection.querySelectorAll('.btn-profile-cancel').forEach(cancelBtn => {
        cancelBtn.addEventListener('click', () => {
            const panel = cancelBtn.closest('.ep-tab-panel');
            if (panel) {
                panel.classList.remove('ep-editing');
                const editBtn = panel.querySelector('.ep-btn-edit');
                if (editBtn) editBtn.style.display = '';
            }
            populateProfileForm(user);
            showToast('Changes reverted', 'info');
        });
    });

    // 5. Save — submit then exit edit mode
    profileSection.querySelectorAll('.btn-profile-save').forEach(saveBtn => {
        saveBtn.addEventListener('click', async () => {
            await handleProfileSave(user);
            // Always exit edit mode after attempt; toast handles success/error feedback
            const panel = saveBtn.closest('.ep-tab-panel');
            if (panel) {
                panel.classList.remove('ep-editing');
                const editBtn = panel.querySelector('.ep-btn-edit');
                if (editBtn) editBtn.style.display = '';
            }
        });
    });

    // 6. Password Validation
    const firstSaveBtn = profileSection.querySelector('.btn-profile-save');
    setupPasswordValidation(profileSection, firstSaveBtn);
}



function populateProfileForm(user) {
    if (!user) return;

    // Header Info
    const initialsEl = document.getElementById('profile-page-initials');
    const nameEl = document.getElementById('profile-page-name');
    const emailHeaderEl = document.getElementById('profile-page-email');

    const firstName = user.first_name || user.username?.split('@')[0] || 'User';
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
    setValue('profile-phone', user.phone_number);
    setValue('profile-address', user.address);

    // Employment
    setValue('profile-position', user.position);
    setValue('profile-department', user.department_name || user.department_id); // Fallback
    setValue('profile-hire-date', user.hire_date ? user.hire_date.split('T')[0] : '');
    setValue('profile-status', user.status);
    setValue('profile-employee-id', user.employee_id);
    setValue('profile-role', user.role);
}

function setValue(id, val) {
    const el = document.getElementById(id);
    if (el) el.value = val || '';
}

function setupPasswordValidation(section, saveBtn) {
    const currentPasswordInput = section.querySelector('#profile-current-password');
    const newPasswordInput = section.querySelector('#profile-new-password');
    const confirmPasswordInput = section.querySelector('#profile-confirm-password');

    if (!newPasswordInput || !confirmPasswordInput) return;

    function validatePasswords() {
        const currentPassword = currentPasswordInput.value.trim();
        const newPassword = newPasswordInput.value.trim();
        const confirmPassword = confirmPasswordInput.value.trim();

        if (newPassword || confirmPassword) {
            if (!currentPassword) return false;
            if (newPassword.length < 6) return false;
            if (newPassword !== confirmPassword) return false;
        }
        return true;
    }

    [newPasswordInput, confirmPasswordInput, currentPasswordInput].forEach(input => {
        input.addEventListener('input', () => {
            const isValid = validatePasswords();
            if (!isValid && (newPasswordInput.value || confirmPasswordInput.value || currentPasswordInput.value)) {
                if (saveBtn) saveBtn.style.opacity = '0.6';
                if (saveBtn) saveBtn.disabled = true;
            } else {
                if (saveBtn) saveBtn.style.opacity = '1';
                if (saveBtn) saveBtn.disabled = false;
            }
        });
    });
}

// Reuse logic from shared/profile.js but implemented locally since we can't easily import the internal functions of that IIFE
// We will call the API using window.fetchWithAuth
async function handleProfileSave(user) {
    if (!user || !user.employee_id) return;

    const firstName = document.getElementById('profile-first-name')?.value;
    const lastName = document.getElementById('profile-last-name')?.value;
    const phone = document.getElementById('profile-phone')?.value;
    const address = document.getElementById('profile-address')?.value;

    const currentPassword = document.getElementById('profile-current-password')?.value;
    const newPassword = document.getElementById('profile-new-password')?.value;

    const updates = {
        first_name: firstName,
        last_name: lastName,
        phone: phone, // Changed from phone_number to phone to match backend API
        address: address,
        updated_at: new Date().toISOString()
    };

    // Only include password if changed
    if (newPassword && newPassword.length >= 6) {
        updates.currentPassword = currentPassword; // Changed to match backend expectation
        updates.newPassword = newPassword;
    }

    try {
        const apiBase = window.API_URL || '/api';
        // Changed endpoint to /auth/profile and method to PUT
        const response = await window.fetchWithAuth(`${apiBase}/auth/profile`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(updates)
        });

        const result = await response.json();

        if (response.ok) {
            showToast('Changes saved successfully.', 'success');

            // Clear password fields
            setValue('profile-current-password', '');
            setValue('profile-new-password', '');
            setValue('profile-confirm-password', '');

            // Update local user object
            // Map 'phone' back to 'phone_number' for local consistency if needed
            if (updates.phone) updates.phone_number = updates.phone;

            // If backend returned the full profile, use it
            if (result.profile) {
                Object.assign(user, result.profile);
            } else {
                Object.assign(user, updates);
            }

            // Remove password fields from local obj
            delete user.currentPassword;
            delete user.newPassword;
            delete user.current_password;
            delete user.new_password;

            // Update UI
            populateProfileForm(user);
            populateEmployeeInfo(user); // Header info

            // Try to update global UI if function exists
            if (window.updateUserInterface) {
                window.updateUserInterface(user);
            }
        } else {
            showToast('Changes were not saved.', 'error');
        }
    } catch (error) {
        console.error('Profile update error:', error);
        showToast('An error occurred while saving', 'error');
    }
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
