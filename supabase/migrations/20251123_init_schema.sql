-- Initial schema for employee attendance system
-- Tables required for local development with Supabase

-- Roles table
CREATE TABLE IF NOT EXISTS public.roles (
    role_id SERIAL PRIMARY KEY,
    role_name VARCHAR(50) NOT NULL UNIQUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- Users table
CREATE TABLE IF NOT EXISTS public.users (
    user_id SERIAL PRIMARY KEY,
    username VARCHAR(255) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    role_id INTEGER REFERENCES public.roles(role_id),
    status VARCHAR(50) DEFAULT 'active',
    first_login BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- Departments table
CREATE TABLE IF NOT EXISTS public.departments (
    dept_id SERIAL PRIMARY KEY,
    dept_name VARCHAR(255) NOT NULL UNIQUE,
    description TEXT,
    head_id INTEGER REFERENCES public.users(user_id),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- Employees table
CREATE TABLE IF NOT EXISTS public.employees (
    employee_id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES public.users(user_id),
    dept_id INTEGER REFERENCES public.departments(dept_id),
    first_name VARCHAR(255),
    last_name VARCHAR(255),
    email VARCHAR(255),
    phone VARCHAR(20),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- Attendance table
CREATE TABLE IF NOT EXISTS public.attendance (
    attendance_id SERIAL PRIMARY KEY,
    employee_id INTEGER REFERENCES public.employees(employee_id),
    date DATE NOT NULL,
    time_in TIME,
    time_out TIME,
    method VARCHAR(50),
    status VARCHAR(50) DEFAULT 'present',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- QR Sessions table
CREATE TABLE IF NOT EXISTS public.qr_sessions (
    session_id VARCHAR(255) PRIMARY KEY,
    created_by INTEGER REFERENCES public.users(user_id),
    session_type VARCHAR(50),
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
    expires_at TIMESTAMP WITH TIME ZONE
);

-- System settings table
CREATE TABLE IF NOT EXISTS public.system_settings (
    setting_id SERIAL PRIMARY KEY,
    setting_key VARCHAR(255) NOT NULL UNIQUE,
    setting_value TEXT,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- Invitations table
CREATE TABLE IF NOT EXISTS public.invitations (
    invitation_id SERIAL PRIMARY KEY,
    email VARCHAR(255) NOT NULL,
    token VARCHAR(255) NOT NULL UNIQUE,
    role_id INTEGER REFERENCES public.roles(role_id),
    status VARCHAR(50) DEFAULT 'pending',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
    expires_at TIMESTAMP WITH TIME ZONE
);

-- Refresh tokens table
CREATE TABLE IF NOT EXISTS public.refresh_tokens (
    token_id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES public.users(user_id),
    token_hash VARCHAR(255) NOT NULL UNIQUE,
    session_id VARCHAR(255),
    expires_at TIMESTAMP WITH TIME ZONE,
    revoked BOOLEAN DEFAULT false,
    revoked_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- User sessions table
CREATE TABLE IF NOT EXISTS public.user_sessions (
    session_id VARCHAR(255) PRIMARY KEY,
    user_id INTEGER REFERENCES public.users(user_id),
    login_time TIMESTAMP WITH TIME ZONE DEFAULT now(),
    logout_time TIMESTAMP WITH TIME ZONE
);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_attendance_employee_date ON public.attendance(employee_id, date);
CREATE INDEX IF NOT EXISTS idx_users_username ON public.users(username);
CREATE INDEX IF NOT EXISTS idx_invitations_email ON public.invitations(email);
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_user ON public.refresh_tokens(user_id);

-- Insert default roles
INSERT INTO public.roles (role_name) VALUES 
    ('superadmin'),
    ('hr'),
    ('head_dept'),
    ('employee'),
    ('display')
ON CONFLICT (role_name) DO NOTHING;

-- Insert default system settings
INSERT INTO public.system_settings (setting_key, setting_value) VALUES 
    ('system_name', 'Employee Attendance System'),
    ('version', '1.0.0'),
    ('maintenance_mode', 'false')
ON CONFLICT (setting_key) DO NOTHING;

-- ========== RPC FUNCTIONS ==========

-- Auth login RPC - Creates user session and returns session_id
CREATE OR REPLACE FUNCTION auth_login(
    p_email VARCHAR,
    p_password_hash VARCHAR,
    p_ip_address INET DEFAULT NULL,
    p_device_info JSONB DEFAULT NULL
)
RETURNS JSONB AS $$
DECLARE
    v_user_id INTEGER;
    v_username VARCHAR;
    v_password_hash_stored VARCHAR;
    v_role_id INTEGER;
    v_role_name VARCHAR;
    v_status VARCHAR;
    v_employee_id INTEGER;
    v_session_id VARCHAR;
BEGIN
    -- Find user by email
    SELECT u.user_id, u.username, u.password_hash, u.role_id, u.status
    INTO v_user_id, v_username, v_password_hash_stored, v_role_id, v_status
    FROM public.users u
    WHERE u.username = p_email;
    
    -- User not found
    IF v_user_id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'User not found');
    END IF;
    
    -- User not active
    IF v_status NOT IN ('active', 'pending') THEN
        RETURN jsonb_build_object('success', false, 'error', 'User account not active');
    END IF;
    
    -- Get role name
    SELECT role_name INTO v_role_name FROM public.roles WHERE role_id = v_role_id;
    
    -- Get employee_id if employee exists
    SELECT employee_id INTO v_employee_id FROM public.employees WHERE user_id = v_user_id;
    
    -- Create new session
    v_session_id := gen_random_uuid()::VARCHAR;
    INSERT INTO public.user_sessions (session_id, user_id) VALUES (v_session_id, v_user_id);
    
    -- Return success with user data
    RETURN jsonb_build_object(
        'success', true,
        'session_id', v_session_id,
        'user', jsonb_build_object(
            'user_id', v_user_id,
            'username', v_username,
            'role_id', v_role_id,
            'role_name', v_role_name,
            'status', v_status,
            'employee_id', v_employee_id
        )
    );
END;
$$ LANGUAGE plpgsql;

-- Logout RPC - Marks session as logged out
CREATE OR REPLACE FUNCTION auth_logout(p_session_id VARCHAR)
RETURNS JSONB AS $$
BEGIN
    UPDATE public.user_sessions
    SET logout_time = now()
    WHERE session_id = p_session_id;
    
    RETURN jsonb_build_object('success', true, 'message', 'Session logged out');
END;
$$ LANGUAGE plpgsql;

-- Attendance checkin RPC - Records check-in with QR session
CREATE OR REPLACE FUNCTION attendance_checkin(
    p_employee_id INTEGER,
    p_session_id VARCHAR,
    p_ip_address INET DEFAULT NULL,
    p_location TEXT DEFAULT NULL
)
RETURNS JSONB AS $$
DECLARE
    v_attendance_id INTEGER;
    v_today DATE;
BEGIN
    v_today := CURRENT_DATE;
    
    -- Check if already checked in today
    SELECT attendance_id INTO v_attendance_id
    FROM public.attendance
    WHERE employee_id = p_employee_id AND date = v_today AND time_in IS NOT NULL;
    
    IF v_attendance_id IS NOT NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'Already checked in today');
    END IF;
    
    -- Insert or update attendance record
    INSERT INTO public.attendance (employee_id, date, time_in, checkin_session_id, ip_address, location, status, method)
    VALUES (p_employee_id, v_today, CURRENT_TIME, p_session_id, p_ip_address, p_location, 'present', 'qr')
    ON CONFLICT (employee_id, date) DO UPDATE
    SET time_in = CURRENT_TIME, checkin_session_id = p_session_id, ip_address = p_ip_address, location = p_location, method = 'qr'
    RETURNING attendance_id INTO v_attendance_id;
    
    RETURN jsonb_build_object('success', true, 'attendance_id', v_attendance_id, 'message', 'Check-in recorded');
END;
$$ LANGUAGE plpgsql;

-- Attendance checkout RPC - Records check-out with QR session
CREATE OR REPLACE FUNCTION attendance_checkout(
    p_employee_id INTEGER,
    p_session_id VARCHAR,
    p_ip_address INET DEFAULT NULL
)
RETURNS JSONB AS $$
DECLARE
    v_attendance_id INTEGER;
    v_today DATE;
BEGIN
    v_today := CURRENT_DATE;
    
    -- Find today's attendance record
    SELECT attendance_id INTO v_attendance_id
    FROM public.attendance
    WHERE employee_id = p_employee_id AND date = v_today;
    
    IF v_attendance_id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'No check-in record found for today');
    END IF;
    
    -- Update with check-out time
    UPDATE public.attendance
    SET time_out = CURRENT_TIME, checkout_session_id = p_session_id, ip_address = p_ip_address
    WHERE attendance_id = v_attendance_id;
    
    RETURN jsonb_build_object('success', true, 'attendance_id', v_attendance_id, 'message', 'Check-out recorded');
END;
$$ LANGUAGE plpgsql;

-- Get QR session RPC - Retrieves QR session details
CREATE OR REPLACE FUNCTION get_qr_session(p_session_id VARCHAR)
RETURNS JSONB AS $$
DECLARE
    v_session RECORD;
BEGIN
    SELECT * INTO v_session FROM public.qr_sessions WHERE session_id = p_session_id;
    
    IF v_session IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'Session not found');
    END IF;
    
    RETURN jsonb_build_object(
        'success', true,
        'session', jsonb_build_object(
            'session_id', v_session.session_id,
            'is_active', v_session.is_active,
            'expires_at', v_session.expires_at,
            'created_at', v_session.created_at
        )
    );
END;
$$ LANGUAGE plpgsql;

-- Revoke QR session RPC - Marks QR session as inactive
CREATE OR REPLACE FUNCTION revoke_qr_session(p_session_id VARCHAR)
RETURNS JSONB AS $$
BEGIN
    UPDATE public.qr_sessions
    SET is_active = false
    WHERE session_id = p_session_id;
    
    RETURN jsonb_build_object('success', true, 'message', 'Session revoked');
END;
$$ LANGUAGE plpgsql;

