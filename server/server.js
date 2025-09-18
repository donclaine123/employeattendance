const jsonServer = require('json-server');
const path = require('path');
const bodyParser = require('body-parser');
const cors = require('cors');

const server = jsonServer.create();
const router = jsonServer.router(path.join(__dirname, 'db.json'));
const middlewares = jsonServer.defaults({ static: 'public' });
const jwt = require('jsonwebtoken');
const SECRET = process.env.JWT_SECRET || 'dev-secret-key';

const QRCode = require('qrcode');
const { v4: uuidv4 } = require('uuid');
const { Pool } = require('pg');

// Postgres connection - expects DATABASE_URL env var or falls back to localhost
const PG_CONN = process.env.DATABASE_URL || 'postgresql://workline:secret@localhost:5432/workline';
const pool = new Pool({ connectionString: PG_CONN });

// allow cross-origin requests (handles OPTIONS preflight)
server.use(cors());

// serve the SPA static files from ../public
const publicPath = path.join(__dirname, '..', 'public');
server.use(jsonServer.defaults({ static: publicPath }));
server.use(expressStaticFallback = (req, res, next) => { next(); });

server.use(middlewares);
server.use(bodyParser.json());

// simple login route
server.post('/api/login', async (req, res) => {
    const { email, password } = req.body || {};
    if (!email || !password) return res.status(400).json({ error: 'Missing email or password' });
    try{
        const q = 'SELECT id, email, password, role, redirect FROM users WHERE lower(email)=lower($1) LIMIT 1';
        const r = await pool.query(q, [email]);
        if (!r.rows || r.rows.length === 0) return res.status(401).json({ error: 'Invalid credentials' });
        const user = r.rows[0];
        // NOTE: passwords are currently stored plaintext in seed; replace with bcrypt in future
        if (user.password !== password) return res.status(401).json({ error: 'Invalid credentials' });

        // try to find employee mapping
        const er = await pool.query('SELECT id, employee_id FROM employees WHERE lower(email)=lower($1) LIMIT 1', [email]);
        const emp = (er.rows && er.rows[0]) ? er.rows[0] : null;

        const safe = { id: user.id, email: user.email, role: user.role, redirect: user.redirect };
        if (emp){ safe.employee_id = emp.employee_id; safe.employee_db_id = emp.id; }

        const token = jwt.sign({ id: safe.id, email: safe.email, role: safe.role, employee_id: safe.employee_id || null }, SECRET, { expiresIn: '8h' });
        return res.json({ user: safe, token });
    }catch(e){ console.error('login error', e); return res.status(500).json({ error: 'login failed' }); }
});

// simple middleware to protect HR endpoints
function requireAuth(allowedRoles){
    return function(req, res, next){
        const auth = req.headers && (req.headers.authorization || req.headers.Authorization);
        if (!auth || !auth.startsWith('Bearer ')) return res.status(401).json({ error: 'missing auth' });
        const token = auth.slice('Bearer '.length);
        try{
            const payload = jwt.verify(token, SECRET);
            req.auth = payload; // attach user data
            if (allowedRoles && allowedRoles.length && (!payload.role || !allowedRoles.includes(payload.role))){
                return res.status(403).json({ error: 'forbidden' });
            }
            return next();
        }catch(e){ return res.status(401).json({ error: 'invalid token' }); }
    };
}

// Helper: ensure qr_sessions exists
function ensureQrSessions(db){ if (!db.has('qr_sessions').value()) db.set('qr_sessions', []).write(); }

// helper: convert DB row -> session object
function rowToSession(row){ if (!row) return null; return { session_id: row.session_id, type: row.type, window_id: row.window_id, issued_at: row.issued_at ? row.issued_at.toISOString() : null, expires_at: row.expires_at ? row.expires_at.toISOString() : null, status: row.status }; }

// cleanup: remove expired sessions (both rotating and static)
async function cleanupExpiredQrSessions(){
    try{
        await pool.query("DELETE FROM qr_sessions WHERE expires_at IS NOT NULL AND expires_at < NOW()");
    }catch(e){ console.warn('qr cleanup failed:', e.message || e); }
}

