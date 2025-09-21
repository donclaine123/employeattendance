/**
 * Comprehensive Supabase connection troubleshooting script
 */

const { Pool } = require('pg');
const https = require('https');
const http = require('http');

async function comprehensiveSupabaseTest() {
    console.log('🔍 Comprehensive Supabase Connection Troubleshooting\n');
    
    // Your connection string
    const DATABASE_URL = 'postgresql://postgres:CuK7buYUzo8HKLD0@db.nwwnwffsvnajeqkfpgpn.supabase.co:5432/postgres';
    const hostname = 'db.nwwnwffsvnajeqkfpgpn.supabase.co';
    const projectRef = 'nwwnwffsvnajeqkfpgpn';
    
    console.log(`🎯 Project Reference: ${projectRef}`);
    console.log(`🌐 Hostname: ${hostname}\n`);
    
    // Test 1: Basic DNS resolution
    console.log('1️⃣ Testing DNS resolution...');
    const dns = require('dns').promises;
    try {
        const addresses = await dns.lookup(hostname);
        console.log(`✅ DNS resolved: ${addresses.address}`);
    } catch (error) {
        console.log(`❌ DNS failed: ${error.message}`);
        
        // Try alternative DNS servers
        console.log('   🔄 Trying alternative DNS servers...');
        const { Resolver } = require('dns');
        const resolver = new Resolver();
        resolver.setServers(['8.8.8.8', '1.1.1.1']); // Google and Cloudflare DNS
        
        try {
            const altResult = await new Promise((resolve, reject) => {
                resolver.resolve4(hostname, (err, addresses) => {
                    if (err) reject(err);
                    else resolve(addresses);
                });
            });
            console.log(`✅ Alternative DNS resolved: ${altResult[0]}`);
        } catch (altError) {
            console.log(`❌ Alternative DNS also failed: ${altError.message}`);
        }
    }
    
    // Test 2: Check if Supabase API is reachable
    console.log('\n2️⃣ Testing Supabase API reachability...');
    const apiUrl = `https://${projectRef}.supabase.co`;
    
    try {
        const response = await new Promise((resolve, reject) => {
            const req = https.get(apiUrl, (res) => {
                resolve(res);
            });
            req.on('error', reject);
            req.setTimeout(10000, () => reject(new Error('Timeout')));
        });
        console.log(`✅ Supabase API reachable: ${response.statusCode}`);
    } catch (apiError) {
        console.log(`❌ Supabase API not reachable: ${apiError.message}`);
    }
    
    // Test 3: Try different connection string formats
    console.log('\n3️⃣ Testing alternative connection formats...');
    
    const alternatives = [
        // Standard format
        `postgresql://postgres:CuK7buYUzo8HKLD0@db.nwwnwffsvnajeqkfpgpn.supabase.co:5432/postgres`,
        // With SSL parameter
        `postgresql://postgres:CuK7buYUzo8HKLD0@db.nwwnwffsvnajeqkfpgpn.supabase.co:5432/postgres?sslmode=require`,
        // Alternative SSL
        `postgresql://postgres:CuK7buYUzo8HKLD0@db.nwwnwffsvnajeqkfpgpn.supabase.co:5432/postgres?ssl=true`,
    ];
    
    for (let i = 0; i < alternatives.length; i++) {
        console.log(`   Format ${i + 1}: Testing...`);
        const pool = new Pool({ 
            connectionString: alternatives[i],
            ssl: { rejectUnauthorized: false },
            connectionTimeoutMillis: 10000,
        });
        
        try {
            const client = await pool.connect();
            console.log(`   ✅ Format ${i + 1}: Connection successful!`);
            
            // Test a simple query
            const result = await client.query('SELECT NOW() as current_time');
            console.log(`   📅 Server time: ${result.rows[0].current_time}`);
            
            client.release();
            await pool.end();
            
            console.log('\n🎉 Connection successful! Using this format.');
            return alternatives[i];
            
        } catch (connError) {
            console.log(`   ❌ Format ${i + 1}: ${connError.message}`);
            await pool.end().catch(() => {});
        }
    }
    
    // Test 4: Check project status via REST API
    console.log('\n4️⃣ Checking Supabase project status...');
    try {
        const statusUrl = `https://${projectRef}.supabase.co/rest/v1/`;
        const statusReq = await new Promise((resolve, reject) => {
            const req = https.get(statusUrl, (res) => {
                let data = '';
                res.on('data', chunk => data += chunk);
                res.on('end', () => resolve({ status: res.statusCode, data }));
            });
            req.on('error', reject);
            req.setTimeout(10000, () => reject(new Error('Timeout')));
        });
        
        if (statusReq.status === 401 || statusReq.status === 403) {
            console.log('✅ Project is active (authentication required for REST API)');
        } else {
            console.log(`⚠️ Unexpected status: ${statusReq.status}`);
        }
    } catch (statusError) {
        console.log(`❌ Status check failed: ${statusError.message}`);
    }
    
    // Test 5: Manual connection configuration
    console.log('\n5️⃣ Testing manual connection configuration...');
    try {
        const manualPool = new Pool({
            user: 'postgres',
            password: 'CuK7buYUzo8HKLD0',
            host: 'db.nwwnwffsvnajeqkfpgpn.supabase.co',
            port: 5432,
            database: 'postgres',
            ssl: {
                rejectUnauthorized: false
            },
            connectionTimeoutMillis: 15000,
        });
        
        const client = await manualPool.connect();
        console.log('✅ Manual configuration successful!');
        
        const result = await client.query('SELECT version()');
        console.log(`📊 PostgreSQL version: ${result.rows[0].version.substring(0, 50)}...`);
        
        client.release();
        await manualPool.end();
        
    } catch (manualError) {
        console.log(`❌ Manual configuration failed: ${manualError.message}`);
    }
    
    console.log('\n💡 Troubleshooting Summary:');
    console.log('1. Check if your Supabase project is fully provisioned (can take a few minutes)');
    console.log('2. Verify the password is correct in Supabase Dashboard → Settings → Database');
    console.log('3. Try pausing and resuming your Supabase project');
    console.log('4. Check if there are any network/firewall restrictions');
    console.log('5. Consider creating a fresh Supabase project if issues persist');
}

// Run the comprehensive test
comprehensiveSupabaseTest().catch(console.error);