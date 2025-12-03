#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

(async () => {
  const client = new Client({
    connectionString: process.env.DATABASE_URL || 'postgresql://workline:secret@localhost:5432/workline',
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
  });
  
  try {
    await client.connect();
    console.log('Connected to database');
    
    const sqlPath = path.resolve(__dirname, 'postgres', 'add_scheduling_tables.sql');
    const sql = fs.readFileSync(sqlPath, 'utf8');
    
    console.log('Applying scheduling tables from', sqlPath);
    await client.query(sql);
    console.log('Scheduling tables applied successfully');
    
  } catch (err) {
    console.error('Failed to apply scheduling tables:', err.message || err);
    process.exitCode = 1;
  } finally {
    await client.end();
  }
})();
