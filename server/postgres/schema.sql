-- Workline Postgres schema (9 tables) — DEV RESET
-- WARNING: This script DROPs and recreates tables to align with the proposed schema.
-- Use only on development environments, or backup first.

BEGIN;

-- Extensions (for bcrypt via crypt()/gen_salt and UUIDs if needed)
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Drop existing tables (order matters due to FKs)
DROP TABLE IF EXISTS notifications CASCADE;
DROP TABLE IF EXISTS user_sessions CASCADE;
DROP TABLE IF EXISTS qr_sessions CASCADE;
DROP TABLE IF EXISTS requests CASCADE;
-- legacy tables from earlier design
DROP TABLE IF EXISTS leave_requests CASCADE;
DROP TABLE IF EXISTS overtime_requests CASCADE;
DROP TABLE IF EXISTS correction_requests CASCADE;
DROP TABLE IF EXISTS attendance CASCADE;
DROP TABLE IF EXISTS employees CASCADE;
DROP TABLE IF EXISTS departments CASCADE;
DROP TABLE IF EXISTS users CASCADE;
DROP TABLE IF EXISTS roles CASCADE;

-- 1) roles
CREATE TABLE roles (
    role_id SERIAL PRIMARY KEY,
    role_name VARCHAR(50) UNIQUE NOT NULL
);

-- Seed roles
INSERT INTO roles (role_name) VALUES
 ('superadmin'), ('hr'), ('head_dept'), ('employee')
ON CONFLICT (role_name) DO NOTHING;

-- 2) users
CREATE TABLE users (
  user_id SERIAL PRIMARY KEY,
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  role_id INTEGER NOT NULL REFERENCES roles(role_id) ON UPDATE CASCADE,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive','locked')),
  first_login BOOLEAN DEFAULT false,
  created_by INTEGER REFERENCES users(user_id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- updated_at trigger
CREATE OR REPLACE FUNCTION set_updated_at() RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS users_set_updated_at ON users;
CREATE TRIGGER users_set_updated_at
BEFORE UPDATE ON users
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- 3) departments
CREATE TABLE departments (
  dept_id SERIAL PRIMARY KEY,
  dept_name TEXT UNIQUE NOT NULL,
  description TEXT,
  head_id INTEGER REFERENCES users(user_id) ON UPDATE CASCADE ON DELETE SET NULL
);

-- 4) employees (1:1 with users)
CREATE TABLE employees (
    employee_id INT PRIMARY KEY,
    first_name VARCHAR(100) NOT NULL,
    last_name VARCHAR(100) NOT NULL,
    full_name TEXT GENERATED ALWAYS AS (first_name || ' ' || last_name) STORED,
    email VARCHAR(255) UNIQUE,
    phone VARCHAR(20),
    address TEXT,
    dept_id INT REFERENCES departments(dept_id) ON DELETE SET NULL,
    position VARCHAR(100),
    hire_date DATE,
    status VARCHAR(20) DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'suspended')),
    created_by INT REFERENCES users(user_id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ DEFAULT now(),
    -- New schedule columns
    schedule_start_time TIME DEFAULT '09:00:00',
    schedule_end_time TIME DEFAULT '17:00:00',
    work_days INT[] DEFAULT ARRAY[1,2,3,4,5] -- Mon-Fri
);

-- 5) attendance
CREATE TABLE attendance (
    attendance_id SERIAL PRIMARY KEY,
    employee_id INT NOT NULL,
    date DATE NOT NULL,
    time_in TIME,
    time_out TIME,
    break_start TIME,
    break_end TIME,
    break_minutes INT GENERATED ALWAYS AS (
        CASE 
            WHEN break_start IS NOT NULL AND break_end IS NOT NULL
            THEN EXTRACT(EPOCH FROM (break_end - break_start)) / 60
            ELSE 0 
        END
    ) STORED,
    method VARCHAR(50) CHECK (method IN ('qr_scan', 'manual')),
    status VARCHAR(50) DEFAULT 'present' CHECK (status IN ('present', 'late', 'absent', 'on_leave')),
    location TEXT,
    ip_address INET,
    override_reason TEXT,
    overridden_by INT REFERENCES users(user_id) ON DELETE SET NULL,
    overridden_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT now(),
    FOREIGN KEY (employee_id) REFERENCES employees(employee_id) ON DELETE CASCADE,
    UNIQUE (employee_id, date) -- An employee can only have one attendance record per day
);

