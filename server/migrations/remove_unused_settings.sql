-- ============================================================================
-- MIGRATION: Remove Unused Settings (Session Timeout & QR Validity Only)
-- ============================================================================
-- Date: 2025-11-08
-- Correction Date: 2025-11-08
-- Purpose: Clean up system settings that are not used or implemented
-- 
-- NOTE: QR AUTOMATION WAS PREVIOUSLY THOUGHT UNUSED - IT IS FULLY IMPLEMENTED
--       See generateQRAutomatically() in server.js for full implementation
--
-- REMOVED SETTINGS (2 only):
-- 1. session_timeout_minutes - HARDCODED to 6 hours in cookieConfig.js, not configurable
-- 2. qr_validity_hours - NOT USED, no QR expiry validation implemented
--
-- KEPT SETTINGS (6 QR automation + 2 security):
-- 1. qr_auto_generate_enabled - CONTROLS auto-generation scheduler (ACTIVE)
-- 2. qr_auto_interval_seconds - SETS generation interval (ACTIVE)
-- 3. qr_session_schedule_start - ENFORCED in generateQRAutomatically() (ACTIVE)
-- 4. qr_session_schedule_end - ENFORCED in generateQRAutomatically() (ACTIVE)
-- 5. qr_active_days - ENFORCED in generateQRAutomatically() (ACTIVE)
-- 6. qr_allow_hr_pause - ENFORCED in pause/resume endpoints (ACTIVE)
-- 7. geolocation_restriction_enabled - Future security feature
-- 8. ip_restriction_enabled - Future security feature
--
-- ============================================================================

BEGIN;

-- Step 1: Delete unused session timeout setting
-- (Session timeout is hardcoded to 6 hours, cannot be changed)
DELETE FROM public.system_settings 
WHERE setting_key = 'session_timeout_minutes';

-- Step 2: Delete unused QR validity setting
-- (No code validates QR expiry based on this setting)
DELETE FROM public.system_settings 
WHERE setting_key = 'qr_validity_hours';

-- Step 3: Verify remaining settings are correct
-- (QR automation settings should still be there!)
SELECT setting_key, setting_value, description, updated_at 
FROM public.system_settings
ORDER BY setting_key;

COMMIT;


-- ============================================================================
-- ROLLBACK SCRIPT (if needed)
-- ============================================================================
-- If you need to restore the settings, use this:
/*
INSERT INTO public.system_settings (setting_key, setting_value, description) VALUES
  ('session_timeout_minutes', '15', 'Minutes before auto-logout'),
  ('qr_validity_hours', '24', 'Hours for QR code expiration');
*/
