document.addEventListener('DOMContentLoaded', () => {
    const urlParams = new URLSearchParams(window.location.search);
    const token = urlParams.get('token');
    
    const form = document.getElementById('resetForm');
    const newPasswordInput = document.getElementById('newPassword');
    const confirmPasswordInput = document.getElementById('confirmPassword');
    const passwordError = document.getElementById('passwordError');
    const submitBtn = document.getElementById('submitBtn');
    const btnSpinner = submitBtn.querySelector('.btn-spinner');
    const btnText = submitBtn.querySelector('.btn-text');
    const statusMessage = document.getElementById('statusMessage');
    const statusTitle = document.getElementById('statusTitle');
    const statusDesc = document.getElementById('statusDesc');

    // If no token in URL, show error immediately
    if (!token) {
        form.style.display = 'none';
        statusMessage.style.display = 'block';
        statusTitle.textContent = 'Invalid Link';
        statusTitle.style.color = 'var(--red-primary)';
        statusDesc.textContent = 'The password reset link is missing or invalid. Please request a new one from the login page.';
        return;
    }

    // Clear error on input
    [newPasswordInput, confirmPasswordInput].forEach(input => {
        input.addEventListener('input', () => {
            input.classList.remove('is-invalid');
            passwordError.style.display = 'none';
        });
    });

    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        
        const newPassword = newPasswordInput.value;
        const confirmPassword = confirmPasswordInput.value;

        // Validation
        if (newPassword.length < 8) {
            showError(newPasswordInput, 'Password must be at least 8 characters long.');
            return;
        }

        if (newPassword !== confirmPassword) {
            showError(confirmPasswordInput, 'Passwords do not match.');
            return;
        }

        // Set Loading state
        submitBtn.disabled = true;
        btnSpinner.style.display = 'inline-block';
        btnText.textContent = 'Updating...';

        try {
            const response = await fetch('/api/auth/reset-password', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ token, newPassword })
            });

            const data = await response.json();

            if (data.success) {
                // Show Success
                form.style.display = 'none';
                statusMessage.style.display = 'block';
                statusTitle.textContent = 'Password Reset Successful';
                statusTitle.style.color = 'var(--green-primary)';
                statusDesc.textContent = 'You can now log in with your new password.';
            } else {
                // Show API Error
                showError(null, data.error || 'Failed to reset password. The link may have expired.');
            }

        } catch (error) {
            showError(null, 'A network error occurred. Please try again later.');
        } finally {
            submitBtn.disabled = false;
            btnSpinner.style.display = 'none';
            btnText.textContent = 'Update Password';
        }
    });

    function showError(inputElement, message) {
        if (inputElement) {
            inputElement.classList.add('is-invalid');
            inputElement.focus();
        }
        passwordError.textContent = message;
        passwordError.style.display = 'block';
    }
});