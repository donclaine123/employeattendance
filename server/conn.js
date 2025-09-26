// Conn stub: Postgres pool disabled for REST-only testing
console.log('[conn] WARNING: Postgres pool disabled - running in REST-only test mode');

const PG_CONN = process.env.DATABASE_URL || null;

function maskDatabaseUrl() { return PG_CONN ? PG_CONN.replace(/(:)([^:]+)@/, '$1*****@') : 'none'; }

async function checkPostgresConnection() {
  console.warn('[conn] checkPostgresConnection: pool disabled for REST-only testing');
  return false;
}

// Minimal pool stub that throws when used so fallback is obvious
const pool = {
  query() { throw new Error('Postgres pool disabled for REST-only testing'); },
  connect() { throw new Error('Postgres pool disabled for REST-only testing'); },
  end() { return Promise.resolve(); },
  on() { /* noop */ }
};

module.exports = {
  pool,
  checkPostgresConnection,
  maskDatabaseUrl,
  getWorkingConnectionUrl: () => PG_CONN,
  getPrimaryConnectionUrl: () => PG_CONN
};