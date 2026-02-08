#!/usr/bin/env node

/**
 * Database Backup Script for Docker + Supabase
 * Exports PostgreSQL database from Supabase container to SQL file with timestamp
 */

// Try to load .env but don't require it
try {
  require('dotenv').config();
} catch (e) {
  // dotenv not installed, continue with environment variables
}

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// Create backups directory if it doesn't exist
const backupsDir = path.join(__dirname, '..', 'backups');
if (!fs.existsSync(backupsDir)) {
  fs.mkdirSync(backupsDir, { recursive: true });
}

// Create filename with timestamp
const timestamp = new Date().toISOString()
  .replace(/T/, '_')
  .replace(/:/g, '')
  .replace(/\..+$/, '');
const filename = `data_backup_${timestamp}.sql`;
const filepath = path.join(backupsDir, filename);

console.log(`[Backup] Starting database backup...`);
console.log(`[Backup] Destination: ${filepath}`);
console.log(`[Backup] Using Docker for backup...`);

const containerName = 'supabase_db_employeattendance';
const dbPassword = 'postgres';

try {
  // Check if Docker is available
  try {
    execSync('docker --version', { stdio: 'pipe' });
  } catch (e) {
    console.error(`[ERROR] Docker is not installed or not in PATH`);
    process.exit(1);
  }

  // Check if Supabase container is running
  console.log(`[Backup] Checking Supabase Docker container...`);
  try {
    const containerCheck = execSync(
      `docker ps --filter "name=${containerName}" --format "{{.Names}}"`,
      { encoding: 'utf8', stdio: 'pipe' }
    ).trim();

    if (!containerCheck) {
      throw new Error(`not found`);
    }
    console.log(`[Backup] Container found: ${containerCheck}`);
  } catch (e) {
    console.error(`[ERROR] Supabase Docker container '${containerName}' is not running`);
    console.log(`[ERROR] Please ensure Supabase is started with: supabase start`);
    process.exit(1);
  }

  // Run pg_dump inside Docker container and save to file
  console.log(`[Backup] Running pg_dump inside container...`);
  
  // Use docker exec with output redirection to avoid buffer issues
  execSync(
    `docker exec -e PGPASSWORD=${dbPassword} ${containerName} pg_dump -U postgres --column-inserts --data-only postgres > "${filepath}"`,
    { stdio: 'inherit', shell: true }
  );

  const stats = fs.statSync(filepath);
  const sizeMB = (stats.size / 1024 / 1024).toFixed(2);

  console.log(`\n[SUCCESS] Backup completed successfully!`);
  console.log(`File: ${filename}`);
  console.log(`Size: ${sizeMB} MB`);
  console.log(`Location: ${filepath}`);

} catch (error) {
  console.error(`\n[FAILED] Backup failed!`);
  console.error(`Error: ${error.message}`);
  process.exit(1);
}

