#!/usr/bin/env node
const { Client } = require('pg');
const bcrypt = require('bcryptjs');

const SALT_ROUNDS = parseInt(process.env.BCRYPT_ROUNDS || '10', 10);

(async () => {
  const client = new Client({
    connectionString: process.env.DATABASE_URL || 'postgresql://workline:secret@localhost:5432/workline'
  });
  await client.connect();
  try {
    // find users missing password_hash but having plaintext password
    const { rows } = await client.query("SELECT id, email, password FROM users WHERE (password IS NOT NULL AND password <> '') AND (password_hash IS NULL OR password_hash = '')");
    if (!rows.length) {
      console.log('No users found needing hashing.');
      return;
    }
    console.log(`Hashing ${rows.length} user password(s)...`);
    for (const u of rows) {
      const hash = await bcrypt.hash(u.password, SALT_ROUNDS);
      await client.query('UPDATE users SET password_hash=$1 WHERE id=$2', [hash, u.id]);
      console.log(`Updated user ${u.email}`);
    }
    console.log('Done.');
  } catch (err) {
    console.error('Hashing failed:', err.message || err);
    process.exitCode = 1;
  } finally {
    await client.end();
  }
})();
