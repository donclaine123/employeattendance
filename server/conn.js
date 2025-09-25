const { Pool } = require('pg');

// Postgres connection - expects DATABASE_URL env var or falls back to localhost
// Support for IP-based fallback for Render DNS issues
const PG_CONN = process.env.DATABASE_URL_IP || process.env.DATABASE_URL || 'postgresql://workline:secret@localhost:5432/workline';

console.log('[conn] Using connection string source:', 
  process.env.DATABASE_URL_IP ? 'DATABASE_URL_IP (IP-based fallback)' : 
  process.env.DATABASE_URL ? 'DATABASE_URL (hostname-based)' : 
  'localhost fallback');

// Enhanced connection configuration for better compatibility with Supabase
const poolConfig = {
  connectionString: PG_CONN,
  connectionTimeoutMillis: 30000, // 30 seconds
  idleTimeoutMillis: 60000, // 60 seconds
  max: 10, // maximum number of connections in the pool
  min: 1, // minimum number of connections in the pool
  acquireTimeoutMillis: 60000, // 60 seconds to acquire a connection
  createTimeoutMillis: 30000, // 30 seconds to create a connection
  destroyTimeoutMillis: 5000, // 5 seconds to destroy a connection
  reapIntervalMillis: 1000, // 1 second between connection reaper runs
  createRetryIntervalMillis: 200, // 200ms between connection creation retries
};

// SSL configuration for Supabase/production
if (process.env.NODE_ENV === 'production' || PG_CONN.includes('supabase.co')) {
  poolConfig.ssl = {
    rejectUnauthorized: false,
    // Additional SSL options for Supabase compatibility
    ca: undefined,
    key: undefined,
    cert: undefined,
  };
}

// Force IPv4 for Render compatibility
if (process.env.NODE_ENV === 'production') {
  process.env.NODE_OPTIONS = (process.env.NODE_OPTIONS || '') + ' --dns-result-order=ipv4first';
}

// Function to get alternative connection URL (direct vs pooler + IP alternatives)
function getAlternativeConnectionUrl(originalUrl) {
  const alternatives = [];
  
  // Only try pooler connections (6543) - direct connections (5432) require paid Supabase plan
  if (originalUrl.includes(':6543')) {
    // Don't switch to direct connection - only try IP alternatives for pooler
    // Add IP-based alternatives for Render DNS issues
    if (originalUrl.includes('aws-1-ap-southeast-1.pooler.supabase.com')) {
      alternatives.push(originalUrl.replace('aws-1-ap-southeast-1.pooler.supabase.com', '3.1.167.181'));
      alternatives.push(originalUrl.replace('aws-1-ap-southeast-1.pooler.supabase.com', '13.213.241.248'));
    }
  }
  
  // If the original URL already uses an IP address, try the other known IPs (pooler only)
  if (originalUrl.includes('3.1.167.181:6543')) {
    alternatives.push(originalUrl.replace('3.1.167.181', '13.213.241.248'));
    // Also try the hostname version
    alternatives.push(originalUrl.replace('3.1.167.181', 'aws-1-ap-southeast-1.pooler.supabase.com'));
  }
  
  if (originalUrl.includes('13.213.241.248:6543')) {
    alternatives.push(originalUrl.replace('13.213.241.248', '3.1.167.181'));
    // Also try the hostname version
    alternatives.push(originalUrl.replace('13.213.241.248', 'aws-1-ap-southeast-1.pooler.supabase.com'));
  }
  
  // Remove any direct connection attempts (port 5432) as they require paid plan
  return alternatives.filter(url => !url.includes(':5432'));
}

// Create the initial pool
const pool = new Pool(poolConfig);

// Track working connection URL for logging
let workingConnectionUrl = PG_CONN;

// Helper to mask a database connection string (hide password)
function maskDatabaseUrl(conn) {
  try {
    // basic parsing: postgresql://user:pass@host:port/db
    const m = conn.match(/^(postgres(?:ql)?:\/\/)([^:]+)(:([^@]+))?@([^\/]+)(\/.*)?$/i);
    if (!m) return conn.replace(/:.+@/, ':*****@');
    const proto = m[1];
    const user = m[2];
    const pass = m[4] ? '*****' : '';
    const host = m[5] || '';
    const db = m[6] || '';
    return `${proto}${user}${pass}@${host}${db}`;
  } catch (e) { 
    return 'postgres://****'; 
  }
}

