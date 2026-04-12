/**
 * Phase 5: Refactored Server Entry Point
 * Pure HTTP server with modular routes and services
 * Removed: 4500+ lines of inline endpoint handlers
 * Kept: Socket.IO, middleware, auth, QR automation, startup logic
 */

require('dotenv').config();

const http = require('http');
const https = require('https');
const express = require('express');
const { Server: SocketIOServer } = require('socket.io');
const path = require('path');

// ============================================================
// CORE IMPORTS
// ============================================================

// Environment & config
const { checkPostgresConnection, maskDatabaseUrl } = require('./conn-supabase');
const syncService = require('./utils/syncService');
const httpsSetup = require('./https-setup');
const { startBackupScheduler, stopBackupScheduler } = require('./services/backupScheduler');

// Middleware
const { requireAuth } = require('./middleware/auth');
const { errorHandler, notFoundHandler } = require('./middleware/errorHandler');

// Routes
const routes = require('./routes');

// Socket.IO & Bonjour (optional discovery)
let bonjourAdvertiser = null;
try {
  bonjourAdvertiser = require('./bonjour-advertiser');
  console.log('[startup] Bonjour advertiser loaded');
} catch (err) {
  console.warn('[startup] Bonjour advertiser not available (optional):', err.message);
}

// ============================================================
// CREATE EXPRESS APP & SERVER
// ============================================================

const expressApp = express();

// Conditionally create HTTP or HTTPS server based on certificate availability
let server;
let protocol = 'HTTP';

const httpsOptions = httpsSetup.getHttpsOptions();
if (httpsOptions) {
  server = https.createServer(httpsOptions, expressApp);
  protocol = 'HTTPS';
  console.log('[startup] Using HTTPS with Let\'s Encrypt certificates');
} else {
  server = http.createServer(expressApp);
  console.log('[startup] Using HTTP mode (HTTPS certificates not found)');
}

// For backwards compatibility, alias as httpServer
const httpServer = server;

// ============================================================
// SOCKET.IO SETUP
// ============================================================

const io = new SocketIOServer(httpServer, {
  cors: {
    origin: function(origin, callback) {
      const FRONTEND_URL = process.env.FRONTEND_URL || 'https://employeeattendance.me';
      const allowedOrigins = [
        FRONTEND_URL,
        'https://backend-rxe4.onrender.com',
        'https://employeeattendance.me',
        'https://employeeattendance.me/',
        'https://local.employeeattendance.me',
        'http://local.employeeattendance.me',
        'https://local.employettendance.me',
        'http://local.employettendance.me',
        'https://local.attendance.me',
        'http://local.attendance.me',
        'http://localhost:5000',
        'http://127.0.0.1:5000',
        'http://localhost',
        'http://127.0.0.1',
        'http://192.168.1.199',
        'http://192.168.1.199:80',
        'https://192.168.1.199',
        'https://192.168.1.199:443',
        'https://localhost',
        'https://127.0.0.1',
        'https://workline.local',
        'http://workline.local',
        'https://desktop-0e4rqce.local',
        'http://desktop-0e4rqce.local'
      ];
      
      if (!origin || allowedOrigins.indexOf(origin) !== -1 || /^https?:\/\/local\.[a-z0-9-]+\.me(?::\d+)?$/i.test(origin) || process.env.NODE_ENV !== 'production') {
        callback(null, true);
      } else {
        callback(new Error('CORS not allowed'));
      }
    },
    credentials: true
  }
});

// Store io instance globally for route handlers
global.io = io;

// Handle Socket.IO connections
io.on('connection', (socket) => {
  console.log(`[Socket.IO] Client connected: ${socket.id}`);
  
  socket.on('join-display', () => {
    socket.join('displays');
    console.log(`[Socket.IO] Client ${socket.id} joined displays room`);
  });
  
  socket.on('disconnect', () => {
    console.log(`[Socket.IO] Client disconnected: ${socket.id}`);
  });
});

