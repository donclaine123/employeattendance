-- SUPABASE RPC FUNCTION UPDATES
-- These functions need to be updated to use the new column names
-- Date: 2025-10-21

-- ============================================================
-- RPC 1: attendance_checkin
-- ============================================================
-- IMPORTANT: This function is called when employee scans QR to CHECK IN
-- It needs to set checkin_session_id instead of session_id

-- Find and update the attendance_checkin RPC function in Supabase
-- Look for the UPDATE statement that sets session_id
-- Change it to: checkin_session_id

-- Example of what to update:
-- OLD:
--   UPDATE attendance 
--   SET session_id = p_session_id, 
--       time_in = NOW()::time, ...
--   WHERE employee_id = p_employee_id AND date = CURRENT_DATE

-- NEW:
--   UPDATE attendance 
--   SET checkin_session_id = p_session_id,  -- CHANGED
--       time_in = NOW()::time, ...
--   WHERE employee_id = p_employee_id AND date = CURRENT_DATE


-- ============================================================
-- RPC 2: attendance_checkout
-- ============================================================
-- IMPORTANT: This function is called when employee scans QR to CHECK OUT
-- It needs to set checkout_session_id (the NEW column)

-- Find and update the attendance_checkout RPC function in Supabase
-- Look for the UPDATE statement that might be setting session_id
-- Change it to: checkout_session_id

-- Example of what to update:
-- OLD:
--   UPDATE attendance 
--   SET session_id = p_session_id, 
--       time_out = NOW()::time, ...
--   WHERE employee_id = p_employee_id AND date = CURRENT_DATE

-- NEW:
--   UPDATE attendance 
--   SET checkout_session_id = p_session_id,  -- CHANGED (NEW COLUMN)
--       time_out = NOW()::time, ...
--   WHERE employee_id = p_employee_id AND date = CURRENT_DATE


-- ============================================================
-- VERIFICATION QUERIES
-- ============================================================
-- Run these after updating the RPCs to verify everything works

-- Check if both session columns are being populated
SELECT 
    attendance_id,
    employee_id,
    date,
    checkin_session_id,
    checkout_session_id,
    time_in,
    time_out
FROM attendance
WHERE date = CURRENT_DATE
ORDER BY time_in DESC;


-- Count today's scans (both check-in and check-out)
SELECT 
    COUNT(*) as total_scans,
    COUNT(CASE WHEN checkin_session_id IS NOT NULL THEN 1 END) as checkins,
    COUNT(CASE WHEN checkout_session_id IS NOT NULL THEN 1 END) as checkouts
FROM attendance
WHERE date = CURRENT_DATE;


-- Find employees who checked in but haven't checked out yet
SELECT 
    employee_id,
    time_in,
    time_out,
    checkin_session_id,
    checkout_session_id
FROM attendance
WHERE date = CURRENT_DATE
  AND checkin_session_id IS NOT NULL
  AND checkout_session_id IS NULL
ORDER BY time_in DESC;

-- ============================================================
-- STEPS TO UPDATE RPC FUNCTIONS IN SUPABASE
-- ============================================================

-- 1. Go to your Supabase project dashboard
-- 2. Click on "SQL Editor" in the left sidebar
-- 3. Click "New Query"
-- 4. Find the attendance_checkin function:
--    - Either search for existing functions or use:
--      SELECT * FROM pg_proc WHERE proname LIKE 'attendance_checkin%';
-- 5. Look at the function definition and find where session_id is being set
-- 6. Change session_id to checkin_session_id
-- 7. Repeat for attendance_checkout function, setting checkout_session_id
-- 8. Test by scanning a QR code and verifying both columns are populated

-- ============================================================
-- NOTES
-- ============================================================
-- - If the RPC functions don't exist, create them based on your logic
-- - Both functions should be idempotent (safe to call multiple times)
-- - attendance_checkin should only set checkin_session_id
-- - attendance_checkout should only set checkout_session_id
-- - Do NOT overwrite one with the other