// Return current rotating session or create one
server.post('/api/hr/qr/generate', requireAuth(['hr','superadmin']), async (req, res) => {
    try{
        await cleanupExpiredQrSessions();
        const type = (req.body && req.body.type) || 'rotating';
        const now = Date.now();
        const windowId = Math.floor(Math.floor(now/1000) / 60);

        if (type === 'rotating'){
            // look for existing active rotating session for this window
            const sel = await pool.query('SELECT * FROM qr_sessions WHERE type=$1 AND window_id=$2 AND status=$3 LIMIT 1', ['rotating', windowId, 'active']);
            let row = (sel.rows && sel.rows[0]) ? sel.rows[0] : null;
            if (!row){
                const sessionId = uuidv4();
                const windowStart = Math.floor(now/1000/60)*60*1000;
                const expiresAt = new Date(windowStart + 60*1000).toISOString();
                await pool.query('INSERT INTO qr_sessions(session_id, type, window_id, issued_at, expires_at, status) VALUES($1,$2,$3,$4,$5,$6)', [sessionId, 'rotating', windowId, new Date().toISOString(), expiresAt, 'active']);
                const rr = await pool.query('SELECT * FROM qr_sessions WHERE session_id=$1 LIMIT 1', [sessionId]);
                row = rr.rows[0];
            }
            const session = rowToSession(row);
            const dataUrl = await QRCode.toDataURL(session.session_id, { margin:1, width:320 });
            return res.json({ session: Object.assign({}, session, { imageDataUrl: dataUrl }) });
        } else {
            const ttl = (req.body && req.body.ttlSeconds) || 900;
            const sessionId = uuidv4();
            const issuedAt = new Date().toISOString();
            const expiresAt = new Date(Date.now() + ttl*1000).toISOString();
            await pool.query('INSERT INTO qr_sessions(session_id,type,window_id,issued_at,expires_at,status) VALUES($1,$2,$3,$4,$5,$6)', [sessionId,'static', null, issuedAt, expiresAt, 'active']);
            const rr = await pool.query('SELECT * FROM qr_sessions WHERE session_id=$1 LIMIT 1', [sessionId]);
            const session = rowToSession(rr.rows[0]);
            const dataUrl = await QRCode.toDataURL(sessionId, { margin:1, width:320 });
            return res.json({ session: Object.assign({}, session, { imageDataUrl: dataUrl }) });
        }
    }catch(e){ console.error('generate qr error', e); return res.status(500).json({ error: 'failed to generate QR' }); }
});

// get current rotating session (and optional active static)
server.get('/api/hr/qr/current', async (req, res) => {
    try{
        await cleanupExpiredQrSessions();
        const now = Date.now();
        const windowId = Math.floor(Math.floor(now/1000) / 60);
        let sel = await pool.query('SELECT * FROM qr_sessions WHERE type=$1 AND window_id=$2 AND status=$3 LIMIT 1', ['rotating', windowId, 'active']);
        let row = (sel.rows && sel.rows[0]) ? sel.rows[0] : null;
        if (!row){
            // lazily create a rotating session for the current minute window
            const sessionId = uuidv4();
            const windowStart = Math.floor(now/1000/60)*60*1000;
            const expiresAt = new Date(windowStart + 60*1000).toISOString();
            await pool.query('INSERT INTO qr_sessions(session_id, type, window_id, issued_at, expires_at, status) VALUES($1,$2,$3,$4,$5,$6)', [sessionId, 'rotating', windowId, new Date().toISOString(), expiresAt, 'active']);
            const rr = await pool.query('SELECT * FROM qr_sessions WHERE session_id=$1 LIMIT 1', [sessionId]);
            row = rr.rows[0];
        }
        const session = rowToSession(row);
        const dataUrl = await QRCode.toDataURL(session.session_id, { margin:1, width:320 });
        return res.json({ session: Object.assign({}, session, { imageDataUrl: dataUrl }) });
    }catch(e){ console.error('current qr error', e); return res.status(500).json({ error: 'failed to fetch current QR' }); }
});

// revoke session
server.post('/api/hr/qr/revoke', requireAuth(['hr','superadmin']), async (req, res) => {
    try{
        const id = req.body && req.body.session_id;
        const hardDelete = !!(req.body && req.body.hardDelete);
        if (!id) return res.status(400).json({ error: 'missing session_id' });

        if (hardDelete){
            // Permanently remove the QR session from the database
            const del = await pool.query('DELETE FROM qr_sessions WHERE session_id=$1', [id]);
            if (!del || del.rowCount === 0) return res.status(404).json({ error: 'session not found' });
            await cleanupExpiredQrSessions();
            return res.json({ ok: true, deleted: del.rowCount });
        } else {
            // Backward compatible: mark as revoked but keep the record
            const upd = await pool.query('UPDATE qr_sessions SET status=$1 WHERE session_id=$2 RETURNING *', ['revoked', id]);
            if (!upd.rows || upd.rows.length === 0) return res.status(404).json({ error: 'session not found' });
            // also cleanup expired rows opportunistically
            await cleanupExpiredQrSessions();
            return res.json({ ok:true });
        }
    }catch(e){ console.error('revoke error', e); return res.status(500).json({ error: 'failed to revoke' }); }
});

// mark attendance - append to db.json attendance array
server.post('/api/attendance', async (req, res) => {
    try{
        const body = req.body || {};
        const record = {
            email: body.email || null,
            qr: body.qr || null,
            note: body.note || null,
            timestamp: new Date().toISOString(),
            status: body.status || 'On Time'
        };
        const ins = await pool.query('INSERT INTO attendance(employee_id, session_id, date_key, timestamp, location, device_info, status, notes) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *', [record.email, record.qr, new Date().toISOString().slice(0,10), record.timestamp, null, null, record.status, record.note]);
        return res.status(201).json(ins.rows[0]);
    }catch(e){ console.error('attendance post error', e); return res.status(500).json({ error: 'failed to post attendance' }); }
});

