// Refresh Token Management Utilities
// Handles creation, validation, rotation, and revocation of refresh tokens

const crypto = require('crypto');
const { pool } = require('../conn-supabase');

// Configuration
const REFRESH_TOKEN_BYTES = 32; // 256-bit tokens
const REFRESH_TOKEN_EXPIRY_DAYS = 30; // Long-lived refresh tokens

/**
 * Generate a cryptographically secure random token
 * @returns {string} Base64-encoded token
 */
function generateRefreshToken() {
    return crypto.randomBytes(REFRESH_TOKEN_BYTES).toString('base64url');
}

/**
 * Hash a token using SHA-256 (for database storage)
 * @param {string} token - The plaintext token
 * @returns {string} Hex-encoded hash
 */
function hashRefreshToken(token) {
    return crypto.createHash('sha256').update(token).digest('hex');
}

/**
 * Store a refresh token in the database
 * @param {number} userId - User ID
 * @param {string} tokenHash - SHA-256 hash of the token
 * @param {object} options - Optional metadata (deviceInfo, ipAddress)
 * @returns {Promise<object>} Created token record
 */
async function storeRefreshToken(userId, tokenHash, options = {}) {
    const { deviceInfo, ipAddress } = options;
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + REFRESH_TOKEN_EXPIRY_DAYS);

    const query = `
        INSERT INTO refresh_tokens (token_hash, user_id, expires_at, device_info, ip_address)
        VALUES ($1, $2, $3, $4, $5)
        RETURNING id, token_hash, user_id, expires_at, created_at
    `;
    
    const values = [tokenHash, userId, expiresAt, deviceInfo || null, ipAddress || null];
    
    try {
        const result = await pool.query(query, values);
        return result.rows[0];
    } catch (error) {
        console.error('[refreshTokens] Error storing token:', error);
        throw error;
    }
}

/**
 * Validate a refresh token
 * @param {string} token - The plaintext refresh token
 * @returns {Promise<object|null>} Token record if valid, null otherwise
 */
async function validateRefreshToken(token) {
    const tokenHash = hashRefreshToken(token);
    
    const query = `
        SELECT rt.*, u.username, u.role_id, r.role_name
        FROM refresh_tokens rt
        JOIN users u ON rt.user_id = u.user_id
        JOIN roles r ON u.role_id = r.role_id
        WHERE rt.token_hash = $1
          AND rt.revoked = FALSE
          AND rt.expires_at > NOW()
    `;
    
    try {
        const result = await pool.query(query, [tokenHash]);
        return result.rows[0] || null;
    } catch (error) {
        console.error('[refreshTokens] Error validating token:', error);
        return null;
    }
}

/**
 * Rotate a refresh token (revoke old, issue new)
 * @param {string} oldToken - The current refresh token
 * @param {object} options - Optional metadata
 * @returns {Promise<string|null>} New refresh token or null if rotation failed
 */
