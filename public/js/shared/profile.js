// Profile modal functionality - reusable across all pages
window.ProfileModal = (function () {

    function createProfileModal(userRole, currentUser) {
        // Remove existing modal if present
        const existingModal = document.querySelector('.profile-modal');
        if (existingModal) {
            existingModal.remove();
        }

        const existingBackdrop = document.querySelector('.profile-modal-backdrop');
        if (existingBackdrop) {
            existingBackdrop.remove();
        }

        // Create backdrop
        const backdrop = document.createElement('div');
        backdrop.className = 'modal-backdrop profile-modal-backdrop';

        // Create modal
        const modal = document.createElement('div');
        modal.className = 'profile-modal';
        modal.setAttribute('role', 'dialog');
        modal.setAttribute('aria-modal', 'true');

        // Generate modal content based on user role
        modal.innerHTML = generateModalHTML(userRole, currentUser);

        // Append to body
        document.body.appendChild(backdrop);
        document.body.appendChild(modal);

        // Initialize functionality
        initializeModalEvents(modal, backdrop, userRole, currentUser);

        return modal;
    }

    function generateModalHTML(userRole, currentUser) {
        const isEmployee = userRole === 'employee';
        const isHR = userRole === 'hr';
        const isDeptHead = userRole === 'head_dept';
        const isSuperAdmin = userRole === 'superadmin';

        // Get user initials for avatar
        const firstName = currentUser?.first_name || currentUser?.username?.split('@')[0] || 'User';
        const lastName = currentUser?.last_name || '';
        const initials = (firstName.charAt(0) + (lastName.charAt(0) || '')).toUpperCase();
        const email = currentUser?.email || currentUser?.username || 'user@example.com';

        // Format display name
        const displayName = (firstName && lastName) ? `${firstName} ${lastName}` : firstName;

        return `
            <div class="profile-modal-container">
                <button class="modal-close-btn" aria-label="Close">
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <line x1="18" y1="6" x2="6" y2="18"></line>
                        <line x1="6" y1="6" x2="18" y2="18"></line>
                    </svg>
                </button>
                
                <!-- Left Card: Profile & Sidebar -->
                <div class="profile-sidebar-card">
                    <div class="profile-user-info">
                        <div class="profile-avatar">
                            <span class="avatar-initials">${initials}</span>
                        </div>
                        <div class="profile-user-details">
                            <h3 class="profile-username">${displayName}</h3>
                            <p class="profile-email">${email}</p>
                        </div>
                    </div>
                    
                    <nav class="profile-sidebar-nav">
                        <button class="profile-nav-item active" data-section="profile">
                            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path>
                                <circle cx="12" cy="7" r="4"></circle>
                            </svg>
                            My Profile
                        </button>
                        <button class="profile-nav-item" data-section="employment">
                            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <rect x="2" y="3" width="20" height="14" rx="2" ry="2"></rect>
                                <line x1="8" y1="21" x2="16" y2="21"></line>
                                <line x1="12" y1="17" x2="12" y2="21"></line>
                            </svg>
                            Employment Information
                        </button>
                        <button class="profile-nav-item" data-section="settings">
                            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <circle cx="12" cy="12" r="3"></circle>
                                <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1 1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path>
                            </svg>
                            Settings
                        </button>
                    </nav>
                </div>
                
                <!-- Right Card: Content Area -->
                <div class="profile-content-card">
                    <div class="profile-content-header">
                        <h2 id="profile-content-title">My Profile</h2>
                        <!-- Close button moved to container level -->
                    </div>
                    
                    <div class="profile-content-body">
                        <!-- My Profile Section -->
                        <div class="profile-content-section active" id="profile-section">
                            <div class="profile-section">
                                <h4>Personal Information</h4>
                                <div class="form-row">
                                    <div class="form-group">
                                        <label for="profile-first-name">First Name *</label>
                                        <input type="text" id="profile-first-name" required>
                                    </div>
                                    <div class="form-group">
                                        <label for="profile-last-name">Last Name *</label>
                                        <input type="text" id="profile-last-name" required>
                                    </div>
                                </div>
                                <div class="form-row single">
                                    <div class="form-group">
                                        <label for="profile-email">Email Address</label>
                                        <input type="email" id="profile-email" readonly title="Email cannot be changed as it's used for login">
                                    </div>
                                </div>
                                <div class="form-row">
                                    <div class="form-group">
                                        <label for="profile-phone">Phone Number</label>
                                        <input type="tel" id="profile-phone" placeholder="+63xxxxxxxxxx">
                                    </div>
                                    <div class="form-group">
                                        <label for="profile-address">Address (Optional)</label>
                                        <input type="text" id="profile-address" placeholder="Complete address">
                                    </div>
                                </div>
                            </div>
                        </div>
                        
                        <!-- Employment Information Section -->
                        <div class="profile-content-section" id="employment-section">
                            <div class="profile-section">
                                <h4>Employment Details</h4>
                                <div class="form-row">
                                    <div class="form-group">
                                        <label for="profile-position">Position</label>
                                        <input type="text" id="profile-position" readonly placeholder="e.g., Software Engineer">
                                    </div>
                                    <div class="form-group">
                                        <label for="profile-department">Department</label>
                                        <input type="text" id="profile-department" readonly>
                                    </div>
                                </div>
                                <div class="form-row">
                                    <div class="form-group">
                                        <label for="profile-hire-date">Hire Date</label>
                                        <input type="date" id="profile-hire-date" readonly>
                                    </div>
                                    <div class="form-group">
                                        <label for="profile-status">Status</label>
                                        <input type="text" id="profile-status" readonly>
                                    </div>
                                </div>
                                <div class="form-row">
                                    <div class="form-group">
                                        <label for="profile-employee-id">Employee ID</label>
                                        <input type="text" id="profile-employee-id" readonly>
                                    </div>
                                    <div class="form-group">
                                        <label for="profile-role">Role</label>
                                        <input type="text" id="profile-role" readonly>
                                    </div>
                                </div>
                            </div>
                        </div>
                        
                        <!-- Settings Section -->
                        <div class="profile-content-section" id="settings-section">
                            <div class="profile-section password-section">
                                <h4>Security Settings</h4>
                                
                                <!-- Password Change -->
                                <div style="margin-bottom: 28px;">
                                    <h5 style="font-size: 14px; font-weight: 600; margin: 0 0 12px 0; color: var(--text-primary);">Change Password</h5>
                                    <div class="form-row single">
                                        <div class="form-group">
                                            <label for="profile-current-password">Current Password</label>
                                            <input type="password" id="profile-current-password" placeholder="Enter current password to change">
                                        </div>
                                    </div>
                                    <div class="form-row">
                                        <div class="form-group">
                                            <label for="profile-new-password">New Password</label>
                                            <input type="password" id="profile-new-password" placeholder="New password (min 6 characters)" minlength="6">
                                        </div>
                                        <div class="form-group">
                                            <label for="profile-confirm-password">Confirm New Password</label>
                                            <input type="password" id="profile-confirm-password" placeholder="Confirm new password" minlength="6">
                                        </div>
                                    </div>
                                    <div class="form-row single">
                                        <p style="font-size: 12px; color: var(--text-secondary); margin: 0;">
                                            Leave password fields empty to keep current password. Password must be at least 6 characters.
                                        </p>
                                    </div>
                                </div>


                            </div>
                        </div>
                    </div>
                    
                    <div class="profile-content-footer">
                        <div class="profile-actions">
                            <button class="btn-profile-cancel">Cancel</button>
                            <button class="btn-profile-save">Save Changes</button>
                        </div>
                    </div>
                </div>
            </div>
        `;
    }

    function initializeModalEvents(modal, backdrop, userRole, currentUser) {
        const closeBtn = modal.querySelector('.modal-close-btn');
        const cancelBtn = modal.querySelector('.btn-profile-cancel');
        const saveBtn = modal.querySelector('.btn-profile-save');

        // Sidebar navigation
        const navItems = modal.querySelectorAll('.profile-nav-item');
        const contentSections = modal.querySelectorAll('.profile-content-section');
        const contentTitle = modal.querySelector('#profile-content-title');

        navItems.forEach(item => {
            item.addEventListener('click', () => {
                // Remove active class from all items
                navItems.forEach(nav => nav.classList.remove('active'));
                contentSections.forEach(section => section.classList.remove('active'));

                // Add active class to clicked item
                item.classList.add('active');

                // Show corresponding content section
                const sectionId = item.dataset.section;
                const targetSection = modal.querySelector(`#${sectionId}-section`);
                if (targetSection) {
                    targetSection.classList.add('active');
                }

                // Update title
                const titles = {
                    'profile': 'My Profile',
                    'employment': 'Employment Information',
                    'settings': 'Settings'
                };
                contentTitle.textContent = titles[sectionId] || 'My Profile';
            });
        });

        // Load current user data from API
        loadUserProfileData(modal);

        // Phone formatting
        const phoneInput = modal.querySelector('#profile-phone');
        phoneInput.addEventListener('blur', () => formatPhoneNumber(phoneInput));

        if (window.ProfileFormUtils && typeof window.ProfileFormUtils.bindPasswordFieldClearHandlers === 'function') {
            window.ProfileFormUtils.bindPasswordFieldClearHandlers(modal);
        }

        // Password validation
        const currentPasswordInput = modal.querySelector('#profile-current-password');
        const newPasswordInput = modal.querySelector('#profile-new-password');
        const confirmPasswordInput = modal.querySelector('#profile-confirm-password');

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
                    saveBtn.style.opacity = '0.6';
                } else {
                    saveBtn.style.opacity = '1';
                }
            });
        });

        // Event handlers
        function cleanup() {
            modal.remove();
            backdrop.remove();
        }

        closeBtn.addEventListener('click', cleanup);
        cancelBtn.addEventListener('click', cleanup);
        backdrop.addEventListener('click', cleanup);

        saveBtn.addEventListener('click', () => saveProfileChanges(modal, userRole, cleanup));

        // Focus first input
        setTimeout(() => {
            const firstInput = modal.querySelector('#profile-first-name');
            if (firstInput) firstInput.focus();
        }, 100);
    }

    async function loadUserProfileData(modal) {
        try {
            // Use fetchWithAuth which handles cookie-based authentication
            const response = await fetchWithAuth(`${window.API_URL || '/api'}/auth/profile`, {
                method: 'GET',
                headers: {
                    'Content-Type': 'application/json'
                }
            });

            if (response.ok) {
                const profileData = await response.json();
                console.log('[profile] Profile data loaded successfully:', profileData);
                loadUserData(modal, profileData);
            } else if (response.status === 401) {
                console.warn('[profile] Unauthorized to load profile data - session may have expired');
                // fetchWithAuth already handles redirect to login
            } else {
                console.warn('[profile] Failed to load profile data:', response.status);
            }
        } catch (error) {
            console.error('[profile] Error loading profile data:', error);
        }
    }

    function loadUserData(modal, user) {
        if (!user) return;

        // Personal info
        const firstNameInput = modal.querySelector('#profile-first-name');
        const lastNameInput = modal.querySelector('#profile-last-name');
        const emailInput = modal.querySelector('#profile-email');
        const phoneInput = modal.querySelector('#profile-phone');
        const addressInput = modal.querySelector('#profile-address');

        if (firstNameInput) firstNameInput.value = user.first_name || '';
        if (lastNameInput) lastNameInput.value = user.last_name || '';
        if (emailInput) emailInput.value = user.email || user.username || '';
        if (phoneInput) phoneInput.value = user.phone || '';
        if (addressInput) addressInput.value = user.address || '';

        // Employment info
        const positionInput = modal.querySelector('#profile-position');
        const departmentInput = modal.querySelector('#profile-department');
        const hireDateInput = modal.querySelector('#profile-hire-date');
        const statusInput = modal.querySelector('#profile-status');
        const employeeIdInput = modal.querySelector('#profile-employee-id');
        const roleInput = modal.querySelector('#profile-role');

        if (positionInput) positionInput.value = user.position || 'TBA';
        if (departmentInput) departmentInput.value = user.department || 'TBA';
        if (hireDateInput && user.hire_date) {
            const date = new Date(user.hire_date);
            if (!isNaN(date.getTime())) {
                hireDateInput.value = date.toISOString().split('T')[0];
            }
        }
        if (statusInput) {
            const statusMap = {
                'active': 'Active',
                'inactive': 'Inactive',
                'suspended': 'Suspended'
            };
            statusInput.value = statusMap[user.employee_status] || statusMap[user.status] || 'Active';
        }
        if (employeeIdInput) employeeIdInput.value = user.employee_id || user.user_id || '';
        if (roleInput) {
            const roleMap = {
                'employee': 'Employee',
                'hr': 'Attendance Monitoring Team',
                'head_dept': 'Department Head',
                'superadmin': 'Super Administrator'
            };
            roleInput.value = roleMap[user.role] || user.role || '';
        }
    }

    function formatPhoneNumber(input) {
        let value = input.value.replace(/\D/g, '');
        if (value.startsWith('63')) {
            value = '+' + value;
        } else if (value.startsWith('0') && value.length === 11) {
            value = '+63' + value.substring(1);
        } else if (value.length === 10) {
            value = '+63' + value;
        }
        input.value = value;
    }

    async function saveProfileChanges(modal, userRole, cleanup) {
        const saveBtn = modal.querySelector('.btn-profile-save');
        const originalText = saveBtn.textContent;

        try {
            saveBtn.disabled = true;
            saveBtn.textContent = 'Saving...';

            // Collect form data
            const formData = {
                first_name: modal.querySelector('#profile-first-name').value.trim(),
                last_name: modal.querySelector('#profile-last-name').value.trim(),
                phone: modal.querySelector('#profile-phone').value.trim(),
                address: modal.querySelector('#profile-address').value.trim(),
                position: modal.querySelector('#profile-position').value.trim(),
                dept_id: parseInt(modal.querySelector('#profile-department').value) || null,
                hire_date: modal.querySelector('#profile-hire-date').value || null
            };

            // Handle password change if provided
            const currentPassword = modal.querySelector('#profile-current-password').value.trim();
            const newPassword = modal.querySelector('#profile-new-password').value.trim();
            const confirmPassword = modal.querySelector('#profile-confirm-password').value.trim();

            if (window.ProfileFormUtils && typeof window.ProfileFormUtils.validatePasswordChange === 'function') {
                const passwordValidation = window.ProfileFormUtils.validatePasswordChange(modal, { allowEmpty: true });
                if (passwordValidation && !passwordValidation.valid) {
                    return;
                }

                if (passwordValidation && passwordValidation.hasPasswordChange) {
                    formData.currentPassword = passwordValidation.currentPassword;
                    formData.newPassword = passwordValidation.newPassword;
                }
            } else if (newPassword) {
                if (!currentPassword) {
                    throw new Error('Current password is required to change password');
                }
                if (newPassword.length < 6) {
                    throw new Error('New password must be at least 6 characters');
                }
                if (newPassword !== confirmPassword) {
                    throw new Error('New passwords do not match');
                }

                formData.currentPassword = currentPassword;
                formData.newPassword = newPassword;
            }

            // Validation
            if (!formData.first_name || !formData.last_name) {
                throw new Error('First name and last name are required');
            }

            // Phone validation
            if (formData.phone && !/^\+63[0-9]{10}$/.test(formData.phone)) {
                throw new Error('Phone number must be in format: +63xxxxxxxxxx');
            }

            // Save to server using fetchWithAuth (cookie-based auth)
            const response = await fetchWithAuth(`${window.API_URL || '/api'}/auth/profile`, {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(formData)
            });

            if (!response.ok) {
                const error = await response.json();
                const errorMessage = error.error || error.message || 'Failed to save profile';

                if (window.ProfileFormUtils && typeof window.ProfileFormUtils.setPasswordValidationError === 'function') {
                    if (window.ProfileFormUtils.setPasswordValidationError(errorMessage, modal)) {
                        return;
                    }
                }

                throw new Error(errorMessage);
            }

            const result = await response.json();

            // Clear profile cache to force refresh on next access
            if (window.clearProfileCache) {
                window.clearProfileCache();
            }

            // Trigger page refresh if name changed
            if (result.user && window.updateUserInterface && typeof window.updateUserInterface === 'function') {
                window.updateUserInterface(result.user);
            }

            alert('Profile updated successfully!');
            cleanup();

        } catch (error) {
            console.error('Profile save error:', error);
            alert('Error: ' + error.message);
        } finally {
            saveBtn.disabled = false;
            saveBtn.textContent = originalText;
        }
    }

    async function getCurrentUser() {
        try {
            return await window.fetchUserProfile() || {};
        } catch {
            return {};
        }
    }

    // Public API
    return {
        open: createProfileModal,
        getCurrentUser: getCurrentUser
    };
})();

