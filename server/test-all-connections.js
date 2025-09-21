/**
 * Test all three Supabase connection formats
 */

const { Pool } = require('pg');

async function testAllSupabaseConnections() {
    console.log('🧪 Testing all three Supabase connection formats...\n');
    
    const password = 'CuK7buYUzo8HKLD0';
    
    const connections = [
        {
            name: '🔗 Direct Connection',
            url: `postgresql://postgres:${password}@db.nwwnwffsvnajeqkfpgpn.supabase.co:5432/postgres`,
            description: 'Best for development, single connections'
        },
        {
            name: '⚡ Transaction Pooler',
            url: `postgresql://postgres.nwwnwffsvnajeqkfpgpn:${password}@aws-1-ap-southeast-1.pooler.supabase.com:6543/postgres`,
            description: 'Best for production, handles many connections efficiently'
        },
        {
            name: '🔄 Session Pooler', 
            url: `postgresql://postgres.nwwnwffsvnajeqkfpgpn:${password}@aws-1-ap-southeast-1.pooler.supabase.com:5432/postgres`,
            description: 'Good for applications that need session state'
        }
    ];
    
    for (let i = 0; i < connections.length; i++) {
        const conn = connections[i];
        console.log(`${i + 1}️⃣ Testing: ${conn.name}`);
        console.log(`   📝 ${conn.description}`);
        console.log(`   🔗 URL: ${conn.url.replace(password, '****')}`);
        
        const pool = new Pool({
            connectionString: conn.url,
            ssl: { rejectUnauthorized: false },
            connectionTimeoutMillis: 15000,
        });
        
        try {
            // Test connection
            console.log('   🔄 Connecting...');
            const client = await pool.connect();
            console.log('   ✅ Connection successful!');
            
            // Test basic query
            const timeResult = await client.query('SELECT NOW() as current_time');
            console.log(`   📅 Server time: ${timeResult.rows[0].current_time}`);
            
            // Test if tables exist (from our schema)
            const tablesResult = await client.query(`
                SELECT table_name 
                FROM information_schema.tables 
                WHERE table_schema = 'public' 
                ORDER BY table_name
            `);
            console.log(`   📊 Tables found: ${tablesResult.rows.length}`);
            if (tablesResult.rows.length > 0) {
                console.log(`   📋 Table names: ${tablesResult.rows.map(r => r.table_name).join(', ')}`);
            } else {
                console.log('   ⚠️ No tables found - you may need to run your schema.sql');
            }
            
            // Test roles table (from our schema)
            try {
                const rolesResult = await client.query('SELECT role_name FROM roles ORDER BY role_name');
                console.log(`   👥 Roles: ${rolesResult.rows.map(r => r.role_name).join(', ')}`);
            } catch (roleError) {
                console.log(`   ⚠️ Roles table not found - schema may not be loaded`);
            }
            
            client.release();
            await pool.end();
            
            console.log(`   🎉 ${conn.name} works perfectly!\n`);
            
            // If this is the first working connection, recommend it
            if (i === 0) {
                console.log('🏆 RECOMMENDATION: Use Direct Connection for development');
                console.log('💡 For production deployment (Render), use Transaction Pooler\n');
            }
            
        } catch (error) {
            console.log(`   ❌ Failed: ${error.message}`);
            await pool.end().catch(() => {});
            console.log('');
        }
    }
    
    console.log('📋 Summary & Recommendations:');
    console.log('');
    console.log('🔗 Direct Connection:');
    console.log('   ✅ Use for: Local development, testing');
    console.log('   ❌ Avoid for: High-traffic production apps');
    console.log('');
    console.log('⚡ Transaction Pooler:'); 
    console.log('   ✅ Use for: Production deployment (Render)');
    console.log('   ✅ Best for: REST APIs, serverless functions');
    console.log('   ✅ Handles: Many concurrent connections efficiently');
    console.log('');
    console.log('🔄 Session Pooler:');
    console.log('   ✅ Use for: Apps that need prepared statements');
    console.log('   ✅ Best for: Long-running connections');
    console.log('');
}

testAllSupabaseConnections().catch(console.error);