async function rotateRefreshToken(oldToken, options = {}) {
    const oldTokenHash = hashRefreshToken(oldToken);
    const newToken = generateRefreshToken();
    const newTokenHash = hashRefreshToken(newToken);
    
    const client = await pool.connect();
    
    try {
        await client.query('BEGIN');
        
        // Validate old token
        const validateQuery = `
            SELECT user_id, revoked, expires_at
            FROM refresh_tokens
            WHERE token_hash = $1
        `;
        const validateResult = await client.query(validateQuery, [oldTokenHash]);
        
        if (validateResult.rows.length === 0) {
            await client.query('ROLLBACK');
            console.warn('[refreshTokens] Token not found for rotation');
            return null;
        }
        
        const oldTokenRecord = validateResult.rows[0];
        
        // Check if already revoked (possible replay attack)
        if (oldTokenRecord.revoked) {
            await client.query('ROLLBACK');
            console.warn('[refreshTokens] Attempted reuse of revoked token - possible attack');
            
            // Revoke all tokens for this user as a security measure
            await revokeAllUserTokens(oldTokenRecord.user_id);
            return null;
        }
        
        // Check expiry
        if (new Date(oldTokenRecord.expires_at) < new Date()) {
            await client.query('ROLLBACK');
            console.warn('[refreshTokens] Expired token used for rotation');
            return null;
        }
        
        // Revoke old token
        const revokeQuery = `
            UPDATE refresh_tokens
            SET revoked = TRUE,
                revoked_at = NOW(),
                replaced_by_token = $1
            WHERE token_hash = $2
        `;
        await client.query(revokeQuery, [newTokenHash, oldTokenHash]);
        
        // Store new token
        const expiresAt = new Date();
        expiresAt.setDate(expiresAt.getDate() + REFRESH_TOKEN_EXPIRY_DAYS);
        
        const insertQuery = `
            INSERT INTO refresh_tokens (token_hash, user_id, expires_at, device_info, ip_address)
            VALUES ($1, $2, $3, $4, $5)
            RETURNING id
        `;
        
        await client.query(insertQuery, [
            newTokenHash,
            oldTokenRecord.user_id,
            expiresAt,
            options.deviceInfo || null,
            options.ipAddress || null
        ]);
        
        await client.query('COMMIT');
        
        console.log('[refreshTokens] Token rotated successfully for user', oldTokenRecord.user_id);
        return newToken;
        
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('[refreshTokens] Error rotating token:', error);
        return null;
    } finally {
        client.release();
    }
}

/**
 * Revoke a specific refresh token
 * @param {string} token - The plaintext refresh token
 * @returns {Promise<boolean>} True if revoked successfully
 */
async function revokeRefreshToken(token) {
    const tokenHash = hashRefreshToken(token);
    
    const query = `
        UPDATE refresh_tokens
        SET revoked = TRUE, revoked_at = NOW()
        WHERE token_hash = $1 AND revoked = FALSE
        RETURNING id
    `;
    
    try {
        const result = await pool.query(query, [tokenHash]);
        return result.rowCount > 0;
    } catch (error) {
        console.error('[refreshTokens] Error revoking token:', error);
        return false;
    }
}

/**
 * Revoke all refresh tokens for a user (e.g., on password change or security breach)
 * @param {number} userId - User ID
 * @returns {Promise<number>} Number of tokens revoked
 */
async function revokeAllUserTokens(userId) {
    const query = `
        UPDATE refresh_tokens
        SET revoked = TRUE, revoked_at = NOW()
        WHERE user_id = $1 AND revoked = FALSE
        RETURNING id
    `;
    
    try {
        const result = await pool.query(query, [userId]);
        console.log(`[refreshTokens] Revoked ${result.rowCount} tokens for user ${userId}`);
        return result.rowCount;
    } catch (error) {
        console.error('[refreshTokens] Error revoking all user tokens:', error);
        return 0;
    }
}

/**
 * Clean up expired tokens (run periodically)
 * @param {number} daysOld - Remove tokens expired more than this many days ago
 * @returns {Promise<number>} Number of tokens deleted
 */
async function cleanupExpiredTokens(daysOld = 7) {
    const query = `
        DELETE FROM refresh_tokens
        WHERE expires_at < NOW() - INTERVAL '${daysOld} days'
        RETURNING id
    `;
    
    try {
        const result = await pool.query(query);
        console.log(`[refreshTokens] Cleaned up ${result.rowCount} expired tokens`);
        return result.rowCount;
    } catch (error) {
        console.error('[refreshTokens] Error cleaning up tokens:', error);
        return 0;
    }
}

module.exports = {
    generateRefreshToken,
    hashRefreshToken,
    storeRefreshToken,
    validateRefreshToken,
    rotateRefreshToken,
    revokeRefreshToken,
    revokeAllUserTokens,
    cleanupExpiredTokens,
    REFRESH_TOKEN_EXPIRY_DAYS
};
