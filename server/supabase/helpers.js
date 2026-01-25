// ============================================================
// CORE HELPER FUNCTIONS
// ============================================================

const { supabase } = require('./init');

// Helper: find user by email using Supabase from 'users' table
async function findUserByEmail(email) {
  // Try Supabase first if available
  if (supabase) {
    try {
      console.log('[supabase] findUserByEmail searching for:', email);
      
      // Use case-insensitive match
      const { data, error } = await supabase
        .from('users')
        .select('user_id, username, password_hash, role_id, status, first_login')
        .ilike('username', email)
        .limit(1);
      
      if (error) {
        console.warn('[supabase] findUserByEmail error:', error.message);
        // Fall through to local DB
      } else if (data && data.length) {
        console.log('[supabase] findUserByEmail found user via Supabase');
        return data[0];
      }
    } catch (err) {
      console.warn('[supabase] findUserByEmail exception:', err.message);
      // Fall through to local DB
    }
  }

  // Fallback to local PostgreSQL
  console.log('[findUserByEmail] Falling back to local PostgreSQL for:', email);
  try {
    const { pool } = require('../conn');
    const result = await pool.query(
      'SELECT user_id, username, password_hash, role_id, status, first_login FROM users WHERE LOWER(username) = LOWER($1)',
      [email]
    );
    if (result.rows && result.rows.length > 0) {
      console.log('[findUserByEmail] Found user via local PostgreSQL');
      return result.rows[0];
    }
  } catch (localErr) {
    console.error('[findUserByEmail] Local PostgreSQL error:', localErr.message);
  }

  console.log('[findUserByEmail] User not found in any database');
  return null;
}

module.exports = {
  findUserByEmail
};
