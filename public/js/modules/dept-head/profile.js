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

        // Setup Profile UI Logic (for the section)
        initializeProfileSection(user);

        // Setup Logout
        const logoutBtn = document.getElementById('logoutBtn');
        if (logoutBtn) logoutBtn.addEventListener('click', handleLogout);

        const profileSidebarLogoutBtn = document.getElementById('profileSidebarLogoutBtn');
        if (profileSidebarLogoutBtn) profileSidebarLogoutBtn.addEventListener('click', handleLogout);

        const profileMobileLogoutBtn = document.getElementById('profileMobileLogoutBtn');
        if (profileMobileLogoutBtn) profileMobileLogoutBtn.addEventListener('click', handleLogout);

        return user;
    } catch (e) {
        console.error('[Profile] Init error:', e);
        return null;
    }
}

/**
 * Initializes the logic for the profile section
 */
function initializeProfileSection(user) {
    const profileSection = document.getElementById('section-profile');
    if (!profileSection) return;

    // 1. Setup Tab Navigation
    const navItems = profileSection.querySelectorAll('.ep-tab-item');
    const contentSections = profileSection.querySelectorAll('.ep-tab-panel');

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
            editBtn.style.display = 'none';
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
        phone: phone,
        address: address,
        updated_at: new Date().toISOString()
    };

    if (newPassword && newPassword.length >= 6) {
        updates.currentPassword = currentPassword;
        updates.newPassword = newPassword;
    }

    try {
        const apiBase = window.API_URL || '/api';
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

            setValue('profile-current-password', '');
            setValue('profile-new-password', '');
            setValue('profile-confirm-password', '');

            if (updates.phone) updates.phone_number = updates.phone;

            if (result.profile) {
                Object.assign(user, result.profile);
            } else {
                Object.assign(user, updates);
            }

            delete user.currentPassword;
            delete user.newPassword;
            delete user.current_password;
            delete user.new_password;

            populateProfileForm(user);
            populateEmployeeInfo(user);
        } else {
            showToast('Failed to save changes: ' + (result.message || 'Unknown error'), 'error');
        }
    } catch (e) {
        console.error('[Profile] Save error:', e);
        showToast('Error saving profile: ' + e.message, 'error');
    }
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
