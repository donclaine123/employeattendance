// Cookie-based auth configuration and helpers
// Provides secure cookie settings and JWT access token configuration

// Access token configuration (short-lived but reasonable for work sessions)
const ACCESS_TOKEN_EXPIRES_IN = '6h'; // 6 hours - long enough for HR work sessions without constant refreshing
const ACCESS_TOKEN_COOKIE_NAME = 'workline_access_token';

// Refresh token configuration (long-lived but not too long)
const REFRESH_TOKEN_COOKIE_NAME = 'workline_refresh_token';
const REFRESH_TOKEN_MAX_AGE_DAYS = 7; // 7 days - reasonable session persistence

// Environment flags
const isProduction = process.env.NODE_ENV === 'production';

// Helper: detect localhost-like hosts so we can relax secure flag during local dev
const apiUrl = process.env.API_URL || '';
const isLocalhost = (() => {
    try {
        if (!apiUrl) return false;
        return apiUrl.includes('localhost') || apiUrl.includes('127.0.0.1');
    } catch (e) { return false; }
})();

/**
 * Get secure cookie options for access token
 * @returns {object} Cookie options
 */
function getAccessTokenCookieOptions() {
    // Production: secure cookies with SameSite='none' for cross-domain
    // IMPORTANT: SameSite='none' is required when frontend and backend are on different domains
    // (e.g., employeattendance.me vs backend-rxe4.onrender.com)
    if (isProduction) {
        return {
            httpOnly: true,
            secure: true,           // require HTTPS in production
            sameSite: 'none',       // allow cross-site cookies (required for different domains)
            maxAge: 6 * 60 * 60 * 1000, // 6 hours in milliseconds
            path: '/',
            // NOTE: domain is NOT set here intentionally
            // Browsers will use the Set-Cookie domain from the response origin
            // If you need explicit domain, you must set it to the exact backend domain
        };
    }

    // Local / development: keep a relaxed config (uncomment if needed)
    // NOTE: For local development on http://localhost you may need to use
    // secure: false and sameSite: 'lax' so browsers will accept cookies over HTTP.
    // Example (commented):
    // return {
    //     httpOnly: true,
    //     secure: false,
    //     sameSite: 'lax',
    //     maxAge: 6 * 60 * 60 * 1000,
    //     path: '/'
    // };

    // Default non-production fallback (safe permissive defaults)
    return {
        httpOnly: true,
        secure: false,
        sameSite: 'lax',
        maxAge: 6 * 60 * 60 * 1000,
        path: '/'
    };
}

/**
 * Get secure cookie options for refresh token
 * @returns {object} Cookie options
 */
function getRefreshTokenCookieOptions() {
    if (isProduction) {
        return {
            httpOnly: true,
            secure: true,
            sameSite: 'none',       // allow cross-site cookies (required for different domains)
            maxAge: REFRESH_TOKEN_MAX_AGE_DAYS * 24 * 60 * 60 * 1000,
            path: '/'
        };
    }

    // Commented example for local development (uncomment when testing on http://localhost)
    // return {
    //     httpOnly: true,
    //     secure: false,
    //     sameSite: 'lax',
    //     maxAge: REFRESH_TOKEN_MAX_AGE_DAYS * 24 * 60 * 60 * 1000,
    //     path: '/'
    // };

    return {
        httpOnly: true,
        secure: false,
        sameSite: 'lax',
        maxAge: REFRESH_TOKEN_MAX_AGE_DAYS * 24 * 60 * 60 * 1000,
        path: '/'
    };
}

/**
 * Clear all auth cookies
 * @param {object} res - Express response object
 */
function clearAuthCookies(res) {
    res.clearCookie(ACCESS_TOKEN_COOKIE_NAME, { path: '/' });
    res.clearCookie(REFRESH_TOKEN_COOKIE_NAME, { path: '/' });
}

module.exports = {
    ACCESS_TOKEN_EXPIRES_IN,
    ACCESS_TOKEN_COOKIE_NAME,
    REFRESH_TOKEN_COOKIE_NAME,
    REFRESH_TOKEN_MAX_AGE_DAYS,
    getAccessTokenCookieOptions,
    getRefreshTokenCookieOptions,
    clearAuthCookies
};
