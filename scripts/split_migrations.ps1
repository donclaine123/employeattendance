$migrationsDir = "d:\THESIS 1\employeattendance\supabase\migrations"

# 1. Delete the problematic large file
$oldFile = Join-Path $migrationsDir "20250125000001_add_all_rpcs.sql"
if (Test-Path $oldFile) {
    Remove-Item $oldFile
    Write-Host "Removed old migration file: $oldFile" -ForegroundColor Yellow
}

# 2. Define all the new files and their content
$files = @{}

$files["20250125000010_rpc_attendance_break.sql"] = @'
CREATE OR REPLACE FUNCTION public.attendance_break(p_employee_identifier text, p_action text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
    v_employee_id integer;
    v_attendance_record record;
    v_today date := CURRENT_DATE;
    v_now timestamp := NOW();
    v_break_minutes integer;
BEGIN
    IF p_action NOT IN ('in', 'out') THEN
        RETURN jsonb_build_object('success', false, 'error', 'Invalid action. Use "in" or "out"');
    END IF;
    
    IF p_employee_identifier ~ '^\d+$' THEN
        v_employee_id := p_employee_identifier::integer;
    ELSE
        SELECT user_id INTO v_employee_id
        FROM users 
        WHERE lower(username) = lower(p_employee_identifier)
        LIMIT 1;
    END IF;
    
    IF v_employee_id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'Employee not found');
    END IF;
    
    SELECT * INTO v_attendance_record
    FROM attendance 
    WHERE employee_id = v_employee_id AND date = v_today;
    
    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'No attendance record found for today');
    END IF;
    
    IF p_action = 'in' THEN
        UPDATE attendance 
        SET break_start = v_now, break_end = NULL
        WHERE attendance_id = v_attendance_record.attendance_id
        RETURNING * INTO v_attendance_record;
    ELSE 
        IF v_attendance_record.break_start IS NULL THEN
            RETURN jsonb_build_object('success', false, 'error', 'Break not started');
        END IF;
        
        v_break_minutes := GREATEST(0, ROUND(EXTRACT(EPOCH FROM (v_now - v_attendance_record.break_start)) / 60));
        
        UPDATE attendance 
        SET break_end = v_now, 
            break_minutes = COALESCE(break_minutes, 0) + v_break_minutes
        WHERE attendance_id = v_attendance_record.attendance_id
        RETURNING * INTO v_attendance_record;
    END IF;
    
    RETURN jsonb_build_object(
        'success', true,
        'attendance', jsonb_build_object(
            'attendance_id', v_attendance_record.attendance_id,
            'employee_id', v_attendance_record.employee_id,
            'date', v_attendance_record.date,
            'time_in', v_attendance_record.time_in,
            'time_out', v_attendance_record.time_out,
            'break_minutes', v_attendance_record.break_minutes,
            'status', v_attendance_record.status
        )
    );
END;
$function$;
'@

$files["20250125000011_rpc_attendance_checkin.sql"] = @'
CREATE OR REPLACE FUNCTION public.attendance_checkin(p_employee_identifier text, p_method text DEFAULT 'manual'::text, p_status text DEFAULT 'present'::text)
 RETURNS json
 LANGUAGE plpgsql
AS $function$
DECLARE
    v_employee_id INT;
    v_result RECORD;
BEGIN
    v_employee_id := p_employee_identifier::INT;
    
    INSERT INTO attendance (employee_id, date, time_in, method, status, checkin_session_id)
    VALUES (
        v_employee_id,
        CURRENT_DATE,
        CURRENT_TIME,
        p_method,
        p_status,
        gen_random_uuid()::TEXT
    )
    ON CONFLICT (employee_id, date) DO UPDATE SET
        time_in = CURRENT_TIME,
        method = p_method,
        status = p_status,
        checkin_session_id = gen_random_uuid()::TEXT
    RETURNING * INTO v_result;
    
    RETURN JSON_BUILD_OBJECT('success', TRUE, 'data', row_to_json(v_result));
EXCEPTION WHEN OTHERS THEN
    RETURN JSON_BUILD_OBJECT('success', FALSE, 'error', SQLERRM);
END;
$function$;
'@