// ============================================================
// MIDDLEWARE SETUP
// ============================================================

const bodyParser = require('body-parser');
const cors = require('cors');
const cookieParser = require('cookie-parser');

// CORS
const FRONTEND_URL = process.env.FRONTEND_URL || 'https://employeeattendance.me';
const allowedOrigins = [
  FRONTEND_URL,
  'https://backend-rxe4.onrender.com',
  'https://employeeattendance.me',
  'https://employeeattendance.me/',
  'https://local.employeeattendance.me',
  'http://local.employeeattendance.me',
  'https://local.employettendance.me',
  'http://local.employettendance.me',
  'https://local.attendance.me',
  'http://local.attendance.me',
  'http://localhost:5000',
  'http://127.0.0.1:5000',
  'http://localhost',
  'http://127.0.0.1',
  'http://192.168.1.199',
  'http://192.168.1.199:80',
  'https://192.168.1.199',
  'https://192.168.1.199:443',
  'https://localhost',
  'https://127.0.0.1',
  'https://desktop-0e4rqce.local',
  'http://desktop-0e4rqce.local'
].filter(Boolean);

expressApp.use(cors({
  origin: function (origin, callback) {
    if (!origin || allowedOrigins.indexOf(origin) !== -1 || /^https?:\/\/local\.[a-z0-9-]+\.me(?::\d+)?$/i.test(origin) || process.env.NODE_ENV !== 'production') {
      callback(null, true);
    } else {
      callback(new Error('CORS not allowed'));
    }
  },
  credentials: true,
  exposedHeaders: ['X-Total-Count'],
  allowedHeaders: ['Content-Type', 'Authorization', 'Accept'],
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
  optionsSuccessStatus: 200,
  maxAge: 86400
}));

// Body parsing
expressApp.use(cookieParser());
expressApp.use(bodyParser.json({ limit: '10mb' }));
expressApp.use(bodyParser.urlencoded({ limit: '10mb', extended: true }));

// Static files
const publicPath = path.join(__dirname, '..', 'public');
expressApp.use(express.static(publicPath));

// Origin validation
expressApp.use((req, res, next) => {
  if (!req.path.startsWith('/api/')) {
    return next();
  }

  const origin = req.get('origin');
  const allowedOrigins = [
    'https://employeeattendance.me',
    'https://backend-rxe4.onrender.com',
    'https://local.employeeattendance.me',
    'http://local.employeeattendance.me',
    'https://local.employettendance.me',
    'http://local.employettendance.me',
    'https://local.attendance.me',
    'http://local.attendance.me',
    'http://localhost:5000',
    'http://127.0.0.1:5000',
    'http://192.168.1.199',
    'http://192.168.1.199:80',
    'https://192.168.1.199',
    'https://192.168.1.199:443',
    'https://localhost',
    'https://127.0.0.1',
    'https://workline.local',
    'http://workline.local',
    'http://192.168.43.1',
    'https://192.168.43.1',
    'http://10.0.0.1',
    'https://10.0.0.1',
    'https://desktop-0e4rqce.local',
    'http://desktop-0e4rqce.local',
  ];
  
  const isAllowed = !origin || allowedOrigins.includes(origin) || 
                    /^https?:\/\/local\.[a-z0-9-]+\.me(?::\d+)?$/i.test(origin) ||
                    /^https?:\/\/(192\.168|10)\.\d+\.\d+/.test(origin);
  
  if (!isAllowed) {
    console.warn('[origin-validation] Rejected request from unauthorized origin:', origin);
    return res.status(403).json({ error: 'Origin not allowed' });
  }
  
  next();
});

// ============================================================
// HEALTH CHECK ENDPOINTS
// ============================================================

expressApp.get('/health', async (req, res) => {
  try {
    const postgresOk = await checkPostgresConnection();
    res.json({
      status: 'ok',
      timestamp: new Date().toISOString(),
      database: postgresOk ? 'connected' : 'error',
      sync: syncService.getSyncStatus()
    });
  } catch (e) {
    console.error('[health] Error:', e);
    res.status(500).json({ status: 'error', error: e.message });
  }
});

