const jsonServer = require('json-server');
const path = require('path');
const bodyParser = require('body-parser');
const cors = require('cors');

const server = jsonServer.create();
const router = jsonServer.router(path.join(__dirname, 'db.json'));
const middlewares = jsonServer.defaults();

const QRCode = require('qrcode');
const { v4: uuidv4 } = require('uuid');

// allow cross-origin requests (handles OPTIONS preflight)
server.use(cors());

server.use(middlewares);
server.use(bodyParser.json());

// simple login route
server.post('/api/login', (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: 'Missing email or password' });

  const db = router.db;
  const user = db.get('users').find(u => (u.email || '').toLowerCase() === (email || '').toLowerCase() && u.password === password).value();
  if (!user) return res.status(401).json({ error: 'Invalid credentials' });

  const { password: _p, ...safe } = user;
  return res.json({ user: safe, token: 'mock-token' });
});

// Helper: ensure qr_sessions exists
function ensureQrSessions(db){ if (!db.has('qr_sessions').value()) db.set('qr_sessions', []).write(); }

// Return current rotating session or create one
server.post('/api/hr/qr/generate', async (req, res) => {
    try{
        const db = router.db;
        ensureQrSessions(db);
        const type = (req.body && req.body.type) || 'rotating';
        const now = Date.now();
        const windowId = Math.floor(Math.floor(now/1000) / 60);

        if (type === 'rotating'){
            // return existing session for this window if present
            let session = db.get('qr_sessions').find({ type:'rotating', window_id: windowId, status:'active' }).value();
            if (!session){
                const sessionId = uuidv4();
                const windowStart = Math.floor(now/1000/60)*60*1000; // ms
                const expiresAt = new Date(windowStart + 60*1000).toISOString();
                session = { session_id: sessionId, type: 'rotating', window_id: windowId, issued_at: new Date().toISOString(), expires_at: expiresAt, status: 'active' };
                db.get('qr_sessions').push(session).write();
            }
            // generate qr image (data url) encoding the session_id
            const payload = session.session_id;
            const dataUrl = await QRCode.toDataURL(payload, { margin:1, width:320 });
            return res.json({ session: Object.assign({}, session, { imageDataUrl: dataUrl }) });
        } else {
            // static session: create with optional ttlSeconds
            const ttl = (req.body && req.body.ttlSeconds) || 900; // default 15min
            const sessionId = uuidv4();
            const issuedAt = new Date().toISOString();
            const expiresAt = new Date(Date.now() + ttl*1000).toISOString();
            const session = { session_id: sessionId, type: 'static', window_id: null, issued_at: issuedAt, expires_at: expiresAt, status: 'active' };
            db.get('qr_sessions').push(session).write();
            const dataUrl = await QRCode.toDataURL(sessionId, { margin:1, width:320 });
            return res.json({ session: Object.assign({}, session, { imageDataUrl: dataUrl }) });
        }
    }catch(e){ console.error(e); return res.status(500).json({ error: 'failed to generate QR' }); }
});

// get current rotating session (and optional active static)
server.get('/api/hr/qr/current', async (req, res) => {
    try{
        const db = router.db; ensureQrSessions(db);
        const now = Date.now();
        const windowId = Math.floor(Math.floor(now/1000) / 60);
        const session = db.get('qr_sessions').find({ type:'rotating', window_id: windowId, status:'active' }).value();
        if (session){
            const dataUrl = await QRCode.toDataURL(session.session_id, { margin:1, width:320 });
            return res.json({ session: Object.assign({}, session, { imageDataUrl: dataUrl }) });
        }
        return res.status(404).json({ error: 'no active rotating session' });
    }catch(e){ console.error(e); return res.status(500).json({ error: 'failed to fetch current QR' }); }
});

// revoke session
server.post('/api/hr/qr/revoke', (req, res) => {
    const id = req.body && req.body.session_id;
    if (!id) return res.status(400).json({ error: 'missing session_id' });
    const db = router.db; ensureQrSessions(db);
    const found = db.get('qr_sessions').find({ session_id: id }).value();
    if (!found) return res.status(404).json({ error: 'session not found' });
    db.get('qr_sessions').find({ session_id: id }).assign({ status:'revoked' }).write();
    return res.json({ ok:true });
});

// mark attendance - append to db.json attendance array
server.post('/api/attendance', (req, res) => {
    const db = router.db; // lowdb instance from json-server
    const body = req.body || {};

    // simple record shape
    const record = {
        id: Date.now(),
        email: body.email || null,
        qr: body.qr || null,
        note: body.note || null,
        timestamp: new Date().toISOString(),
        status: body.status || 'On Time'
    };

    // ensure attendance array exists
    if (!db.has('attendance').value()) {
        db.set('attendance', []).write();
    }
    db.get('attendance').push(record).write();
    res.status(201).json(record);
});

// check-in using a QR session (validates session, one check-in per employee per day)
server.post('/api/attendance/checkin', (req, res) => {
    try{
        const db = router.db;
        const body = req.body || {};
        const { session_id, employee_id, lat, lon, deviceInfo } = body;
        if (!session_id || !employee_id) return res.status(400).json({ error: 'missing session_id or employee_id' });

        // ensure qr_sessions and attendance collections exist
        if (!db.has('qr_sessions').value()) db.set('qr_sessions', []).write();
        if (!db.has('attendance').value()) db.set('attendance', []).write();

        // find session
        const session = db.get('qr_sessions').find({ session_id }).value();
        if (!session) return res.status(404).json({ error: 'session not found' });

        // check status
        if (session.status !== 'active') return res.status(410).json({ error: 'session not active' });

        // check expiry
        if (session.expires_at && new Date(session.expires_at) < new Date()) return res.status(410).json({ error: 'session expired' });

        // compute date key (YYYY-MM-DD) in server local time
        const now = new Date();
        const dateKey = now.toISOString().slice(0,10);

        // check if employee already checked in today
        const existing = db.get('attendance').find(a => a.employee_id === employee_id && (a.dateKey === dateKey)).value();
        if (existing) return res.status(409).json({ error: 'already checked in today', record: existing });

        // create attendance record
        const record = {
            id: Date.now(),
            employee_id,
            session_id,
            dateKey,
            timestamp: now.toISOString(),
            location: (lat != null && lon != null) ? { lat, lon } : null,
            deviceInfo: deviceInfo || null,
            status: 'present'
        };

        db.get('attendance').push(record).write();
        return res.status(201).json({ ok: true, record });
    }catch(e){ console.error(e); return res.status(500).json({ error: 'failed to checkin' }); }
});

// mount router
server.use('/api', router);

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => console.log(`Mock server running at http://localhost:${PORT}`));