// Fetch today's attendance with optional department filter; joins employees for display fields
server.get('/api/attendance', async (req, res) => {
    try{
        const today = new Date().toISOString().slice(0,10);
        const dept = (req.query && req.query.department) ? String(req.query.department) : null;
        let sql = `
            SELECT a.employee_id, a.session_id, a.date_key, a.timestamp, a.status,
                   e.name as employee_name, e.department as employee_department
            FROM attendance a
            LEFT JOIN employees e ON (e.employee_id = a.employee_id OR e.id::text = a.employee_id OR lower(e.email) = lower(a.employee_id))
            WHERE a.date_key = $1
        `;
        const params = [today];
        if (dept){
            sql += ' AND lower(e.department) = lower($2)';
            params.push(dept);
        }
        sql += ' ORDER BY a.timestamp DESC NULLS LAST';
        const r = await pool.query(sql, params);
        return res.json(Array.isArray(r.rows) ? r.rows : []);
    }catch(e){ console.error('attendance fetch error', e); return res.status(500).json({ error: 'failed to fetch attendance' }); }
});

// check-in using a QR session (validates session, one check-in per employee per day)
server.post('/api/attendance/checkin', async (req, res) => {
    try{
        const body = req.body || {};
        const { session_id, employee_id, lat, lon, deviceInfo } = body;
        if (!session_id || !employee_id) return res.status(400).json({ error: 'missing session_id or employee_id' });

        // find session in Postgres
        const selt = await pool.query('SELECT * FROM qr_sessions WHERE session_id=$1 LIMIT 1', [session_id]);
        const sessionRow = (selt.rows && selt.rows[0]) ? selt.rows[0] : null;
        if (!sessionRow) return res.status(404).json({ error: 'session not found' });
        if (sessionRow.status !== 'active') return res.status(410).json({ error: 'session not active' });
        if (sessionRow.expires_at && new Date(sessionRow.expires_at) < new Date()) return res.status(410).json({ error: 'session expired' });

        const now = new Date();
        const dateKey = now.toISOString().slice(0,10);

        // validate employee exists
        const er = await pool.query('SELECT * FROM employees WHERE employee_id=$1 OR id::text=$2 OR lower(email)=lower($3) LIMIT 1', [employee_id, String(employee_id), String(employee_id)]);
        const emp = (er.rows && er.rows[0]) ? er.rows[0] : null;
        if (!emp) return res.status(404).json({ error: 'employee not found' });

        // check existing attendance for today
        const ex = await pool.query('SELECT * FROM attendance WHERE employee_id=$1 AND date_key=$2 LIMIT 1', [employee_id, dateKey]);
        if (ex.rows && ex.rows.length > 0) return res.status(409).json({ error: 'already checked in today', record: ex.rows[0] });

        // insert attendance
        const loc = (lat != null && lon != null) ? JSON.stringify({ lat, lon }) : null;
        const dev = deviceInfo ? JSON.stringify(deviceInfo) : null;
        const ins = await pool.query('INSERT INTO attendance(employee_id, session_id, date_key, timestamp, location, device_info, status) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *', [employee_id, session_id, dateKey, now.toISOString(), loc, dev, 'present']);
        return res.status(201).json({ ok: true, record: ins.rows[0] });
    }catch(e){ console.error('checkin error', e); return res.status(500).json({ error: 'failed to checkin' }); }
});

// Fetch employee info by email (secured): returns {id, employee_id, name, department, email}
server.get('/api/employee/by-email', requireAuth([]), async (req, res) => {
    try{
        const email = (req.query && req.query.email) ? String(req.query.email) : (req.auth && req.auth.email);
        if (!email) return res.status(400).json({ error: 'missing email' });
        const r = await pool.query('SELECT id, employee_id, name, department, email FROM employees WHERE lower(email)=lower($1) LIMIT 1', [email]);
        if (!r.rows || r.rows.length === 0) return res.status(404).json({ error: 'employee not found' });
        return res.json(r.rows[0]);
    }catch(e){ console.error('employee lookup error', e); return res.status(500).json({ error: 'failed to fetch employee' }); }
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

// Quick Postgres connectivity check (non-blocking)
(async function checkPostgres(){
    try{
        const r = await pool.query('SELECT now() as now');
        console.log('[server] Postgres reachable — now:', (r.rows && r.rows[0] && r.rows[0].now) ? r.rows[0].now.toISOString() : r.rows[0]);
    }catch(e){
        console.warn('[server] Warning: could not reach Postgres at', maskDatabaseUrl(PG_CONN), '\n', e.message || e);
    }
})();

server.listen(PORT, () => {
    console.log(`Mock server running at http://localhost:${PORT}`);
    console.log('[server] API mount: /api  (json-server router + custom routes)');
    console.log('[server] Serving static files from:', publicPath);
    console.log('[server] Database:', maskDatabaseUrl(PG_CONN));
    console.log('[server] JWT secret set?', !!process.env.JWT_SECRET);
});
