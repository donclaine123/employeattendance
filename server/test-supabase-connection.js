/**
 * Test script to verify Supabase database connection
 * Run this locally with your Supabase connection string
 */

const { Pool } = require('pg');

async function testSupabaseConnection() {
    console.log('🧪 Testing Supabase database connection...\n');
    
    // Use the working Transaction Pooler connection string  
    const DATABASE_URL = process.env.DATABASE_URL || 'postgresql://postgres.nwwnwffsvnajeqkfpgpn:CuK7buYUzo8HKLD0@aws-1-ap-southeast-1.pooler.supabase.com:6543/postgres';
    
    console.log('🔗 Connection string format check...');
    console.log(`Database URL: ${DATABASE_URL.replace(/:[^:@]*@/, ':****@')}`); // Hide password
    
    if (DATABASE_URL.includes('[PASSWORD]') || DATABASE_URL.includes('[PROJECT-REF]')) {
        console.log('❌ Please update the DATABASE_URL with your actual Supabase credentials');
        console.log('Get your connection string from: Supabase Dashboard → Settings → Database');
        return;
    }
    
    // Validate connection string format
    const urlPattern = /^postgresql:\/\/postgres:[^@]+@db\.[a-z0-9]+\.supabase\.co:5432\/postgres$/;
    if (!urlPattern.test(DATABASE_URL)) {
        console.log('⚠️ Connection string format looks incorrect');
        console.log('Expected format: postgresql://postgres:PASSWORD@db.PROJECT-REF.supabase.co:5432/postgres');
    }
    
    console.log('\n📡 Testing DNS resolution...');
    const hostname = DATABASE_URL.match(/@([^:]+):/)?.[1];
    if (hostname) {
        console.log(`Hostname: ${hostname}`);
        
        // Test if we can resolve the hostname
        const dns = require('dns').promises;
        try {
            const addresses = await dns.lookup(hostname);
            console.log(`✅ DNS resolved: ${addresses.address}`);
        } catch (dnsError) {
            console.log(`❌ DNS resolution failed: ${dnsError.message}`);
            console.log('\n🔧 Possible solutions:');
            console.log('1. Check if your Supabase project is active (not paused)');
            console.log('2. Verify the project reference in the hostname is correct');
            console.log('3. Check your internet connection');
            console.log('4. Try refreshing your Supabase project or creating a new one');
            return;
        }
    }
    
    const pool = new Pool({ 
        connectionString: DATABASE_URL,
        ssl: {
            rejectUnauthorized: false
        }
    });
    
    try {
        // Test basic connection
        console.log('1️⃣ Testing database connection...');
        const client = await pool.connect();
        console.log('✅ Connected to Supabase successfully!');
        
        // Test tables exist
        console.log('\n2️⃣ Checking tables...');
        const tablesResult = await client.query(`
            SELECT table_name 
            FROM information_schema.tables 
            WHERE table_schema = 'public' 
            ORDER BY table_name
        `);
        
        console.log('📋 Tables found:', tablesResult.rows.map(r => r.table_name).join(', '));
        
        // Test sample data
        console.log('\n3️⃣ Checking sample data...');
        const rolesResult = await client.query('SELECT role_name FROM roles ORDER BY role_name');
        console.log('👥 Roles:', rolesResult.rows.map(r => r.role_name).join(', '));
        
        const deptsResult = await client.query('SELECT dept_name FROM departments ORDER BY dept_name');
        console.log('🏢 Departments:', deptsResult.rows.map(r => r.dept_name).join(', '));
        
        // Test user count
        const userResult = await client.query('SELECT COUNT(*) as count FROM users');
        console.log('👤 Users count:', userResult.rows[0].count);
        
        client.release();
        
        console.log('\n🎉 Supabase database is ready!');
        console.log('💡 You can now update your Render environment variables');
        
    } catch (error) {
        console.error('❌ Connection failed:', error.message);
        console.log('\n🔧 Troubleshooting:');
        console.log('1. Check your DATABASE_URL format');
        console.log('2. Verify password is correct');
        console.log('3. Ensure schema.sql was executed in Supabase');
        console.log('4. Check Supabase project is active');
    } finally {
        await pool.end();
    }
}

// Run test
testSupabaseConnection();