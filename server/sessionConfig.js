// Session configuration for express-session with PostgreSQL store
require('dotenv').config();
const session = require('express-session');
const pgSession = require('connect-pg-simple')(session);
const { Pool } = require('pg');

// Verify DATABASE_URL is set
if (!process.env.DATABASE_URL) {
  console.error('[session-config] ❌ ERROR: DATABASE_URL not found in environment');
  console.error('[session-config] Please add your Supabase Transaction Pooler connection string to .env');
  throw new Error('DATABASE_URL is required for session store');
}

console.log('[session-config] Initializing PostgreSQL session store with Transaction Pooler...');
console.log('[session-config] DATABASE_URL present:', !!process.env.DATABASE_URL);
console.log('[session-config] Connection type:', process.env.DATABASE_URL.includes('pooler') ? 'Transaction Pooler ✓' : 'Direct connection');

// Create a dedicated pool for session store
const sessionPool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL?.includes('supabase') 
    ? { rejectUnauthorized: false } 
    : false,
  // Session store settings
  max: 5, // Smaller pool for session operations
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
});

sessionPool.on('error', (err) => {
  console.error('[session-pool] Unexpected error on idle client:', err);
});

sessionPool.on('connect', () => {
  console.log('[session-pool] ✓ Client connected to database');
});

// Test connection immediately
sessionPool.query('SELECT NOW() as time, current_database() as db', (err, res) => {
  if (err) {
    console.error('[session-pool] ❌ Connection test FAILED:', err.message);
    console.error('[session-pool] Check your DATABASE_URL and network connection');
  } else {
    console.log('[session-pool] ✓ Connection test PASSED');
    console.log('[session-pool] Database:', res.rows[0].db);
    console.log('[session-pool] Server time:', res.rows[0].time);
  }
});

// Session store configuration
const sessionStore = new pgSession({
  pool: sessionPool,
  tableName: 'session', // Must match the table created in SQL
  createTableIfMissing: true, // Auto-create table if missing
  pruneSessionInterval: 60 * 15, // Cleanup expired sessions every 15 minutes
  errorLog: (...args) => {
    console.error('[session-store] ERROR:', ...args);
  }
});

// Test if session store can access the table
sessionPool.query('SELECT COUNT(*) as count FROM session', (err, res) => {
  if (err) {
    console.error('[session-store] ⚠️  Cannot access session table:', err.message);
    console.log('[session-store] Table will be auto-created on first session save');
  } else {
    console.log('[session-store] ✓ Session table accessible');
    console.log('[session-store] Current sessions in DB:', res.rows[0].count);
  }
});

console.log('[session-config] Session store initialized successfully');

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

// Helper: Destroy session
function destroySession(req) {
  return new Promise((resolve, reject) => {
    if (!req.session) {
      return resolve();
    }
    req.session.destroy((err) => {
      if (err) {
        console.error('[session] Error destroying session:', err);
        return reject(err);
      }
      resolve();
    });
  });
}

// Helper: Regenerate session ID (use after login to prevent session fixation)
function regenerateSession(req) {
  return new Promise((resolve, reject) => {
    if (!req.session) {
      return reject(new Error('No session to regenerate'));
    }
    req.session.regenerate((err) => {
      if (err) {
        console.error('[session] Error regenerating session:', err);
        return reject(err);
      }
      resolve();
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
