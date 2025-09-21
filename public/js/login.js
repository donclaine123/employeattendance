// Mock login script for Workline employee portal
// Contains a single mock account and handles form submission and QR button

(() => {
    // Authentication is provided by the backend mock server. Local in-file mocks removed to avoid
    // duplicate credential data. Ensure the mock server is running and `js/api.js` (AppApi) is loaded.

    // Helper: simple email normalization
    function normalizeEmail(e) {
        return (e || '').trim().toLowerCase();
    }

    // Show a temporary message under the form
    function showMessage(text, timeout = 3000, isError = false) {
        try {
            const container = document.querySelector('.message-container') || document.body;
            const p = document.createElement('p');
            p.textContent = text;
            p.style.color = isError ? '#b00020' : 'inherit';
            p.className = 'toast-message';
            container.appendChild(p);
            if (timeout) setTimeout(() => p.remove(), timeout);
        } catch (e) {
            // fail silently but log for debugging
            console.warn('showMessage failed to update DOM', e);
        }
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
                // Check if password change is required
                if (data && data.requirePasswordChange) {
                    showFirstLoginPasswordChange(data.userId, password);
                    return;
                }
                
                const user = data && data.user;
                if (user) {
                    // persist employee mapping when available (server may attach employee_id and employee_db_id)
                    const payload = { email: user.email, role: user.role };
                    if (user.employee_id) payload.employee_id = user.employee_id;
                    if (user.employee_db_id) payload.id = user.employee_db_id;
                    sessionStorage.setItem('workline_user', JSON.stringify(payload));
                    showMessage('Signed in — redirecting...', 800, false);
                    
                    // Check for return URL parameter
                    const urlParams = new URLSearchParams(window.location.search);
                    const returnUrl = urlParams.get('return');
                    
                    let redirect;
                    if (returnUrl) {
                        // Use return URL if provided
                        redirect = decodeURIComponent(returnUrl);
                        // Remove leading slash if present to keep relative paths
                        if (redirect.startsWith('/')) redirect = redirect.slice(1);
                    } else {
                        // Use server-provided redirect or default
                        redirect = user.redirect || 'pages/employee.html';
                        if (typeof redirect === 'string' && redirect.startsWith('/')) redirect = redirect.slice(1);
                    }
                    
                    setTimeout(() => { window.location.href = redirect; }, 700);
                } else {
                    showMessage('Login failed: unexpected response from server.', 4000, true);
                }
            }).catch(err => {
                showMessage('Invalid credentials or server error: ' + (err.message || ''), 4000, true);
            });
            return;
        }
        // If we reached here, AppApi is not available. Guide developer to run the mock server.
        showMessage('Backend not available — start the mock server (see server/README.md) and reload the page.', 6000, true);
    }

    // Handle QR scan button (mock)
    function handleQrScan() {
        // In a real app this would open camera/scan. Here we simulate a quick mark and redirect.
        const user = sessionStorage.getItem('workline_user');
        if (!user) {
            showMessage('Please sign in first to use QR scanning.', 3000, true);
            return;
        }

        showMessage('QR recognized. Marking attendance and redirecting...', 1200, false);
        setTimeout(() => {
            window.location.href = 'pages/employee.html';
        }, 900);
    }

    // Attach event listeners when DOM is ready
    document.addEventListener('DOMContentLoaded', () => {
        const form = document.getElementById('loginForm');
        if (form) form.addEventListener('submit', handleSignIn);

        const qrBtn = document.getElementById('qrScanBtn');
        if (qrBtn) qrBtn.addEventListener('click', handleQrScan);

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
