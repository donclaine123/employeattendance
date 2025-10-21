-- Migration: Add checkout_session_id and rename session_id to checkin_session_id
-- Purpose: Track both check-in and check-out QR scans separately with consistent naming
-- Date: 2025-10-21

-- Step 1: Drop the existing foreign key constraint on session_id
ALTER TABLE public.attendance
DROP CONSTRAINT attendance_session_id_fkey;

-- Step 2: Rename session_id to checkin_session_id
ALTER TABLE public.attendance
RENAME COLUMN session_id TO checkin_session_id;

-- Step 3: Add foreign key constraint for checkin_session_id
ALTER TABLE public.attendance
ADD CONSTRAINT attendance_checkin_session_id_fkey 
FOREIGN KEY (checkin_session_id) REFERENCES public.qr_sessions(session_id);

-- Step 4: Add new column to track checkout session ID
ALTER TABLE public.attendance
ADD COLUMN checkout_session_id character varying;

-- Step 5: Add foreign key constraint for checkout_session_id
ALTER TABLE public.attendance
ADD CONSTRAINT attendance_checkout_session_id_fkey 
FOREIGN KEY (checkout_session_id) REFERENCES public.qr_sessions(session_id);

-- Step 6: Add comments to explain the columns
COMMENT ON COLUMN public.attendance.checkin_session_id IS 'QR session ID for check-in scan';
COMMENT ON COLUMN public.attendance.checkout_session_id IS 'QR session ID for check-out scan';

-- Step 7: Create indexes for faster queries
CREATE INDEX idx_attendance_checkin_session_id ON public.attendance(checkin_session_id);
CREATE INDEX idx_attendance_checkout_session_id ON public.attendance(checkout_session_id);
CREATE INDEX idx_attendance_session_date ON public.attendance(checkin_session_id, date);

