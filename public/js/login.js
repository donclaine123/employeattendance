    // Mock login script for Workline employee portal
    // Contains a single mock account and handles form submission and QR button

(() => {
    // Authentication is provided by the backend mock server. Local in-file mocks removed to avoid
    // duplicate credential data. Ensure the mock server is running and `js/api.js` (AppApi) is loaded.

    // Helper: simple email normalization
    function normalizeEmail(e) {
        return (e || '').trim().toLowerCase();
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

    // Get appropriate page for user role, with optional validation of requested page
    function getPageForRole(userRole, requestedPage = null) {
        // Define role-to-page mapping
        const rolePages = {
            'superadmin': 'pages/Superadmin.html',
            'hr': 'pages/HRDashboard.html', 
            'head_dept': 'pages/DepartmentHead.html',
            'employee': 'pages/employee.html'
        };

        // Get the default page for the user's role
        const defaultPage = rolePages[userRole] || 'pages/employee.html';

        // If no specific page requested, return default
        if (!requestedPage) {
            return defaultPage;
        }

        // Clean up the requested page path
        let cleanedPath = requestedPage;
        if (cleanedPath.startsWith('/')) cleanedPath = cleanedPath.slice(1);
        
        // Check if the requested page matches the user's role
        const requestedPageName = cleanedPath.split('/').pop(); // Get filename
        const allowedPageName = defaultPage.split('/').pop(); // Get filename
        
        // If the requested page matches their role's page, allow it
        if (requestedPageName === allowedPageName) {
            return defaultPage;
        }
        
        // Otherwise, redirect to their appropriate page
        console.warn(`[Login] User ${userRole} attempted to access ${requestedPage}, redirected to ${defaultPage}`);
        return defaultPage;
    }

    // Handle regular sign-in
    function handleSignIn(event) {
        event.preventDefault();
        const email = normalizeEmail(document.getElementById('email').value);
        const password = document.getElementById('password').value || '';

        // Basic validation
        if (!email || !password) {
            showMessage('Please enter email and password.', 3000, true);
            return;
        }

        // Call the real API when available (mock server). If AppApi is not present, instruct dev to start the mock server.
        if (window.AppApi && typeof window.AppApi.login === 'function') {
            // call API
            AppApi.login(email, password).then(data => {
                console.log('[login.js] Login response received:', data);
                
                // Check if password change is required
                if (data && data.requirePasswordChange) {
                    showFirstLoginPasswordChange(data.userId, password);
                    return;
                }
                
                const user = data && data.user;
                console.log('[login.js] User from response:', user);
                
                if (user) {
                    // No longer storing user in sessionStorage - will fetch from /api/auth/profile when needed
                    showMessage('Signed in — redirecting...', 800, false);
                    
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
                    }, 700);
                } else {
                    console.error('[login.js] No user in response data');
                    showMessage('Login failed. Please check your credentials and try again.', 4000, true);
                }
            }).catch(err => {
                console.error('[login.js] Login error:', err);
                showMessage('Invalid email or password. Please try again.', 4000, true);
            });
            return;
        }
        // If we reached here, AppApi is not available. Guide developer to run the mock server.
        showMessage('Backend not available — start the mock server (see server/README.md) and reload the page.', 6000, true);
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

        const qrBtn = document.getElementById('qrScanBtn');
        if (qrBtn) qrBtn.addEventListener('click', handleQrScan);

        // Password toggle eye icon
        const passwordToggle = document.getElementById('passwordToggle');
        const passwordInput = document.getElementById('password');
        if (passwordToggle && passwordInput) {
            passwordToggle.addEventListener('click', (e) => {
                e.preventDefault();
                const isPassword = passwordInput.type === 'password';
                passwordInput.type = isPassword ? 'text' : 'password';
                
                // Toggle icon visibility
                const eyeIcon = passwordToggle.querySelector('.eye-icon');
                const eyeOffIcon = passwordToggle.querySelector('.eye-off-icon');
                if (eyeIcon && eyeOffIcon) {
                    eyeIcon.style.display = isPassword ? 'none' : 'block';
                    eyeOffIcon.style.display = isPassword ? 'block' : 'none';
                }
                
                // Update aria-label
                passwordToggle.setAttribute('aria-label', isPassword ? 'Hide password' : 'Show password');
            });
        }

        // Make the "Forgot password" open an inline reset panel
        const forgotEl = document.querySelector('.forgot-password');
        if (forgotEl) {
            forgotEl.setAttribute('role', 'button');
            forgotEl.setAttribute('tabindex', '0');
            forgotEl.addEventListener('click', () => openResetPanel());
            forgotEl.addEventListener('keydown', (e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    openResetPanel();
                }
            });
        }

        const supportEl = document.querySelector('.contact-support');
        if (supportEl) {
            supportEl.setAttribute('role', 'button');
            supportEl.setAttribute('tabindex', '0');
            supportEl.addEventListener('click', (e) => { e.preventDefault(); openContactSupport(); });
            supportEl.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openContactSupport(); } });
        }

        // Do not prefill email by default (accounts are provisioned by HR/Super Admin)
        const emailInput = document.getElementById('email');
        if (emailInput) emailInput.value = '';
    });

    // Modal reset dialog for forgot-password
    function openResetPanel() {
        if (document.querySelector('.reset-modal')) {
            document.querySelector('.reset-modal .reset-email').focus();
            return;
        }

        const previouslyFocused = document.activeElement;

        const backdrop = document.createElement('div');
        backdrop.className = 'modal-backdrop';

        const modal = document.createElement('div');
        modal.className = 'reset-modal';
        modal.setAttribute('role', 'dialog');
        modal.setAttribute('aria-modal', 'true');
        modal.innerHTML = `
            <div class="modal-card">
                <button class="modal-close-btn" aria-label="Close">✕</button>
                <div class="modal-header"><h3 class="modal-title">Reset password</h3></div>
                <div class="modal-body">
                  <p class="muted">Enter the email address associated with your account and we'll send a reset link.</p>
                  <input type="email" class="reset-email" placeholder="your email" aria-label="email for password reset" autocomplete="email">
                </div>
                <div class="modal-footer">
                  <div class="modal-actions">
                    <button type="button" class="modal-cancel-btn">Cancel</button>
                    <button type="button" class="modal-send-btn" disabled>
                      <span class="btn-spinner" hidden></span>
                      <span class="btn-label">Send</span>
                    </button>
                  </div>
                </div>
            </div>
        `;

        document.body.appendChild(backdrop);
        document.body.appendChild(modal);

        const emailInput = document.getElementById('email');
        const resetEmail = modal.querySelector('.reset-email');
        const sendBtn = modal.querySelector('.modal-send-btn');
        const spinner = sendBtn.querySelector('.btn-spinner');
        const label = sendBtn.querySelector('.btn-label');
        const cancelBtn = modal.querySelector('.modal-cancel-btn');
        const closeBtn = modal.querySelector('.modal-close-btn');

        if (emailInput && emailInput.value) resetEmail.value = emailInput.value;
        resetEmail.focus();

        function cleanup() {
            modal.remove();
            backdrop.remove();
            document.removeEventListener('keydown', onKey);
            if (previouslyFocused && previouslyFocused.focus) previouslyFocused.focus();
        }

        function setLoading(on) {
            if (on) {
                spinner.removeAttribute('hidden');
                label.textContent = 'Sending…';
                sendBtn.disabled = true;
            } else {
                spinner.setAttribute('hidden', '');
                label.textContent = 'Send';
                sendBtn.disabled = false;
            }
        }

        function closeModal() { cleanup(); }

        function sendReset() {
            const mail = (resetEmail.value || '').trim();
            if (!mail || !mail.includes('@')) {
                showMessage('Please enter a valid email to receive a reset link.', 3000, true);
                resetEmail.focus();
                return;
            }
            // simulate network send
            setLoading(true);
            setTimeout(() => {
                setLoading(false);
                showMessage('If an account exists for ' + mail + ', a password reset link has been sent.', 5000, false);
                setTimeout(cleanup, 900);
            }, 900);
        }

        cancelBtn.addEventListener('click', closeModal);
        closeBtn.addEventListener('click', closeModal);
        sendBtn.addEventListener('click', sendReset);

        resetEmail.addEventListener('input', () => {
            const ok = (resetEmail.value || '').includes('@');
            sendBtn.disabled = !ok;
        });

        resetEmail.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !sendBtn.disabled) sendReset(); });

        function onKey(e) { if (e.key === 'Escape') closeModal(); }
        document.addEventListener('keydown', onKey);
    }

    // Contact Support modal
    function openContactSupport() {
        if (document.querySelector('.contact-modal')) {
            document.querySelector('.contact-modal textarea').focus();
            return;
        }

        const previouslyFocused = document.activeElement;
        const backdrop = document.createElement('div');
        backdrop.className = 'modal-backdrop';

        const modal = document.createElement('div');
        modal.className = 'contact-modal';
        modal.setAttribute('role', 'dialog');
        modal.setAttribute('aria-modal', 'true');
        modal.innerHTML = `
                        <div class="modal-card">
                                <button class="modal-close-btn" aria-label="Close">✕</button>
                                <div class="modal-header"><h3 class="modal-title">🛈 Contact Support</h3></div>
                                <div class="modal-body">
                                    <p class="muted">Describe your issue and our support team/HR will get back to you.</p>

                                    <label style="display:block;margin-top:12px;font-weight:600;">Employee ID / Username <span style="color:#b00020">*</span></label>
                                    <input type="text" class="contact-employee" placeholder="e.g. E12345 or username" aria-label="employee id" required>

                                    <label style="display:block;margin-top:12px;font-weight:600;">Your Email <span style="color:#b00020">*</span></label>
                                    <input type="email" class="contact-email" placeholder="your email" aria-label="your email" autocomplete="email" required>

                                    <label style="display:block;margin-top:12px;font-weight:600;">Category</label>
                                    <select class="contact-category" aria-label="category" style="width:100%;padding:10px;border-radius:8px;margin-top:6px;border:1px solid var(--border);background:var(--input);">
                                        <option value="attendance">Attendance issue</option>
                                        <option value="qr">QR code not working</option>
                                        <option value="login">Login problem (not password reset)</option>
                                        <option value="bug">System error / bug report</option>
                                        <option value="other">Others</option>
                                    </select>

                                    <label style="display:block;margin-top:12px;font-weight:600;">Description <span style="color:#b00020">*</span></label>
                                    <textarea class="contact-message" placeholder="Describe your issue" aria-label="support message" rows="5" style="margin-top:6px;"></textarea>

                                    <label style="display:block;margin-top:12px;font-weight:600;">File (optional)</label>
                                    <input type="file" class="contact-file" aria-label="attachment" style="margin-top:6px;" />
                                </div>
                                <div class="modal-footer">
                                    <div class="modal-actions">
                                        <button type="button" class="modal-send-btn" disabled>
                                            <span class="btn-spinner" hidden></span>
                                            <span class="btn-label">Send</span>
                                        </button>
                                    </div>
                                </div>
                        </div>
                `;

        document.body.appendChild(backdrop);
        document.body.appendChild(modal);

        const emailInput = document.getElementById('email');
        const employeeEl = modal.querySelector('.contact-employee');
        const contactEmail = modal.querySelector('.contact-email');
        const categoryEl = modal.querySelector('.contact-category');
        const messageEl = modal.querySelector('.contact-message');
        const fileEl = modal.querySelector('.contact-file');
        const sendBtn = modal.querySelector('.modal-send-btn');
        const spinner = sendBtn.querySelector('.btn-spinner');
        const label = sendBtn.querySelector('.btn-label');
        const closeBtn = modal.querySelector('.modal-close-btn');

        if (emailInput && emailInput.value) contactEmail.value = emailInput.value;
        employeeEl.focus();

        function cleanup() {
            modal.remove();
            backdrop.remove();
            document.removeEventListener('keydown', onKey);
            if (previouslyFocused && previouslyFocused.focus) previouslyFocused.focus();
        }

        function setLoading(on) {
            if (on) {
                spinner.removeAttribute('hidden');
                label.textContent = 'Sending…';
                sendBtn.disabled = true;
            } else {
                spinner.setAttribute('hidden', '');
                label.textContent = 'Send';
                sendBtn.disabled = false;
            }
        }

        function validateContact() {
            const emp = (employeeEl.value || '').trim();
            const mail = (contactEmail.value || '').trim();
            const msg = (messageEl.value || '').trim();
            const emailOk = mail && mail.includes('@');
            return emp.length > 0 && emailOk && msg.length > 0;
        }

        function onSend() {
            if (!validateContact()) {
                showMessage('Please fill Employee ID, a valid email, and a description.', 3500, true);
                return;
            }
            // Read optional file name (no upload in this mock)
            const fileName = (fileEl.files && fileEl.files[0]) ? fileEl.files[0].name : null;
            setLoading(true);
            setTimeout(() => {
                setLoading(false);
                showMessage('Thanks — your request was submitted to support/HR.', 4000, false);
                setTimeout(cleanup, 900);
            }, 900);
        }

        closeBtn.addEventListener('click', cleanup);
        sendBtn.addEventListener('click', onSend);

        // enable send when required fields present
        function refreshSendState() { sendBtn.disabled = !validateContact(); }
        employeeEl.addEventListener('input', refreshSendState);
        contactEmail.addEventListener('input', refreshSendState);
        messageEl.addEventListener('input', refreshSendState);
        messageEl.addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { onSend(); } });
        fileEl.addEventListener('change', () => { /* optionally show filename */ });

        function onKey(e) { if (e.key === 'Escape') cleanup(); }
        document.addEventListener('keydown', onKey);
    }

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