expressApp.get('/health/ping', (req, res) => {
  res.set('Cache-Control', 'no-cache, no-store, must-revalidate, max-age=0');
  res.set('Pragma', 'no-cache');
  res.set('Expires', '0');

  const accept = (req.get('Accept') || '').toLowerCase();
  if (accept.includes('application/json')) {
    return res.json({ status: 'ok' });
  }

  return res.type('text/plain').send('OK');
});

// ============================================================
// MOUNT MODULAR ROUTES
// ============================================================

try {
  expressApp.use('/api', routes);
  console.log('[startup] Routes mounted successfully');
} catch (error) {
  console.error('[startup] Error mounting routes:', error.message);
  throw error;
}

// ============================================================
// ERROR HANDLING (MUST BE LAST)
// ============================================================

expressApp.use(notFoundHandler);
expressApp.use(errorHandler);

// ============================================================
// QR AUTOMATION SCHEDULER
// ============================================================

let qrAutoGenerationInterval = null;

async function generateQRAutomatically() {
  try {
    const { rpcQrGenerateSession, createQRSession, getSystemSettings, deactivateExpiredQRSessions } = require('./supabase');
    
    // Get current settings
    const settings = await getSystemSettings();
    
    // Check if QR automation is enabled and configured to run on this server
    if (!settings || !settings.qr_auto_generate_enabled) {
      return;
    }
    
    // Check if QR generation should run on this server (local or cloud)
    const currentEnv = process.env.NODE_ENV === 'production' ? 'cloud' : 'local';
    const automationLocation = (settings && settings.qr_automation_location) ? settings.qr_automation_location : 'local';
    
    // Only run QR generation if the location matches current environment
    if (automationLocation !== currentEnv) {
      return; // Silently skip - QR generation is configured to run elsewhere
    }
    
    // Use interval from settings to determine expiration time
    // qr_auto_interval_seconds is the time each session should be valid
    const expirationSeconds = (settings && settings.qr_auto_interval_seconds) ? parseInt(settings.qr_auto_interval_seconds) : 30;
    const expiresAt = new Date(Date.now() + expirationSeconds * 1000);
    
    // Generate new QR session using RPC
    let result = null;
    try {
      result = await rpcQrGenerateSession('rotating', expiresAt);
    } catch (rpcError) {
      // Fallback to direct database insertion
      const sessionId = `qr_auto_${Date.now()}_${Math.random().toString(36).substring(2, 15)}`;
      result = await createQRSession(sessionId, expiresAt, null, 'rotating');
    }
    
    if (result && result.session_id) {
      // Notify all connected display clients
      if (global.io) {
        global.io.to('displays').emit('qr:refreshed', {
          session_id: result.session_id,
          expires_at: result.expires_at,
          timestamp: new Date().toISOString()
        });
      }
    }
    
    // Deactivate expired QR sessions (runs on same interval as QR generation)
    try {
      await deactivateExpiredQRSessions();
    } catch (cleanupError) {
      // Silently fail - cleanup errors shouldn't break QR generation
    }
  } catch (error) {
    // Silently fail to avoid log spam
  }
}

async function startQRAutoGeneration() {
  try {
    const { getSystemSettings } = require('./supabase');
    
    // Check settings for interval
    const settings = await getSystemSettings();
    // qr_auto_interval_seconds is stored in database (default 3600 = 1 hour)
    const intervalSeconds = (settings && settings.qr_auto_interval_seconds) ? parseInt(settings.qr_auto_interval_seconds) : 3600;
    const interval = intervalSeconds * 1000; // Convert to milliseconds
    
    // Generate one immediately
    await generateQRAutomatically();
    
    // Then schedule repeating generation
    qrAutoGenerationInterval = setInterval(generateQRAutomatically, interval);
    
  } catch (error) {
    console.error('[QR-auto] ✗ Failed to start:', error.message);
    console.error('[QR-auto] Stack:', error.stack);
  }
}