// Enhanced Postgres connectivity check with retry logic and fallback URLs
async function checkPostgresConnection(retries = 3) {
  // First, let's test DNS resolution
  console.log('[conn] 🔍 Testing DNS resolution...');
  
  // Validate that we're using pooler connection (free tier requirement)
  if (!PG_CONN.includes(':6543')) {
    console.warn('[conn] ⚠️  Warning: Not using Supabase pooler connection (port 6543)');
    console.warn('[conn] ⚠️  Direct connections (port 5432) require paid Supabase plan');
  }
  
  const { URL } = require('url');
  
  try {
    const parsedUrl = new URL(PG_CONN);
    const hostname = parsedUrl.hostname;
    console.log(`[conn] Attempting to resolve hostname: ${hostname}`);
    
    const dns = require('dns').promises;
    const addresses = await dns.lookup(hostname);
    console.log(`[conn] ✅ DNS resolution successful: ${hostname} -> ${addresses.address}`);
  } catch (dnsError) {
    console.error(`[conn] ❌ DNS resolution failed:`, dnsError.message);
    console.log('[conn] 🔧 This might be a Render infrastructure issue. Trying alternative approaches...');
  }
  
  const connectionUrls = [PG_CONN];
  const alternatives = getAlternativeConnectionUrl(PG_CONN);
  if (alternatives && alternatives.length > 0) {
    connectionUrls.push(...alternatives);
  }

  for (const connectionUrl of connectionUrls) {
    console.log(`[conn] Trying connection URL: ${maskDatabaseUrl(connectionUrl)}`);
    
    const testPoolConfig = {
      ...poolConfig,
      connectionString: connectionUrl
    };
    
    const testPool = new Pool(testPoolConfig);
    
    for (let i = 0; i < retries; i++) {
      try {
        console.log(`[conn] Attempting database connection (attempt ${i + 1}/${retries})...`);
        const r = await testPool.query('SELECT now() as now, version() as version');
        const now = (r.rows && r.rows[0] && r.rows[0].now) ? r.rows[0].now.toISOString() : null;
        const version = (r.rows && r.rows[0] && r.rows[0].version) ? r.rows[0].version : null;
        
        // If we succeeded with an alternative URL, update the main pool
        if (connectionUrl !== PG_CONN) {
          console.log(`[conn] 🔄 Updating main pool to use working connection`);
          try {
            // Close the original pool
            await pool.end();
            
            // Update the pool config and recreate
            poolConfig.connectionString = connectionUrl;
            const newPool = new Pool(poolConfig);
            
            // Replace all properties of the original pool object
            Object.setPrototypeOf(pool, Object.getPrototypeOf(newPool));
            Object.defineProperty(pool, 'constructor', { value: newPool.constructor });
            
            // Copy all enumerable properties
            Object.keys(newPool).forEach(key => {
              pool[key] = newPool[key];
            });
            
            // Update tracking variable
            workingConnectionUrl = connectionUrl;
            
            console.log('[conn] ✅ Main pool successfully updated with working connection');
          } catch (replaceError) {
            console.warn('[conn] Failed to replace main pool:', replaceError.message);
            console.warn('[conn] Continuing - individual queries may still fail');
          }
        }
        
        console.log('[conn] ✅ Postgres connected successfully');
        console.log(`[conn] Database time: ${now}`);
        console.log(`[conn] Database version: ${version ? version.substring(0, 50) + '...' : 'Unknown'}`);
        console.log(`[conn] Active connection URL: ${maskDatabaseUrl(connectionUrl)}`);
        
        await testPool.end(); // Clean up test pool
        return true;
      } catch (e) {
        console.error(`[conn] ❌ Database connection attempt ${i + 1} failed:`, e.message || e);
        console.error(`[conn] Error code: ${e.code}, Error errno: ${e.errno}`);
        if (i < retries - 1) {
          console.log(`[conn] Retrying in 2 seconds...`);
          await new Promise(resolve => setTimeout(resolve, 2000));
        }
      }
    }
    
    await testPool.end(); // Clean up test pool if all attempts failed
    console.log(`[conn] All attempts failed for URL: ${maskDatabaseUrl(connectionUrl)}`);
  }
  
  console.error('[conn] ⚠️  All database connection attempts failed with all URLs. Server will continue but database operations may fail.');
  console.error('[conn] Tried URLs:');
  connectionUrls.forEach((url, index) => {
    console.error(`[conn]   ${index + 1}. ${maskDatabaseUrl(url)}`);
  });
  console.error('[conn] SSL config:', poolConfig.ssl ? 'Enabled' : 'Disabled');
  console.error('[conn] 💡 Possible solutions:');
  console.error('[conn]   1. Check Render service logs for network issues');
  console.error('[conn]   2. Try using a different Supabase region');
  console.error('[conn]   3. Contact Render support about Supabase connectivity');
  console.error('[conn]   4. Verify Supabase project is active and accessible');
  console.error('[conn]   5. Consider upgrading Supabase plan if using direct connections (port 5432)');
  console.error('[conn] Note: Only trying pooler connections (port 6543) - direct connections require paid Supabase plan');
  return false;
}

// Handle pool errors
pool.on('error', (err, client) => {
  console.error('[conn] Database pool error:', err.message || err);
});

// Export the pool and utility functions
module.exports = {
  pool,
  checkPostgresConnection,
  maskDatabaseUrl,
  getWorkingConnectionUrl: () => workingConnectionUrl,
  getPrimaryConnectionUrl: () => PG_CONN
};