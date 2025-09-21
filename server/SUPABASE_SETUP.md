-- Instructions for setting up Supabase database
-- Run this script in Supabase SQL Editor or via psql

-- This is your schema.sql content that should be executed in Supabase
-- Go to your Supabase project → SQL Editor → New Query
-- Copy the entire content of schema.sql file and paste it there
-- Click "Run" to execute

-- Alternative: Use psql command line
-- psql "postgresql://postgres:[PASSWORD]@db.[PROJECT-REF].supabase.co:5432/postgres" -f schema.sql

-- After running schema, you should see these tables created:
-- 1. roles
-- 2. users  
-- 3. employees
-- 4. departments
-- 5. attendance
-- 6. qr_sessions
-- 7. requests
-- 8. notifications
-- 9. user_sessions

-- The schema includes:
-- ✅ Extensions (pgcrypto, uuid-ossp)
-- ✅ All required tables with proper relationships
-- ✅ Triggers for updated_at timestamps
-- ✅ Sample data for roles and users
-- ✅ Indexes for performance