const jsonServer = require('json-server');
const path = require('path');
const bodyParser = require('body-parser');
const cors = require('cors');

const server = jsonServer.create();
const router = jsonServer.router(path.join(__dirname, 'db.json'));
const middlewares = jsonServer.defaults();

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

// mount router
server.use('/api', router);

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => console.log(`Mock server running at http://localhost:${PORT}`));
