const jsonServer = require('json-server');
const path = require('path');
const bodyParser = require('body-parser');
const cors = require('cors');

const server = jsonServer.create();
const router = jsonServer.router(path.join(__dirname, 'db.json'));
const middlewares = jsonServer.defaults({ static: 'public' });
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const SECRET = process.env.JWT_SECRET || 'dev-secret-key';
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '8h';


const QRCode = require('qrcode');
const { v4: uuidv4 } = require('uuid');
const { Pool } = require('pg');

// Postgres connection - expects DATABASE_URL env var or falls back to localhost
const PG_CONN = process.env.DATABASE_URL || 'postgresql://workline:secret@localhost:5432/workline';

// Enhanced connection configuration for better compatibility with Supabase
const poolConfig = {
  connectionString: PG_CONN,
  connectionTimeoutMillis: 30000, // 30 seconds
  idleTimeoutMillis: 60000, // 60 seconds
  max: 10, // maximum number of connections in the pool
  min: 1, // minimum number of connections in the pool
};

// SSL configuration for Supabase/production
if (process.env.NODE_ENV === 'production' || PG_CONN.includes('supabase.co')) {
  poolConfig.ssl = {
    rejectUnauthorized: false,
    // Additional SSL options for Supabase compatibility
    ca: undefined,
    key: undefined,
    cert: undefined,
  };
}

const pool = new Pool(poolConfig);

// allow cross-origin requests (handles OPTIONS preflight)
server.use(cors());

// serve the SPA static files from ../public
const publicPath = path.join(__dirname, '..', 'public');
server.use(jsonServer.defaults({ static: publicPath }));
server.use(expressStaticFallback = (req, res, next) => { next(); });

server.use(middlewares);
server.use(bodyParser.json());

// simple login route (uses users/roles schema; username acts as email in UI)
server.post('/api/login', async (req, res) => {
    const { email, password } = req.body || {};
    if (!email || !password) return res.status(400).json({ error: 'Missing email or password' });
    try{
        const q = `
            SELECT u.user_id, u.username, u.password_hash, u.role_id, r.role_name, u.status, 
                   COALESCE(u.first_login, false) as first_login
            FROM users u
            JOIN roles r ON r.role_id = u.role_id
            WHERE lower(u.username) = lower($1)
            LIMIT 1`;
        const r = await pool.query(q, [email]);
        if (!r.rows || r.rows.length === 0) return res.status(401).json({ error: 'Invalid credentials' });
        const user = r.rows[0];
        if (user.status !== 'active') return res.status(403).json({ error: 'User account is not active' });

        // Invalidate any existing active sessions for this user before creating a new one.
        // This ensures the user is logged out from other devices.
        await pool.query(
            'UPDATE user_sessions SET logout_time = NOW() WHERE user_id = $1 AND logout_time IS NULL',
            [user.user_id]
        );

        let valid = false;
        if (user.password_hash) {
            try { valid = await bcrypt.compare(password, user.password_hash); } catch(e) { valid = false; }
        }
        if (!valid) return res.status(401).json({ error: 'Invalid credentials' });

        // Check if this is the first login - if so, require password change
        if (user.first_login) {
            return res.status(200).json({ 
                requirePasswordChange: true, 
                userId: user.user_id,
                message: 'You must change your password before continuing.' 
            });
        }

        // map to employee record (1:1 by user_id)
        const er = await pool.query('SELECT employee_id FROM employees WHERE employee_id = $1 LIMIT 1', [user.user_id]);
        const emp = (er.rows && er.rows[0]) ? er.rows[0] : null;

        const safe = { id: user.user_id, email: user.username, role: user.role_name };
        if (emp){ safe.employee_id = emp.employee_id; safe.employee_db_id = emp.employee_id; }

        // legacy-style redirect based on role
        const roleRedirects = {
            superadmin: 'pages/Superadmin.html',
            hr: 'pages/HRDashboard.html',
            head_dept: 'pages/DepartmentHead.html',
            employee: 'pages/employee.html'
        };
        safe.redirect = roleRedirects[user.role_name] || 'pages/employee.html';

        // Create a user session record
        const sessionToken = uuidv4();
        const ipAddress = req.ip || (req.connection && req.connection.remoteAddress);
        const deviceInfo = { userAgent: req.get('User-Agent') };
        await pool.query(
            'INSERT INTO user_sessions (session_id, user_id, ip_address, device_info) VALUES ($1, $2, $3, $4)',
            [sessionToken, user.user_id, ipAddress, deviceInfo]
        );

        const token = jwt.sign({ id: safe.id, email: safe.email, role: safe.role, employee_id: safe.employee_id || null, sessionId: sessionToken }, SECRET, { expiresIn: JWT_EXPIRES_IN });
        return res.json({ user: safe, token });
    }catch(e){ console.error('login error', e); return res.status(500).json({ error: 'login failed' }); }
});

// Logout: invalidate a user session
server.post('/api/logout', requireAuth([]), async (req, res) => {
    try {
        const sessionId = req.auth && req.auth.sessionId;
        if (!sessionId) {
            return res.status(400).json({ error: 'No session to log out from.' });
        }

        const result = await pool.query(
            'UPDATE user_sessions SET logout_time = NOW() WHERE session_id = $1 AND logout_time IS NULL',
            [sessionId]
        );

        if (result.rowCount > 0) {
            console.log(`[session] User ${req.auth.id} logged out session ${sessionId}`);
            return res.json({ ok: true, message: 'Logged out successfully.' });
        } else {
            return res.status(404).json({ error: 'Session already logged out or not found.' });
        }
    } catch (e) {
        console.error('logout error', e);
        return res.status(500).json({ error: 'Logout failed.' });
    }
});

// Change password on first login
server.post('/api/change-first-login-password', async (req, res) => {
    try {
        const { userId, currentPassword, newPassword } = req.body;
        
        if (!userId || !currentPassword || !newPassword) {
            return res.status(400).json({ error: 'User ID, current password, and new password are required.' });
        }
        
        if (newPassword.length < 6) {
            return res.status(400).json({ error: 'New password must be at least 6 characters long.' });
        }
        
        // Verify user exists and is marked for first login
        const userResult = await pool.query(
            'SELECT user_id, password_hash, COALESCE(first_login, false) as first_login FROM users WHERE user_id = $1',
            [userId]
        );
        
        if (userResult.rows.length === 0) {
            return res.status(404).json({ error: 'User not found.' });
        }
        
        const user = userResult.rows[0];
        
        if (!user.first_login) {
            return res.status(400).json({ error: 'Password change not required for this user.' });
        }
        
        // Verify current password
        const validPassword = await bcrypt.compare(currentPassword, user.password_hash);
        if (!validPassword) {
            return res.status(401).json({ error: 'Current password is incorrect.' });
        }
        
        // Hash new password and update
        const hashedNewPassword = await bcrypt.hash(newPassword, 10);
        await pool.query(
            'UPDATE users SET password_hash = $1, first_login = false WHERE user_id = $2',
            [hashedNewPassword, userId]
        );
        
        res.json({ success: true, message: 'Password changed successfully. Please log in again.' });
    } catch (e) {
        console.error('Change password error:', e);
        res.status(500).json({ error: 'Failed to change password.' });
    }
});

// Get user profile
server.get('/api/auth/profile', requireAuth([]), async (req, res) => {
    try {
        const userId = req.auth.id;
        
        // Get user details with role and employee info
        const userResult = await pool.query(`
            SELECT 
                u.user_id,
                u.username,
                u.status,
                u.first_login,
                u.created_at,
                r.role_name as role,
                e.first_name,
                e.last_name,
                e.full_name,
                e.email,
                e.phone,
                e.address,
                e.position,
                e.hire_date,
                e.status as employee_status,
                e.dept_id,
                d.dept_name as department
            FROM users u
            LEFT JOIN roles r ON u.role_id = r.role_id
            LEFT JOIN employees e ON u.user_id = e.employee_id
            LEFT JOIN departments d ON e.dept_id = d.dept_id
            WHERE u.user_id = $1
        `, [userId]);
        
        if (userResult.rows.length === 0) {
            return res.status(404).json({ error: 'User not found' });
        }
        
        const user = userResult.rows[0];
        
        // Return sanitized profile data
        res.json({
            user_id: user.user_id,
            username: user.username,
            role: user.role,
            first_name: user.first_name,
            last_name: user.last_name,
            full_name: user.full_name,
            email: user.email,
            phone: user.phone,
            address: user.address,
            position: user.position,
            hire_date: user.hire_date,
            department: user.department,
            dept_id: user.dept_id,
            status: user.status,
            employee_status: user.employee_status,
            first_login: user.first_login,
            created_at: user.created_at
        });
    } catch (e) {
        console.error('Get profile error:', e);
        res.status(500).json({ error: 'Failed to get profile' });
    }
});

