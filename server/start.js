#!/usr/bin/env node

/**
 * Render.com startup script
 * This script runs before the main application starts
 * It handles database initialization and setup
 */

const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
    console.error('❌ DATABASE_URL environment variable is required');
    process.exit(1);
}

console.log('🚀 Starting Render.com deployment setup...');

async function initializeDatabase() {
    const pool = new Pool({ connectionString: DATABASE_URL });
    
    try {
        console.log('📊 Checking database connection...');
        await pool.query('SELECT NOW()');
        console.log('✅ Database connected successfully');
        
        // Check if tables exist
        console.log('🔍 Checking if tables exist...');
        const tableCheck = await pool.query(`
            SELECT table_name 
            FROM information_schema.tables 
            WHERE table_schema = 'public' AND table_name = 'users'
        `);
        
        if (tableCheck.rows.length === 0) {
            console.log('📋 Tables not found, initializing database schema...');
            
            // Read and execute schema
            const schemaPath = path.join(__dirname, 'postgres', 'schema.sql');
            if (fs.existsSync(schemaPath)) {
                const schema = fs.readFileSync(schemaPath, 'utf8');
                await pool.query(schema);
                console.log('✅ Database schema created');
            } else {
                console.log('⚠️ Schema file not found, skipping schema creation');
            }
            
            // Create default accounts
            console.log('👥 Creating default accounts...');
            try {
                const bcrypt = require('bcryptjs');
                
                const defaultAccounts = [
                    { username: 'superadmin', password: 'admin123', role: 'superadmin' },
                    { username: 'hr', password: 'hr123', role: 'hr' },
                    { username: 'head', password: 'head123', role: 'head_dept' },
                    { username: 'emp', password: 'emp123', role: 'employee' }
                ];
                
                for (const account of defaultAccounts) {
                    const hashedPassword = await bcrypt.hash(account.password, 10);
                    
                    // Get role_id
                    const roleResult = await pool.query('SELECT role_id FROM roles WHERE role_name = $1', [account.role]);
                    if (roleResult.rows.length > 0) {
                        const roleId = roleResult.rows[0].role_id;
                        
                        // Check if user exists
                        const userCheck = await pool.query('SELECT user_id FROM users WHERE username = $1', [account.username]);
                        if (userCheck.rows.length === 0) {
                            await pool.query(
                                'INSERT INTO users (username, password_hash, role_id) VALUES ($1, $2, $3)',
                                [account.username, hashedPassword, roleId]
                            );
                            console.log(`   ✅ Created ${account.role} account: ${account.username}`);
                        } else {
                            console.log(`   ℹ️ User ${account.username} already exists`);
                        }
                    }
                }
                
                console.log('✅ Default accounts setup completed');
            } catch (error) {
                console.error('⚠️ Error creating default accounts:', error.message);
            }
            
        } else {
            console.log('✅ Database tables already exist');
        }
        
        // Test a simple query
        const result = await pool.query('SELECT COUNT(*) as user_count FROM users');
        console.log(`👥 Total users in database: ${result.rows[0].user_count}`);
        
    } catch (error) {
        console.error('❌ Database initialization failed:', error.message);
        process.exit(1);
    } finally {
        await pool.end();
    }
}

async function startApplication() {
    console.log('🎯 Starting application server...');
    
    // Import and start the main server
    require('./server.js');
}

// Main execution
async function main() {
    try {
        await initializeDatabase();
        console.log('🎉 Database initialization completed successfully');
        console.log('🚀 Starting Employee Attendance System...\n');
        
        // Start the main application
        startApplication();
        
    } catch (error) {
        console.error('💥 Startup failed:', error.message);
        process.exit(1);
    }
}

// Run if this script is executed directly
if (require.main === module) {
    main();
}