-- 6) requests (unified)
CREATE TABLE requests (
  request_id BIGSERIAL PRIMARY KEY,
  employee_id INTEGER NOT NULL REFERENCES employees(employee_id) ON UPDATE CASCADE ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('leave','overtime','correction')),
  details JSONB,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
  approved_by INTEGER REFERENCES users(user_id) ON UPDATE CASCADE ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

DROP TRIGGER IF EXISTS requests_set_updated_at ON requests;
CREATE TRIGGER requests_set_updated_at
BEFORE UPDATE ON requests
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- 7) qr_sessions (updated for HR dashboard) 
-- Note: qr_data removed - QR codes generated on-demand from session_id
CREATE TABLE qr_sessions (
    qr_id SERIAL PRIMARY KEY,
    session_id VARCHAR(255) UNIQUE NOT NULL,
    session_type VARCHAR(20) DEFAULT 'rotating' CHECK (session_type IN ('rotating', 'static')),
    is_active BOOLEAN DEFAULT true,
    created_by INT REFERENCES users(user_id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ DEFAULT now(),
    expires_at TIMESTAMPTZ NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX idx_qr_sessions_active_expires ON qr_sessions(is_active, expires_at);

DROP TRIGGER IF EXISTS qr_sessions_set_updated_at ON qr_sessions;
CREATE TRIGGER qr_sessions_set_updated_at
BEFORE UPDATE ON qr_sessions
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- 8) user_sessions
CREATE TABLE user_sessions (
  session_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id INTEGER NOT NULL REFERENCES users(user_id) ON UPDATE CASCADE ON DELETE CASCADE,
  login_time TIMESTAMPTZ NOT NULL DEFAULT now(),
  logout_time TIMESTAMPTZ,
  ip_address INET,
  device_info JSONB
);
CREATE INDEX idx_user_sessions_user_id_login_time ON user_sessions(user_id, login_time);

-- 9) notifications
CREATE TABLE notifications (
  notif_id BIGSERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(user_id) ON UPDATE CASCADE ON DELETE CASCADE,
  message TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'unread' CHECK (status IN ('read','unread')),
  created_at TIMESTAMPTZ DEFAULT now()
);

-- 10) audit_logs
CREATE TABLE audit_logs (
  log_id BIGSERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(user_id) ON DELETE SET NULL,
  action_type VARCHAR(100) NOT NULL,
  details JSONB,
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX idx_audit_logs_user_id ON audit_logs(user_id);
CREATE INDEX idx_audit_logs_action_type ON audit_logs(action_type);
CREATE INDEX idx_audit_logs_created_at ON audit_logs(created_at);


-- 11) system_settings
CREATE TABLE system_settings (
  setting_key VARCHAR(100) PRIMARY KEY,
  setting_value JSONB NOT NULL,
  description TEXT,
  updated_at TIMESTAMPTZ DEFAULT now()
);

DROP TRIGGER IF EXISTS system_settings_set_updated_at ON system_settings;
CREATE TRIGGER system_settings_set_updated_at
BEFORE UPDATE ON system_settings
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Seed initial settings
INSERT INTO system_settings (setting_key, setting_value, description) VALUES
('session_timeout_minutes', '15', 'Warn users 5 minutes before auto-logout.'),
('qr_validity_hours', '24', 'Daily QR expiration for attendance scans.'),
('geolocation_restriction_enabled', 'true', 'Allow scans only within campus perimeter.'),
('ip_restriction_enabled', 'false', 'Limit to approved network ranges.')
ON CONFLICT (setting_key) DO NOTHING;


-- Seeds

-- roles
INSERT INTO roles (role_name) VALUES
 ('superadmin'), ('hr'), ('head_dept'), ('employee')
ON CONFLICT (role_name) DO NOTHING;

-- departments
INSERT INTO departments (dept_name) VALUES
 ('Registrar'), ('Finance'), ('IT'), ('Human Resources'), ('Library')
ON CONFLICT (dept_name) DO NOTHING;

-- NOTE: Additional user accounts can be seeded via server/postgres/accounts.sql

COMMIT;
