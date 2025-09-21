/**
 * Script to create a superadmin account in Supabase database
 */

const { Pool } = require('pg');
const bcrypt = require('bcryptjs');

async function createSuperadmin() {
    console.log('👑 Creating superadmin account...\n');
    
    const DATABASE_URL = process.env.DATABASE_URL || 'postgresql://postgres.nwwnwffsvnajeqkfpgpn:CuK7buYUzo8HKLD0@aws-1-ap-southeast-1.pooler.supabase.com:6543/postgres';
    
    const pool = new Pool({
        connectionString: DATABASE_URL,
        ssl: { rejectUnauthorized: false }
    });

    const client = await pool.connect();
    
    try {
        console.log('✅ Connected to Supabase database');

        // Hash the password
        const password = 'admin123';
        const passwordHash = await bcrypt.hash(password, 10);
        console.log('🔒 Password hashed');

        // Start transaction
        await client.query('BEGIN');

        // Get superadmin role ID
        const roleResult = await client.query('SELECT role_id FROM roles WHERE lower(role_name) = $1', ['superadmin']);
        
        if (roleResult.rows.length === 0) {
            throw new Error('Superadmin role not found in roles table');
        }

        const roleId = roleResult.rows[0].role_id;
        console.log('👑 Found superadmin role ID:', roleId);

        // Check if superadmin user already exists (check by email)
        const existingUser = await client.query('SELECT user_id FROM users WHERE lower(username) = $1', ['admin@company.com']);
        
        if (existingUser.rows.length > 0) {
            console.log('⚠️  Superadmin user already exists, updating password...');
            await client.query('UPDATE users SET password_hash = $1 WHERE lower(username) = $2', [passwordHash, 'admin@company.com']);
            console.log('✅ Superadmin password updated');
        } else {
            // Create superadmin user (username field stores the email for login compatibility)
            const userResult = await client.query(`
                INSERT INTO users (username, password_hash, role_id, created_at, updated_at)
                VALUES ($1, $2, $3, NOW(), NOW())
                RETURNING user_id
            `, ['admin@company.com', passwordHash, roleId]);

            const userId = userResult.rows[0].user_id;
            console.log('👤 Created superadmin user with ID:', userId);

            // Create employee record for the superadmin (with email in proper column)
            await client.query(`
                INSERT INTO employees (employee_id, first_name, last_name, email, dept_id, hire_date, created_at)
                VALUES ($1, $2, $3, $4, $5, NOW(), NOW())
            `, [userId, 'Super', 'Admin', 'admin@company.com', 1]); // Assuming dept_id 1 exists

            console.log('👥 Created employee record for superadmin');
        }

        // Commit transaction
        await client.query('COMMIT');
        console.log('✅ Transaction committed successfully');

        console.log('\n🎉 Superadmin account ready!');
        console.log('📋 Login credentials:');
        console.log('   Email: admin@company.com');
        console.log('   Password: admin123');

    } catch (error) {
        await client.query('ROLLBACK');
        console.error('❌ Error creating superadmin account:', error.message);
        throw error;
    } finally {
        client.release();
        await pool.end();
        console.log('🔌 Database connection closed');
    }
}

// Run the function
createSuperadmin().catch(error => {
    console.error('Failed to create superadmin:', error.message);
    process.exit(1);
});