// ============================================================
// SERVER STARTUP
// ============================================================

const PORT = process.env.PORT || 5000;

httpServer.listen(PORT, '0.0.0.0', async () => {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`✓ Server running at ${protocol}://0.0.0.0:${PORT}`);
  console.log(`  Protocol: ${protocol} ${protocol === 'HTTPS' ? '(Let\'s Encrypt)' : '(HTTP - HTTPS via reverse proxy)'}`);
  console.log(`${'='.repeat(60)}\n`);
  
  console.log('[server] Configuration:');
  console.log(`  - Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`  - API mount: /api (modular routes + json-server)`);
  console.log(`  - Static files: ${publicPath}`);
  console.log(`  - Database: Supabase PostgreSQL`);
  console.log(`  - Supabase URL: ${maskDatabaseUrl()}`);
  console.log(`  - WebSocket: Socket.IO enabled`);
  console.log(`  - JWT Secret: ${process.env.JWT_SECRET ? '✓' : '✗'}`);
  
  // Check database connectivity
  console.log('\n[startup] Checking database connectivity...');
  try {
    const isConnected = await checkPostgresConnection();
    console.log(`[startup] Database: ${isConnected ? '✓ Connected' : '⚠ Warning'}`);
  } catch (error) {
    console.warn('[startup] Database check failed:', error.message);
  }
  
  // Initialize sync service
  console.log('[startup] Initializing sync service...');
  try {
    const syncInitResult = await syncService.init();
    console.log(`[startup] Sync service: ${syncInitResult ? '✓ Started' : '⚠ Failed to start'}`);
  } catch (error) {
    console.warn('[startup] Sync service initialization warning:', error.message);
  }
  
  // Start QR automation after 3 seconds
  setTimeout(async () => {
    try {
      await startQRAutoGeneration();
      console.log('[startup] QR automation: ✓ Started');
    } catch (error) {
      console.warn('[startup] QR automation warning:', error.message);
    }
  }, 3000);

  // Start database backup scheduler after startup settles
  setTimeout(async () => {
    try {
      await startBackupScheduler();
      console.log('[startup] Backup scheduler: ✓ Started');
    } catch (error) {
      console.warn('[startup] Backup scheduler warning:', error.message);
    }
  }, 5000);
  
  // Start health monitoring broadcast (every 30 seconds)
  setTimeout(() => {
    try {
      const healthService = require('./services/healthService');
      let healthBroadcastInterval = setInterval(async () => {
        try {
          const health = await healthService.getFullHealth();
          if (global.io) {
            global.io.emit('health:update', {
              health,
              timestamp: new Date().toISOString()
            });
          }
        } catch (error) {
          console.error('[health-broadcast] Error:', error.message);
        }
      }, 30000); // Broadcast every 30 seconds
      console.log('[startup] Health monitoring: ✓ Started');
    } catch (error) {
      console.warn('[startup] Health monitoring warning:', error.message);
    }
  }, 4000);
  
  console.log(`\n${'='.repeat(60)}\n`);
});

// ============================================================
// GRACEFUL SHUTDOWN
// ============================================================

process.on('SIGTERM', () => {
  console.log('[shutdown] SIGTERM received, closing server...');
  if (qrAutoGenerationInterval) {
    clearInterval(qrAutoGenerationInterval);
  }
  stopBackupScheduler();
  httpServer.close(() => {
    console.log('[shutdown] Server closed');
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  console.log('[shutdown] SIGINT received, closing server...');
  if (qrAutoGenerationInterval) {
    clearInterval(qrAutoGenerationInterval);
  }
  stopBackupScheduler();
  httpServer.close(() => {
    console.log('[shutdown] Server closed');
    process.exit(0);
  });
});

module.exports = { httpServer, expressApp, io, protocol, httpsSetup };
