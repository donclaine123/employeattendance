-- ============================================================
-- OPTIONAL FIX: Remove Foreign Key on checkout_session_id
-- ============================================================
-- This allows checkout_session_id to be any value (or NULL)
-- without requiring it to reference an actual QR session

-- Current issue: FK constraint prevents checking out without a valid QR session
-- This fix removes that constraint since:
-- 1. Checkouts happen manually in most cases
-- 2. checkout_session_id is optional for legacy support

-- IF YOU WANT TO REMOVE THE FK CONSTRAINT:
ALTER TABLE public.attendance
DROP CONSTRAINT attendance_checkout_session_id_fkey;

-- Now checkout_session_id can be NULL or any value
-- When QR checkouts are implemented later, you can set it manually