// Update user profile
server.put('/api/auth/profile', requireAuth([]), async (req, res) => {
    try {
        const userId = req.auth.id;
        const userRole = req.auth.role;
        const { 
            first_name, 
            last_name, 
            phone, 
            address, 
            position, 
            dept_id, 
            hire_date,
            currentPassword,
            newPassword
        } = req.body;
        
        // Validation
        if (!first_name || !last_name) {
            return res.status(400).json({ error: 'First name and last name are required' });
        }
        
        // Phone validation
        if (phone && !/^\+63[0-9]{10}$/.test(phone)) {
            return res.status(400).json({ error: 'Phone number must be in format: +63xxxxxxxxxx' });
        }
        
        // Start transaction
        const client = await pool.connect();
        try {
            await client.query('BEGIN');
            
            // Handle password change if provided
            if (newPassword) {
                if (!currentPassword) {
                    throw new Error('Current password is required to change password');
                }
                
                if (newPassword.length < 6) {
                    throw new Error('New password must be at least 6 characters');
                }
                
                // Verify current password
                const userResult = await client.query('SELECT password_hash FROM users WHERE user_id = $1', [userId]);
                if (userResult.rows.length === 0) {
                    throw new Error('User not found');
                }
                
                const isValidPassword = await bcrypt.compare(currentPassword, userResult.rows[0].password_hash);
                if (!isValidPassword) {
                    throw new Error('Current password is incorrect');
                }
                
                // Update password
                const hashedNewPassword = await bcrypt.hash(newPassword, 10);
                await client.query('UPDATE users SET password_hash = $1 WHERE user_id = $2', [hashedNewPassword, userId]);
                
                // Log audit event
                await logAuditEvent(userId, 'PASSWORD_CHANGED', { userId });
            }
            
            // Check if user has employee record and get current data for change tracking
            const employeeCheck = await client.query(`
                SELECT e.*, d.dept_name 
                FROM employees e 
                LEFT JOIN departments d ON e.dept_id = d.dept_id 
                WHERE e.employee_id = $1
            `, [userId]);
            
            if (employeeCheck.rows.length > 0) {
                const currentData = employeeCheck.rows[0];
                
                // User has employee record - update it
                let updateQuery = 'UPDATE employees SET first_name = $1, last_name = $2, phone = $3';
                let updateParams = [first_name, last_name, phone];
                let paramIndex = 4;
                
                // Prepare new data for change tracking
                const newData = {
                    first_name,
                    last_name,
                    phone,
                    position: currentData.position,
                    dept_id: currentData.dept_id,
                    hire_date: currentData.hire_date
                };
                
                // Role-based field updates
                if (userRole === 'hr' || userRole === 'superadmin') {
                    // HR and superadmin can update position, department, and hire date
                    if (position !== undefined) {
                        updateQuery += `, position = $${paramIndex}`;
                        updateParams.push(position);
                        newData.position = position;
                        paramIndex++;
                    }
                    if (dept_id !== undefined) {
                        updateQuery += `, dept_id = $${paramIndex}`;
                        updateParams.push(dept_id);
                        newData.dept_id = dept_id;
                        paramIndex++;
                    }
                    if (hire_date !== undefined) {
                        updateQuery += `, hire_date = $${paramIndex}`;
                        updateParams.push(hire_date);
                        newData.hire_date = hire_date;
                        paramIndex++;
                    }
                } else if (userRole === 'head_dept') {
                    // Department heads can update position within their department
                    if (position !== undefined) {
                        updateQuery += `, position = $${paramIndex}`;
                        updateParams.push(position);
                        newData.position = position;
                        paramIndex++;
                    }
                }
                
                updateQuery += ` WHERE employee_id = $${paramIndex}`;
                updateParams.push(userId);
                
                await client.query(updateQuery, updateParams);
                
                // Generate detailed change tracking
                const fieldMappings = {
                    first_name: { label: 'First Name' },
                    last_name: { label: 'Last Name' },
                    phone: { label: 'Phone Number' },
                    position: { label: 'Position' },
                    dept_id: { 
                        label: 'Department',
                        formatter: (value) => {
                            if (!value) return 'Not assigned';
                            // We'll need to look up department name for new dept_id
                            return value === currentData.dept_id ? currentData.dept_name : `Department ID: ${value}`;
                        }
                    },
                    hire_date: { 
                        label: 'Hire Date',
                        formatter: (value) => value ? new Date(value).toLocaleDateString() : 'Not set'
                    }
                };
                
                const changes = generateFieldChanges(currentData, newData, fieldMappings);
                
                // If there's a department change, get the new department name
                if (dept_id !== undefined && dept_id !== currentData.dept_id) {
                    try {
                        const deptResult = await client.query('SELECT dept_name FROM departments WHERE dept_id = $1', [dept_id]);
                        if (deptResult.rows.length > 0) {
                            // Update the change description with actual department names
                            const deptChange = changes.find(c => c.field === 'dept_id');
                            if (deptChange) {
                                const oldDeptName = currentData.dept_name || 'Not assigned';
                                const newDeptName = deptResult.rows[0].dept_name;
                                deptChange.description = `Changed Department from "${oldDeptName}" to "${newDeptName}"`;
                            }
                        }
                    } catch (e) {
                        console.error('Error fetching department name:', e);
                    }
                }
                
                // Log detailed changes
                if (changes.length > 0) {
                    await logFieldChanges(
                        req.auth.id, // Who made the change
                        userId,      // Whose profile was changed
                        'PROFILE_FIELD_UPDATED',
                        changes,
                        { 
                            updatedByRole: userRole,
                            selfUpdate: req.auth.id === userId
                        }
                    );
                }
            } else {
                // No employee record exists - this shouldn't happen normally but let's handle it
                console.warn(`User ${userId} has no employee record`);
            }
            
            await client.query('COMMIT');
            
            // Return updated user data
            const updatedUserResult = await pool.query(`
                SELECT 
                    u.user_id,
                    u.username,
                    r.role_name as role,
                    e.first_name,
                    e.last_name,
                    e.full_name,
                    e.email,
                    e.phone,
                    e.position,
                    e.status as employee_status,
                    d.dept_name as department,
                    e.dept_id
                FROM users u
                LEFT JOIN roles r ON u.role_id = r.role_id
                LEFT JOIN employees e ON u.user_id = e.employee_id
                LEFT JOIN departments d ON e.dept_id = d.dept_id
                WHERE u.user_id = $1
            `, [userId]);
            
            const user = updatedUserResult.rows[0];
            
            res.json({
                success: true,
                message: 'Profile updated successfully',
                user: {
                    user_id: user.user_id,
                    username: user.username,
                    role: user.role,
                    first_name: user.first_name,
                    last_name: user.last_name,
                    full_name: user.full_name,
                    email: user.email,
                    phone: user.phone,
                    position: user.position,
                    department: user.department,
                    dept_id: user.dept_id,
                    employee_status: user.employee_status
                }
            });
            
        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        } finally {
            client.release();
        }
        
    } catch (e) {
        console.error('Update profile error:', e);
        res.status(500).json({ error: e.message || 'Failed to update profile' });
    }
});

// simple middleware to protect HR endpoints
function requireAuth(allowedRoles){
    return async function(req, res, next){
        const auth = req.headers && (req.headers.authorization || req.headers.Authorization);
        if (!auth || !auth.startsWith('Bearer ')) return res.status(401).json({ error: 'Missing or invalid authorization header' });
        const token = auth.slice('Bearer '.length);
        try{
            const decoded = jwt.verify(token, SECRET);
            req.auth = decoded;

            // Verify the session is still active in the database
            if (!decoded.sessionId) {
                return res.status(401).json({ error: 'Invalid token: No session ID.' });
            }
            const sessionResult = await pool.query(
                'SELECT * FROM user_sessions WHERE session_id = $1 AND user_id = $2 AND logout_time IS NULL',
                [decoded.sessionId, decoded.id]
            );

            if (sessionResult.rowCount === 0) {
                return res.status(401).json({ error: 'Session has expired or been logged out. Please log in again.' });
            }

            // check roles
            if (Array.isArray(allowedRoles) && allowedRoles.length > 0){
                const userRole = decoded.role;
                if (!allowedRoles.includes(userRole.toLowerCase())){
                    return res.status(403).json({ error: 'Forbidden: Insufficient permissions' });
                }
            }
            next();
        }catch(e){
            console.warn('auth error', e.message || e);
            return res.status(401).json({ error: 'Invalid or expired token' });
        }
    };
}

// helper: convert DB row -> session object (compat fields)
function rowToSession(row){ 
    if (!row) return null; 
    return { 
        session_id: row.session_id, 
        issued_at: row.created_at ? row.created_at.toISOString() : null, 
        expires_at: row.expires_at ? row.expires_at.toISOString() : null, 
        is_active: row.is_active,
        session_type: row.session_type 
    }; 
}

// cleanup: expire sessions past expires_at
async function cleanupExpiredQrSessions(){
    try{
        await pool.query("UPDATE qr_sessions SET is_active = false WHERE expires_at IS NOT NULL AND expires_at < NOW() AND is_active = true");
    }catch(e){ console.warn('qr cleanup failed:', e.message || e); }
}

// revoke session
// QR revoke endpoint is defined later in the file with correct schema

// mark attendance - append to db.json attendance array
server.post('/api/attendance', async (req, res) => {
    try{
        const body = req.body || {};
        // For compatibility, accept employee identifier in body.email
        const ident = body.email || body.employee_id;
        if (!ident) return res.status(400).json({ error: 'missing employee identifier' });
        // resolve to employee_id (users.user_id)
        let empId = null;
        if (/^\d+$/.test(String(ident))) {
            empId = parseInt(String(ident), 10);
        } else {
            const ur = await pool.query('SELECT user_id FROM users WHERE lower(username)=lower($1) LIMIT 1', [String(ident)]);
            if (ur.rows && ur.rows[0]) empId = ur.rows[0].user_id;
        }
        if (!empId) return res.status(404).json({ error: 'employee not found' });
        const today = new Date();
        const date = today.toISOString().slice(0,10);
        const timeIn = today.toISOString();
        const status = body.status || 'present';
        const method = body.method || 'manual';
        const ins = await pool.query('INSERT INTO attendance(employee_id, date, time_in, method, status) VALUES($1,$2,$3,$4,$5) RETURNING *', [empId, date, timeIn, method, status]);
        return res.status(201).json(ins.rows[0]);
    }catch(e){ console.error('attendance post error', e); return res.status(500).json({ error: 'failed to post attendance' }); }
});

// attendance: checkout (sets time_out for today's record)
server.post('/api/attendance/checkout', async (req, res) => {
    try{
        const body = req.body || {};
        const ident = body.employee_id || body.email;
        if (!ident) return res.status(400).json({ error: 'missing employee identifier' });
        let empId = null;
        if (/^\d+$/.test(String(ident))) empId = parseInt(String(ident), 10); else {
            const ur = await pool.query('SELECT user_id FROM users WHERE lower(username)=lower($1) LIMIT 1', [String(ident)]);
            if (ur.rows && ur.rows[0]) empId = ur.rows[0].user_id;
        }
        if (!empId) return res.status(404).json({ error: 'employee not found' });
        const today = new Date().toISOString().slice(0,10);
        const nowIso = new Date().toISOString();
        const upd = await pool.query('UPDATE attendance SET time_out=$1 WHERE employee_id=$2 AND date=$3 AND time_out IS NULL RETURNING *', [nowIso, empId, today]);
        if (!upd.rows || upd.rows.length === 0) return res.status(404).json({ error: 'no open attendance record found' });
        return res.json({ ok: true, record: upd.rows[0] });
    }catch(e){ console.error('checkout error', e); return res.status(500).json({ error: 'failed to checkout' }); }
});

