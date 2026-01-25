// ============================================================
// INITIALIZATION & SETUP
// ============================================================

const { createClient } = require('@supabase/supabase-js');
const bcrypt = require('bcryptjs');

// Helper function to transform role names for display
function transformRoleName(roleName) {
    const roleMap = {
        'hr': 'Monitoring',
        'HR': 'Monitoring',
        'Hr': 'Monitoring',
        'department_head': 'Department Head',
        'head_dept': 'Department Head',
        'employee': 'Employee',
        'superadmin': 'System Administrator',
        'display': 'Display'
    };
    return roleMap[roleName] || roleName;
}

// Reads SUPABASE_URL and SECRET_KEYS from environment
let SUPABASE_URL = process.env.SUPABASE_URL || process.env.LOCAL_SUPABASE_URL || process.env.CLOUD_SUPABASE_URL || null;
const SECRET_KEYS = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SECRET_KEYS || null; // Prefer service role key

// Fix for local development on Windows where host.docker.internal is used in .env but running on host
if (SUPABASE_URL && SUPABASE_URL.includes('host.docker.internal') && process.platform === 'win32') {
  console.log('[supabase] Detected Windows host with host.docker.internal URL, switching to localhost');
  SUPABASE_URL = SUPABASE_URL.replace('host.docker.internal', 'localhost');
}

function maskUrl(url) {
  try {
    if (!url) return '';
    return url.replace(/(https?:\/\/)([^:@]+)(:[^@]+)?@/, '$1*****@');
  } catch (e) { return '*****'; }
}

let supabase = null;
if (SUPABASE_URL && SECRET_KEYS) {
  try {
    supabase = createClient(SUPABASE_URL, SECRET_KEYS, {
      auth: { persistSession: false },
      global: { headers: { 'x-client-info': 'employee-attendance-server' } }
    });
    console.log('[supabase] Supabase client initialized successfully');
    console.log('[supabase] SUPABASE_URL:', maskUrl(SUPABASE_URL));
    console.log('[supabase] SECRET_KEYS present:', SECRET_KEYS ? 'yes' : 'no');
  } catch (err) {
    console.error('[supabase] FATAL: Failed to initialize Supabase client:', err.message);
    supabase = null;
  }
} else {
  console.error('[supabase] CRITICAL: SUPABASE_URL or SECRET_KEYS not set - Supabase will be unavailable!');
  console.error('[supabase] SUPABASE_URL present:', SUPABASE_URL ? 'yes' : 'no');
  console.error('[supabase] SECRET_KEYS present:', SECRET_KEYS ? 'yes' : 'no');
}

module.exports = {
  supabase,
  bcrypt,
  transformRoleName
};
