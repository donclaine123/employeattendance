/**
 * CORS Configuration
 * Centralized CORS setup for different environments
 */

const config = require('./environment');

/**
 * Get allowed origins based on environment
 */
function getAllowedOrigins() {
  const baseOrigins = [
    config.FRONTEND_URL,
    'https://backend-rxe4.onrender.com',
    'https://employeeattendance.me',
    'https://employeeattendance.me/',
    'http://localhost:5000',
    'http://127.0.0.1:5000',
    'http://localhost',
    'http://127.0.0.1',
    'https://localhost',
    'https://127.0.0.1',
    'https://workline.local',
    'http://workline.local',
    'https://desktop-0e4rqce.local',
    'http://desktop-0e4rqce.local',
    'https://local.employeeattendance.me',
    'http://local.employeeattendance.me',
    'https://local.attendance.me',
    'http://local.attendance.me',
  ];

  // Add network/WiFi origins
  const networkOrigins = [
    'http://192.168.1.199',
    'http://192.168.1.199:80',
    'https://192.168.1.199',
    'https://192.168.1.199:443',
  ];

  // Add hotspot/mobile origins
  const hotspotOrigins = [
    'http://192.168.43.1',
    'https://192.168.43.1',
    'http://10.0.0.1',
    'https://10.0.0.1',
  ];

  return [...baseOrigins, ...networkOrigins, ...hotspotOrigins].filter(Boolean);
}

/**
 * Check if origin is allowed
 */
function isOriginAllowed(origin) {
  if (!origin) return true; // Allow requests with no origin (mobile apps, Postman)

  const allowedOrigins = getAllowedOrigins();
  
  console.log('[CORS DEBUG] Checking origin:', origin);
  console.log('[CORS DEBUG] Allowed origins:', allowedOrigins);
  
  // Check exact match
  if (allowedOrigins.includes(origin)) {
    console.log('[CORS DEBUG] ✓ Exact match found');
    return true;
  }

  // Allow any local.*.me domain (local.attendance.me, local.employeeattendance.me, etc)
  const localRegex = /^https?:\/\/local\.[a-z0-9-]+\.me/;
  if (localRegex.test(origin)) {
    console.log('[CORS DEBUG] ✓ Matched local.*.me regex:', origin);
    return true;
  }

  // Allow any 192.168.x.x or 10.x.x.x for hotspot flexibility
  const ipRegex = /^https?:\/\/(192\.168|10)\.\d+\.\d+/;
  if (ipRegex.test(origin)) {
    console.log('[CORS DEBUG] ✓ Matched IP regex:', origin);
    return true;
  }

  // In development, allow all origins
  if (config.isDevelopment) {
    console.log('[CORS DEBUG] ✓ Development mode - allowing all');
    return true;
  }

  console.log('[CORS DEBUG] ✗ Origin blocked:', origin);
  return false;
}

/**
 * CORS options object
 */
const corsOptions = {
  origin: (origin, callback) => {
    if (isOriginAllowed(origin)) {
      callback(null, true);
    } else {
      console.warn('[CORS] Blocked unauthorized origin:', origin);
      callback(new Error('CORS not allowed'));
    }
  },
  credentials: true,
  exposedHeaders: ['X-Total-Count'],
  allowedHeaders: ['Content-Type', 'Authorization', 'Accept'],
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
  optionsSuccessStatus: 200,
  maxAge: 86400, // 24 hours
};

/**
 * Socket.IO CORS options
 */
const socketCorsOptions = {
  origin: (origin, callback) => {
    if (isOriginAllowed(origin)) {
      callback(null, true);
    } else {
      console.warn('[Socket.IO CORS] Blocked origin:', origin);
      callback(new Error('CORS not allowed'));
    }
  },
  credentials: true,
};

module.exports = {
  corsOptions,
  socketCorsOptions,
  getAllowedOrigins,
  isOriginAllowed,
};