window.ProfileFormUtils = (function () {
    const DEFAULT_PASSWORD_FIELD_IDS = [
        'profile-current-password',
        'profile-new-password',
        'profile-confirm-password'
    ];

    function getDocument(root) {
        return root && root.ownerDocument ? root.ownerDocument : document;
    }

    function findField(root, fieldId) {
        const scope = root && typeof root.querySelector === 'function' ? root : document;
        return scope.querySelector(`#${fieldId}`) || document.getElementById(fieldId);
    }

    function getFieldGroup(input) {
        if (!input) return null;
        return input.closest('.ep-form-group, .form-group');
    }

    function ensureErrorElement(input, fieldId, root) {
        const doc = getDocument(root || input);
        let errorElement = doc.getElementById(`${fieldId}-error`);

        if (errorElement) {
            applyErrorElementStyles(errorElement);
            return errorElement;
        }

        errorElement = doc.createElement('div');
        errorElement.id = `${fieldId}-error`;
        errorElement.className = 'ep-field-error';
        errorElement.setAttribute('aria-live', 'polite');
        applyErrorElementStyles(errorElement);

        const group = getFieldGroup(input);
        if (group) {
            group.appendChild(errorElement);
        } else if (input && input.parentNode) {
            input.parentNode.insertBefore(errorElement, input.nextSibling);
        }

        return errorElement;
    }

    function applyErrorElementStyles(errorElement) {
        if (!errorElement) return;

        errorElement.classList.add('ep-field-error');
        errorElement.hidden = true;
        errorElement.style.display = 'none';
        errorElement.style.gridTemplateRows = 'auto auto';
        errorElement.style.gap = '0.25rem';
        errorElement.style.marginTop = '0.45rem';
        errorElement.style.padding = '0.625rem 0.75rem';
        errorElement.style.border = '1px solid rgba(239, 68, 68, 0.35)';
        errorElement.style.borderLeftWidth = '4px';
        errorElement.style.borderRadius = '0.5rem';
        errorElement.style.background = 'rgba(254, 226, 226, 0.55)';
        errorElement.style.color = 'var(--text-primary)';
        errorElement.style.fontSize = '12px';
        errorElement.style.lineHeight = '1.4';
        errorElement.style.boxSizing = 'border-box';
        errorElement.style.width = '100%';
        errorElement.style.wordBreak = 'break-word';
    }

    function applyErrorMessageStyles(title, detailSpan) {
        if (title) {
            title.style.display = 'block';
            title.style.fontWeight = '600';
            title.style.color = 'var(--red-primary, #ef4444)';
        }

        if (detailSpan) {
            detailSpan.style.display = 'block';
            detailSpan.style.color = 'var(--text-secondary, #6b7280)';
            detailSpan.style.fontSize = '0.75rem';
        }
    }

    function applyErrorState(input, hasError) {
        if (!input) return;

        const group = getFieldGroup(input);
        if (group) {
            group.classList.toggle('ep-has-error', hasError);
        }

        if (hasError) {
            input.setAttribute('aria-invalid', 'true');
            input.style.borderColor = 'var(--red-primary, #ef4444)';
            input.style.boxShadow = '0 0 0 3px rgba(239, 68, 68, 0.12)';

            const label = group ? group.querySelector('label') : null;
            if (label) {
                label.style.color = 'var(--red-primary, #ef4444)';
            }
        } else {
            input.removeAttribute('aria-invalid');
            input.style.removeProperty('border-color');
            input.style.removeProperty('box-shadow');

            const label = group ? group.querySelector('label') : null;
            if (label) {
                label.style.removeProperty('color');
            }
        }
    }

    function clearPasswordFieldError(fieldId, root) {
        const input = findField(root, fieldId);
        if (!input) return;

        applyErrorState(input, false);

        const errorElement = ensureErrorElement(input, fieldId, root);
        errorElement.innerHTML = '';
        errorElement.hidden = true;
        errorElement.style.display = 'none';
    }

    function clearPasswordFieldErrors(root, fieldIds = DEFAULT_PASSWORD_FIELD_IDS) {
        fieldIds.forEach(fieldId => clearPasswordFieldError(fieldId, root));
    }

    function bindPasswordFieldClearHandlers(root, fieldIds = DEFAULT_PASSWORD_FIELD_IDS) {
        fieldIds.forEach(fieldId => {
            const input = findField(root, fieldId);
            if (!input || input.dataset.inlineErrorBound === 'true') return;

            input.dataset.inlineErrorBound = 'true';
            input.addEventListener('input', () => {
                clearPasswordFieldError(fieldId, root);
            });
        });
    }

    function setPasswordFieldError(fieldId, message, detail = '', root) {
        const input = findField(root, fieldId);
        if (!input) return;

        const doc = getDocument(root || input);
        const errorElement = ensureErrorElement(input, fieldId, root);

        errorElement.innerHTML = '';
        errorElement.hidden = false;
        errorElement.style.display = 'flex';
        errorElement.style.flexDirection = 'column';

        const title = doc.createElement('span');
        title.className = 'ep-field-error-title';
        title.textContent = message;
        errorElement.appendChild(title);

        let detailSpan = null;
        if (detail) {
            detailSpan = doc.createElement('span');
            detailSpan.className = 'ep-field-error-detail';
            detailSpan.textContent = detail;
            errorElement.appendChild(detailSpan);
        }

        applyErrorMessageStyles(title, detailSpan);

        applyErrorState(input, true);
    }

    function setPasswordValidationError(message, root) {
        const normalizedMessage = String(message || '').toLowerCase();

        if (normalizedMessage.includes('current password is incorrect')) {
            setPasswordFieldError(
                'profile-current-password',
                'Current password is incorrect.',
                'The password you entered does not match your current password.',
                root
            );
            const currentInput = findField(root, 'profile-current-password');
            if (currentInput) currentInput.focus();
            return true;
        }

        if (normalizedMessage.includes('current password and new password are required together')) {
            const errorText = 'Current password and new password are required.';
            const detailText = 'Fill in both fields before saving the new password.';
            setPasswordFieldError('profile-current-password', errorText, detailText, root);
            setPasswordFieldError('profile-new-password', errorText, detailText, root);
            const currentInput = findField(root, 'profile-current-password');
            if (currentInput) currentInput.focus();
            return true;
        }

        if (normalizedMessage.includes('new password must be at least 6 characters')) {
            setPasswordFieldError(
                'profile-new-password',
                'New password must be at least 6 characters.',
                'Use a longer password to continue.',
                root
            );
            const newInput = findField(root, 'profile-new-password');
            if (newInput) newInput.focus();
            return true;
        }

        if (normalizedMessage.includes('new passwords do not match')) {
            const detailText = 'Type the same password in both fields before saving.';
            setPasswordFieldError('profile-new-password', 'New passwords do not match.', detailText, root);
            setPasswordFieldError('profile-confirm-password', 'New passwords do not match.', detailText, root);
            const confirmInput = findField(root, 'profile-confirm-password');
            if (confirmInput) confirmInput.focus();
            return true;
        }

        if (normalizedMessage.includes('current password is required to change password')) {
            setPasswordFieldError(
                'profile-current-password',
                'Current password is required.',
                'Enter your current password before saving the new password.',
                root
            );
            const currentInput = findField(root, 'profile-current-password');
            if (currentInput) currentInput.focus();
            return true;
        }

        if (normalizedMessage.includes('new password is required')) {
            setPasswordFieldError(
                'profile-new-password',
                'New password is required.',
                'Type a new password to continue.',
                root
            );
            const newInput = findField(root, 'profile-new-password');
            if (newInput) newInput.focus();
            return true;
        }

        if (normalizedMessage.includes('please confirm the new password')) {
            setPasswordFieldError(
                'profile-confirm-password',
                'Please confirm the new password.',
                'Retype the new password before saving.',
                root
            );
            const confirmInput = findField(root, 'profile-confirm-password');
            if (confirmInput) confirmInput.focus();
            return true;
        }

        return false;
    }

    function validatePasswordChange(root, options = {}) {
        const currentPasswordId = options.currentPasswordId || 'profile-current-password';
        const newPasswordId = options.newPasswordId || 'profile-new-password';
        const confirmPasswordId = options.confirmPasswordId || 'profile-confirm-password';
        const minLength = options.minLength || 6;
        const allowEmpty = options.allowEmpty !== false;

        clearPasswordFieldErrors(root, [currentPasswordId, newPasswordId, confirmPasswordId]);

        const currentPasswordInput = findField(root, currentPasswordId);
        const newPasswordInput = findField(root, newPasswordId);
        const confirmPasswordInput = findField(root, confirmPasswordId);

        if (!currentPasswordInput || !newPasswordInput || !confirmPasswordInput) {
            return {
                valid: false,
                hasPasswordChange: false,
                currentPassword: '',
                newPassword: '',
                confirmPassword: '',
                error: 'Password fields were not found.'
            };
        }

        const currentPassword = currentPasswordInput.value.trim();
        const newPassword = newPasswordInput.value.trim();
        const confirmPassword = confirmPasswordInput.value.trim();
        const hasPasswordChange = Boolean(currentPassword || newPassword || confirmPassword);

        if (!hasPasswordChange && allowEmpty) {
            return {
                valid: true,
                hasPasswordChange: false,
                currentPassword: '',
                newPassword: '',
                confirmPassword: ''
            };
        }

        if (!currentPassword) {
            setPasswordFieldError(
                currentPasswordId,
                'Current password is required.',
                'Enter your current password before saving the new password.',
                root
            );
            currentPasswordInput.focus();
            return { valid: false, hasPasswordChange: true };
        }

        if (!newPassword) {
            setPasswordFieldError(
                newPasswordId,
                'New password is required.',
                'Type a new password to continue.',
                root
            );
            newPasswordInput.focus();
            return { valid: false, hasPasswordChange: true };
        }

        if (!confirmPassword) {
            setPasswordFieldError(
                confirmPasswordId,
                'Please confirm the new password.',
                'Retype the new password before saving.',
                root
            );
            confirmPasswordInput.focus();
            return { valid: false, hasPasswordChange: true };
        }

        if (newPassword.length < minLength) {
            setPasswordFieldError(
                newPasswordId,
                `New password must be at least ${minLength} characters.`,
                'Use a longer password to continue.',
                root
            );
            newPasswordInput.focus();
            return { valid: false, hasPasswordChange: true };
        }

        if (newPassword !== confirmPassword) {
            const detailText = 'Type the same password in both fields before saving.';
            setPasswordFieldError(newPasswordId, 'New passwords do not match.', detailText, root);
            setPasswordFieldError(confirmPasswordId, 'New passwords do not match.', detailText, root);
            confirmPasswordInput.focus();
            return { valid: false, hasPasswordChange: true };
        }

        return {
            valid: true,
            hasPasswordChange: true,
            currentPassword,
            newPassword,
            confirmPassword
        };
    }

    return {
        bindPasswordFieldClearHandlers,
        clearPasswordFieldError,
        clearPasswordFieldErrors,
        setPasswordFieldError,
        setPasswordValidationError,
        validatePasswordChange
    };
})();

