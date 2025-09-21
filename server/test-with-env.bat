@echo off
REM Set your Supabase connection string and test
REM Replace with your actual connection string from Supabase Dashboard

set DATABASE_URL=postgresql://postgres:CuK7buYUzo8HKLD0@db.nwwnwffsvnajeqkfpgpn.supabase.co:5432/postgres

echo Testing with environment variable...
node test-supabase-connection.js

pause