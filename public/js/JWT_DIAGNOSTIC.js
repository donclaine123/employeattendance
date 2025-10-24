// Diagnostic: Check JWT token content
// Run this in browser console to see what's in your access token

(function() {
    // Decode JWT (without verification - just to see payload)
    function decodeJWT(token) {
        try {
            const parts = token.split('.');
            if (parts.length !== 3) return null;
            
            const decoded = JSON.parse(atob(parts[1]));
            return decoded;
        } catch (e) {
            return null;
        }
    }
    
    // Get all cookies
    function getCookie(name) {
        const nameEQ = name + "=";
        const ca = document.cookie.split(';');
        for(let i = 0; i < ca.length; i++) {
            let c = ca[i].trim();
            if (c.indexOf(nameEQ) === 0) return c.substring(nameEQ.length);
        }
        return null;
    }
    
    console.log('=== JWT DIAGNOSTIC ===');
    console.log('Access Token Cookie:', getCookie('workline_access_token') ? 'EXISTS' : 'MISSING');
    console.log('Refresh Token Cookie:', getCookie('workline_refresh_token') ? 'EXISTS' : 'MISSING');
    
    const accessToken = getCookie('workline_access_token');
    if (accessToken) {
        const decoded = decodeJWT(accessToken);
        console.log('Access Token Payload:', decoded);
        
        if (decoded) {
            console.log('---');
            console.log('✓ Token ID:', decoded.id);
            console.log('✓ Token Email:', decoded.email);
            console.log('✓ Token Role:', decoded.role);
            console.log('✓ Token SessionId:', decoded.sessionId);
            console.log('✓ Token Expiry:', new Date(decoded.exp * 1000).toLocaleString());
            console.log('---');
            
            if (!decoded.sessionId) {
                console.error('❌ CRITICAL: Token has NO sessionId! This will cause 401 errors!');
                console.error('Solution: Clear cookies and login again after applying the SQL migration');
            } else {
                console.log('✓ Token has sessionId - should work fine');
            }
        }
    } else {
        console.log('No access token found');
    }
    
    console.log('=== END DIAGNOSTIC ===');
})();
