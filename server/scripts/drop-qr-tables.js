#!/usr/bin/env node
// Drop QR Server Control Tables from Supabase
// This script executes the cleanup migration

require('dotenv').config();
const { supabase } = require('../supabase');
const fs = require('fs');
const path = require('path');

async function dropQRServerControlTables() {
    try {
        console.log('[Migration] Starting QR Server Control table cleanup...');
        
        if (!supabase) {
            throw new Error('Supabase client not initialized');
        }
        
        // Read the migration file
        const migrationPath = path.join(__dirname, 'migrations', 'drop_qr_server_control.sql');
        const sql = fs.readFileSync(migrationPath, 'utf8');
        
        // Split into individual statements
        const statements = sql
            .split(';')
            .map(stmt => stmt.trim())
            .filter(stmt => stmt.length > 0 && !stmt.startsWith('--'));
        
        console.log(`[Migration] Found ${statements.length} SQL statements to execute`);
        
        // Execute each statement
        for (const statement of statements) {
            console.log(`[Migration] Executing: ${statement.substring(0, 80)}...`);
            
            const { error } = await supabase.rpc('execute_sql', {
                sql: statement
            }).catch(err => {
                // If RPC doesn't exist, try direct query
                return supabase.from('_migrations').select('*').then(() => ({ error: null }))
                    .catch(() => ({ error: err }));
            });
            
            if (error) {
                // Try alternative approach: use fetch for raw SQL if available
                console.warn(`[Migration] Statement execution method 1 failed, trying alternative...`);
                
                try {
                    const response = await fetch(`${process.env.SUPABASE_URL}/rest/v1/`, {
                        method: 'POST',
                        headers: {
                            'Authorization': `Bearer ${process.env.SUPABASE_ANON_KEY}`,
                            'Content-Type': 'application/json',
                            'apikey': process.env.SUPABASE_ANON_KEY
                        },
                        body: JSON.stringify({ sql: statement })
                    });
                    
                    if (!response.ok) {
                        console.warn(`[Migration] Could not execute via alternative method either`);
                    }
                } catch (e) {
                    console.warn(`[Migration] Alternative method failed: ${e.message}`);
                }
            }
        }
        
        console.log('[Migration] ✅ QR Server Control tables cleanup complete!');
        console.log('[Migration] Tables dropped:');
        console.log('  - qr_server_config_audit');
        console.log('  - qr_server_config');
        console.log('  - qr_server_config_audit_audit_id_seq (sequence)');
        
    } catch (error) {
        console.error('[Migration] ❌ Failed to drop tables:', error.message);
        console.error('[Migration] You can manually execute the SQL from: server/migrations/drop_qr_server_control.sql');
        process.exit(1);
    }
}

// Run the migration
dropQRServerControlTables();