$files["20250125000012_rpc_auth_change_first_password.sql"] = @'
CREATE OR REPLACE FUNCTION public.auth_change_first_password(p_user_id integer, p_new_password_hash text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
    v_user record;
BEGIN
    SELECT user_id, COALESCE(first_login, false) as first_login
    INTO v_user
    FROM users 
    WHERE user_id = p_user_id;
    
    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'User not found');
    END IF;
    
    IF NOT v_user.first_login THEN
        RETURN jsonb_build_object('success', false, 'error', 'Password change not required');
    END IF;
    
    UPDATE users 
    SET password_hash = p_new_password_hash, 
        first_login = false,
        status = CASE WHEN status = 'pending' THEN 'active' ELSE status END,
        updated_at = NOW()
    WHERE user_id = p_user_id;
    
    UPDATE employees 
    SET status = 'active',
        updated_at = NOW()
    WHERE employee_id = p_user_id AND status = 'pending';
    
    RETURN jsonb_build_object('success', true, 'message', 'Password changed successfully');
END;
$function$;
'@

$files["20250125000013_rpc_auth_login.sql"] = @'
CREATE OR REPLACE FUNCTION public.auth_login(p_email text, p_password_hash text, p_ip_address text, p_device_info jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
    v_user record;
    v_employee record;
    v_session_id uuid;
    v_result jsonb;
BEGIN
    SELECT u.user_id, u.username, u.password_hash, u.role_id, r.role_name, u.status, 
           COALESCE(u.first_login, false) as first_login
    INTO v_user
    FROM users u
    JOIN roles r ON r.role_id = u.role_id
    WHERE lower(u.username) = lower(p_email)
    LIMIT 1;
    
    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'User not found');
    END IF;
    
    IF v_user.status NOT IN ('active', 'pending') THEN
        RETURN jsonb_build_object('success', false, 'error', 'User account is not active');
    END IF;
    
    UPDATE user_sessions 
    SET logout_time = NOW() 
    WHERE user_id = v_user.user_id AND logout_time IS NULL;
    
    SELECT employee_id INTO v_employee
    FROM employees 
    WHERE employee_id = v_user.user_id;
    
    v_session_id := gen_random_uuid();
    INSERT INTO user_sessions (session_id, user_id, ip_address, device_info)
    VALUES (v_session_id, v_user.user_id, 
            CASE 
                WHEN p_ip_address IS NOT NULL AND p_ip_address != '' 
                THEN p_ip_address::inet 
                ELSE NULL 
            END, 
            p_device_info);
    
    v_result := jsonb_build_object(
        'success', true,
        'user', jsonb_build_object(
            'user_id', v_user.user_id,
            'username', v_user.username,
            'role_name', v_user.role_name,
            'role_id', v_user.role_id,
            'status', v_user.status,
            'first_login', v_user.first_login,
            'employee_id', CASE WHEN v_employee.employee_id IS NOT NULL THEN v_employee.employee_id ELSE null END
        ),
        'session_id', v_session_id
    );
    
    RETURN v_result;
END;
$function$;
'@

