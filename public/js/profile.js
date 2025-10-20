// Profile modal functionality - reusable across all pages
window.ProfileModal = (function() {
    
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
        modal.className = 'reset-modal profile-modal';
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
        const firstName = currentUser?.first_name || 'User';
        const lastName = currentUser?.last_name || '';
        const initials = (firstName.charAt(0) + lastName.charAt(0)).toUpperCase();
        const email = currentUser?.email || 'user@example.com';
        
        return `
            <div class="profile-modal-container">
                <!-- Left Card: Profile & Sidebar -->
                <div class="profile-sidebar-card">
                    <div class="profile-user-info">
                        <div class="profile-avatar">
                            <span class="avatar-initials">${initials}</span>
                        </div>
                        <div class="profile-user-details">
                            <h3 class="profile-username">${firstName} ${lastName}</h3>
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
                        <button class="modal-close-btn" aria-label="Close">✕</button>
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

                                <!-- PIN Code Setup -->
                                <div style="padding-top: 20px; border-top: 1px solid var(--border-primary);">
                                    <h5 style="font-size: 14px; font-weight: 600; margin: 0 0 12px 0; color: var(--text-primary);">PIN Code for QR Attendance</h5>
                                    <p style="font-size: 12px; color: var(--text-secondary); margin: 0 0 16px 0;">
                                        Set a PIN code to use with QR code scanning for attendance check-in/check-out.
                                    </p>
                                    <div class="form-row single">
                                        <div class="form-group">
                                            <label for="profile-pin-current-password">Current Password (Required)</label>
                                            <input type="password" id="profile-pin-current-password" placeholder="Confirm your password" required>
                                        </div>
                                    </div>
                                    <div class="form-row">
                                        <div class="form-group">
                                            <label for="profile-pin-code">New PIN Code</label>
                                            <input type="password" id="profile-pin-code" placeholder="4-6 digit PIN" minlength="4" maxlength="6" inputmode="numeric" pattern="[0-9]{4,6}">
                                        </div>
                                        <div class="form-group">
                                            <label for="profile-pin-confirm">Confirm PIN Code</label>
                                            <input type="password" id="profile-pin-confirm" placeholder="Confirm your PIN" minlength="4" maxlength="6" inputmode="numeric" pattern="[0-9]{4,6}">
                                        </div>
                                    </div>
                                    <div class="form-row single">
                                        <p style="font-size: 12px; color: var(--text-secondary); margin: 0;">
                                            PIN must be 4-6 digits. Leave PIN fields empty to keep current PIN.
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
                'hr': 'HR Manager',
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
            
            if (newPassword) {
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

            // Handle PIN code change if provided
            const pinCurrentPassword = modal.querySelector('#profile-pin-current-password')?.value.trim() || '';
            const pinCode = modal.querySelector('#profile-pin-code')?.value.trim() || '';
            const pinConfirm = modal.querySelector('#profile-pin-confirm')?.value.trim() || '';
            
            if (pinCode || pinConfirm) {
                if (!pinCurrentPassword) {
                    throw new Error('Current password is required to set PIN code');
                }
                if (pinCode.length < 4 || pinCode.length > 6) {
                    throw new Error('PIN code must be 4-6 digits');
                }
                if (!/^\d{4,6}$/.test(pinCode)) {
                    throw new Error('PIN code must contain only digits (0-9)');
                }
                if (pinCode !== pinConfirm) {
                    throw new Error('PIN codes do not match');
                }
                
                formData.pinPassword = pinCurrentPassword;
                formData.pinCode = pinCode;
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
                throw new Error(error.error || 'Failed to save profile');
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