// attendance: break in/out
server.post('/api/attendance/break', async (req, res) => {
    try{
        const body = req.body || {};
        const ident = body.employee_id || body.email;
        const action = (body.action || '').toLowerCase(); // 'in' or 'out'
        if (!ident || (action !== 'in' && action !== 'out')) return res.status(400).json({ error: 'missing employee identifier or invalid action' });
        let empId = null;
        if (/^\d+$/.test(String(ident))) empId = parseInt(String(ident), 10); else {
            const ur = await pool.query('SELECT user_id FROM users WHERE lower(username)=lower($1) LIMIT 1', [String(ident)]);
            if (ur.rows && ur.rows[0]) empId = ur.rows[0].user_id;
        }
        if (!empId) return res.status(404).json({ error: 'employee not found' });
        const today = new Date().toISOString().slice(0,10);
        const now = new Date();
        if (action === 'in'){
            const upd = await pool.query('UPDATE attendance SET break_start=$1, break_end=NULL WHERE employee_id=$2 AND date=$3 RETURNING *', [now.toISOString(), empId, today]);
            if (!upd.rows || upd.rows.length === 0) return res.status(404).json({ error: 'no attendance record found' });
            return res.json({ ok:true, record: upd.rows[0] });
        } else {
            // out: set break_end and accumulate break_minutes
            const sel = await pool.query('SELECT * FROM attendance WHERE employee_id=$1 AND date=$2 LIMIT 1', [empId, today]);
            if (!sel.rows || sel.rows.length === 0) return res.status(404).json({ error: 'no attendance record found' });
            const rec = sel.rows[0];
            if (!rec.break_start) return res.status(409).json({ error: 'break not started' });
            const breakStart = new Date(rec.break_start);
            const minutes = Math.max(0, Math.round((now - breakStart)/60000));
            const upd = await pool.query('UPDATE attendance SET break_end=$1, break_minutes = COALESCE(break_minutes,0) + $2 WHERE attendance_id=$3 RETURNING *', [now.toISOString(), minutes, rec.attendance_id]);
            return res.json({ ok:true, record: upd.rows[0] });
        }
    }catch(e){ console.error('break error', e); return res.status(500).json({ error: 'failed to update break' }); }
});

// attendance history with optional date range and employee filter
server.get('/api/attendance/history', async (req, res) => {
    try{
        const { start, end, employee } = req.query || {};
        const params = [];
        let idx = 1;
        let sql = `
            SELECT a.*, u.username, (e.first_name||' '||e.last_name) AS employee_name, d.dept_name
            FROM attendance a
            JOIN employees e ON e.employee_id = a.employee_id
            JOIN users u ON u.user_id = e.employee_id
            LEFT JOIN departments d ON d.dept_id = e.dept_id
            WHERE 1=1`;
        if (start) { sql += ` AND a.date >= $${idx++}`; params.push(start); }
        if (end)   { sql += ` AND a.date <= $${idx++}`; params.push(end); }
        if (employee){
            if (/^\d+$/.test(String(employee))) { sql += ` AND a.employee_id = $${idx++}`; params.push(parseInt(String(employee),10)); }
            else { sql += ` AND lower(u.username) = lower($${idx++})`; params.push(String(employee)); }
        }
        sql += ' ORDER BY a.date DESC, a.time_in DESC NULLS LAST';
        const r = await pool.query(sql, params);
        return res.json(r.rows || []);
    }catch(e){ console.error('history error', e); return res.status(500).json({ error: 'failed to fetch history' }); }
});

// Fetch attendance with filters
server.get('/api/attendance', requireAuth(['hr', 'superadmin', 'head_dept']), async (req, res) => {
    try{
        const { startDate, endDate, employee, status, department } = req.query;
        const today = new Date().toISOString().slice(0,10);

        let sql = `
            SELECT a.employee_id, a.date, a.time_in, a.time_out, a.method, a.status,
                   u.username as employee_username,
                   (e.first_name || ' ' || e.last_name) AS employee_name,
                   d.dept_name as employee_department,
                   a.time_in AS timestamp
            FROM attendance a
            JOIN employees e ON e.employee_id = a.employee_id
            JOIN users u ON u.user_id = e.employee_id
            LEFT JOIN departments d ON d.dept_id = e.dept_id
            WHERE 1=1
        `;
        const params = [];
        let paramIndex = 1;

        if (startDate) {
            sql += ` AND a.date >= $${paramIndex++}`;
            params.push(startDate);
        }
        if (endDate) {
            sql += ` AND a.date <= $${paramIndex++}`;
            params.push(endDate);
        }
        if (!startDate && !endDate) {
            // Default to today if no date range is provided
            sql += ` AND a.date = $${paramIndex++}`;
            params.push(today);
        }

        if (department){
            sql += ` AND lower(d.dept_name) = lower($${paramIndex++})`;
            params.push(department);
        }

        if (employee) {
            sql += ` AND (e.full_name ILIKE $${paramIndex} OR u.username ILIKE $${paramIndex} OR CAST(e.employee_id AS TEXT) ILIKE $${paramIndex})`;
            params.push(`%${employee}%`);
            paramIndex++;
        }

        if (status) {
            sql += ` AND a.status = $${paramIndex++}`;
            params.push(status);
        }

        sql += ' ORDER BY a.time_in DESC NULLS LAST';
        const r = await pool.query(sql, params);
        return res.json(Array.isArray(r.rows) ? r.rows : []);
    }catch(e){ console.error('attendance fetch error', e); return res.status(500).json({ error: 'failed to fetch attendance' }); }
});

// check-in using a QR session (validates session, one check-in per employee per day)
server.post('/api/attendance/checkin', async (req, res) => {
    try{
        const body = req.body || {};
        const { session_id, employee_id, lat, lon, deviceInfo } = body;
        console.log('Check-in request received:', { session_id, employee_id, lat, lon, deviceInfo });
        
        if (!session_id || !employee_id) return res.status(400).json({ error: 'missing session_id or employee_id' });

        // find QR session by code
        const selt = await pool.query('SELECT * FROM qr_sessions WHERE session_id=$1 LIMIT 1', [session_id]);
        const sessionRow = (selt.rows && selt.rows[0]) ? selt.rows[0] : null;
        if (!sessionRow) return res.status(404).json({ error: 'session not found' });
        const now = new Date();
        if (!sessionRow.is_active) return res.status(410).json({ error: 'session not active' });
        if (sessionRow.expires_at && new Date(sessionRow.expires_at) < now) return res.status(410).json({ error: 'session expired' });

        const date = now.toISOString().slice(0,10);

        // resolve employee_id: may be numeric user_id or username
        let empId = null;
        if (/^\d+$/.test(String(employee_id))) {
            empId = parseInt(String(employee_id), 10);
        } else {
            const ur = await pool.query('SELECT user_id FROM users WHERE lower(username)=lower($1) LIMIT 1', [String(employee_id)]);
            if (ur.rows && ur.rows[0]) empId = ur.rows[0].user_id;
        }
        if (!empId) return res.status(404).json({ error: 'employee not found' });

        // ensure employee row exists
        const er = await pool.query('SELECT employee_id, schedule_start_time FROM employees WHERE employee_id=$1 LIMIT 1', [empId]);
        if (!er.rows || er.rows.length === 0) return res.status(404).json({ error: 'employee not found' });
        const employee = er.rows[0];

        // check existing attendance for today
        const ex = await pool.query('SELECT * FROM attendance WHERE employee_id=$1 AND date=$2 LIMIT 1', [empId, date]);
        if (ex.rows && ex.rows.length > 0) return res.status(409).json({ error: 'already checked in today', record: ex.rows[0] });

        // insert attendance
        const method = 'qr_scan'; // Corrected from 'QR' to match CHECK constraint
        let status = 'present';

        // Determine status (late or present)
        if (employee.schedule_start_time) {
            const scheduleTime = new Date(`${date}T${employee.schedule_start_time}`);
            // Add a grace period (e.g., 5 minutes)
            scheduleTime.setMinutes(scheduleTime.getMinutes() + 5); 
            if (now > scheduleTime) {
                status = 'late';
            }
        }

        const ins = await pool.query('INSERT INTO attendance(employee_id, date, time_in, method, status) VALUES($1,$2,$3,$4,$5) RETURNING *', [empId, date, now.toTimeString().split(' ')[0], method, status]);
        console.log('Attendance inserted successfully:', { empId, date, time_in: now.toTimeString().split(' ')[0], method, status });
        const rec = ins.rows[0];
        // shape response for compatibility - create proper timestamp from date and time
        // Convert date to YYYY-MM-DD format to ensure valid timestamp creation
        const dateStr = new Date(rec.date).toISOString().split('T')[0];
        const fullTimestamp = new Date(`${dateStr}T${rec.time_in}`).toISOString();
        const compat = {
            timestamp: fullTimestamp,
            status: rec.status,
            dateKey: dateStr,
            employee_id: rec.employee_id
        };
        return res.status(201).json({ ok: true, record: compat });
    }catch(e){ console.error('checkin error', e); return res.status(500).json({ error: 'failed to checkin' }); }
});

// Fetch employee info by email (secured): returns {id, employee_id, name, department, email}
// Backward-compatible: treat email param as username and return combined fields
server.get('/api/employee/by-email', requireAuth([]), async (req, res) => {
    try{
        const email = (req.query && req.query.email) ? String(req.query.email) : (req.auth && req.auth.email);
        if (!email) return res.status(400).json({ error: 'missing email' });
        const r = await pool.query(`
            SELECT e.employee_id as id,
                   e.employee_id,
                   (e.first_name || ' ' || e.last_name) AS name,
                   d.dept_name as department,
                   u.username as email
            FROM users u
            JOIN employees e ON e.employee_id = u.user_id
            LEFT JOIN departments d ON d.dept_id = e.dept_id
            WHERE lower(u.username) = lower($1)
            LIMIT 1
        `, [email]);
        if (!r.rows || r.rows.length === 0) return res.status(404).json({ error: 'employee not found' });
        return res.json(r.rows[0]);
    }catch(e){ console.error('employee lookup error', e); return res.status(500).json({ error: 'failed to fetch employee' }); }
});

// --- Super Admin: User Management ---

