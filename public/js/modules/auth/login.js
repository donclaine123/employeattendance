    // Mock login script for Workline employee portal
    // Contains a single mock account and handles form submission and QR button

(() => {
    // Authentication is provided by the backend mock server. Local in-file mocks removed to avoid
    // duplicate credential data. Ensure the mock server is running and `js/api.js` (AppApi) is loaded.

    // Helper: simple email normalization
    function normalizeEmail(e) {
        return (e || '').trim().toLowerCase();
    }

    function isValidEmail(email) {
        return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
    }

    function getFieldElements(inputId) {
        const input = document.getElementById(inputId);
        const group = input ? input.closest('.input-group') : null;
        const hint = group ? group.querySelector('.field-hint') : null;
        return { input, group, hint };
    }

    function rememberDefaultHints() {
        document.querySelectorAll('.field-hint').forEach(hint => {
            if (!hint.dataset.defaultHint) {
                hint.dataset.defaultHint = hint.textContent.trim();
            }
        });
    }

    function setFieldState(inputId, message, isError) {
        const { input, group, hint } = getFieldElements(inputId);
        if (!input || !group || !hint) return;

        const defaultHint = hint.dataset.defaultHint || hint.textContent.trim();
        group.classList.toggle('is-invalid', Boolean(isError));
        group.classList.toggle('is-valid', !isError && Boolean(input.value.trim()));
        input.setAttribute('aria-invalid', isError ? 'true' : 'false');
        hint.textContent = message || defaultHint;
    }

    function clearFieldState(inputId) {
        const { input, group, hint } = getFieldElements(inputId);
        if (!input || !group || !hint) return;

        const defaultHint = hint.dataset.defaultHint || hint.textContent.trim();
        group.classList.remove('is-invalid');
        group.classList.toggle('is-valid', Boolean(input.value.trim()));
        input.setAttribute('aria-invalid', 'false');
        hint.textContent = defaultHint;
    }

    function validateEmailField(showErrors = false) {
        const { input } = getFieldElements('email');
        if (!input) return false;

        const email = normalizeEmail(input.value);
        if (!email) {
            if (showErrors) {
                setFieldState('email', 'Enter your email address to continue.', true);
            } else {
                clearFieldState('email');
            }
            return false;
        }

        if (!isValidEmail(email)) {
            if (showErrors) {
                setFieldState('email', 'Enter a valid email address.', true);
            } else {
                clearFieldState('email');
            }
            return false;
        }

        clearFieldState('email');
        return true;
    }

    function validatePasswordField(showErrors = false) {
        const { input } = getFieldElements('password');
        if (!input) return false;

        const password = input.value || '';
        if (!password.trim()) {
            if (showErrors) {
                setFieldState('password', 'Enter your password to sign in.', true);
            } else {
                clearFieldState('password');
            }
            return false;
        }

        clearFieldState('password');
        return true;
    }

    function validateLoginForm() {
        const emailValid = validateEmailField(true);
        const passwordValid = validatePasswordField(true);
        return emailValid && passwordValid;
    }

    function setSubmitLoading(submitBtn, isLoading) {
        if (!submitBtn) return;

        if (isLoading) {
            submitBtn.disabled = true;
            submitBtn.setAttribute('aria-busy', 'true');
            submitBtn.innerHTML = `<span class="btn-spinner"></span> Signing In...`;
            return;
        }

        submitBtn.disabled = false;
        submitBtn.removeAttribute('aria-busy');
    }

    // Check for existing valid session and redirect if found
    // This bypasses the token refresh modal by doing a direct fetch without fetchWithAuth
    async function checkExistingSession() {
        try {
            console.log('[login.js] Checking for existing session...');
            
            // Direct fetch to avoid triggering token refresh modal on 401
            // Temporarily suppress console errors for this specific request
       
            
            const apiBase = window.API_URL || '/api';
            const resp = await fetch(`${apiBase}/auth/profile`, {
                method: 'GET',
                credentials: 'include', // Send session cookies
                headers: {
                    'Content-Type': 'application/json'
                }
            });
            
            
            if (resp.ok) {
                const user = await resp.json();
                
                if (user && user.role) {
                    console.log('[login.js] Valid session found for user:', user.email, 'role:', user.role);
                    
                    // Determine redirect page based on role
                    const rolePages = {
                        'superadmin': 'pages/Superadmin.html',
                        'hr': 'pages/HRDashboard.html',
                        'head_dept': 'pages/DepartmentHead.html',
                        'display': 'pages/qr-display.html',
                        'employee': 'pages/employee.html'
                    };
                    
                    const redirectPage = rolePages[user.role] || 'pages/employee.html';
                    console.log('[login.js] Redirecting to:', redirectPage);
                    
                    // Redirect immediately
                    window.location.href = redirectPage;
                    return true;
                }
            } else if (resp.status === 401 || resp.status === 403) {
                console.log('[login.js] No valid session (401/403), showing login form');
                return false;
            }
            
            console.log('[login.js] No valid session found, showing login form');
            return false;
        } catch (err) {
            console.log('[login.js] Session check error (expected if not logged in):', err.message);
            return false;
        }
    }    // Show a message inside the login form
    function showMessage(text, timeout = 4000, isError = false) {
        try {
            const container = document.getElementById('messageContainer');
            if (!container) {
                console.warn('Message container not found');
                return;
            }

            // Clear any existing messages
            container.innerHTML = '';

            const p = document.createElement('p');
            p.textContent = text;
            p.className = isError ? 'toast-message error' : 'toast-message success';
            container.appendChild(p);
            
            if (timeout) {
                setTimeout(() => {
                    if (p.parentNode) {
                        p.remove();
                    }
                }, timeout);
            }
        } catch (e) {
            // fail silently but log for debugging
            console.warn('showMessage failed to update DOM', e);
        }
    }

    function openSupportModal() {
        const modal = document.getElementById('supportModal');
        if (!modal) return;

        modal.classList.add('active');
        document.body.style.overflow = 'hidden';

        const closeButton = modal.querySelector('.modal-close-btn');
        if (closeButton) closeButton.focus();
    }

    function closeSupportModal() {
        const modal = document.getElementById('supportModal');
        if (!modal) return;

        modal.classList.remove('active');
        document.body.style.overflow = '';
    }

    function openResetModal() {
        const modal = document.getElementById('forgotPasswordModal');
        if (!modal) {
            console.error('Reset password modal not found');
            return;
        }

        modal.classList.add('active');
        document.body.style.overflow = 'hidden';

        const resetEmailInput = document.getElementById('resetEmail');
        const emailInput = document.getElementById('email');
        if (resetEmailInput && emailInput && emailInput.value) {
            resetEmailInput.value = emailInput.value;
        }

        if (resetEmailInput) {
            // setTimeout ensures focus works after modal transition
            setTimeout(() => resetEmailInput.focus(), 100);
        }
        
        // Clear old messages
        const msgContainer = document.getElementById('resetMessageContainer');
        if (msgContainer) msgContainer.innerHTML = '';
        if (msgContainer) msgContainer.style.color = '';
    }

    function closeResetModal() {
        const modal = document.getElementById('forgotPasswordModal');
        if (!modal) return;

        modal.classList.remove('active');
        document.body.style.overflow = '';
        
        const resetEmailInput = document.getElementById('resetEmail');
        if (resetEmailInput) resetEmailInput.value = '';

        // Reset the message text when closing
        const msgContainer = document.getElementById('resetMessageContainer');
        if (msgContainer) {
            msgContainer.textContent = '';
        }
    }

    // Get appropriate page for user role, with optional validation of requested page
    function getPageForRole(userRole, requestedPage = null) {
        // Define role-to-page mapping (using relative paths - will be converted to absolute URLs)
        const rolePages = {
            'superadmin': 'pages/Superadmin.html',
            'hr': 'pages/HRDashboard.html', 
            'head_dept': 'pages/DepartmentHead.html',
            'display': 'pages/qr-display.html',
            'employee': 'pages/employee.html'
        };

        // Get the default page for the user's role
        const defaultPage = rolePages[userRole] || 'pages/employee.html';

        // If no specific page requested, return default
        if (!requestedPage) {
            return convertToAbsoluteUrl(defaultPage);
        }

        // Clean up the requested page path
        let cleanedPath = requestedPage;
        if (cleanedPath.startsWith('/')) cleanedPath = cleanedPath.slice(1);
        
        // Check if the requested page matches the user's role
        const requestedPageName = cleanedPath.split('/').pop(); // Get filename
        const allowedPageName = defaultPage.split('/').pop(); // Get filename
        
        // If the requested page matches their role's page, allow it
        if (requestedPageName === allowedPageName) {
            return convertToAbsoluteUrl(defaultPage);
        }
        
        // Otherwise, redirect to their appropriate page
        console.warn(`[Login] User ${userRole} attempted to access ${requestedPage}, redirected to ${defaultPage}`);
        return convertToAbsoluteUrl(defaultPage);
    }

    // Convert relative paths to absolute URLs to ensure proper routing through proxies
    function convertToAbsoluteUrl(relativePath) {
        // Get current origin (e.g., https://employeeattendance.me or https://localhost:3000)
        const origin = window.location.origin;
        
        // Remove leading slash if present
        const cleanPath = relativePath.startsWith('/') ? relativePath.slice(1) : relativePath;
        
        // Return absolute URL
        return `${origin}/${cleanPath}`;
    }

    // Handle regular sign-in
    function handleSignIn(event) {
        event.preventDefault();
        const email = normalizeEmail(document.getElementById('email').value);
        const password = document.getElementById('password').value || '';
        const submitBtn = document.querySelector('.glass-btn-primary');
        const originalBtnContent = submitBtn.innerHTML;

        // Basic validation
        if (!validateLoginForm()) {
            showMessage('Check the highlighted fields and try again.', 3000, true);
            const firstInvalid = document.querySelector('.input-group.is-invalid .glass-input');
            if (firstInvalid) firstInvalid.focus();
            return;
        }

        // Set Loading State
        setSubmitLoading(submitBtn, true);

        // Call the real API when available (mock server). If AppApi is not present, instruct dev to start the mock server.
        if (window.AppApi && typeof window.AppApi.login === 'function') {
            // call API
            AppApi.login(email, password).then(data => {
                console.log('[login.js] Login response received:', data);
                
                // Check if password change is required
                if (data && data.requirePasswordChange) {
                    submitBtn.innerHTML = originalBtnContent;
                    setSubmitLoading(submitBtn, false);
                    showFirstLoginPasswordChange(data.userId, password);
                    return;
                }
                
                const user = data && data.user;
                console.log('[login.js] User from response:', user);
                
                if (user) {
                    // Success State
                    submitBtn.innerHTML = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg> Success!`;
                    submitBtn.classList.add('success');
                    submitBtn.setAttribute('aria-busy', 'false');
                    
                    // Check for return URL parameter and validate access
                    const urlParams = new URLSearchParams(window.location.search);
                    const returnUrl = urlParams.get('return');
                    
                    let redirect;
                    if (returnUrl) {
                        // Validate if user has access to the return URL page
                        const requestedPage = decodeURIComponent(returnUrl);
                        const allowedPage = getPageForRole(user.role, requestedPage);
                        redirect = allowedPage;
                    } else {
                        // Use role-based default page
                        redirect = getPageForRole(user.role);
                    }
                    
                    console.log('[login.js] Redirecting to:', redirect);
                    setTimeout(() => { 
                        console.log('[login.js] Executing redirect now');
                        window.location.href = redirect; 
                    }, 1000);
                } else {
                    console.error('[login.js] No user in response data');
                    showMessage('Login failed. Please check your credentials and try again.', 4000, true);
                    submitBtn.innerHTML = originalBtnContent;
                    setSubmitLoading(submitBtn, false);
                }
            }).catch(err => {
                console.error('[login.js] Login error:', err);
                showMessage('Invalid email or password. Please try again.', 4000, true);
                submitBtn.innerHTML = originalBtnContent;
                setSubmitLoading(submitBtn, false);
            });
            return;
        }
        // If we reached here, AppApi is not available. Guide developer to run the mock server.
        showMessage('Backend not available — start the mock server (see server/README.md) and reload the page.', 6000, true);
        submitBtn.innerHTML = originalBtnContent;
        setSubmitLoading(submitBtn, false);
    }

    // Handle QR scan button (mock)
    function handleQrScan() {
        // In a real app this would open camera/scan. Here we simulate a quick mark and redirect.
        // Authentication is now cookie-based - no need to check sessionStorage
        // The server will validate the session cookie when the attendance endpoint is called
        
        showMessage('QR recognized. Marking attendance and redirecting...', 1200, false);
        setTimeout(() => {
            window.location.href = 'pages/employee.html';
        }, 900);
    }

    // Show/hide session check loading indicator (if needed for future use)
    function showSessionCheckLoader(show = true, message = 'Checking session...') {
        try {
            let loader = document.getElementById('sessionCheckLoader');
            
            if (show) {
                if (!loader) {
                    loader = document.createElement('div');
                    loader.id = 'sessionCheckLoader';
                    loader.innerHTML = `
                        <div class="session-loader-backdrop">
                            <div class="session-loader-box">
                                <div class="session-spinner"></div>
                                <p class="session-loader-text">Checking session...</p>
                            </div>
                        </div>
                    `;
                    document.body.appendChild(loader);
                    
                    // Add styles if not already present
                    if (!document.getElementById('sessionCheckLoaderStyles')) {
                        const styles = document.createElement('style');
                        styles.id = 'sessionCheckLoaderStyles';
                        styles.innerHTML = `
                            #sessionCheckLoader .session-loader-backdrop {
                                position: fixed;
                                inset: 0;
                                background: rgba(12, 15, 19, 0.7);
                                backdrop-filter: blur(2px);
                                display: flex;
                                align-items: center;
                                justify-content: center;
                                z-index: 9998;
                                animation: fadeInSession 300ms ease-in-out;
                            }
                            
                            #sessionCheckLoader .session-loader-box {
                                background: var(--bg-secondary, #14181F);
                                border: 1px solid var(--border-primary, #2a3754);
                                padding: 32px;
                                border-radius: 12px;
                                text-align: center;
                                box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
                                min-width: 240px;
                            }
                            
                            #sessionCheckLoader .session-spinner {
                                width: 40px;
                                height: 40px;
                                margin: 0 auto 16px;
                                border: 3px solid rgba(76, 175, 80, 0.2);
                                border-top-color: #4cb50e;
                                border-radius: 50%;
                                animation: spin 1s linear infinite;
                            }
                            
                            #sessionCheckLoader .session-loader-text {
                                margin: 0;
                                font-size: 14px;
                                color: var(--text-primary, #f3f4f6);
                                font-weight: 500;
                            }
                            
                            @keyframes spin {
                                from { transform: rotate(0deg); }
                                to { transform: rotate(360deg); }
                            }
                            
                            @keyframes fadeInSession {
                                from { opacity: 0; }
                                to { opacity: 1; }
                            }
                        `;
                        document.head.appendChild(styles);
                    }
                }
                
                // Update message if provided
                const textEl = loader.querySelector('.session-loader-text');
                if (textEl) textEl.textContent = message;
                loader.style.display = 'flex';
            } else {
                if (loader) loader.style.display = 'none';
            }
        } catch (e) {
            console.warn('[login.js] Failed to show/hide session loader:', e);
        }
    }

    // Attach event listeners when DOM is ready
    document.addEventListener('DOMContentLoaded', () => {
        rememberDefaultHints();

        // First, check if user already has a valid session
        // If they do, redirect them immediately without showing login form
        checkExistingSession().then(sessionFound => {
            if (sessionFound) {
                console.log('[login.js] Session check redirected user, skipping form setup');
                return; // User was redirected, don't set up login form
            }
            
            // No existing session, proceed with normal login form setup
            console.log('[login.js] No existing session found, setting up login form');
        });

        const form = document.getElementById('loginForm');
        if (form) form.addEventListener('submit', handleSignIn);

        const emailInput = document.getElementById('email');
        if (emailInput) {
            emailInput.addEventListener('blur', () => validateEmailField(true));
            emailInput.addEventListener('input', () => {
                if (emailInput.value.trim()) {
                    validateEmailField(Boolean(emailInput.closest('.input-group')?.classList.contains('is-invalid')));
                } else {
                    clearFieldState('email');
                }
            });
        }

        const passwordInput = document.getElementById('password');
        if (passwordInput) {
            passwordInput.addEventListener('blur', () => validatePasswordField(true));
            passwordInput.addEventListener('input', () => {
                if (passwordInput.value.trim()) {
                    validatePasswordField(Boolean(passwordInput.closest('.input-group')?.classList.contains('is-invalid')));
                } else {
                    clearFieldState('password');
                }
            });
        }

        const qrBtn = document.getElementById('qrScanBtn');
        if (qrBtn) qrBtn.addEventListener('click', handleQrScan);

        // Password toggle eye icon
        const passwordToggle = document.getElementById('passwordToggle');
        if (passwordToggle && passwordInput) {
            passwordToggle.addEventListener('click', (e) => {
                e.preventDefault();
                const isPassword = passwordInput.type === 'password';
                passwordInput.type = isPassword ? 'text' : 'password';
                
                // Toggle icon visibility
                const eyeOpen = passwordToggle.querySelector('.eye-open');
                const eyeClosed = passwordToggle.querySelector('.eye-closed');
                if (eyeOpen && eyeClosed) {
                    eyeOpen.style.display = isPassword ? 'none' : 'block';
                    eyeClosed.style.display = isPassword ? 'block' : 'none';
                }
                
                // Update aria-label
                passwordToggle.setAttribute('aria-label', isPassword ? 'Hide password' : 'Show password');
                passwordToggle.setAttribute('aria-pressed', isPassword ? 'true' : 'false');
            });

            passwordToggle.setAttribute('aria-pressed', 'false');
        }

        // Make the "Forgot password" open an inline reset panel
        const forgotEl = document.querySelector('.forgot-password');
        if (forgotEl) {
            forgotEl.addEventListener('click', (e) => {
                e.preventDefault();
                openResetModal();
            });
        }

        const supportButtons = document.querySelectorAll('.contact-support');
        supportButtons.forEach(button => {
            button.addEventListener('click', openSupportModal);
        });

        const supportModal = document.getElementById('supportModal');
        if (supportModal) {
            const closeButtons = supportModal.querySelectorAll('.modal-close-btn, .modal-close-action');
            closeButtons.forEach(button => {
                button.addEventListener('click', closeSupportModal);
            });

            supportModal.addEventListener('click', event => {
                if (event.target === supportModal) {
                    closeSupportModal();
                }
            });
        }

        const resetModal = document.getElementById('forgotPasswordModal');
        if (resetModal) {
            const closeButtons = resetModal.querySelectorAll('.modal-close-btn, .modal-close-action');
            closeButtons.forEach(button => {
                button.addEventListener('click', (e) => {
                    e.preventDefault();
                    closeResetModal();
                });
            });

            resetModal.addEventListener('click', event => {
                if (event.target === resetModal) {
                    closeResetModal();
                }
            });

            const sendBtn = document.getElementById('resetSendBtn');
            if (sendBtn) {
                sendBtn.addEventListener('click', handleResetPassword);
            }
        }

        // Also add the new cancel button for closure
        const cancelBtn = document.getElementById('resetCancelBtn');
        if (cancelBtn) {
            cancelBtn.addEventListener('click', (e) => {
                e.preventDefault();
                closeResetModal();
            });
        }

        document.addEventListener('keydown', event => {
            if (event.key === 'Escape') {
                closeSupportModal();
                closeResetModal();
            }
        });

        // Do not prefill email by default (accounts are provisioned by HR/Super Admin)
        if (emailInput) emailInput.value = '';
    });

    // Modal reset dialog for forgot-password
    function openResetPanel() {
        openResetModal();
    }

    async function handleResetPassword() {
        const emailInput = document.getElementById('resetEmail');
        const email = emailInput ? emailInput.value.trim() : '';
        const msgContainer = document.getElementById('resetMessageContainer');
        const sendBtn = document.getElementById('resetSendBtn');
        const spinner = sendBtn.querySelector('.btn-spinner');
        const btnText = sendBtn.querySelector('.btn-text');

        if (!email) {
            if (msgContainer) {
                msgContainer.textContent = 'Please enter your email address.';
                msgContainer.style.color = 'var(--red-primary)';
            }
            return;
        }

        if (!isValidEmail(email)) {
            if (msgContainer) {
                msgContainer.textContent = 'Please enter a valid email address.';
                msgContainer.style.color = 'var(--red-primary)';
            }
            return;
        }

        try {
            // Set loading state
            sendBtn.disabled = true;
            spinner.style.display = 'inline-block';
            btnText.textContent = 'Sending...';
            if (msgContainer) {
                msgContainer.textContent = '';
                msgContainer.style.color = '';
            }

            // Fetch real API request
            const response = await fetch('/api/auth/forgot-password', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email })
            });
            const data = await response.json();

            // Show success message
            if (msgContainer) {
                if (data.success) {
                    msgContainer.textContent = data.message || 'If the email exists, a password reset link has been sent.';
                    msgContainer.style.color = 'var(--green-primary)';
                } else {
                    msgContainer.textContent = data.error || 'Something went wrong. Please try again.';
                    msgContainer.style.color = 'var(--red-primary)';
                }
            }

            // Close after 3 seconds on success
            if (data.success) {
                setTimeout(() => {
                    closeResetModal();
                    sendBtn.disabled = false;
                    spinner.style.display = 'none';
                    btnText.textContent = 'Send Link';
                }, 3000);
            } else {
                sendBtn.disabled = false;
                spinner.style.display = 'none';
                btnText.textContent = 'Send Link';
            }

        } catch (error) {
            console.error('Password reset error:', error);
            if (msgContainer) {
                msgContainer.textContent = 'Error processing request. Try again later.';
                msgContainer.style.color = 'var(--red-primary)';
            }
            sendBtn.disabled = false;
            spinner.style.display = 'none';
            btnText.textContent = 'Send Link';
        }
    }

    // Contact Support modal - REMOVED (Handled by index.html inline script)
    // function openContactSupport() { ... }

    // Show first login password change modal
    function showFirstLoginPasswordChange(userId, currentPassword) {
        if (document.querySelector('.first-login-modal')) {
            document.querySelector('.first-login-modal .new-password').focus();
            return;
        }

        const previouslyFocused = document.activeElement;

        const backdrop = document.createElement('div');
        backdrop.className = 'modal-backdrop';

        const modal = document.createElement('div');
        modal.className = 'reset-modal first-login-modal';
        modal.setAttribute('role', 'dialog');
        modal.setAttribute('aria-modal', 'true');
        modal.innerHTML = `
            <div class="modal-card">
                <div class="modal-header"><h3 class="modal-title">Change Password Required</h3></div>
                <div class="modal-body">
                    <p style="margin-bottom: 16px; color: var(--muted-foreground);">You must change your password before continuing.</p>
                    <label style="display: block; font-weight: 600; margin-bottom: 6px;">New Password</label>
                    <input type="password" class="new-password" placeholder="New password (min 6 characters)" aria-label="new password" minlength="6" required style="margin-bottom: 12px;">
                    <label style="display: block; font-weight: 600; margin-bottom: 6px;">Confirm Password</label>
                    <input type="password" class="confirm-password" placeholder="Confirm new password" aria-label="confirm password" minlength="6" required>
                    <p style="margin-top: 8px; font-size: 12px; color: var(--muted-foreground);">Password must be at least 6 characters long.</p>
                </div>
                <div class="modal-footer">
                    <div class="modal-actions">
                        <button class="modal-send-btn">Change Password</button>
                    </div>
                </div>
            </div>
        `;

        document.body.appendChild(backdrop);
        document.body.appendChild(modal);

        const newPasswordInput = modal.querySelector('.new-password');
        const confirmPasswordInput = modal.querySelector('.confirm-password');
        const sendBtn = modal.querySelector('.modal-send-btn');

        function cleanup() {
            modal.remove();
            backdrop.remove();
            document.removeEventListener('keydown', onKey);
            if (previouslyFocused && previouslyFocused.focus) previouslyFocused.focus();
        }

        function validatePasswords() {
            const newPassword = newPasswordInput.value || '';
            const confirmPassword = confirmPasswordInput.value || '';
            return newPassword.length >= 6 && newPassword === confirmPassword;
        }

        function setLoading(on) {
            if (on) {
                sendBtn.textContent = 'Changing...';
                sendBtn.disabled = true;
            } else {
                sendBtn.textContent = 'Change Password';
                sendBtn.disabled = false;
            }
        }

        function onChangePassword() {
            if (!validatePasswords()) {
                showMessage('Passwords must be at least 6 characters and match.', 3500, true);
                return;
            }

            setLoading(true);

            fetch(`${window.API_URL || '/api'}/change-first-login-password`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    userId: userId,
                    currentPassword: currentPassword,
                    newPassword: newPasswordInput.value
                })
            })
            .then(response => response.json())
            .then(data => {
                setLoading(false);
                if (data.success) {
                    showMessage('Password changed successfully! Please log in again.', 4000, false);
                    cleanup();
                    // Clear form and reset to login state
                    document.getElementById('email').value = '';
                    document.getElementById('password').value = '';
                } else {
                    showMessage(data.error || 'Failed to change password.', 4000, true);
                }
            })
            .catch(err => {
                setLoading(false);
                showMessage('Network error: ' + (err.message || ''), 4000, true);
            });
        }

        sendBtn.addEventListener('click', onChangePassword);

        function refreshSendState() { 
            sendBtn.disabled = !validatePasswords(); 
        }
        
        newPasswordInput.addEventListener('input', refreshSendState);
        confirmPasswordInput.addEventListener('input', refreshSendState);
        
        newPasswordInput.addEventListener('keydown', (e) => { 
            if (e.key === 'Enter') confirmPasswordInput.focus(); 
        });
        confirmPasswordInput.addEventListener('keydown', (e) => { 
            if (e.key === 'Enter') onChangePassword(); 
        });

        function onKey(e) { 
            // Don't allow escape - force password change
            if (e.key === 'Escape') {
                e.preventDefault();
                showMessage('You must change your password to continue.', 3000, true);
            }
        }
        document.addEventListener('keydown', onKey);

        // Focus first input
        setTimeout(() => newPasswordInput.focus(), 100);
    }

})();
