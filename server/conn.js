// PostgreSQL Connection Pool
const { Pool } = require('pg');

console.log('[conn] Initializing PostgreSQL connection pool...');

const PG_CONN = process.env.DATABASE_URL || null;

function maskDatabaseUrl() { 
  return PG_CONN ? PG_CONN.replace(/(:)([^:]+)@/, '$1*****@') : 'none'; 
}

// Create connection pool
const pool = new Pool({
  connectionString: PG_CONN || 'postgresql://postgres:postgres@postgres:5432/postgres',
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

pool.on('error', (err) => {
  console.error('[conn] Unexpected error on idle client', err);
});

async function checkPostgresConnection() {
  try {
    const client = await pool.connect();
    await client.query('SELECT 1');
    client.release();
    console.log('[conn] PostgreSQL connection successful');
    return true;
  } catch (error) {
    console.error('[conn] PostgreSQL connection failed:', error.message);
    return false;
  }
}

module.exports = {
  pool,
  checkPostgresConnection,
  maskDatabaseUrl,
  getWorkingConnectionUrl: () => PG_CONN,
  getPrimaryConnectionUrl: () => PG_CONN
};