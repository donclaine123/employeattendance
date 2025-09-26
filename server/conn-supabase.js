// Supabase-only connection module - no PostgreSQL pool dependency
require('dotenv').config();

const { supabase } = require('./supabaseClient');

// Database connection info for logging
const SUPABASE_URL = process.env.SUPABASE_URL || null;

function maskDatabaseUrl() { 
    return SUPABASE_URL ? SUPABASE_URL.replace(/\/\/([^.]+)\./, '//***.') : 'none'; 
}

async function checkSupabaseConnection() {
    try {
        if (!supabase) {
            console.warn('[conn-supabase] Supabase client not initialized');
            return false;
        }
        
        // Test connection with a simple query
        const { data, error } = await supabase.from('employees').select('count', { count: 'exact', head: true });
        
        if (error) {
            console.error('[conn-supabase] Connection test failed:', error.message);
            return false;
        }
        
        console.log('[conn-supabase] Supabase connection test successful');
        return true;
    } catch (error) {
        console.error('[conn-supabase] Connection test error:', error.message);
        return false;
    }
}

// Supabase query wrapper that mimics pool.query interface
const supabasePool = {
    async query(sql, params = []) {
        if (!supabase) {
            throw new Error('Supabase client not initialized - check environment variables');
        }
        
        // For complex SQL queries, we should use RPC functions instead
        // This is a compatibility layer for legacy code
        console.warn('[conn-supabase] Direct SQL query attempted - consider using Supabase REST API or RPC functions instead');
        console.warn('[conn-supabase] Query:', sql.substring(0, 100) + '...');
        
        // Return empty result for now - routes should use dedicated Supabase helpers
        return { rows: [], rowCount: 0 };
    },
    
    async connect() {
        return await checkSupabaseConnection();
    },
    
    async end() {
        console.log('[conn-supabase] Connection end requested (no-op for Supabase)');
        return Promise.resolve();
    },
    
    on() { 
        // Event handler no-op 
    }
};

function getWorkingConnectionUrl() {
    return maskDatabaseUrl();
}

function getPrimaryConnectionUrl() {
    return maskDatabaseUrl();
}

module.exports = {
    pool: supabasePool,
    checkPostgresConnection: checkSupabaseConnection,
    maskDatabaseUrl,
    getWorkingConnectionUrl,
    getPrimaryConnectionUrl
};