// Session configuration for express-session
// Using MemoryStore due to Render<->Supabase Transaction Pooler connectivity issues
require('dotenv').config();
const session = require('express-session');

console.log('[session-config] ⚠️  Transaction Pooler not accessible from Render (network/firewall issue)');
console.log('[session-config] Using MemoryStore (in-memory session storage)');
console.log('[session-config] ℹ️  Sessions will be lost on server restart - users will need to re-login');

// Use MemoryStore as the session store
const sessionStore = new session.MemoryStore();
const sessionPool = null; // No PostgreSQL pool needed

console.log('[session-config] ✓ MemoryStore initialized successfully');

// Session middleware configuration
console.log('[session-config] Creating session middleware configuration...');
console.log('[session-config] Session secret present:', !!(process.env.SESSION_SECRET || process.env.JWT_SECRET));
console.log('[session-config] Cookie secure (production only):', process.env.NODE_ENV === 'production');

const sessionConfig = {
  store: sessionStore,
  secret: process.env.SESSION_SECRET || process.env.JWT_SECRET || 'fallback-dev-secret-change-in-production',
  resave: false, // Don't save session if unmodified
  saveUninitialized: false, // Don't create session until something stored
  name: 'workline.sid', // Custom cookie name (not default 'connect.sid')
  cookie: {
    httpOnly: true, // Prevent client-side JS access (XSS protection)
    secure: process.env.NODE_ENV === 'production', // true for HTTPS in production, false for localhost
    sameSite: 'lax', // 'lax' for same-site requests (redirects work)
    maxAge: 1000 * 60 * 60 * 8, // 8 hours (matches your JWT_EXPIRES_IN)
    path: '/', // Cookie valid for entire site
  },
  // Use genid to generate unique session IDs
  genid: (req) => {
    const { v4: uuidv4 } = require('uuid');
    return uuidv4(); // Generate cryptographically strong session IDs
  }
};

// Helper: Get user from session
function getSessionUser(req) {
  return req.session?.user || null;
}

// Helper: Set user in session
function setSessionUser(req, userData) {
  if (!req.session) {
    throw new Error('Session not initialized');
  }
  req.session.user = {
    id: userData.id || userData.user_id,
    email: userData.email || userData.username,
    role: userData.role || userData.role_name,
    employee_id: userData.employee_id || null,
    employee_db_id: userData.employee_db_id || userData.employee_id || null,
    sessionId: userData.sessionId || req.sessionID, // Track in user sessions table too
  };
  req.session.loginTime = Date.now();
  req.session.lastActivity = Date.now();
}

// Helper: Destroy session (logout)
async function destroySession(req) {
  return new Promise((resolve, reject) => {
    if (!req.session) {
      return resolve();
    }
    req.session.destroy((err) => {
      if (err) {
        console.error('[session] Error destroying session:', err);
        reject(err);
      } else {
        resolve();
      }
    });
  });
}

// Helper: Regenerate session ID (prevents session fixation)
async function regenerateSession(req) {
  return new Promise((resolve, reject) => {
    req.session.regenerate((err) => {
      if (err) {
        console.error('[session] Error regenerating session:', err);
        reject(err);
      } else {
        resolve();
      }
    });
  });
}

// Middleware: Update last activity timestamp
function updateSessionActivity(req, res, next) {
  if (req.session && req.session.user) {
    req.session.lastActivity = Date.now();
  }
  next();
}

// Middleware: Require authentication (replaces JWT requireAuth)
function requireAuth(allowedRoles = []) {
  return (req, res, next) => {
    // Check if user is logged in
    const user = getSessionUser(req);
    
    if (!user) {
      return res.status(401).json({ 
        error: 'Authentication required. Please log in.' 
      });
    }
    
    // Attach user to request for easy access
    req.auth = user;
    req.user = user; // Alias for convenience
    
    // Check roles if specified
    if (Array.isArray(allowedRoles) && allowedRoles.length > 0) {
      const userRole = (user.role || '').toLowerCase();
      const hasPermission = allowedRoles.some(role => 
        role.toLowerCase() === userRole
      );
      
      if (!hasPermission) {
        return res.status(403).json({ 
          error: 'Forbidden: Insufficient permissions',
          required: allowedRoles,
          current: user.role
        });
      }
    }
    
    next();
  };
}

module.exports = {
  sessionConfig,
  sessionStore,
  sessionPool,
  // Helper functions
  getSessionUser,
  setSessionUser,
  destroySession,
  regenerateSession,
  updateSessionActivity,
  // Middleware
  requireAuth,
};
