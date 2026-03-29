/**
 * Authentication Middleware
 * JWT and session validation
 */

const jwt = require('jsonwebtoken');
const config = require('../config/environment');
const { ACCESS_TOKEN_COOKIE_NAME } = require('../utils/cookieConfig');
const { ERROR_MESSAGES, HTTP_STATUS } = require('../utils/constants');

const SESSION_VALIDATION_CACHE_TTL_MS = 30 * 1000;
const sessionValidationCache = new Map();

function getSessionCacheKey(sessionId, userId) {
  return `${sessionId}:${userId}`;
}

function invalidateSessionValidationCache(sessionId, userId = null) {
  if (!sessionId) return;

  if (userId !== null && userId !== undefined) {
    sessionValidationCache.delete(getSessionCacheKey(sessionId, userId));
    return;
  }

  for (const key of sessionValidationCache.keys()) {
    if (key.startsWith(`${sessionId}:`)) {
      sessionValidationCache.delete(key);
    }
  }
}

function clearSessionValidationCache() {
  sessionValidationCache.clear();
}

async function validateSessionCached(sessionId, userId) {
  const cacheKey = getSessionCacheKey(sessionId, userId);
  const cached = sessionValidationCache.get(cacheKey);
  const now = Date.now();

  if (cached && cached.expiresAt > now) {
    return cached.isValid;
  }

  const { validateSession } = require('../supabase');
  const isValid = !!(await validateSession(sessionId, userId));

  sessionValidationCache.set(cacheKey, {
    isValid,
    expiresAt: now + SESSION_VALIDATION_CACHE_TTL_MS,
  });

  return isValid;
}

/**
 * Verify and decode JWT token
 */
function verifyToken(token) {
  try {
    return jwt.verify(token, config.JWT_SECRET);
  } catch (error) {
    if (error.name === 'TokenExpiredError') {
      throw new Error('Token has expired');
    }
    if (error.name === 'JsonWebTokenError') {
      throw new Error(ERROR_MESSAGES.INVALID_TOKEN);
    }
    throw error;
  }
}

/**
 * Main authentication middleware
 * Checks for valid JWT token in cookies or Authorization header
 */
function requireAuth(allowedRoles = []) {
  return async (req, res, next) => {
    try {
      // Get token from cookie or Authorization header
      let token = req.cookies[ACCESS_TOKEN_COOKIE_NAME];

      // Fallback: Check Authorization header (Bearer scheme)
      if (!token && req.headers.authorization) {
        const parts = req.headers.authorization.split(' ');
        if (parts.length === 2 && parts[0] === 'Bearer') {
          token = parts[1];
        }
      }

      // No token found
      if (!token) {
        return res.status(HTTP_STATUS.UNAUTHORIZED).json({
          error: ERROR_MESSAGES.UNAUTHORIZED,
          message: 'No authentication token provided',
        });
      }

      // Verify token
      let decoded;
      try {
        decoded = verifyToken(token);
      } catch (error) {
        // Token is invalid or expired
        return res.status(HTTP_STATUS.UNAUTHORIZED).json({
          error: ERROR_MESSAGES.INVALID_TOKEN,
          message: error.message,
        });
      }

      // Check if user is still active (session validation)
      if (decoded.sessionId) {
        try {
          // Use decoded.id (from current JWT format) with fallback to decoded.userId (legacy format)
          const userId = decoded.id || decoded.userId;
          const isValid = await validateSessionCached(decoded.sessionId, userId);

          if (!isValid) {
            // Session was force-logged out
            return res.status(HTTP_STATUS.UNAUTHORIZED).json({
              error: 'Session terminated',
              message: 'Your session has been terminated by an administrator',
            });
          }
        } catch (error) {
          console.warn('[auth] Session validation error:', error.message);
          // Don't fail if session validation fails - proceed with token validation
        }
      }

      // Check role authorization
      if (allowedRoles.length > 0 && !allowedRoles.includes(decoded.role)) {
        return res.status(HTTP_STATUS.FORBIDDEN).json({
          error: ERROR_MESSAGES.FORBIDDEN,
          message: `This endpoint requires one of these roles: ${allowedRoles.join(', ')}`,
        });
      }

      // Attach user info to request
      req.auth = {
        id: decoded.id || decoded.userId,
        user_id: decoded.id || decoded.userId,
        email: decoded.email,
        role: decoded.role,
        employee_id: decoded.employee_id || decoded.id || decoded.userId,
        sessionId: decoded.sessionId,
      };

      // Proceed to next middleware
      next();
    } catch (error) {
      console.error('[auth] Authentication error:', error.message);

      return res.status(HTTP_STATUS.SERVER_ERROR).json({
        error: ERROR_MESSAGES.SERVER_ERROR,
        message: error.message,
      });
    }
  };
}

/**
 * Optional authentication
 * Attaches user info if token exists, but doesn't require it
 */
function optionalAuth(req, res, next) {
  try {
    let token = req.cookies[ACCESS_TOKEN_COOKIE_NAME];

    if (!token && req.headers.authorization) {
      const parts = req.headers.authorization.split(' ');
      if (parts.length === 2 && parts[0] === 'Bearer') {
        token = parts[1];
      }
    }

    if (token) {
      try {
        const decoded = verifyToken(token);
        req.auth = {
          id: decoded.userId,
          email: decoded.email,
          role: decoded.role,
          employee_id: decoded.employee_id || decoded.userId, // Fallback to user_id if employee_id missing
          sessionId: decoded.sessionId,
        };
      } catch (error) {
        // Token is invalid, but that's okay for optional auth
        console.warn('[auth] Optional auth - invalid token:', error.message);
      }
    }

    next();
  } catch (error) {
    console.error('[auth] Optional auth error:', error.message);
    next(); // Proceed anyway for optional auth
  }
}

/**
 * Check specific role
 */
function checkRole(...roles) {
  return (req, res, next) => {
    if (!req.auth) {
      return res.status(HTTP_STATUS.UNAUTHORIZED).json({
        error: ERROR_MESSAGES.UNAUTHORIZED,
      });
    }

    if (!roles.includes(req.auth.role)) {
      return res.status(HTTP_STATUS.FORBIDDEN).json({
        error: ERROR_MESSAGES.FORBIDDEN,
        message: `Required roles: ${roles.join(', ')}`,
      });
    }

    next();
  };
}

module.exports = {
  requireAuth,
  optionalAuth,
  checkRole,
  verifyToken,
  invalidateSessionValidationCache,
  clearSessionValidationCache,
  AppError: require('./errorHandler').AppError,
};
