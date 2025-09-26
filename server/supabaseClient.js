const { createClient } = require('@supabase/supabase-js');

// Reads SUPABASE_URL and SECRET_KEYS from environment
const SUPABASE_URL = process.env.SUPABASE_URL || null;
const SECRET_KEYS = process.env.SECRET_KEYS || null; // expect service role or anon key(s)

function maskUrl(url) {
  try {
    if (!url) return '';
    return url.replace(/(https?:\/\/)([^:@]+)(:[^@]+)?@/, '$1*****@');
  } catch (e) { return '*****'; }
}

let supabase = null;
if (SUPABASE_URL && SECRET_KEYS) {
  supabase = createClient(SUPABASE_URL, SECRET_KEYS, {
    auth: { persistSession: false },
    global: { headers: { 'x-client-info': 'employee-attendance-server' } }
  });
  console.log('[supabase] Supabase client initialized');
  console.log('[supabase] SUPABASE_URL:', maskUrl(SUPABASE_URL));
  console.log('[supabase] SECRET_KEYS present:', SECRET_KEYS ? 'yes' : 'no');
} else {
  console.log('[supabase] SUPABASE_URL or SECRET_KEYS not set - skipping Supabase client initialization');
  console.log('[supabase] SUPABASE_URL present:', SUPABASE_URL ? 'yes' : 'no');
  console.log('[supabase] SECRET_KEYS present:', SECRET_KEYS ? 'yes' : 'no');
}

// Helper: find user by email using Supabase from 'users' table
async function findUserByEmail(email) {
  if (!supabase) throw new Error('Supabase client not initialized');
  // Use case-insensitive match
  const { data, error } = await supabase
    .from('users')
    .select('user_id, username, password_hash, role_id, status, first_login')
    .ilike('username', email)
    .limit(1);
  if (error) throw error;
  return (data && data.length) ? data[0] : null;
}

// Helper: run arbitrary SQL via RPC or direct query is not recommended here; prefer table selects
module.exports = {
  supabase,
  findUserByEmail,
  isSupabaseEnabled: () => !!supabase
};
