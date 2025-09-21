#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

(async () => {
  const client = new Client({
    connectionString: process.env.DATABASE_URL || 'postgresql://workline:secret@localhost:5432/workline'
  });
  await client.connect();
  try {
    const sqlPath = path.resolve(__dirname, 'postgres', 'schema.sql');
    const sql = fs.readFileSync(sqlPath, 'utf8');
    console.log('Applying schema from', sqlPath);
    await client.query(sql);
    console.log('Schema applied successfully');
  } catch (err) {
    console.error('Schema apply failed:', err.message || err);
    process.exitCode = 1;
  } finally {
    await client.end();
  }
})();
