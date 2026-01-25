/// Directory protection - prevents direct URL access to pages
// This script should be included on every protected page

(function() {
    'use strict';
    
    // Only run if we're in the pages directory
    if (!window.location.pathname.includes('/pages/')) {
        return;
    }
    
    // Get current page filename
    const currentPage = window.location.pathname.split('/').pop();
    
    // Define which pages require authentication
    const protectedPages = [
        'employee.html',
        'DepartmentHead.html', 
        'HRDashboard.html',
        'Superadmin.html'
    ];
    
    // Check if current page requires protection
    if (protectedPages.includes(currentPage)) {
        // Fetch user profile from API to check role (uses cookie-based auth)
        (async function() {
            try {
                console.log('[Directory Protection] Fetching user profile...');
                const userData = await window.fetchUserProfile();
                console.log('[Directory Protection] User data received:', userData);
                
                if (!userData) {
                    console.error('[Directory Protection] No user data, redirecting to login');
                    sessionStorage.clear();
                    window.location.replace('../index.html');
                    return;
                }
                const userRole = userData.role;
                console.log('[Directory Protection] User role:', userRole, 'Current page:', currentPage);
            
            // Define role-to-page access mapping
            const pageAccess = {
                'employee.html': ['employee'],
                'DepartmentHead.html': ['head_dept'],
                'HRDashboard.html': ['hr'], 
                'Superadmin.html': ['superadmin']
            };
            
            // Check if user has access to current page
            const allowedRoles = pageAccess[currentPage];
            console.log('[Directory Protection] Allowed roles for', currentPage, ':', allowedRoles);
            
            if (allowedRoles && !allowedRoles.includes(userRole)) {
                // User doesn't have access - redirect to their appropriate page
                const rolePages = {
                    'superadmin': 'Superadmin.html',
                    'hr': 'HRDashboard.html',
                    'head_dept': 'DepartmentHead.html', 
                    'employee': 'employee.html'
                };
                
                const correctPage = rolePages[userRole] || 'employee.html';
                console.warn(`[Directory Protection] ${userRole} attempted to access ${currentPage}, redirecting to ${correctPage}`);
                window.location.replace(correctPage);
                return;
            }
            
            console.log('[Directory Protection] Access granted for', userRole, 'to', currentPage);
            } catch (e) {
                // Invalid user data - redirect to login
                console.error('[Directory Protection] Error in async check:', e);
                sessionStorage.clear();
                const returnUrl = encodeURIComponent(window.location.pathname);
                window.location.replace(`../index.html?return=${returnUrl}`);
                return;
            }
        })();
    }
    
    console.log('[Directory Protection] Page access validated');
})();