// GET all users for the admin panel
server.get('/api/admin/users', requireAuth(['superadmin']), async (req, res) => {
    try {
        const { q, role, _page = 1, _limit = 10 } = req.query;
        const page = parseInt(_page, 10);
        const limit = parseInt(_limit, 10);
        const offset = (page - 1) * limit;

        let query = `
            SELECT
                u.user_id,
                u.username,
                e.full_name,
                e.first_name,
                e.last_name,
                r.role_name,
                u.status,
                d.dept_name as department_name,
                u.created_at,
                (SELECT u_inner.username FROM users u_inner WHERE u_inner.user_id = u.created_by) as last_modified_by,
                (SELECT MAX(s.login_time) FROM user_sessions s WHERE s.user_id = u.user_id) as last_login
            FROM users u
            LEFT JOIN employees e ON u.user_id = e.employee_id
            LEFT JOIN departments d ON e.dept_id = d.dept_id
            JOIN roles r ON u.role_id = r.role_id
        `;
        const params = [];
        let whereClauses = [];
        let paramIndex = 1;

        if (q) {
            whereClauses.push(`(u.username ILIKE $${paramIndex} OR e.full_name ILIKE $${paramIndex})`);
            params.push(`%${q}%`);
            paramIndex++;
        }

        if (role && role.toLowerCase() !== 'all') {
            whereClauses.push(`r.role_name = $${paramIndex}`);
            params.push(role);
            paramIndex++;
        }

        if (whereClauses.length > 0) {
            query += ' WHERE ' + whereClauses.join(' AND ');
        }

        // Get total count for pagination headers
        const totalQuery = `SELECT COUNT(*) FROM (${query}) as total`;
        const totalResult = await pool.query(totalQuery, params);
        const totalCount = parseInt(totalResult.rows[0].count, 10);

        query += ` ORDER BY u.user_id ASC LIMIT $${paramIndex++} OFFSET $${paramIndex++}`;
        params.push(limit, offset);

        const result = await pool.query(query, params);
        
        res.setHeader('X-Total-Count', totalCount);
        res.json(result.rows);
    } catch (e) {
        console.error('Admin fetch users error:', e);
        res.status(500).json({ error: 'Failed to fetch users.' });
    }
});

// POST a new user (Superadmin action)
server.post('/api/admin/users', requireAuth(['superadmin']), async (req, res) => {
    const { email, password, role, firstName, lastName, departmentId } = req.body;
    const creatorId = req.auth.id;

    if (!email || !password || !role || !firstName || !lastName) {
        return res.status(400).json({ error: 'Missing required fields.' });
    }

    // Superadmin can only create HR or Super Admin accounts
    const normalizedRole = String(role).toLowerCase();
    if (!['hr', 'superadmin'].includes(normalizedRole)) {
        return res.status(403).json({ error: 'Not allowed to create this role. Only HR or Super Admin can be created.' });
    }

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        const roleResult = await client.query('SELECT role_id FROM roles WHERE lower(role_name) = $1', [normalizedRole]);
        if (roleResult.rowCount === 0) {
            throw new Error('Invalid role specified.');
        }
        const roleId = roleResult.rows[0].role_id;

        const passwordHash = await bcrypt.hash(password, 10);

        const userQuery = 'INSERT INTO users (username, password_hash, role_id) VALUES ($1, $2, $3) RETURNING user_id';
        const userResult = await client.query(userQuery, [email, passwordHash, roleId]);
        const newUserId = userResult.rows[0].user_id;

        const employeeQuery = `
            INSERT INTO employees (employee_id, first_name, last_name, dept_id, hire_date, created_by)
            VALUES ($1, $2, $3, $4, NOW(), $5)
        `;
        await client.query(employeeQuery, [newUserId, firstName, lastName, departmentId, creatorId]);

        await client.query('COMMIT');
        
        // Enhanced audit logging for user creation
        await logAuditEvent(creatorId, 'USER_CREATED', { 
            createdUserId: newUserId, 
            email,
            firstName,
            lastName,
            role: normalizedRole,
            departmentId,
            description: `Created new ${normalizedRole} user: ${firstName} ${lastName} (${email})`
        });
        
        res.status(201).json({ success: true, userId: newUserId });
    } catch (e) {
        await client.query('ROLLBACK');
        console.error('Admin create user error:', e);
        if (e.constraint === 'users_username_key') {
            return res.status(409).json({ error: 'A user with this email already exists.' });
        }
        res.status(500).json({ error: 'Failed to create user.' });
    } finally {
        client.release();
    }
});

// PUT to update a user's role or status
server.put('/api/admin/users/:id', requireAuth(['superadmin']), async (req, res) => {
    const userId = parseInt(req.params.id, 10);
    if (isNaN(userId)) return res.status(400).json({ error: 'Invalid user ID.' });

    const { email, role, status, firstName, lastName, departmentId, password } = req.body || {};

    // Validate simple enums
    if (status && !['active', 'inactive', 'locked'].includes(status)) {
        return res.status(400).json({ error: 'Invalid status.' });
    }

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        // Track what was changed for audit
        const auditDetails = { targetUserId: userId, changes: {} };

        // Update role/status/email/password in users table as applicable
        let roleId = null;
        if (role) {
            const normalizedRole = String(role).toLowerCase();
            const allowedRoles = ['employee','head_dept','hr','superadmin'];
            if (!allowedRoles.includes(normalizedRole)) {
                throw new Error('Invalid role.');
            }
            const roleResult = await client.query('SELECT role_id FROM roles WHERE lower(role_name) = $1', [normalizedRole]);
            if (roleResult.rowCount === 0) {
                throw new Error('Invalid role.');
            }
            roleId = roleResult.rows[0].role_id;
        }

        const updates = [];
        const params = [];
        let p = 1;
        if (typeof email === 'string' && email.trim()) { updates.push(`username = $${p++}`); params.push(email.trim()); auditDetails.changes.email = true; }
        if (roleId !== null) { updates.push(`role_id = $${p++}`); params.push(roleId); auditDetails.changes.role = role; }
        if (status) { updates.push(`status = $${p++}`); params.push(status); auditDetails.changes.status = status; }
        if (typeof password === 'string' && password.length > 0) {
            const hash = await bcrypt.hash(password, 10);
            updates.push(`password_hash = $${p++}`);
            params.push(hash);
            auditDetails.changes.passwordReset = true;
        }
        if (updates.length > 0) {
            updates.push(`updated_at = NOW()`);
            const sql = `UPDATE users SET ${updates.join(', ')} WHERE user_id = $${p}`;
            params.push(userId);
            const r = await client.query(sql, params);
            if (r.rowCount === 0) {
                throw new Error('User not found.');
            }
        }

        // Update employees info if provided
        const empUpdates = [];
        const empParams = [];
        let ep = 1;
        if (typeof firstName === 'string' && firstName.trim()) { empUpdates.push(`first_name = $${ep++}`); empParams.push(firstName.trim()); auditDetails.changes.firstName = true; }
        if (typeof lastName === 'string' && lastName.trim()) { empUpdates.push(`last_name = $${ep++}`); empParams.push(lastName.trim()); auditDetails.changes.lastName = true; }
        if (departmentId !== undefined && departmentId !== null) { empUpdates.push(`dept_id = $${ep++}`); empParams.push(departmentId); auditDetails.changes.departmentId = departmentId; }
        
        if (empUpdates.length > 0) {
            const esql = `UPDATE employees SET ${empUpdates.join(', ')} WHERE employee_id = $${ep}`;
            empParams.push(userId);
            const r = await client.query(esql, empParams);
            if (r.rowCount === 0) {
                // This might happen if the user exists but has no employee record.
                // We can choose to create one or throw an error.
                // For now, we'll log a warning and continue, as the user record might have been updated.
                console.warn(`[update-user] No employee record found for user_id ${userId} to update details.`);
            }
        }

        await client.query('COMMIT');
        await logAuditEvent(req.auth.id, 'USER_UPDATED', auditDetails);
        res.json({ success: true });
    } catch (e) {
        await client.query('ROLLBACK');
        console.error(`Admin update user ${userId} error:`, e);
        if (String(e.message).includes('Invalid role')) {
            return res.status(400).json({ error: 'Invalid role.' });
        }
        if (String(e.message).includes('User not found')) {
            return res.status(404).json({ error: 'User not found.' });
        }
        if (e.constraint === 'users_username_key') {
            return res.status(409).json({ error: 'A user with this email already exists.' });
        }
        res.status(500).json({ error: 'Failed to update user.' });
    } finally {
        client.release();
    }
});

// DELETE a user (soft delete by setting status to 'inactive')
server.delete('/api/admin/users/:id', requireAuth(['superadmin']), async (req, res) => {
    const userId = parseInt(req.params.id, 10);
    if (isNaN(userId)) return res.status(400).json({ error: 'Invalid user ID.' });

    // Prevent superadmin from deleting themselves
    if (userId === req.auth.id) {
        return res.status(403).json({ error: 'You cannot delete your own account.' });
    }

    try {
        // Check target user's role
        const roleCheck = await pool.query(
            `SELECT r.role_name FROM users u JOIN roles r ON u.role_id = r.role_id WHERE u.user_id = $1`,
            [userId]
        );
        if (roleCheck.rowCount === 0) {
            return res.status(404).json({ error: 'User not found.' });
        }
        const targetRole = String(roleCheck.rows[0].role_name).toLowerCase();
        // Only superadmin can deactivate HR; this route is already superadmin-only, but we keep the policy explicit
        if (targetRole === 'superadmin' && userId === req.auth.id) {
            return res.status(403).json({ error: 'You cannot deactivate your own superadmin account.' });
        }
        
        // Get user details before deactivation for audit log
        const userDetails = await pool.query(`
            SELECT u.username, e.first_name, e.last_name, r.role_name
            FROM users u
            LEFT JOIN employees e ON u.user_id = e.employee_id  
            LEFT JOIN roles r ON u.role_id = r.role_id
            WHERE u.user_id = $1
        `, [userId]);
        
        const result = await pool.query("UPDATE users SET status = 'inactive', updated_at = NOW() WHERE user_id = $1", [userId]);
        if (result.rowCount === 0) {
            return res.status(404).json({ error: 'User not found.' });
        }
        
        // Enhanced audit logging for user deactivation
        const userInfo = userDetails.rows[0];
        const userName = userInfo ? `${userInfo.first_name} ${userInfo.last_name}` : 'Unknown User';
        const userEmail = userInfo ? userInfo.username : 'Unknown Email';
        const userRole = userInfo ? userInfo.role_name : 'Unknown Role';
        
        await logAuditEvent(req.auth.id, 'USER_DEACTIVATED', { 
            targetUserId: userId,
            targetUserEmail: userEmail,
            targetUserName: userName,
            targetUserRole: userRole,
            description: `Deactivated ${userRole} user: ${userName} (${userEmail})`
        });
        
        res.status(204).send(); // No content
    } catch (e) {
        console.error(`Admin delete user ${userId} error:`, e);
        res.status(500).json({ error: 'Failed to delete user.' });
    }
});

