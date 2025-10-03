// Cookie-based auth configuration and helpers
// Provides secure cookie settings and JWT access token configuration

// Access token configuration (short-lived)
const ACCESS_TOKEN_EXPIRES_IN = '15m'; // 15 minutes
const ACCESS_TOKEN_COOKIE_NAME = 'workline_access_token';

// Refresh token configuration (long-lived)
const REFRESH_TOKEN_COOKIE_NAME = 'workline_refresh_token';
const REFRESH_TOKEN_MAX_AGE_DAYS = 30;

// Cookie options for production (HTTPS required)
const isProduction = process.env.NODE_ENV === 'production';

/**
 * Get secure cookie options for access token
 * @returns {object} Cookie options
 */
function getAccessTokenCookieOptions() {
    return {
        httpOnly: true,
        secure: isProduction, // HTTPS only in production
        sameSite: 'strict',
        maxAge: 15 * 60 * 1000, // 15 minutes in milliseconds
        path: '/'
    };
}

/**
 * Get secure cookie options for refresh token
 * @returns {object} Cookie options
 */
function getRefreshTokenCookieOptions() {
    return {
        httpOnly: true,
        secure: isProduction, // HTTPS only in production
        sameSite: 'strict',
        maxAge: REFRESH_TOKEN_MAX_AGE_DAYS * 24 * 60 * 60 * 1000, // 30 days in milliseconds
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
