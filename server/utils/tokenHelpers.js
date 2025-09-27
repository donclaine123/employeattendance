const crypto = require('crypto');

/**
 * Token generation and verification helpers for invite-based account creation
 */

/**
 * Generate a cryptographically secure random token
 * @returns {string} 64-character hex string (256 bits of entropy)
 */
function generateRawToken() {
    return crypto.randomBytes(32).toString('hex');
}

/**
 * Hash a raw token using SHA-256 for secure storage
 * @param {string} rawToken - The raw token to hash
 * @returns {string} SHA-256 hash in hex format
 */
function hashToken(rawToken) {
    return crypto.createHash('sha256').update(rawToken).digest('hex');
}

/**
 * Verify a raw token against a stored hash using constant-time comparison
 * @param {string} rawToken - The raw token to verify
 * @param {string} storedHash - The stored hash to compare against
 * @returns {boolean} True if token matches hash
 */
function verifyTokenHash(rawToken, storedHash) {
    const computedHash = hashToken(rawToken);
    return crypto.timingSafeEqual(
        Buffer.from(computedHash, 'hex'),
        Buffer.from(storedHash, 'hex')
    );
}

/**
 * Generate token expiration timestamp
 * @param {number} hoursFromNow - Hours from now when token expires (default 24)
 * @returns {Date} Expiration timestamp
 */
function generateTokenExpiry(hoursFromNow = 24) {
    const now = new Date();
    return new Date(now.getTime() + (hoursFromNow * 60 * 60 * 1000));
}

/**
 * Check if a timestamp is expired
 * @param {Date|string} expiryDate - The expiry date to check
 * @returns {boolean} True if expired
 */
function isExpired(expiryDate) {
    return new Date() > new Date(expiryDate);
}

/**
 * Generate invite link URL
 * @param {string} baseUrl - Frontend base URL
 * @param {string} rawToken - The raw token to include
 * @returns {string} Complete invite acceptance URL
 */
function generateInviteLink(baseUrl, rawToken) {
    const cleanBaseUrl = baseUrl.replace(/\/$/, ''); // Remove trailing slash
    return `${cleanBaseUrl}/pages/accept-invite.html?token=${rawToken}`;
}

/**
 * Validate email format (basic validation)
 * @param {string} email - Email to validate
 * @returns {boolean} True if valid format
 */
function isValidEmail(email) {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
}

/**
 * Generate a secure random password (for fallback scenarios)
 * @param {number} length - Password length (default 12)
 * @returns {string} Random password
 */
function generateRandomPassword(length = 12) {
    const charset = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*';
    let password = '';
    for (let i = 0; i < length; i++) {
        password += charset.charAt(crypto.randomInt(0, charset.length));
    }
    return password;
}

module.exports = {
    generateRawToken,
    hashToken,
    verifyTokenHash,
    generateTokenExpiry,
    isExpired,
    generateInviteLink,
    isValidEmail,
    generateRandomPassword
};