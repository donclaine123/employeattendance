-- Workline Postgres schema + seed
-- Run this as the 'workline' DB user: psql -U workline -d workline -f /schema.sql

-- users (authentication)
CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  password TEXT NOT NULL,
  role TEXT NOT NULL,
  redirect TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- employees (profile data)
CREATE TABLE IF NOT EXISTS employees (
  id INTEGER PRIMARY KEY,
  employee_id TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  department TEXT,
  email TEXT UNIQUE,
  extra JSONB,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- qr_sessions
CREATE TABLE IF NOT EXISTS qr_sessions (
  id BIGSERIAL PRIMARY KEY,
  session_id UUID UNIQUE,
  type TEXT NOT NULL,
  window_id INTEGER,
  issued_at TIMESTAMPTZ DEFAULT now(),
  expires_at TIMESTAMPTZ,
  status TEXT DEFAULT 'active',
  meta JSONB
);

-- enforce at most one active rotating session per window
CREATE UNIQUE INDEX IF NOT EXISTS ux_qr_rotating_active_window
  ON qr_sessions(window_id)
  WHERE type = 'rotating' AND status = 'active';

-- attendance
CREATE TABLE IF NOT EXISTS attendance (
  id BIGSERIAL PRIMARY KEY,
  employee_id TEXT NOT NULL,
  session_id UUID,
  date_key DATE NOT NULL,
  timestamp TIMESTAMPTZ DEFAULT now(),
  location JSONB,
  device_info JSONB,
  status TEXT,
  notes TEXT
);

-- enforce one attendance per employee per day
CREATE UNIQUE INDEX IF NOT EXISTS ux_attendance_employee_date
  ON attendance(employee_id, date_key);

-- seed users (matches server/db.json)
INSERT INTO users (id,email,password,role,redirect) VALUES
  (1,'employee@example.com','employee','employee','pages/employee.html'),
  (2,'head@example.com','head','departmentHead','pages/DepartmentHead.html'),
  (3,'hr@example.com','hr','hr','pages/HRDashboard.html'),
  (4,'superadmin@example.com','superadmin','superadmin','pages/Superadmin.html'),
  (5,'alice.reyes@stclare.edu','alice123','employee','pages/employee.html'),
  (6,'brian.santos@stclare.edu','brian123','employee','pages/employee.html'),
  (7,'carlos.lopez@stclare.edu','carlos123','employee','pages/employee.html'),
  (8,'diana.velasquez@stclare.edu','diana123','employee','pages/employee.html'),
  (9,'eleanor.cruz@stclare.edu','eleanor123','employee','pages/employee.html')
ON CONFLICT (id) DO NOTHING;

-- seed employees
INSERT INTO employees (id, employee_id, name, department, email) VALUES
  (101, 'EMP-001', 'Alice M. Reyes', 'Registrar', 'alice.reyes@stclare.edu'),
  (102, 'EMP-002', 'Brian C. Santos', 'Finance', 'brian.santos@stclare.edu'),
  (103, 'EMP-003', 'Carlos D. Lopez', 'IT', 'carlos.lopez@stclare.edu'),
  (104, 'EMP-004', 'Diana R. Velasquez', 'Human Resources', 'diana.velasquez@stclare.edu'),
  (105, 'EMP-005', 'Eleanor P. Cruz', 'Library', 'eleanor.cruz@stclare.edu')
ON CONFLICT (id) DO NOTHING;
