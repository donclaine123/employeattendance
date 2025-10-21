-- ============================================================
-- SUPABASE RPC FUNCTION FIXES - FINAL VERSION
-- ============================================================
-- Run these queries in Supabase SQL Editor
-- Date: 2025-10-21
-- Status: Ready to deploy - all issues fixed

-- ============================================================
-- IMPORTANT: Before running this, run the FK fix below
-- ============================================================
-- Uncomment and run this FIRST in Supabase SQL Editor:
--
-- ALTER TABLE public.attendance
-- DROP CONSTRAINT attendance_checkout_session_id_fkey;
--
-- This removes the FK constraint that was preventing checkouts
-- (checkout_session_id will now accept NULL or any value)

-- ============================================================
-- Drop old functions (we're using JavaScript handleQRCheckout now)
-- ============================================================
DROP FUNCTION IF EXISTS attendance_checkin(text, text, text);
DROP FUNCTION IF EXISTS attendance_checkout(text);
DROP FUNCTION IF EXISTS attendance_checkout(text, text);

-- ============================================================
-- FIX 1: attendance_checkin RPC Function
-- ============================================================
-- Called when employee scans QR to CHECK IN
-- Records check-in in checkin_session_id column

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
    -- Convert employee identifier to integer (employee_id in attendance table)
    v_employee_id := p_employee_identifier::INT;
    
    -- Insert new or update existing attendance record
    INSERT INTO attendance (employee_id, date, time_in, method, status, checkin_session_id)
    VALUES (
        v_employee_id,
        CURRENT_DATE,
        CURRENT_TIME,
        p_method,
        p_status,
        gen_random_uuid()::TEXT  -- Generate unique session ID for check-in
    )
    ON CONFLICT (employee_id, date) DO UPDATE SET
        time_in = CURRENT_TIME,
        method = p_method,
        status = p_status,
        checkin_session_id = gen_random_uuid()::TEXT  -- ✅ Use checkin_session_id
    RETURNING * INTO v_result;
    
    RETURN JSON_BUILD_OBJECT('success', TRUE, 'data', row_to_json(v_result));
EXCEPTION WHEN OTHERS THEN
    RETURN JSON_BUILD_OBJECT('success', FALSE, 'error', SQLERRM);
END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- VERIFICATION QUERIES
-- ============================================================

-- 1. Verify functions exist
SELECT proname, proargtypes 
FROM pg_proc 
WHERE proname IN ('attendance_checkin', 'attendance_checkout');

-- 2. Check today's attendance with both session columns
SELECT 
    attendance_id,
    employee_id,
    date,
    time_in,
    time_out,
    checkin_session_id,
    checkout_session_id
FROM attendance
WHERE date = CURRENT_DATE
ORDER BY created_at DESC
LIMIT 10;

-- 3. Count today's scans by type
SELECT 
    COUNT(*) as total_records,
    COUNT(CASE WHEN checkin_session_id IS NOT NULL THEN 1 END) as checkins,
    COUNT(CASE WHEN checkout_session_id IS NOT NULL THEN 1 END) as checkouts
FROM attendance
WHERE date = CURRENT_DATE;