// PUT /api/admin/users/:id/reactivate - Reactivate a user
server.put('/api/admin/users/:id/reactivate', requireAuth(['superadmin']), async (req, res) => {
    const userId = parseInt(req.params.id, 10);
    if (isNaN(userId)) return res.status(400).json({ error: 'Invalid user ID.' });

    try {
        // Check if user exists and get their details
        const userDetails = await pool.query(`
            SELECT u.username, u.status, e.first_name, e.last_name, r.role_name
            FROM users u
            LEFT JOIN employees e ON u.user_id = e.employee_id  
            LEFT JOIN roles r ON u.role_id = r.role_id
            WHERE u.user_id = $1
        `, [userId]);

        if (userDetails.rowCount === 0) {
            return res.status(404).json({ error: 'User not found.' });
        }

        const user = userDetails.rows[0];
        if (user.status === 'active') {
            return res.status(400).json({ error: 'User is already active.' });
        }
        
        // Reactivate the user
        const result = await pool.query("UPDATE users SET status = 'active', updated_at = NOW() WHERE user_id = $1", [userId]);
        if (result.rowCount === 0) {
            return res.status(404).json({ error: 'Failed to reactivate user.' });
        }
        
        // Enhanced audit logging for user reactivation
        const userName = user ? `${user.first_name} ${user.last_name}` : 'Unknown User';
        const userEmail = user ? user.username : 'Unknown Email';
        const userRole = user ? user.role_name : 'Unknown Role';
        
        await logAuditEvent(req.auth.id, 'USER_REACTIVATED', { 
            targetUserId: userId,
            targetUserEmail: userEmail,
            targetUserName: userName,
            targetUserRole: userRole,
            description: `Reactivated ${userRole} user: ${userName} (${userEmail})`
        });
        
        res.status(200).json({ message: 'User reactivated successfully.' });
    } catch (e) {
        console.error(`Admin reactivate user ${userId} error:`, e);
        res.status(500).json({ error: 'Failed to reactivate user.' });
    }
});

// --- Super Admin: System Settings ---

// Helper function to log audit events
async function logAuditEvent(userId, actionType, details = {}) {
    try {
        const query = 'INSERT INTO audit_logs (user_id, action_type, details) VALUES ($1, $2, $3)';
        await pool.query(query, [userId, actionType, details]);
        console.log(`[audit] User ${userId} performed action: ${actionType}`);
    } catch (e) {
        console.error('Failed to log audit event:', e);
    }
}

// Enhanced audit logging for field changes
async function logFieldChanges(userId, targetUserId, actionType, changes, additionalContext = {}) {
    try {
        // Log each field change separately for detailed tracking
        for (const change of changes) {
            const details = {
                targetUserId,
                field: change.field,
                fieldLabel: change.fieldLabel,
                oldValue: change.oldValue,
                newValue: change.newValue,
                changeDescription: change.description,
                ...additionalContext
            };
            
            await logAuditEvent(userId, actionType, details);
        }
    } catch (e) {
        console.error('Failed to log field changes:', e);
    }
}

// Helper to compare objects and generate change descriptions
function generateFieldChanges(oldData, newData, fieldMappings) {
    const changes = [];
    
    for (const [field, config] of Object.entries(fieldMappings)) {
        const oldValue = oldData[field];
        const newValue = newData[field];
        
        // Skip if values are the same
        if (oldValue === newValue) continue;
        
        // Skip if new value is undefined (field not being updated)
        if (newValue === undefined) continue;
        
        const fieldLabel = config.label || field;
        const oldDisplay = config.formatter ? config.formatter(oldValue) : (oldValue || 'Not set');
        const newDisplay = config.formatter ? config.formatter(newValue) : (newValue || 'Not set');
        
        changes.push({
            field,
            fieldLabel,
            oldValue: oldValue,
            newValue: newValue,
            description: `Changed ${fieldLabel} from "${oldDisplay}" to "${newDisplay}"`
        });
    }
    
    return changes;
}

// GET all system settings
server.get('/api/admin/settings', requireAuth(['superadmin']), async (req, res) => {
    try {
        const result = await pool.query('SELECT setting_key, setting_value FROM system_settings');
        const settings = result.rows.reduce((acc, row) => {
            acc[row.setting_key] = row.setting_value;
            return acc;
        }, {});
        res.json(settings);
    } catch (e) {
        console.error('Admin get settings error:', e);
        res.status(500).json({ error: 'Failed to fetch system settings.' });
    }
});

// PUT to update system settings
server.put('/api/admin/settings', requireAuth(['superadmin']), async (req, res) => {
    const settings = req.body;
    if (typeof settings !== 'object' || settings === null) {
        return res.status(400).json({ error: 'Invalid settings format.' });
    }

    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        for (const key in settings) {
            if (Object.hasOwnProperty.call(settings, key)) {
                const value = JSON.stringify(settings[key]);
                const query = `
                    INSERT INTO system_settings (setting_key, setting_value)
                    VALUES ($1, $2)
                    ON CONFLICT (setting_key) DO UPDATE
                    SET setting_value = $2, updated_at = NOW()
                `;
                await client.query(query, [key, value]);
            }
        }
        await client.query('COMMIT');
        // Audit Log
        await logAuditEvent(req.auth.id, 'SETTINGS_UPDATED', { updatedKeys: Object.keys(settings) });
        res.json({ success: true, message: 'Settings updated successfully.' });
    } catch (e) {
        await client.query('ROLLBACK');
        console.error('Admin update settings error:', e);
        res.status(500).json({ error: 'Failed to update settings.' });
    } finally {
        client.release();
    }
});

// --- Super Admin: Audit Logs ---

// GET all audit logs with filtering
server.get('/api/admin/audit-logs', requireAuth(['superadmin']), async (req, res) => {
    try {
        const { startDate, endDate, userId, actionType } = req.query;
        let query = `
            SELECT 
                a.log_id, 
                a.user_id, 
                u.username, 
                a.action_type, 
                a.details, 
                a.created_at 
            FROM audit_logs a
            LEFT JOIN users u ON a.user_id = u.user_id
            WHERE 1=1
        `;
        const params = [];
        let paramIndex = 1;

        if (startDate) {
            query += ` AND a.created_at >= $${paramIndex++}`;
            params.push(startDate);
        }
        if (endDate) {
            query += ` AND a.created_at <= $${paramIndex++}`;
            params.push(endDate);
        }
        if (userId) {
            query += ` AND a.user_id = $${paramIndex++}`;
            params.push(userId);
        }
        if (actionType) {
            query += ` AND a.action_type = $${paramIndex++}`;
            params.push(actionType);
        }

        query += ' ORDER BY a.created_at DESC';

        const result = await pool.query(query, params);
        res.json(result.rows);
    } catch (e) {
        console.error('Admin get audit logs error:', e);
        res.status(500).json({ error: 'Failed to fetch audit logs.' });
    }
});

// --- Super Admin: Activity Monitor ---

// GET active user sessions
server.get('/api/admin/sessions', requireAuth(['superadmin']), async (req, res) => {
    try {
        const query = `
            SELECT 
                s.session_id,
                s.user_id,
                u.username,
                e.full_name,
                s.login_time,
                s.ip_address,
                s.device_info->>'userAgent' as user_agent
            FROM user_sessions s
            JOIN users u ON s.user_id = u.user_id
            LEFT JOIN employees e ON u.user_id = e.employee_id
            WHERE s.logout_time IS NULL
            ORDER BY s.login_time DESC
        `;
        const result = await pool.query(query);
        res.json(result.rows);
    } catch (e) {
        console.error('Admin get sessions error:', e);
        res.status(500).json({ error: 'Failed to fetch active sessions.' });
    }
});

// POST to forcefully log out a user session
server.post('/api/admin/sessions/:sessionId/logout', requireAuth(['superadmin']), async (req, res) => {
    const { sessionId } = req.params;
    const adminId = req.auth.id;

    try {
        const result = await pool.query(
            'UPDATE user_sessions SET logout_time = NOW() WHERE session_id = $1 AND logout_time IS NULL RETURNING user_id',
            [sessionId]
        );

        if (result.rowCount > 0) {
            const targetUserId = result.rows[0].user_id;
            await logAuditEvent(adminId, 'SESSION_LOGOUT_FORCED', { targetUserId, targetSessionId: sessionId });
            res.json({ success: true, message: 'Session logged out successfully.' });
        } else {
            res.status(404).json({ error: 'Active session not found.' });
        }
    } catch (e) {
        console.error('Admin force logout error:', e);
        res.status(500).json({ error: 'Failed to log out session.' });
    }
});


// --- HR Dashboard API ---

// QR Code Management for HR
server.get('/api/hr/qr/current', requireAuth(['hr', 'superadmin']), async (req, res) => {
    try {
        // Get current active QR session
        const result = await pool.query(`
            SELECT session_id, expires_at, created_at as issued_at, session_type as type
            FROM qr_sessions 
            WHERE is_active = true AND expires_at > NOW()
            ORDER BY created_at DESC 
            LIMIT 1
        `);
        
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'No active QR session found' });
        }
        
        const session = result.rows[0];
        // Generate QR code on-demand from session_id
        session.imageDataUrl = await QRCode.toDataURL(session.session_id, { margin: 1, width: 320 });
        
        res.json({ session });
    } catch (e) {
        console.error('Get current QR error:', e);
        res.status(500).json({ error: 'Failed to fetch current QR session.' });
    }
});