$files["20250125000014_rpc_auth_logout.sql"] = @'
CREATE OR REPLACE FUNCTION public.auth_logout(p_session_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
    v_rows_affected integer;
BEGIN
    UPDATE user_sessions 
    SET logout_time = NOW() 
    WHERE session_id = p_session_id AND logout_time IS NULL;
    
    GET DIAGNOSTICS v_rows_affected = ROW_COUNT;
    
    IF v_rows_affected > 0 THEN
        RETURN jsonb_build_object('success', true, 'message', 'Logged out successfully');
    ELSE
        RETURN jsonb_build_object('success', false, 'error', 'Session not found or already logged out');
    END IF;
END;
$function$;
'@

$files["20250125000015_rpc_bulk_create_schedules.sql"] = @'
CREATE OR REPLACE FUNCTION public.bulk_create_schedules(p_schedules jsonb)
 RETURNS TABLE(inserted_count integer, error_message text)
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_schedule JSONB;
  v_count INTEGER := 0;
BEGIN
  FOR v_schedule IN SELECT * FROM jsonb_array_elements(p_schedules)
  LOOP
    INSERT INTO public.schedules (
      employee_id, dept_id, schedule_date, shift_type, shift_start_time, shift_end_time, notes, created_by
    )
    VALUES (
      (v_schedule->>'employee_id')::INTEGER, (v_schedule->>'dept_id')::INTEGER, (v_schedule->>'schedule_date')::DATE,
      v_schedule->>'shift_type', (v_schedule->>'shift_start_time')::TIME, (v_schedule->>'shift_end_time')::TIME,
      v_schedule->>'notes', (v_schedule->>'created_by')::INTEGER
    )
    ON CONFLICT (employee_id, schedule_date) 
    DO UPDATE SET
      shift_type = EXCLUDED.shift_type,
      shift_start_time = EXCLUDED.shift_start_time,
      shift_end_time = EXCLUDED.shift_end_time,
      notes = EXCLUDED.notes,
      updated_by = EXCLUDED.created_by,
      updated_at = NOW();
    
    v_count := v_count + 1;
  END LOOP;
  RETURN QUERY SELECT v_count, NULL::TEXT;
EXCEPTION WHEN OTHERS THEN
  RETURN QUERY SELECT 0, SQLERRM;
END;
$function$;
'@

$files["20250125000016_rpc_cleanup_expired_sessions.sql"] = @'
CREATE OR REPLACE FUNCTION public.cleanup_expired_sessions()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
BEGIN
  DELETE FROM "session" WHERE "expire" < NOW();
END;
$function$;
'@

$files["20250125000017_rpc_copy_schedules_by_week.sql"] = @'
CREATE OR REPLACE FUNCTION public.copy_schedules_by_week(p_source_start_date date, p_target_start_date date, p_dept_id integer, p_created_by integer)
 RETURNS TABLE(copied_count integer, error_message text)
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_count INTEGER := 0;
BEGIN
  INSERT INTO public.schedules (
    employee_id, dept_id, schedule_date, shift_type, shift_start_time, shift_end_time, notes, created_by
  )
  SELECT 
    employee_id, dept_id, p_target_start_date + (schedule_date - p_source_start_date),
    shift_type, shift_start_time, shift_end_time, 'Copied from ' || schedule_date::TEXT, p_created_by
  FROM public.schedules
  WHERE schedule_date >= p_source_start_date
    AND schedule_date < p_source_start_date + INTERVAL '7 days'
    AND dept_id = p_dept_id
  ON CONFLICT (employee_id, schedule_date) DO NOTHING;
  
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN QUERY SELECT v_count, NULL::TEXT;
EXCEPTION WHEN OTHERS THEN
  RETURN QUERY SELECT 0, SQLERRM;
END;
$function$;
'@

$files["20250125000018_rpc_generate_qr_session_atomic.sql"] = @'
CREATE OR REPLACE FUNCTION public.generate_qr_session_atomic(p_session_id text, p_expires_at timestamp with time zone, p_session_type text DEFAULT 'rotating'::text, p_server_id text DEFAULT 'primary'::text)
 RETURNS json
 LANGUAGE plpgsql
AS $function$
DECLARE
    v_created_at timestamp with time zone;
    v_expires_at_manila timestamp with time zone;
    v_result json;
BEGIN
    v_created_at := NOW() AT TIME ZONE 'Asia/Manila';
    v_expires_at_manila := p_expires_at AT TIME ZONE 'Asia/Manila';
    
    UPDATE qr_sessions SET is_active = false WHERE is_active = true;
    
    INSERT INTO qr_sessions (
        session_id, session_type, is_active, created_at, expires_at, server_id
    ) VALUES (
        p_session_id, p_session_type, true, v_created_at, v_expires_at_manila, p_server_id
    );

    SELECT json_build_object(
        'session_id', session_id, 'expires_at', expires_at, 'issued_at', created_at,
        'session_type', session_type, 'is_active', is_active, 'server_id', server_id
    ) INTO v_result
    FROM qr_sessions WHERE session_id = p_session_id;
    
    RETURN v_result;
END;
$function$;
'@

$files["20250125000019_rpc_get_schedules_by_date_range.sql"] = @'
CREATE OR REPLACE FUNCTION public.get_schedules_by_date_range(p_start_date date, p_end_date date, p_dept_id integer DEFAULT NULL::integer, p_employee_id integer DEFAULT NULL::integer)
 RETURNS TABLE(schedule_id integer, employee_id integer, employee_name text, dept_id integer, dept_name text, schedule_date date, shift_type character varying, shift_type_id integer, shift_name character varying, shift_start_time time without time zone, shift_end_time time without time zone, color_code character varying, duration_hours numeric, notes text, created_by integer, created_at timestamp with time zone)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  RETURN QUERY
  SELECT 
    s.schedule_id, s.employee_id, e.full_name, s.dept_id, d.dept_name,
    s.schedule_date, s.shift_type, st.shift_type_id, st.shift_name,
    s.shift_start_time, s.shift_end_time, st.color_code,
    (st.duration_minutes::NUMERIC / 60.0), s.notes, s.created_by, s.created_at
  FROM public.schedules s
  JOIN public.employees e ON s.employee_id = e.employee_id
  JOIN public.departments d ON s.dept_id = d.dept_id
  LEFT JOIN public.shift_types st ON s.shift_type = st.shift_name
  WHERE s.schedule_date >= p_start_date AND s.schedule_date <= p_end_date
    AND (p_dept_id IS NULL OR s.dept_id = p_dept_id)
    AND (p_employee_id IS NULL OR s.employee_id = p_employee_id)
  ORDER BY s.schedule_date, e.full_name;
END;
$function$;
'@

$files["20250125000020_rpc_profile_update.sql"] = @'
CREATE OR REPLACE FUNCTION public.profile_update(p_user_id integer, p_first_name text, p_last_name text, p_phone text DEFAULT NULL::text, p_address text DEFAULT NULL::text, p_position text DEFAULT NULL::text, p_dept_id integer DEFAULT NULL::integer, p_hire_date date DEFAULT NULL::date, p_user_role text DEFAULT 'employee'::text, p_password_hash text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
    v_current_data record;
    v_updated_record record;
    v_changes jsonb := '{}';
BEGIN
    SELECT e.*, d.dept_name INTO v_current_data
    FROM employees e LEFT JOIN departments d ON e.dept_id = d.dept_id 
    WHERE e.employee_id = p_user_id;
    
    IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'error', 'Employee record not found'); END IF;
    
    IF p_password_hash IS NOT NULL THEN
        UPDATE users SET password_hash = p_password_hash WHERE user_id = p_user_id;
        v_changes := v_changes || jsonb_build_object('password', 'changed');
    END IF;
    
    UPDATE employees 
    SET first_name = p_first_name, last_name = p_last_name,
        phone = COALESCE(p_phone, phone), address = COALESCE(p_address, address),
        position = CASE WHEN p_user_role IN ('hr', 'superadmin') OR (p_user_role = 'head_dept' AND p_position IS NOT NULL) THEN COALESCE(p_position, position) ELSE position END,
        dept_id = CASE WHEN p_user_role IN ('hr', 'superadmin') AND p_dept_id IS NOT NULL THEN p_dept_id ELSE dept_id END,
        hire_date = CASE WHEN p_user_role IN ('hr', 'superadmin') AND p_hire_date IS NOT NULL THEN p_hire_date ELSE hire_date END
    WHERE employee_id = p_user_id
    RETURNING * INTO v_updated_record;
    
    IF v_current_data.first_name != v_updated_record.first_name THEN
        v_changes := v_changes || jsonb_build_object('first_name', jsonb_build_object('old', v_current_data.first_name, 'new', v_updated_record.first_name));
    END IF;
    IF v_current_data.last_name != v_updated_record.last_name THEN
        v_changes := v_changes || jsonb_build_object('last_name', jsonb_build_object('old', v_current_data.last_name, 'new', v_updated_record.last_name));
    END IF;
    IF COALESCE(v_current_data.phone, '') != COALESCE(v_updated_record.phone, '') THEN
        v_changes := v_changes || jsonb_build_object('phone', jsonb_build_object('old', v_current_data.phone, 'new', v_updated_record.phone));
    END IF;
    
    RETURN jsonb_build_object(
        'success', true,
        'employee', jsonb_build_object(
            'employee_id', v_updated_record.employee_id, 'first_name', v_updated_record.first_name, 'last_name', v_updated_record.last_name,
            'phone', v_updated_record.phone, 'address', v_updated_record.address, 'position', v_updated_record.position,
            'dept_id', v_updated_record.dept_id, 'hire_date', v_updated_record.hire_date
        ),
        'changes', v_changes
    );
END;
$function$;
'@

$files["20250125000021_rpc_qr_generate_session.sql"] = @'
CREATE OR REPLACE FUNCTION public.qr_generate_session(p_session_type text DEFAULT 'checkin'::text, p_expires_minutes integer DEFAULT 60)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
    v_session_id uuid;
    v_expires_at timestamp;
    v_qr_data text;
    v_session_record record;
BEGIN
    UPDATE qr_sessions SET is_active = false WHERE expires_at IS NOT NULL AND expires_at < NOW() AND is_active = true;
    
    v_session_id := gen_random_uuid();
    v_expires_at := NOW() + (p_expires_minutes || ' minutes')::interval;
    v_qr_data := jsonb_build_object('session_id', v_session_id, 'type', p_session_type, 'expires_at', v_expires_at)::text;
    
    INSERT INTO qr_sessions (session_id, session_type, qr_data, expires_at, is_active)
    VALUES (v_session_id, p_session_type, v_qr_data, v_expires_at, true)
    RETURNING * INTO v_session_record;
    
    RETURN jsonb_build_object(
        'success', true,
        'session', jsonb_build_object(
            'session_id', v_session_record.session_id, 'session_type', v_session_record.session_type,
            'qr_data', v_session_record.qr_data, 'expires_at', v_session_record.expires_at,
            'is_active', v_session_record.is_active
        )
    );
END;
$function$;
'@

$files["20250125000022_rpc_qr_revoke_session.sql"] = @'
CREATE OR REPLACE FUNCTION public.qr_revoke_session(p_session_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
    v_rows_affected integer;
BEGIN
    UPDATE qr_sessions SET is_active = false WHERE session_id = p_session_id AND is_active = true;
    GET DIAGNOSTICS v_rows_affected = ROW_COUNT;
    
    IF v_rows_affected > 0 THEN
        RETURN jsonb_build_object('success', true, 'message', 'QR session revoked successfully');
    ELSE
        RETURN jsonb_build_object('success', false, 'error', 'QR session not found or already inactive');
    END IF;
END;
$function$;
'@

$files["20250125000023_rpc_reset_qr_sessions_sequence_safe.sql"] = @'
CREATE OR REPLACE FUNCTION public.reset_qr_sessions_sequence_safe(start_value integer DEFAULT 1)
 RETURNS void
 LANGUAGE plpgsql
AS $function$
BEGIN
    EXECUTE 'ALTER SEQUENCE IF EXISTS qr_sessions_qr_id_seq RESTART WITH ' || start_value;
    RAISE NOTICE 'QR sessions sequence reset to %', start_value;
EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'Warning: Could not reset sequence: %', SQLERRM;
END;
$function$;
'@

$files["20250125000024_rpc_set_updated_at.sql"] = @'
CREATE OR REPLACE FUNCTION public.set_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$function$;
'@

$files["20250125000025_rpc_update_curriculum_templates_updated_at.sql"] = @'
CREATE OR REPLACE FUNCTION public.update_curriculum_templates_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  NEW.updated_at = CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$function$;
'@

$files["20250125000026_rpc_update_qr_automation_state_timestamp.sql"] = @'
CREATE OR REPLACE FUNCTION public.update_qr_automation_state_timestamp()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$function$;
'@

$files["20250125000027_rpc_update_schedules_updated_at.sql"] = @'
CREATE OR REPLACE FUNCTION public.update_schedules_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$function$;
'@

# 3. Create the files
$utf8NoBom = New-Object System.Text.UTF8Encoding $false
foreach ($name in $files.Keys) {
    echo "Creating $name"
    $path = Join-Path $migrationsDir $name
    $content = $files[$name]
    [System.IO.File]::WriteAllText($path, $content, $utf8NoBom)
    Write-Host "Created: $name" -ForegroundColor Green
}

Write-Host "Done! 18 separate migration files created." -ForegroundColor Cyan
