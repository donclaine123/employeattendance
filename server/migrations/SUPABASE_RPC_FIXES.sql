-- ============================================================
-- SUPABASE RPC FUNCTION FIXES
-- ============================================================
-- Run these queries in Supabase SQL Editor to fix the column name issues
-- The RPC functions are trying to use 'session_id' which has been renamed to 'checkin_session_id'
-- Error: "Could not find the 'session_id' column of 'attendance' in the schema cache"

-- Date: 2025-10-21
-- Issue: RPC functions reference old column name 'session_id'
-- Solution: Update to use 'checkin_session_id' and 'checkout_session_id'

-- ============================================================
-- FIX 1: attendance_checkin RPC Function
-- ============================================================
-- This function is called when an employee checks in with QR code
-- It should update the attendance record with:
--   - checkin_session_id (renamed from old session_id)
--   - time_in
--   - status
--   - method

-- First, drop the existing function (it has a different return type)
DROP FUNCTION IF EXISTS attendance_checkin(text, text, text);

CREATE OR REPLACE FUNCTION attendance_checkin(
    p_employee_identifier TEXT,
    p_method TEXT DEFAULT 'manual',
    p_status TEXT DEFAULT 'present'
)
RETURNS JSON AS $$
DECLARE
    v_employee_id INT;
    v_result RECORD;
BEGIN
    -- Parse employee ID (could be numeric or string)
    v_employee_id := CASE 
        WHEN p_employee_identifier ~ '^\d+$' THEN p_employee_identifier::INT
        ELSE p_employee_identifier::INT
    END;
    
    -- Update or create today's attendance record with checkin_session_id
    INSERT INTO attendance (employee_id, date, time_in, method, status, checkin_session_id)
    VALUES (
        v_employee_id,
        CURRENT_DATE,
        CURRENT_TIME,
        p_method,
        p_status,
        gen_random_uuid()::TEXT -- Generate session ID for check-in
    )
    ON CONFLICT (employee_id, date) DO UPDATE SET
        time_in = CURRENT_TIME,
        method = p_method,
        status = p_status,
        checkin_session_id = gen_random_uuid()::TEXT  -- CHANGED: Use checkin_session_id
    RETURNING * INTO v_result;
    
    RETURN JSON_BUILD_OBJECT('success', TRUE, 'data', row_to_json(v_result));
EXCEPTION WHEN OTHERS THEN
    RETURN JSON_BUILD_OBJECT('success', FALSE, 'error', SQLERRM);
END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- FIX 2: attendance_checkout RPC Function
-- ============================================================
-- This function is called when an employee checks out with QR code
-- It should update the attendance record with:
--   - checkout_session_id (NEW column - for check-out session tracking)
--   - time_out

-- First, drop the existing function
DROP FUNCTION IF EXISTS attendance_checkout(text);

CREATE OR REPLACE FUNCTION attendance_checkout(
    p_employee_identifier TEXT
)
RETURNS JSON AS $$
DECLARE
    v_employee_id INT;
    v_result RECORD;
BEGIN
    -- Parse employee ID (could be numeric or string)
    v_employee_id := CASE 
        WHEN p_employee_identifier ~ '^\d+$' THEN p_employee_identifier::INT
        ELSE p_employee_identifier::INT
    END;
    
    -- Update today's attendance record with checkout_session_id and time_out
    UPDATE attendance 
    SET 
        time_out = CURRENT_TIME,
        checkout_session_id = gen_random_uuid()::TEXT  -- CHANGED: Use NEW column checkout_session_id
    WHERE employee_id = v_employee_id 
      AND date = CURRENT_DATE
    RETURNING * INTO v_result;
    
    IF v_result IS NULL THEN
        RETURN JSON_BUILD_OBJECT('success', FALSE, 'error', 'No attendance record found for today');
    END IF;
    
    RETURN JSON_BUILD_OBJECT('success', TRUE, 'data', row_to_json(v_result));
EXCEPTION WHEN OTHERS THEN
    RETURN JSON_BUILD_OBJECT('success', FALSE, 'error', SQLERRM);
END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- VERIFICATION: Run these queries to test the changes
-- ============================================================

-- 1. Check that functions exist and are using correct columns
SELECT 
    p.proname AS function_name,
    pg_get_functiondef(p.oid) AS function_definition
FROM pg_proc p
WHERE p.proname IN ('attendance_checkin', 'attendance_checkout');

-- 2. Test the function (optional - if you want to verify it works)
-- SELECT attendance_checkin('test_employee_id', 'qr', 'present');

-- 3. Check today's attendance records to see if columns are populated
SELECT 
    attendance_id,
    employee_id,
    date,
    checkin_session_id,
    checkout_session_id,
    time_in,
    time_out,
    method,
    status
FROM attendance
WHERE date = CURRENT_DATE
ORDER BY created_at DESC
LIMIT 10;

-- ============================================================
-- IMPORTANT NOTES
-- ============================================================
-- 1. After running these fixes, the RPC functions will:
--    - attendance_checkin: Record check-in in checkin_session_id
--    - attendance_checkout: Record check-out in checkout_session_id
--
-- 2. Old attendance records:
--    - Still have checkin_session_id populated (migrated from session_id)
--    - checkout_session_id will be NULL (expected - they didn't have check-out)
--
-- 3. New attendance records:
--    - Will have both checkin_session_id and checkout_session_id
--
-- 4. The error "Could not find 'session_id' column" will be fixed
--
-- 5. Today's scans will now count both check-ins and check-outs correctly
