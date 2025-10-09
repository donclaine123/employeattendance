/**
 * Authentication Guard - Client-side route protection
 * Prevents unauthorized users from accessing protected pages
 */

(function() {
    'use strict';

    // Authentication check function - now async, fetches from API
    // Uses cookie-based authentication (no sessionStorage needed)
    async function checkAuthentication() {
        try {
            // Fetch profile from server - cookies sent automatically
            const user = await window.fetchUserProfile();
            console.log('[Auth Guard] DEBUG: Received user data:', JSON.stringify(user, null, 2));
            console.log('[Auth Guard] DEBUG: user.role =', user?.role);
            if (!user || !user.role) {
                console.warn('[Auth Guard] Invalid user data from API, redirecting to login...');
                redirectToLogin();
                return false;
            }
            return user;
        } catch (error) {
            console.error('[Auth Guard] Error fetching user profile:', error);
            // fetchUserProfile already handles 401 redirects via config.js
            // But redirect here as well for safety
            redirectToLogin();
            return false;
        }
    }

    // Role-based access control
    function checkRoleAccess(requiredRoles, userRole) {
        if (!Array.isArray(requiredRoles)) {
            requiredRoles = [requiredRoles];
        }
        
        const hasAccess = requiredRoles.includes(userRole);
        if (!hasAccess) {
            console.warn(`[Auth Guard] Access denied. Required: ${requiredRoles.join(', ')}, User: ${userRole}`);
            showUnauthorizedMessage();
            return false;
        }
        return true;
    }

    // Redirect to login page
    function redirectToLogin(skipReturnUrl = false) {
        // Clear invalid session data
        sessionStorage.removeItem('workline_token');
        if (window.clearProfileCache) window.clearProfileCache();
        
        // Determine login page path based on current location
        const currentPath = window.location.pathname;
        const isInPagesFolder = currentPath.includes('/pages/');
        const loginPath = isInPagesFolder ? '../index.html' : './index.html';
        
        let redirectUrl = loginPath;
        
        // Only add return URL if this is an authentication issue, not authorization
        if (!skipReturnUrl) {
            const returnUrl = encodeURIComponent(currentPath);
            redirectUrl = `${loginPath}?return=${returnUrl}`;
        }
        
        setTimeout(() => {
            window.location.href = redirectUrl;
        }, 100);
    }

    // Show unauthorized message
    function showUnauthorizedMessage() {
        document.body.innerHTML = `
            <div style="
                display: flex; 
                justify-content: center; 
                align-items: center; 
                height: 100vh; 
                background: #f5f5f5; 
                font-family: Arial, sans-serif;
                text-align: center;
            ">
                <div style="
                    background: white; 
                    padding: 2rem; 
                    border-radius: 8px; 
                    box-shadow: 0 2px 10px rgba(0,0,0,0.1);
                    max-width: 400px;
                ">
                    <h2 style="color: #e74c3c; margin-bottom: 1rem;">Access Denied</h2>
                    <p style="color: #666; margin-bottom: 1.5rem;">
                        You don't have permission to access this page.
                    </p>
                    <button onclick="window.history.back()" style="
                        background: #3498db; 
                        color: white; 
                        border: none; 
                        padding: 0.75rem 1.5rem; 
                        border-radius: 4px; 
                        cursor: pointer;
                        margin-right: 0.5rem;
                    ">Go Back</button>
                    <button onclick="redirectToLogin(true)" style="
                        background: #2ecc71; 
                        color: white; 
                        border: none; 
                        padding: 0.75rem 1.5rem; 
                        border-radius: 4px; 
                        cursor: pointer;
                    ">Login as Different User</button>
                </div>
            </div>
        `;
        
        // Make redirectToLogin available globally for the button
        window.redirectToLogin = redirectToLogin;
    }

    // Main authentication guard function
    window.AuthGuard = {
        // Protect page with required roles - now async
        protect: async function(requiredRoles, options = {}) {
            const user = await checkAuthentication();
            if (!user) return false;

            if (requiredRoles && !checkRoleAccess(requiredRoles, user.role)) {
                return false;
            }

            // Optional: Check if user needs to change password on first login
            if (options.checkFirstLogin && user.first_login) {
                console.log('[Auth Guard] First login detected, should prompt for password change');
                // You can add first login handling here
            }

            // Start session validation after successful authentication
            if (window.initSessionValidation) {
                console.log('[Auth Guard] Starting session validation checks');
                window.initSessionValidation();
            }

            console.log(`[Auth Guard] Access granted for ${user.role} to page requiring: ${Array.isArray(requiredRoles) ? requiredRoles.join(', ') : requiredRoles}`);
            return user;
        },

        // Get current user without redirecting - now async
        getCurrentUser: async function() {
            try {
                return await window.fetchUserProfile();
            } catch (error) {
                console.error('[Auth Guard] Error getting current user:', error);
                return null;
            }
        },

        // Check if user has specific role - now async
        hasRole: async function(role) {
            const user = await this.getCurrentUser();
            return user && user.role === role;
        },

        // Logout function
        logout: async function() {
            // Stop session validation checks
            if (window.stopSessionValidation) {
                window.stopSessionValidation();
            }
            
            try {
                // Call server-side logout if available
                if (window.AppApi && window.AppApi.logout) {
                    await window.AppApi.logout();
                }
            } catch (error) {
                console.warn('Server logout failed:', error);
            }
            
            // Always clear local storage and profile cache regardless of server response
            sessionStorage.removeItem('workline_token');
            if (window.clearProfileCache) window.clearProfileCache();
            redirectToLogin();
        }
    };

    console.log('[Auth Guard] Authentication guard loaded');
})();