const { Pool } = require('pg');

// Postgres connection - supports both individual parameters and DATABASE_URL
// Primary: Transaction pooler (6543), Fallback: Session pooler (5432)
function buildConnectionString(host, port, database, user, password) {
  return `postgresql://${user}:${password}@${host}:${port}/${database}`;
}

let PG_CONN;
let PG_CONN_FALLBACK;

if (process.env.DB_HOST && process.env.DB_USER && process.env.DB_PASS) {
  // Use individual parameters - build both primary and fallback URLs
  const HOST = process.env.DB_HOST;
  const PORT = process.env.DB_PORT || '6543'; // Transaction pooler (primary)
  const PORT2 = process.env.DB_PORT2 || '5432'; // Session pooler (fallback)
  const DATABASE = process.env.DB_DATABASE || 'postgres';
  const USER = process.env.DB_USER;
  const PASSWORD = process.env.DB_PASS;
  
  PG_CONN = buildConnectionString(HOST, PORT, DATABASE, USER, PASSWORD);
  PG_CONN_FALLBACK = buildConnectionString(HOST, PORT2, DATABASE, USER, PASSWORD);
  
  console.log('[conn] Using individual parameters');
  console.log(`[conn] Primary: Transaction pooler (port ${PORT})`);
  console.log(`[conn] Fallback: Session pooler (port ${PORT2})`);
} else if (process.env.DATABASE_URL) {
  // Use DATABASE_URL as primary, generate fallback by switching ports
  PG_CONN = process.env.DATABASE_URL;
  
  if (PG_CONN.includes(':6543')) {
    PG_CONN_FALLBACK = PG_CONN.replace(':6543', ':5432');
  } else if (PG_CONN.includes(':5432')) {
    PG_CONN_FALLBACK = PG_CONN.replace(':5432', ':6543');
  }
  
  console.log('[conn] Using DATABASE_URL with port switching fallback');
} else {
  // Localhost fallback
  PG_CONN = 'postgresql://workline:secret@localhost:5432/workline';
  console.log('[conn] Using localhost fallback');
}

// Enhanced connection configuration for better compatibility with Supabase Session Pooler
const poolConfig = {
  connectionString: PG_CONN,
  connectionTimeoutMillis: 60000, // 60 seconds - longer for session pooler
  idleTimeoutMillis: 30000, // 30 seconds - shorter idle timeout
  max: 5, // Reduced pool size for session pooler compatibility
  min: 0, // Allow pool to scale down to zero
  acquireTimeoutMillis: 60000, // 60 seconds to acquire a connection
  createTimeoutMillis: 60000, // 60 seconds to create a connection
  destroyTimeoutMillis: 10000, // 10 seconds to destroy a connection
  reapIntervalMillis: 5000, // 5 seconds between connection reaper runs
  createRetryIntervalMillis: 500, // 500ms between connection creation retries
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

// Function to get alternative connection URLs with dual-port support
function getAlternativeConnectionUrl(originalUrl) {
  const alternatives = [];
  
  // Add the fallback URL first (different port)
  if (PG_CONN_FALLBACK && PG_CONN_FALLBACK !== originalUrl) {
    alternatives.push(PG_CONN_FALLBACK);
  }
  
  // Support both direct connections (5432) and pooler connections (6543)
  if (originalUrl.includes(':5432')) {
    // Session pooler - try IP alternatives and transaction pooler
    if (originalUrl.includes('aws-1-ap-southeast-1.pooler.supabase.com')) {
      alternatives.push(originalUrl.replace('aws-1-ap-southeast-1.pooler.supabase.com', '3.1.167.181'));
      alternatives.push(originalUrl.replace('aws-1-ap-southeast-1.pooler.supabase.com', '13.213.241.248'));
      // Also try switching to transaction pooler
      alternatives.push(originalUrl.replace(':5432', ':6543'));
    }
  }
  
  if (originalUrl.includes(':6543')) {
    // Transaction pooler - try IP alternatives and session pooler
    if (originalUrl.includes('aws-1-ap-southeast-1.pooler.supabase.com')) {
      alternatives.push(originalUrl.replace('aws-1-ap-southeast-1.pooler.supabase.com', '3.1.167.181'));
      alternatives.push(originalUrl.replace('aws-1-ap-southeast-1.pooler.supabase.com', '13.213.241.248'));
      // Also try switching to session pooler
      alternatives.push(originalUrl.replace(':6543', ':5432'));
    }
  }
  
  // If the original URL already uses an IP address, try the other known IPs
  if (originalUrl.includes('3.1.167.181:5432')) {
    alternatives.push(originalUrl.replace('3.1.167.181', '13.213.241.248'));
    alternatives.push(originalUrl.replace('3.1.167.181', 'aws-1-ap-southeast-1.pooler.supabase.com'));
    // Also try transaction pooler version
    alternatives.push(originalUrl.replace(':5432', ':6543'));
  }
  
  if (originalUrl.includes('3.1.167.181:6543')) {
    alternatives.push(originalUrl.replace('3.1.167.181', '13.213.241.248'));
    alternatives.push(originalUrl.replace('3.1.167.181', 'aws-1-ap-southeast-1.pooler.supabase.com'));
    // Also try session pooler version
    alternatives.push(originalUrl.replace(':6543', ':5432'));
  }
  
  if (originalUrl.includes('13.213.241.248:5432')) {
    alternatives.push(originalUrl.replace('13.213.241.248', '3.1.167.181'));
    alternatives.push(originalUrl.replace('13.213.241.248', 'aws-1-ap-southeast-1.pooler.supabase.com'));
    // Also try transaction pooler version
    alternatives.push(originalUrl.replace(':5432', ':6543'));
  }
  
  if (originalUrl.includes('13.213.241.248:6543')) {
    alternatives.push(originalUrl.replace('13.213.241.248', '3.1.167.181'));
    alternatives.push(originalUrl.replace('13.213.241.248', 'aws-1-ap-southeast-1.pooler.supabase.com'));
    // Also try session pooler version
    alternatives.push(originalUrl.replace(':6543', ':5432'));
  }
  
  // Remove duplicates
  return [...new Set(alternatives)];
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
  
  // Validate that we're using a valid Supabase connection
  if (PG_CONN.includes(':5432')) {
    console.log('[conn] ℹ️  Primary: Supabase session pooler (port 5432)');
    console.log('[conn] 💡 Session mode - maintains connection state');
  } else if (PG_CONN.includes(':6543')) {
    console.log('[conn] ℹ️  Primary: Supabase transaction pooler (port 6543)');
    console.log('[conn] 💡 Transaction mode - for serverless environments');
  }
  
  if (PG_CONN_FALLBACK) {
    if (PG_CONN_FALLBACK.includes(':5432')) {
      console.log('[conn] 🔄 Fallback: Session pooler (port 5432) available');
    } else if (PG_CONN_FALLBACK.includes(':6543')) {
      console.log('[conn] 🔄 Fallback: Transaction pooler (port 6543) available');
    }
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
  console.error('[conn]   5. Check if using direct connections (port 5432) - requires paid Supabase plan');
  console.error('[conn]   6. Try switching between direct (5432) and pooler (6543) connections');
  console.error('[conn] Note: Supporting both direct (5432) and pooler (6543) connections');
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