// Refresh Token Management Utilities
// Handles creation, validation, rotation, and revocation of refresh tokens

const crypto = require('crypto');
const { pool } = require('../conn-supabase');

// Configuration
const REFRESH_TOKEN_BYTES = 32; // 256-bit tokens
const REFRESH_TOKEN_EXPIRY_DAYS = 7; // 7 days - reasonable session persistence
const ABSOLUTE_EXPIRY_DAYS = 30; // 30 days - hard limit for refresh token chain
const IDLE_TIMEOUT_HOURS = 24; // 24 hours - force re-login if no activity

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
    const { deviceInfo, ipAddress, chainStartedAt, sessionId } = options;
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + REFRESH_TOKEN_EXPIRY_DAYS);

    // Calculate absolute expiry (30 days from chain start)
    const absoluteExpiryAt = new Date();
    const chainStart = chainStartedAt ? new Date(chainStartedAt) : new Date();
    absoluteExpiryAt.setTime(chainStart.getTime() + (ABSOLUTE_EXPIRY_DAYS * 24 * 60 * 60 * 1000));

    try {
        // Use Supabase REST API instead of raw SQL
        const { supabase } = require('../supabaseClient');
        
        const now = new Date().toISOString();
        
        const { data, error } = await supabase
            .from('refresh_tokens')
            .insert({
                token_hash: tokenHash,
                user_id: userId,
                session_id: sessionId || null,  // Link to user session
                expires_at: expiresAt.toISOString(),
                device_info: deviceInfo || null,
                ip_address: ipAddress || null,
                revoked: false,
                last_activity_at: now,
                chain_started_at: chainStart.toISOString(),
                absolute_expiry_at: absoluteExpiryAt.toISOString()
            })
            .select()
            .single();
        
        if (error) {
            console.error('[refreshTokens] Supabase error storing token:', error);
            throw error;
        }
        
        console.log('[refreshTokens] Refresh token stored successfully for user:', userId);
        return data;
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
    
    // DEBUG: log token details (not the actual token value)
    console.log('[validateRefreshToken] Token length:', token?.length);
    console.log('[validateRefreshToken] Token hash (first 16 chars):', tokenHash?.substring(0, 16));
    
    try {
        // Use Supabase REST API instead of raw SQL
        const { supabase } = require('../supabaseClient');
        
        const now = new Date();
        
        const { data, error } = await supabase
            .from('refresh_tokens')
            .select(`
                *,
                users!inner (
                    username,
                    role_id,
                    roles!inner (
                        role_name
                    )
                )
            `)
            .eq('token_hash', tokenHash)
            .eq('revoked', false)
            .gt('expires_at', now.toISOString())
            .maybeSingle();
        
        if (error) {
            console.error('[validateRefreshToken] Supabase error:', error);
            return null;
        }
        
        console.log('[validateRefreshToken] Query returned:', data ? 'match found' : 'no match');
        
        // If token found, check additional expiry conditions
        if (data) {
            // Check idle timeout (24 hours of inactivity)
            if (data.last_activity_at) {
                const lastActivity = new Date(data.last_activity_at);
                const idleTimeMs = now.getTime() - lastActivity.getTime();
                const idleTimeoutMs = IDLE_TIMEOUT_HOURS * 60 * 60 * 1000;
                
                if (idleTimeMs > idleTimeoutMs) {
                    console.warn('[validateRefreshToken] Token expired due to idle timeout (24h)');
                    // Revoke this token
                    await supabase
                        .from('refresh_tokens')
                        .update({ 
                            revoked: true, 
                            revoked_at: now.toISOString() 
                        })
                        .eq('token_hash', tokenHash);
                    return null;
                }
            }
            
            // Check absolute expiry (30 days from chain start)
            if (data.absolute_expiry_at) {
                const absoluteExpiry = new Date(data.absolute_expiry_at);
                if (now >= absoluteExpiry) {
                    console.warn('[validateRefreshToken] Token expired due to absolute expiry (30 days)');
                    // Revoke this token
                    await supabase
                        .from('refresh_tokens')
                        .update({ 
                            revoked: true, 
                            revoked_at: now.toISOString() 
                        })
                        .eq('token_hash', tokenHash);
                    return null;
                }
            }
        } else {
            // DEBUG: If no match, check if ANY tokens exist
            const { data: sampleData } = await supabase
                .from('refresh_tokens')
                .select('token_hash, user_id, revoked, expires_at')
                .limit(5);
            
            console.log('[validateRefreshToken] DEBUG: Sample tokens in DB:', sampleData?.map(r => ({
                hash_preview: r.token_hash?.substring(0, 16),
                user_id: r.user_id,
                revoked: r.revoked,
                expires_at: r.expires_at
            })) || []);
        }
        
        // Flatten the nested structure for compatibility
        if (data && data.users) {
            return {
                ...data,
                username: data.users.username,
                role_id: data.users.role_id,
                role_name: data.users.roles?.role_name
            };
        }
        
        return data;
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
    
    try {
        const { supabase } = require('../supabaseClient');
        
        // Validate old token and get chain info
        const { data: oldTokenRecord, error: validateError } = await supabase
            .from('refresh_tokens')
            .select('user_id, revoked, expires_at, chain_started_at, absolute_expiry_at, session_id')
            .eq('token_hash', oldTokenHash)
            .maybeSingle();
        
        if (validateError || !oldTokenRecord) {
            console.warn('[refreshTokens] Token not found for rotation');
            return null;
        }
        
        // Check if already revoked (possible replay attack)
        if (oldTokenRecord.revoked) {
            console.warn('[refreshTokens] Attempted reuse of revoked token - possible attack');
            // Revoke all tokens for this user as a security measure
            await revokeAllUserTokens(oldTokenRecord.user_id);
            return null;
        }
        
        // Check expiry
        if (new Date(oldTokenRecord.expires_at) < new Date()) {
            console.warn('[refreshTokens] Expired token used for rotation');
            return null;
        }
        
        // Revoke old token
        const { error: revokeError } = await supabase
            .from('refresh_tokens')
            .update({
                revoked: true,
                revoked_at: new Date().toISOString(),
                replaced_by_token: newTokenHash
            })
            .eq('token_hash', oldTokenHash);
        
        if (revokeError) {
            console.error('[refreshTokens] Error revoking old token:', revokeError);
            return null;
        }
        
        // Store new token (preserving chain info and session_id from old token)
        const expiresAt = new Date();
        expiresAt.setDate(expiresAt.getDate() + REFRESH_TOKEN_EXPIRY_DAYS);
        
        const { error: insertError } = await supabase
            .from('refresh_tokens')
            .insert({
                token_hash: newTokenHash,
                user_id: oldTokenRecord.user_id,
                session_id: oldTokenRecord.session_id,  // CRITICAL: Preserve session_id link
                expires_at: expiresAt.toISOString(),
                device_info: options.deviceInfo || null,
                ip_address: options.ipAddress || null,
                revoked: false,
                // Preserve chain tracking from old token
                chain_started_at: oldTokenRecord.chain_started_at,
                absolute_expiry_at: oldTokenRecord.absolute_expiry_at,
                // Update last activity to now
                last_activity_at: new Date().toISOString()
            });
        
        if (insertError) {
            console.error('[refreshTokens] Error storing new token:', insertError);
            return null;
        }
        
        console.log('[refreshTokens] Token rotated successfully for user', oldTokenRecord.user_id, '- chain preserved with session_id');
        return newToken;
        
    } catch (error) {
        console.error('[refreshTokens] Error rotating token:', error);
        return null;
    }
}

/**
 * Revoke a specific refresh token
 * @param {string} token - The plaintext refresh token
 * @returns {Promise<boolean>} True if revoked successfully
 */
async function revokeRefreshToken(token) {
    const tokenHash = hashRefreshToken(token);
    
    try {
        const { supabase } = require('../supabaseClient');
        
        const { data, error } = await supabase
            .from('refresh_tokens')
            .update({
                revoked: true,
                revoked_at: new Date().toISOString()
            })
            .eq('token_hash', tokenHash)
            .eq('revoked', false)
            .select();
        
        if (error) {
            console.error('[refreshTokens] Error revoking token:', error);
            return false;
        }
        
        return data && data.length > 0;
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
    try {
        const { supabase } = require('../supabaseClient');
        
        const { data, error } = await supabase
            .from('refresh_tokens')
            .update({
                revoked: true,
                revoked_at: new Date().toISOString()
            })
            .eq('user_id', userId)
            .eq('revoked', false)
            .select();
        
        if (error) {
            console.error('[refreshTokens] Error revoking all user tokens:', error);
            return 0;
        }
        
        const count = data ? data.length : 0;
        console.log(`[refreshTokens] Revoked ${count} tokens for user ${userId}`);
        return count;
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