window.ProfilePageController = (function () {
    const DEFAULT_SELECTORS = {
        profileSection: '#section-profile',
        profileTabItems: '.ep-tab-item, .profile-nav-item',
        profileTabPanels: '.ep-tab-panel, .profile-content-section',
        profileEditButton: '[data-panel="profile-section"]',
        settingsEditButton: '[data-panel="settings-section"]',
        profileCancelButton: '#profile-section .btn-profile-cancel',
        profileSaveButton: '#profile-section .btn-profile-save',
        settingsCancelButton: '#settings-section .btn-profile-cancel',
        settingsSaveButton: '#settings-section .btn-profile-save'
    };

    function createController(options = {}) {
        const root = options.root || document;
        const notify = typeof options.notify === 'function'
            ? options.notify
            : (message, type = 'info') => {
                if (window.showStatus) {
                    window.showStatus(message, type === 'error');
                    return;
                }

                if (type === 'error') {
                    alert(`Error: ${message}`);
                    return;
                }

                console.log(`[Profile] ${type}: ${message}`);
            };

        const state = {
            user: options.user || null,
        };

        function getProfileSection() {
            return root.querySelector(DEFAULT_SELECTORS.profileSection);
        }

        function renderUser() {
            if (!state.user) return;

            if (typeof options.renderHeader === 'function') {
                options.renderHeader(state.user);
            }

            if (typeof options.renderForm === 'function') {
                options.renderForm(state.user);
            }

            if (typeof options.onUserUpdated === 'function') {
                options.onUserUpdated(state.user);
            }
        }

        function setEditing(panel, enabled) {
            if (!panel) return;

            panel.classList.toggle('ep-editing', enabled);
            const editBtn = panel.querySelector('.ep-btn-edit');
            if (editBtn) {
                editBtn.style.display = enabled ? 'none' : '';
            }
        }

        function clearPasswordFields(section) {
            if (!section) return;

            const fields = section.querySelectorAll('#settings-section input[type="password"]');
            fields.forEach(input => {
                input.value = '';
            });

            if (window.ProfileFormUtils && typeof window.ProfileFormUtils.clearPasswordFieldErrors === 'function') {
                window.ProfileFormUtils.clearPasswordFieldErrors(section);
            }
        }

        function setupTabs() {
            const tabs = root.querySelectorAll(DEFAULT_SELECTORS.profileTabItems);
            const panels = root.querySelectorAll(DEFAULT_SELECTORS.profileTabPanels);

            tabs.forEach(tab => {
                tab.addEventListener('click', event => {
                    event.preventDefault();
                    const section = tab.dataset.section;

                    tabs.forEach(otherTab => otherTab.classList.remove('active'));
                    panels.forEach(panel => panel.classList.remove('active'));

                    tab.classList.add('active');

                    const targetPanel = root.querySelector(`#${section}-section`);
                    if (targetPanel) {
                        targetPanel.classList.add('active');
                    }
                });
            });
        }

        function setupProfileHandlers() {
            const profileSection = getProfileSection();
            if (!profileSection) return;

            if (window.ProfileFormUtils && typeof window.ProfileFormUtils.bindPasswordFieldClearHandlers === 'function') {
                window.ProfileFormUtils.bindPasswordFieldClearHandlers(profileSection);
            }

            const profileEditBtn = profileSection.querySelector(DEFAULT_SELECTORS.profileEditButton);
            if (profileEditBtn) {
                profileEditBtn.addEventListener('click', () => {
                    const panel = profileSection.querySelector('#profile-section');
                    setEditing(panel, true);
                });
            }

            const profileCancelBtn = profileSection.querySelector(DEFAULT_SELECTORS.profileCancelButton);
            if (profileCancelBtn) {
                profileCancelBtn.addEventListener('click', () => {
                    const panel = profileSection.querySelector('#profile-section');
                    setEditing(panel, false);
                    renderUser();
                    notify('Changes reverted', 'info');
                });
            }

            const profileSaveBtn = profileSection.querySelector(DEFAULT_SELECTORS.profileSaveButton);
            if (profileSaveBtn) {
                profileSaveBtn.addEventListener('click', async () => {
                    const saved = await saveProfileChanges(profileSection);
                    if (saved) {
                        const panel = profileSection.querySelector('#profile-section');
                        setEditing(panel, false);
                    }
                });
            }

            const settingsEditBtn = profileSection.querySelector(DEFAULT_SELECTORS.settingsEditButton);
            if (settingsEditBtn) {
                settingsEditBtn.addEventListener('click', () => {
                    const panel = profileSection.querySelector('#settings-section');
                    setEditing(panel, true);
                    if (window.ProfileFormUtils && typeof window.ProfileFormUtils.clearPasswordFieldErrors === 'function') {
                        window.ProfileFormUtils.clearPasswordFieldErrors(profileSection);
                    }
                });
            }

            const settingsCancelBtn = profileSection.querySelector(DEFAULT_SELECTORS.settingsCancelButton);
            if (settingsCancelBtn) {
                settingsCancelBtn.addEventListener('click', () => {
                    const panel = profileSection.querySelector('#settings-section');
                    setEditing(panel, false);
                    clearPasswordFields(profileSection);
                });
            }

            const settingsSaveBtn = profileSection.querySelector(DEFAULT_SELECTORS.settingsSaveButton);
            if (settingsSaveBtn) {
                settingsSaveBtn.addEventListener('click', async () => {
                    const saved = await savePasswordChanges(profileSection);
                    if (saved) {
                        const panel = profileSection.querySelector('#settings-section');
                        setEditing(panel, false);
                    }
                });
            }
        }

        function setupLogoutVisibility() {
            const headerLogout = root.querySelector('#logoutBtn, #sidebarLogoutBtn, #legacyLogoutBtn');
            if (!headerLogout) return;

            const logoutTargets = [
                root.querySelector('#profileSidebarLogoutBtn'),
                root.querySelector('#profileMobileLogoutBtn'),
                root.querySelector('.ep-mobile-signout')
            ].filter(Boolean);

            if (!logoutTargets.length) return;

            const desktopQuery = window.matchMedia('(min-width: 1025px)');
            const syncVisibility = () => {
                const hideOnDesktop = desktopQuery.matches;

                logoutTargets.forEach(target => {
                    if (hideOnDesktop) {
                        target.style.setProperty('display', 'none', 'important');
                        target.setAttribute('aria-hidden', 'true');
                    } else {
                        target.style.removeProperty('display');
                        target.removeAttribute('aria-hidden');
                    }
                });
            };

            syncVisibility();

            if (typeof desktopQuery.addEventListener === 'function') {
                desktopQuery.addEventListener('change', syncVisibility);
            } else if (typeof desktopQuery.addListener === 'function') {
                desktopQuery.addListener(syncVisibility);
            }
        }

        function setupLogoutHandlers() {
            const logoutSelectors = options.logoutSelectors || [];
            const fallbackLogout = async () => {
                if (typeof options.onLogout === 'function') {
                    await options.onLogout();
                    return;
                }

                if (window.AuthGuard && typeof window.AuthGuard.logout === 'function') {
                    window.AuthGuard.logout();
                    return;
                }

                window.location.href = '../index.html';
            };

            logoutSelectors.forEach(selector => {
                const element = typeof selector === 'string' ? root.querySelector(selector) : selector;
                if (!element) return;

                element.addEventListener('click', async () => {
                    try {
                        await fallbackLogout();
                    } catch (error) {
                        console.error('[ProfilePageController] Logout error:', error);
                        window.location.href = '../index.html';
                    }
                });
            });
        }

        async function saveProfileChanges(profileSection) {
            if (!state.user) return false;

            const firstName = root.getElementById('profile-first-name')?.value.trim() || '';
            const lastName = root.getElementById('profile-last-name')?.value.trim() || '';
            const phone = root.getElementById('profile-phone')?.value.trim() || '';
            const address = root.getElementById('profile-address')?.value.trim() || '';

            if (!firstName || !lastName) {
                notify('First name and last name are required', 'error');
                return false;
            }

            if (phone && !/^\+63[0-9]{10}$/.test(phone)) {
                notify('Phone number must be in format: +63xxxxxxxxxx', 'error');
                return false;
            }

            const profileData = {
                first_name: firstName,
                last_name: lastName,
                phone,
                address,
                updated_at: new Date().toISOString()
            };

            try {
                const apiBase = window.API_URL || '/api';
                const response = await window.fetchWithAuth(`${apiBase}/auth/profile`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(profileData)
                });

                const result = await response.json();

                if (!response.ok) {
                    const errorMessage = result.message || result.error || 'Unknown error';
                    notify(`Failed to save changes: ${errorMessage}`, 'error');
                    return false;
                }

                if (result.profile) {
                    Object.assign(state.user, result.profile);
                } else {
                    Object.assign(state.user, profileData);
                }

                if (window.clearProfileCache) {
                    window.clearProfileCache();
                }

                renderUser();
                notify('Changes saved successfully.', 'success');
                return true;
            } catch (error) {
                console.error('[ProfilePageController] Profile save error:', error);
                notify(`Error updating profile: ${error.message}`, 'error');
                return false;
            }
        }

        async function savePasswordChanges(profileSection) {
            if (!state.user) return false;

            const profileUtils = window.ProfileFormUtils;
            const validation = profileUtils && typeof profileUtils.validatePasswordChange === 'function'
                ? profileUtils.validatePasswordChange(profileSection, { allowEmpty: true })
                : null;

            if (validation && !validation.valid) {
                return false;
            }

            if (!validation || !validation.hasPasswordChange) {
                return true;
            }

            const payload = {
                currentPassword: validation.currentPassword,
                newPassword: validation.newPassword,
                updated_at: new Date().toISOString()
            };

            try {
                const apiBase = window.API_URL || '/api';
                const response = await window.fetchWithAuth(`${apiBase}/auth/profile`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload)
                });

                const result = await response.json();

                if (!response.ok) {
                    const errorMessage = result.message || result.error || 'Unknown error';
                    if (window.ProfileFormUtils && typeof window.ProfileFormUtils.setPasswordValidationError === 'function') {
                        if (window.ProfileFormUtils.setPasswordValidationError(errorMessage, profileSection)) {
                            return false;
                        }
                    }

                    notify(`Failed to update password: ${errorMessage}`, 'error');
                    return false;
                }

                const currentPasswordInput = profileSection.querySelector('#profile-current-password');
                const newPasswordInput = profileSection.querySelector('#profile-new-password');
                const confirmPasswordInput = profileSection.querySelector('#profile-confirm-password');

                if (currentPasswordInput) currentPasswordInput.value = '';
                if (newPasswordInput) newPasswordInput.value = '';
                if (confirmPasswordInput) confirmPasswordInput.value = '';

                if (window.ProfileFormUtils && typeof window.ProfileFormUtils.clearPasswordFieldErrors === 'function') {
                    window.ProfileFormUtils.clearPasswordFieldErrors(profileSection);
                }

                if (result.profile && state.user) {
                    Object.assign(state.user, result.profile);
                }

                notify('Password updated successfully!', 'success');
                return true;
            } catch (error) {
                console.error('[ProfilePageController] Password save error:', error);
                notify(`Error updating password: ${error.message}`, 'error');
                return false;
            }
        }

        function init() {
            if (!state.user) return null;

            renderUser();
            setupTabs();
            setupProfileHandlers();
            setupLogoutVisibility();
            setupLogoutHandlers();

            if (typeof options.afterInit === 'function') {
                options.afterInit(state.user, { refreshUser: renderUser, setUser: nextUser => {
                    state.user = nextUser;
                    renderUser();
                } });
            }

            return state.user;
        }

        function setUser(nextUser) {
            state.user = nextUser;
            renderUser();
        }

        function getUser() {
            return state.user;
        }

        return {
            init,
            setUser,
            getUser,
            refreshUser: renderUser,
        };
    }

    return {
        createController,
        createStandardController: createController,
    };
})();