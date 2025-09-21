/**
 * Check for correct Supabase database hostname format
 */

const https = require('https');

async function checkSupabaseHostnames() {
    console.log('🔍 Checking Supabase hostname formats...\n');
    
    const projectRef = 'nwwnwffsvnajeqkfpgpn';
    
    // Different possible hostname formats that Supabase might use
    const possibleHostnames = [
        `db.${projectRef}.supabase.co`,           // Current standard format
        `${projectRef}.supabase.co`,              // Direct project hostname  
        `aws-0-${projectRef}.pooler.supabase.com`, // Pooler format (newer)
        `aws-0-${projectRef}.pooler.us-east-1.supabase.com`, // Regional pooler
        `${projectRef}.db.supabase.co`,           // Alternative format
    ];
    
    console.log('Testing different hostname formats:');
    
    for (const hostname of possibleHostnames) {
        console.log(`\n🧪 Testing: ${hostname}`);
        
        // Test DNS resolution
        try {
            const dns = require('dns').promises;
            const addresses = await dns.lookup(hostname);
            console.log(`✅ DNS resolves to: ${addresses.address}`);
            
            // If DNS works, try a basic connection test
            const { Pool } = require('pg');
            const pool = new Pool({
                user: 'postgres',
                password: 'CuK7buYUzo8HKLD0',
                host: hostname,
                port: 5432,
                database: 'postgres',
                ssl: { rejectUnauthorized: false },
                connectionTimeoutMillis: 10000,
            });
            
            try {
                const client = await pool.connect();
                console.log(`🎉 DATABASE CONNECTION SUCCESSFUL!`);
                console.log(`✅ Correct hostname: ${hostname}`);
                
                const result = await client.query('SELECT NOW() as time');
                console.log(`📅 Server time: ${result.rows[0].time}`);
                
                client.release();
                await pool.end();
                
                console.log(`\n🔧 Use this connection string:`);
                console.log(`postgresql://postgres:CuK7buYUzo8HKLD0@${hostname}:5432/postgres`);
                return hostname;
                
            } catch (connError) {
                console.log(`❌ Connection failed: ${connError.message}`);
                await pool.end().catch(() => {});
            }
            
        } catch (dnsError) {
            console.log(`❌ DNS failed: ${dnsError.message}`);
        }
    }
    
    console.log('\n🤔 None of the standard hostnames worked.');
    console.log('\n💡 Solutions to try:');
    console.log('1. Go to Supabase Dashboard → Settings → Database');
    console.log('2. Copy the EXACT connection string shown there');
    console.log('3. Make sure you\'re using the "URI" format, not "psql" format');
    console.log('4. Check if you need to enable "Direct Connection" vs "Connection Pooling"');
    console.log('5. Try creating a completely new Supabase project');
}

checkSupabaseHostnames().catch(console.error);