server.post('/api/hr/qr/generate', requireAuth(['hr', 'superadmin']), async (req, res) => {
    try {
        const { type = 'rotating', duration_hours = 24, duration_minutes } = req.body;
        const creator_id = req.auth.id;
        
        console.log('QR Generate request:', { type, duration_hours, duration_minutes, body: req.body });
        
        // Deactivate any existing sessions
        await pool.query('UPDATE qr_sessions SET is_active = false WHERE is_active = true');
        
        // Generate session ID (QR code will be generated on-demand)
        const sessionId = `qr_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        
        // Calculate expiration time - for rotating, default to 1 minute; for static, use hours
        let durationMs;
        if (type === 'rotating') {
            // For rotating QR codes, use 1 minute unless specifically overridden
            durationMs = duration_minutes ? 
                duration_minutes * 60 * 1000 : 
                1 * 60 * 1000; // Default 1 minute for rotating
        } else {
            // For static QR codes, use hours
            durationMs = duration_hours * 60 * 60 * 1000;
        }
        const expiresAt = new Date(Date.now() + durationMs);
        
        console.log('QR expiration calculation:', { type, duration_minutes, duration_hours, durationMs, durationMinutes: Math.round(durationMs / (1000 * 60)), expiresAt: expiresAt.toISOString() });
        
        // Store session without QR data - QR will be generated on-demand
        const result = await pool.query(`
            INSERT INTO qr_sessions (session_id, expires_at, created_by, session_type, is_active)
            VALUES ($1, $2, $3, $4, true)
            RETURNING session_id, expires_at, created_at as issued_at, session_type as type
        `, [sessionId, expiresAt, creator_id, type]);
        
        const session = result.rows[0];
        // Generate QR code on-demand for immediate response
        session.imageDataUrl = await QRCode.toDataURL(sessionId, { margin: 1, width: 320 });
        
        // Log audit event
        await logAuditEvent(creator_id, 'QR_GENERATED', { sessionId, type, expiresAt });
        
        res.json({ session, message: 'QR code generated successfully' });
    } catch (e) {
        console.error('Generate QR error:', e);
        res.status(500).json({ error: 'Failed to generate QR code.' });
    }
});

server.post('/api/hr/qr/revoke', requireAuth(['hr', 'superadmin']), async (req, res) => {
    try {
        const revoker_id = req.auth.id;
        
        // Deactivate all active sessions
        const result = await pool.query(`
            UPDATE qr_sessions 
            SET is_active = false, updated_at = NOW()
            WHERE is_active = true
            RETURNING session_id
        `);
        
        const revokedSessions = result.rows.map(r => r.session_id);
        
        // Log audit event
        await logAuditEvent(revoker_id, 'QR_REVOKED', { revokedSessions });
        
        res.json({ message: 'QR codes revoked successfully', revokedCount: result.rowCount });
    } catch (e) {
        console.error('Revoke QR error:', e);
        res.status(500).json({ error: 'Failed to revoke QR codes.' });
    }
});

// Employee Management for HR
server.get('/api/hr/employees', requireAuth(['hr', 'superadmin']), async (req, res) => {
    try {
        const { search, department, limit = 50, offset = 0 } = req.query;
        
        let query = `
            SELECT e.employee_id, e.full_name as name, e.email, e.phone, e.address, e.position,
                   d.dept_name as department, e.status, e.hire_date, e.created_at,
                   r.role_name as role, 
                   (SELECT MAX(login_time) FROM user_sessions WHERE user_id = e.employee_id) as last_login
            FROM employees e
            LEFT JOIN departments d ON e.dept_id = d.dept_id
            LEFT JOIN users u ON e.employee_id = u.user_id
            LEFT JOIN roles r ON u.role_id = r.role_id
            WHERE 1=1
        `;
        const params = [];
        let paramIndex = 1;
        
        if (search) {
            query += ` AND (e.full_name ILIKE $${paramIndex} OR e.email ILIKE $${paramIndex} OR e.employee_id::text ILIKE $${paramIndex})`;
            params.push(`%${search}%`);
            paramIndex++;
        }
        
        if (department) {
            query += ` AND lower(d.dept_name) = lower($${paramIndex})`;
            params.push(department);
            paramIndex++;
        }
        
        query += ` ORDER BY e.full_name ASC LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
        params.push(parseInt(limit), parseInt(offset));
        
        const result = await pool.query(query, params);
        res.json(result.rows);
    } catch (e) {
        console.error('Get HR employees error:', e);
        res.status(500).json({ error: 'Failed to fetch employees.' });
    }
});

// Get single employee by ID
server.get('/api/hr/employees/:id', requireAuth(['hr', 'superadmin']), async (req, res) => {
    try {
        const employee_id = parseInt(req.params.id, 10);
        
        if (isNaN(employee_id)) {
            return res.status(400).json({ error: 'Invalid employee ID.' });
        }
        
        const result = await pool.query(`
            SELECT e.employee_id, e.first_name, e.last_name, e.full_name, e.email, 
                   e.phone, e.position, e.dept_id, d.dept_name as department, 
                   e.status, e.hire_date, e.created_at,
                   (SELECT MAX(login_time) FROM user_sessions WHERE user_id = e.employee_id) as last_login
            FROM employees e
            LEFT JOIN departments d ON e.dept_id = d.dept_id
            WHERE e.employee_id = $1
        `, [employee_id]);
        
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Employee not found.' });
        }
        
        res.json(result.rows[0]);
    } catch (e) {
        console.error('Get employee error:', e);
        res.status(500).json({ error: 'Failed to fetch employee.' });
    }
});

server.post('/api/hr/employees', requireAuth(['hr', 'superadmin']), async (req, res) => {
    try {
        console.log('Create employee request received:', req.body);
        const { first_name, last_name, email, phone, address, position, role, status, dept_id, hire_date, password } = req.body;
        const creator_id = req.auth.id;
        
        console.log('Extracted fields:', { first_name, last_name, email, phone, position, role, status, dept_id, hire_date, password: password ? '[REDACTED]' : undefined, creator_id });
        
        if (!first_name || !last_name || !email || !password || !role || !status) {
            console.log('Validation failed: missing required fields');
            return res.status(400).json({ error: 'First name, last name, email, password, role, and status are required.' });
        }
        
        if (password.length < 6) {
            console.log('Validation failed: password too short');
            return res.status(400).json({ error: 'Password must be at least 6 characters long.' });
        }
        
        // Validate role
        const validRoles = ['employee', 'head_dept'];
        if (!validRoles.includes(role)) {
            console.log('Validation failed: invalid role:', role);
            return res.status(400).json({ error: 'Invalid role. Must be employee or head_dept.' });
        }
        
        // Validate status
        const validStatuses = ['active', 'inactive', 'suspended'];
        if (!validStatuses.includes(status)) {
            console.log('Validation failed: invalid status:', status);
            return res.status(400).json({ error: 'Invalid status. Must be active, inactive, or suspended.' });
        }
        
        // Validate phone format if provided
        if (phone && !/^\+63[0-9]{10}$/.test(phone)) {
            console.log('Validation failed: invalid phone format:', phone);
            return res.status(400).json({ error: 'Phone number must be in format: +63xxxxxxxxxx' });
        }
        
        console.log('All validation passed, checking for existing records...');
        
        // Check if email already exists in employees or users
        const existingEmployee = await pool.query('SELECT employee_id FROM employees WHERE email = $1', [email]);
        if (existingEmployee.rows.length > 0) {
            console.log('Validation failed: employee email already exists');
            return res.status(400).json({ error: 'Employee with this email already exists.' });
        }
        
        const existingUser = await pool.query('SELECT user_id FROM users WHERE username = $1', [email]);
        if (existingUser.rows.length > 0) {
            console.log('Validation failed: user email already exists');
            return res.status(400).json({ error: 'User account with this email already exists.' });
        }
        
        console.log('No existing records found, proceeding with creation...');
        
        // Hash the password
        const hashedPassword = await bcrypt.hash(password, 10);
        console.log('Password hashed successfully');
        
        // Start a transaction
        const client = await pool.connect();
        try {
            await client.query('BEGIN');
            console.log('Transaction started');
            
            // Create user account first to get the user_id
            console.log('Looking up role_id for role:', role);
            const roleResult = await client.query('SELECT role_id FROM roles WHERE role_name = $1', [role]);
            if (roleResult.rows.length === 0) {
                throw new Error(`Role '${role}' not found in database`);
            }
            console.log('Role found:', roleResult.rows[0]);
            
            console.log('Creating user account with:', { username: email, role_id: roleResult.rows[0].role_id, creator_id });
            const userResult = await client.query(`
                INSERT INTO users (username, password_hash, role_id, first_login, created_by)
                VALUES ($1, $2, $3, true, $4)
                RETURNING user_id
            `, [email, hashedPassword, roleResult.rows[0].role_id, creator_id]);
            
            const userId = userResult.rows[0].user_id;
            console.log('User account created successfully with user_id:', userId);
            
            // Create employee record with matching employee_id
            console.log('Creating employee record with:', { employee_id: userId, first_name, last_name, email, phone, address, position, dept_id, hire_date, status, creator_id });
            const employeeResult = await client.query(`
                INSERT INTO employees (employee_id, first_name, last_name, email, phone, address, position, dept_id, hire_date, status, created_by)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
                RETURNING employee_id, first_name, last_name, email, phone, address, position, dept_id, hire_date, status
            `, [userId, first_name, last_name, email, phone, address, position, dept_id, hire_date, status, creator_id]);
            
            const employee = employeeResult.rows[0];
            console.log('Employee record created:', employee);
            
            await client.query('COMMIT');
            console.log('Transaction committed');
            
            // Log audit event
            await logAuditEvent(creator_id, 'EMPLOYEE_CREATED', { 
                employeeId: employee.employee_id, 
                userId: userId,
                email,
                role: role,
                status: status,
                userAccountCreated: true 
            });
            
            console.log('Employee creation completed successfully');
            res.status(201).json(employee);
        } catch (error) {
            await client.query('ROLLBACK');
            console.log('Transaction rolled back due to error');
            throw error;
        } finally {
            client.release();
        }
    } catch (e) {
        console.error('Create employee error:', e);
        console.error('Request body was:', req.body);
        console.error('Stack trace:', e.stack);
        res.status(500).json({ error: 'Failed to create employee: ' + e.message });
    }
});

server.put('/api/hr/employees/:id', requireAuth(['hr', 'superadmin']), async (req, res) => {
    try {
        const employeeId = parseInt(req.params.id, 10);
        const { first_name, last_name, email, phone, address, position, dept_id, status } = req.body;
        const updater_id = req.auth.id;
        
        if (!first_name || !last_name || !email) {
            return res.status(400).json({ error: 'First name, last name, and email are required.' });
        }
        
        // Validate status if provided
        if (status && !['active', 'inactive', 'suspended'].includes(status)) {
            return res.status(400).json({ error: 'Invalid status. Must be active, inactive, or suspended.' });
        }
        
        // Validate phone format if provided
        if (phone && !/^\+63[0-9]{10}$/.test(phone)) {
            return res.status(400).json({ error: 'Phone number must be in format: +63xxxxxxxxxx' });
        }
        
        // Check if email exists for another employee
        const existingEmployee = await pool.query(
            'SELECT employee_id FROM employees WHERE email = $1 AND employee_id != $2', 
            [email, employeeId]
        );
        if (existingEmployee.rows.length > 0) {
            return res.status(400).json({ error: 'Email is already used by another employee.' });
        }
        
        const result = await pool.query(`
            UPDATE employees 
            SET first_name = $1, last_name = $2, email = $3, phone = $4, address = $5, position = $6, dept_id = $7, status = $8
            WHERE employee_id = $9
            RETURNING employee_id, first_name, last_name, email, phone, address, position, dept_id, status, hire_date
        `, [first_name, last_name, email, phone, address, position, dept_id, status, employeeId]);
        
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Employee not found.' });
        }
        
        // Log audit event
        await logAuditEvent(updater_id, 'EMPLOYEE_UPDATED', { employeeId, email });
        
        res.json(result.rows[0]);
    } catch (e) {
        console.error('Update employee error:', e);
        res.status(500).json({ error: 'Failed to update employee.' });
    }
});

server.delete('/api/hr/employees/:id', requireAuth(['hr', 'superadmin']), async (req, res) => {
    try {
        const employeeId = parseInt(req.params.id, 10);
        const deleter_id = req.auth.id;
        
        // Soft delete by setting status to 'inactive'
        const result = await pool.query(`
            UPDATE employees 
            SET status = 'inactive'
            WHERE employee_id = $1
            RETURNING employee_id, full_name, email
        `, [employeeId]);
        
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Employee not found.' });
        }
        
        // Log audit event
        await logAuditEvent(deleter_id, 'EMPLOYEE_DELETED', { 
            employeeId, 
            email: result.rows[0].email,
            name: result.rows[0].full_name 
        });
        
        res.json({ message: 'Employee deactivated successfully.' });
    } catch (e) {
        console.error('Delete employee error:', e);
        res.status(500).json({ error: 'Failed to delete employee.' });
    }
});

// Attendance Reports for HR
server.get('/api/hr/attendance', requireAuth(['hr', 'superadmin']), async (req, res) => {
    try {
        const { date, department, employee_id, start_date, end_date } = req.query;
        
        let query = `
            SELECT a.attendance_id, a.employee_id, e.full_name as employee_name, e.email,
                   d.dept_name as department, a.date, a.time_in, a.time_out, a.status,
                   a.location, a.ip_address, a.created_at as timestamp
            FROM attendance a
            JOIN employees e ON a.employee_id = e.employee_id
            LEFT JOIN departments d ON e.dept_id = d.dept_id
            WHERE 1=1
        `;
        const params = [];
        let paramIndex = 1;
        
        if (date) {
            query += ` AND a.date = $${paramIndex++}`;
            params.push(date);
        } else if (start_date && end_date) {
            query += ` AND a.date BETWEEN $${paramIndex++} AND $${paramIndex++}`;
            params.push(start_date, end_date);
        } else {
            // Default to today if no date filter
            query += ` AND a.date = CURRENT_DATE`;
        }
        
        if (department) {
            query += ` AND lower(d.dept_name) = lower($${paramIndex++})`;
            params.push(department);
        }
        
        if (employee_id) {
            query += ` AND a.employee_id = $${paramIndex++}`;
            params.push(parseInt(employee_id));
        }
        
        query += ' ORDER BY a.date DESC, a.time_in DESC';
        
        const result = await pool.query(query, params);
        res.json(result.rows);
    } catch (e) {
        console.error('Get HR attendance error:', e);
        res.status(500).json({ error: 'Failed to fetch attendance records.' });
    }
});

// Attendance Override for HR
server.post('/api/hr/attendance/override', requireAuth(['hr', 'superadmin']), async (req, res) => {
    try {
        const { employee_id, date, time_in, time_out, status, reason } = req.body;
        const creator_id = req.auth.id;
        
        if (!employee_id || !date || !status) {
            return res.status(400).json({ error: 'Employee ID, date, and status are required.' });
        }
        
        // Check if employee exists
        const employeeCheck = await pool.query('SELECT employee_id FROM employees WHERE employee_id = $1', [employee_id]);
        if (employeeCheck.rows.length === 0) {
            return res.status(404).json({ error: 'Employee not found.' });
        }
        
        // Check if attendance record already exists for this date
        const existingRecord = await pool.query(
            'SELECT attendance_id FROM attendance WHERE employee_id = $1 AND date = $2',
            [employee_id, date]
        );
        
        let result;
        if (existingRecord.rows.length > 0) {
            // Update existing record
            result = await pool.query(`
                UPDATE attendance 
                SET time_in = $1, time_out = $2, status = $3, override_reason = $4, 
                    overridden_by = $5, overridden_at = NOW()
                WHERE employee_id = $6 AND date = $7
                RETURNING attendance_id, employee_id, date, time_in, time_out, status
            `, [time_in, time_out, status, reason, creator_id, employee_id, date]);
        } else {
            // Create new record
            result = await pool.query(`
                INSERT INTO attendance (employee_id, date, time_in, time_out, status, override_reason, overridden_by, overridden_at)
                VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
                RETURNING attendance_id, employee_id, date, time_in, time_out, status
            `, [employee_id, date, time_in, time_out, status, reason, creator_id]);
        }
        
        // Log audit event
        await logAuditEvent(creator_id, 'ATTENDANCE_OVERRIDE', { 
            employeeId: employee_id, 
            date, 
            status, 
            reason,
            action: existingRecord.rows.length > 0 ? 'updated' : 'created'
        });
        
        res.json({ 
            message: 'Attendance record updated successfully.',
            record: result.rows[0]
        });
    } catch (e) {
        console.error('Attendance override error:', e);
        res.status(500).json({ error: 'Failed to override attendance record.' });
    }
});

// Departments list for HR
server.get('/api/hr/departments', requireAuth(['hr', 'superadmin']), async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT dept_id, dept_name, description, head_id,
                   (SELECT full_name FROM employees WHERE employee_id = d.head_id) as head_name
            FROM departments d
            ORDER BY dept_name ASC
        `);
        res.json(result.rows);
    } catch (e) {
        console.error('Get departments error:', e);
        res.status(500).json({ error: 'Failed to fetch departments.' });
    }
});

// Basic departments list for all authenticated users (for profile modal)
server.get('/api/departments', requireAuth([]), async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT dept_id, dept_name
            FROM departments
            ORDER BY dept_name ASC
        `);
        res.json(result.rows);
    } catch (e) {
        console.error('Get departments error:', e);
        res.status(500).json({ error: 'Failed to fetch departments.' });
    }
});

// Update department head assignment
server.put('/api/hr/departments/:id/head', requireAuth(['hr', 'superadmin']), async (req, res) => {
    try {
        const deptId = parseInt(req.params.id);
        const { head_id } = req.body;
        
        // Validate department exists
        const deptCheck = await pool.query('SELECT dept_id, dept_name FROM departments WHERE dept_id = $1', [deptId]);
        if (deptCheck.rows.length === 0) {
            return res.status(404).json({ error: 'Department not found.' });
        }
        
        // If head_id is provided, validate it exists and is a department head
        if (head_id) {
            const headCheck = await pool.query(`
                SELECT e.employee_id, e.full_name, u.role_id, r.role_name 
                FROM employees e 
                JOIN users u ON e.employee_id = u.user_id 
                JOIN roles r ON u.role_id = r.role_id 
                WHERE e.employee_id = $1
            `, [head_id]);
            
            if (headCheck.rows.length === 0) {
                return res.status(400).json({ error: 'Employee not found.' });
            }
            
            if (headCheck.rows[0].role_name !== 'head_dept') {
                return res.status(400).json({ error: 'Employee must have Department Head role.' });
            }
        }
        
        // Update department head
        await pool.query('UPDATE departments SET head_id = $1 WHERE dept_id = $2', [head_id || null, deptId]);
        
        // Log audit event
        await logAuditEvent(req.auth.id, 'DEPARTMENT_HEAD_ASSIGNED', {
            departmentId: deptId,
            departmentName: deptCheck.rows[0].dept_name,
            headId: head_id,
            action: head_id ? 'assigned' : 'removed'
        });
        
        res.json({ 
            success: true, 
            message: head_id ? 'Department head assigned successfully.' : 'Department head removed successfully.' 
        });
        
    } catch (e) {
        console.error('Update department head error:', e);
        res.status(500).json({ error: 'Failed to update department head.' });
    }
});


// --- Request Management API ---

server.get('/api/requests/pending', requireAuth(['head_dept', 'hr', 'superadmin']), async (req, res) => {
    try {
        const { department } = req.query;
        const { role, id } = req.auth;

        let query = `
            SELECT r.request_id as id, r.type as request_type, r.details, r.status,
                   e.full_name as employee_name,
                   d.dept_name,
                   COALESCE(
                       (r.details->>'start_date')::date, 
                       (r.details->>'date')::date
                   ) as start_date,
                   COALESCE(
                       (r.details->>'end_date')::date, 
                       (r.details->>'date')::date
                   ) as end_date,
                   COALESCE(
                       r.details->>'reason',
                       r.details->>'description'
                   ) as reason,
                   r.details as raw_details
            FROM requests r
            JOIN employees e ON r.employee_id = e.employee_id
            LEFT JOIN departments d ON e.dept_id = d.dept_id
            WHERE r.status = 'pending'
        `;
        const params = [];
        let paramIndex = 1;

        if (role === 'head_dept') {
            query += ` AND d.head_id = $${paramIndex++}`;
            params.push(id);
        } else if (department) {
            query += ` AND lower(d.dept_name) = lower($${paramIndex++})`;
            params.push(department);
        }

        query += ' ORDER BY r.created_at ASC';

        const result = await pool.query(query, params);
        return res.json(result.rows);
    } catch (e) {
        console.error('get pending requests error', e);
        return res.status(500).json({ error: 'Failed to fetch pending requests.' });
    }
});

server.put('/api/requests/:id/status', requireAuth(['head_dept', 'hr', 'superadmin']), async (req, res) => {
    try {
        const requestId = parseInt(req.params.id, 10);
        const { status } = req.body;
        const approver_id = req.auth.id;

        if (isNaN(requestId) || !['approved', 'declined'].includes(status)) {
            return res.status(400).json({ error: 'Invalid request ID or status.' });
        }

        const q = `
            UPDATE requests
            SET status = $1, approved_by = $2, updated_at = NOW()
            WHERE request_id = $3 AND status = 'pending'
            RETURNING *
        `;
        const result = await pool.query(q, [status, approver_id, requestId]);

        if (result.rowCount === 0) {
            return res.status(404).json({ error: 'Request not found or already actioned.' });
        }
        
        console.log(`[requests] Request ${requestId} was ${status} by user ${approver_id}`);
        return res.json(result.rows[0]);
    } catch (e) {
        console.error('update request status error', e);
        return res.status(500).json({ error: 'Failed to update request status.' });
    }
});

server.post('/api/requests', requireAuth([]), async (req, res) => {
    try {
        // Accept either `request_type` (frontend) or `type` (db-friendly)
        const body = req.body || {};
        const request_type = body.request_type || body.type;
        const details = body.details;
        const employee_id = req.auth.employee_id;

        if (!employee_id) {
            return res.status(400).json({ error: 'Only employees can create requests.' });
        }
        if (!['leave', 'overtime', 'correction'].includes(request_type)) {
            return res.status(400).json({ error: 'Invalid request_type.' });
        }
        if (!details || typeof details !== 'object') {
            return res.status(400).json({ error: 'Details must be a valid JSON object.' });
        }

        const q = `
            INSERT INTO requests (employee_id, type, details)
            VALUES ($1, $2, $3)
            RETURNING *
        `;
        const result = await pool.query(q, [employee_id, request_type, details]);
        console.log(`[requests] New ${request_type} request created for employee ${employee_id}`);
        // normalize response for frontend (keep request_type key)
        const row = result.rows[0];
        if (row) row.request_type = row.type;
        return res.status(201).json(row);
    } catch (e) {
        console.error('request creation error', e);
        return res.status(500).json({ error: 'Failed to create request.' });
    }
});

server.get('/api/requests', requireAuth([]), async (req, res) => {
    try {
        const { id, role, employee_id } = req.auth;
        const { status, type } = req.query;

        let query = `
            SELECT r.*, r.type as request_type, e.full_name as employee_name, d.dept_name
            FROM requests r
            JOIN employees e ON r.employee_id = e.employee_id
            LEFT JOIN departments d ON e.dept_id = d.dept_id
            WHERE 1=1
        `;
        const params = [];

        if (role === 'employee') {
            params.push(employee_id);
            query += ` AND r.employee_id = $${params.length}`;
        } else if (role === 'department_head') {
            // A department head sees requests from their department members
            params.push(id); // The head's user_id
            query += ` AND e.dept_id = (SELECT dept_id FROM departments WHERE head_id = $${params.length})`;
        }
        // HR and Super Admin see all requests, so no additional filtering by user.

        if (status) {
            params.push(status);
            query += ` AND r.status = $${params.length}`;
        }
        if (type) {
            params.push(type);
            query += ` AND r.type = $${params.length}`;
        }

        query += ' ORDER BY r.created_at DESC';

        const result = await pool.query(query, params);
        return res.json(result.rows);
    } catch (e) {
        console.error('get requests error', e);
        return res.status(500).json({ error: 'Failed to fetch requests.' });
    }
});

server.put('/api/requests/:id', requireAuth(['hr', 'super_admin', 'department_head']), async (req, res) => {
    try {
        const requestId = parseInt(req.params.id, 10);
        const { status } = req.body;
        const approver_id = req.auth.id;
        const approver_role = req.auth.role;

        if (isNaN(requestId)) {
            return res.status(400).json({ error: 'Invalid request ID.' });
        }
        if (!['approved', 'declined'].includes(status)) {
            return res.status(400).json({ error: 'Invalid status. Must be "approved" or "declined".' });
        }

        // Optional: Add logic to ensure a department head can only approve requests from their department
        if (approver_role === 'department_head') {
            const checkQuery = `
                SELECT 1 FROM requests r
                JOIN employees e ON r.employee_id = e.employee_id
                JOIN departments d ON e.dept_id = d.dept_id
                WHERE r.request_id = $1 AND d.head_id = $2
            `;
            const checkResult = await pool.query(checkQuery, [requestId, approver_id]);
            if (checkResult.rowCount === 0) {
                return res.status(403).json({ error: 'Forbidden: You can only approve requests from your department.' });
            }
        }

        const q = `
            UPDATE requests
            SET status = $1, approved_by = $2, updated_at = NOW()
            WHERE request_id = $3 AND status = 'pending'
            RETURNING *
        `;
        const result = await pool.query(q, [status, approver_id, requestId]);

                if (result.rowCount === 0) {
            return res.status(404).json({ error: 'Request not found, already actioned, or you do not have permission.' });
        }
        
        console.log(`[requests] Request ${requestId} was ${status} by user ${approver_id}`);
        // TODO: In the next step, we will create a notification here.
        // Create a notification for the user
        const requestResult = result.rows[0];
        const message = `Your ${requestResult.request_type} request (ID: ${requestResult.request_id}) has been ${status}.`;
        await pool.query(
            'INSERT INTO notifications (user_id, message) VALUES ($1, $2)',
            [requestResult.employee_id, message]
        );
        console.log(`[notifications] Created notification for user ${requestResult.employee_id}`);


        return res.json(result.rows[0]);
    } catch (e) {
        console.error('update request error', e);
        return res.status(500).json({ error: 'Failed to update request.' });
    }
});

// --- Notifications API ---

// GET /api/notifications - Get unread notifications for the current user
server.get('/api/notifications', requireAuth([]), async (req, res) => {
    try {
        const userId = req.auth.id;
        const q = `
            SELECT * FROM notifications 
            WHERE user_id = $1 AND status = 'unread' 
            ORDER BY created_at DESC
        `;
        const result = await pool.query(q, [userId]);
        return res.json(result.rows);
    } catch (e) {
        console.error('get notifications error', e);
        return res.status(500).json({ error: 'Failed to fetch notifications.' });
    }
});

// PUT /api/notifications/mark-read - Mark specific or all notifications as read
server.put('/api/notifications/mark-read', requireAuth([]), async (req, res) => {
    try {
        const userId = req.auth.id;
        const { ids } = req.body; // ids can be an array of notification IDs or null/undefined for all

        let q;
        const params = [userId];

        if (Array.isArray(ids) && ids.length > 0) {
            // Mark specific notifications as read
            const placeholders = ids.map((_, i) => `$${i + 2}`).join(',');
            q = `UPDATE notifications SET status = 'read' WHERE user_id = $1 AND notif_id IN (${placeholders}) AND status = 'unread'`;
            params.push(...ids);
        } else {
            // Mark all notifications as read
            q = `UPDATE notifications SET status = 'read' WHERE user_id = $1 AND status = 'unread'`;
        }

        const result = await pool.query(q, params);
        console.log(`[notifications] Marked ${result.rowCount} notification(s) as read for user ${userId}`);
        return res.json({ ok: true, count: result.rowCount });
    } catch (e) {
        console.error('mark notifications read error', e);
        return res.status(500).json({ error: 'Failed to update notifications.' });
    }
});

// --- Account Management ---

// PUT /api/account/password - Change user password
server.put('/api/account/password', requireAuth([]), async (req, res) => {
    try {
        const userId = req.auth.id;
        const { currentPassword, newPassword } = req.body;

        if (!currentPassword || !newPassword) {
            return res.status(400).json({ error: 'Current password and new password are required.' });
        }
        if (newPassword.length < 8) {
            return res.status(400).json({ error: 'New password must be at least 8 characters long.' });
        }

        // Get current user's hash
        const userResult = await pool.query('SELECT password_hash FROM users WHERE user_id = $1', [userId]);
        if (userResult.rowCount === 0) {
            return res.status(404).json({ error: 'User not found.' });
        }
        const { password_hash } = userResult.rows[0];

        // Verify current password
        const isMatch = await bcrypt.compare(currentPassword, password_hash);
        if (!isMatch) {
            return res.status(401).json({ error: 'Incorrect current password.' });
        }

        // Hash new password
        const newPasswordHash = await bcrypt.hash(newPassword, 10);

        // Update password in DB
        await pool.query('UPDATE users SET password_hash = $1, updated_at = NOW() WHERE user_id = $2', [newPasswordHash, userId]);

        console.log(`[account] User ${userId} changed their password successfully.`);
        return res.json({ ok: true, message: 'Password updated successfully.' });
    } catch (e) {
        console.error('change password error', e);
        return res.status(500).json({ error: 'Failed to change password.' });
    }
});

// Health endpoint (placed at /health instead of /api/health to avoid json-server router conflicts)
server.get('/health', async (req, res) => {
    const requester = req.ip || req.connection && req.connection.remoteAddress || 'unknown';
    const ua = req.get('User-Agent') || 'unknown';
    console.log(`[server] /health requested from ${requester} - UA: ${ua}`);
    try{
        const r = await pool.query('SELECT now() as now');
        const nowIso = (r.rows && r.rows[0] && r.rows[0].now) ? r.rows[0].now.toISOString() : null;
        console.log(`[server] /health OK - db now=${nowIso}`);
        return res.json({ ok: true, db: { ok: true, now: nowIso } });
    }catch(e){
        console.error('[server] /health FAILED -', e.message || e);
        return res.status(503).json({ ok: false, db: { ok: false, error: (e && e.message) ? e.message : String(e) } });
    }
});

// mount router
server.use('/api', router);

// helper to mask a database connection string (hide password)
function maskDatabaseUrl(conn){
    try{
        // basic parsing: postgresql://user:pass@host:port/db
        const m = conn.match(/^(postgres(?:ql)?:\/\/)([^:]+)(:([^@]+))?@([^\/]+)(\/.*)?$/i);
        if (!m) return conn.replace(/:.+@/, ':*****@');
        const proto = m[1];
        const user = m[2];
        const pass = m[4] ? '*****' : '';
        const host = m[5] || '';
        const db = m[6] || '';
        return `${proto}${user}${pass}@${host}${db}`;
    }catch(e){ return 'postgres://****'; }
}

const PORT = process.env.PORT || 5000;

// Enhanced Postgres connectivity check with retry logic
async function checkPostgresConnection(retries = 3) {
    for (let i = 0; i < retries; i++) {
        try {
            console.log(`[server] Attempting database connection (attempt ${i + 1}/${retries})...`);
            const r = await pool.query('SELECT now() as now, version() as version');
            const now = (r.rows && r.rows[0] && r.rows[0].now) ? r.rows[0].now.toISOString() : null;
            const version = (r.rows && r.rows[0] && r.rows[0].version) ? r.rows[0].version : null;
            console.log('[server] ✅ Postgres connected successfully');
            console.log(`[server] Database time: ${now}`);
            console.log(`[server] Database version: ${version ? version.substring(0, 50) + '...' : 'Unknown'}`);
            return true;
        } catch (e) {
            console.error(`[server] ❌ Database connection attempt ${i + 1} failed:`, e.message || e);
            if (i < retries - 1) {
                console.log(`[server] Retrying in 2 seconds...`);
                await new Promise(resolve => setTimeout(resolve, 2000));
            }
        }
    }
    console.error('[server] ⚠️  All database connection attempts failed. Server will continue but database operations may fail.');
    console.error('[server] Database URL (masked):', maskDatabaseUrl(PG_CONN));
    console.error('[server] SSL config:', poolConfig.ssl ? 'Enabled' : 'Disabled');
    return false;
}

// Run connectivity check
checkPostgresConnection();

// Handle pool errors
pool.on('error', (err, client) => {
    console.error('[server] Database pool error:', err.message || err);
});

server.listen(PORT, () => {
    console.log(`Mock server running at http://localhost:${PORT}`);
    console.log('[server] API mount: /api  (json-server router + custom routes)');
    console.log('[server] Serving static files from:', publicPath);
    console.log('[server] Database:', maskDatabaseUrl(PG_CONN));
    console.log('[server] JWT secret set?', !!process.env.JWT_SECRET);
    console.log('[server] Environment:', process.env.NODE_ENV || 'development');
});
 