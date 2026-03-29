/**
 * Express Application Setup
 * Configure middleware, CORS, and basic routes
 */

const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const bodyParser = require('body-parser');
const path = require('path');
const jsonServer = require('json-server');

const config = require('./config/environment');
const { corsOptions } = require('./config/cors');
const { errorHandler, notFoundHandler } = require('./middleware/errorHandler');

/**
 * Create and configure Express application
 */
function createApp() {
  // Create json-server app
  const app = jsonServer.create();

  // Setup public path
  const publicPath = path.join(__dirname, '..', 'public');

  // ============================================================
  // TRUST PROXY - CRITICAL for X-Forwarded-For headers from nginx
  // ============================================================
  app.set('trust proxy', true);

  // ============================================================
  // CORS MIDDLEWARE
  // ============================================================
  app.use(cors(corsOptions));

  // ============================================================
  // BODY PARSING MIDDLEWARE
  // ============================================================
  app.use(cookieParser());
  app.use(bodyParser.json({ limit: '10mb' }));
  app.use(bodyParser.urlencoded({ limit: '10mb', extended: true }));

  // ============================================================
  // STATIC FILES
  // ============================================================
  app.use(jsonServer.defaults({ static: publicPath }));

  // ============================================================
  // REQUEST LOGGING MIDDLEWARE (Development)
  // ============================================================
  if (config.isDevelopment) {
    app.use((req, res, next) => {
      // Log only API requests (not static files)
      if (req.path.startsWith('/api')) {
        console.log(`[${req.method}] ${req.path}`);
      }
      next();
    });
  }

  // ============================================================
  // ORIGIN VALIDATION MIDDLEWARE
  // ============================================================
  app.use((req, res, next) => {
    // Only validate on API endpoints (not static files)
    if (!req.path.startsWith('/api/')) {
      return next();
    }

    const origin = req.get('origin');
    const { isOriginAllowed } = require('./config/cors');

    if (!isOriginAllowed(origin)) {
      console.warn('[origin-validation] Rejected request from unauthorized origin:', origin);
      return res.status(403).json({
        error: 'Origin not allowed',
        message: `Requests from ${origin} are not permitted`,
      });
    }

    next();
  });

  // ============================================================
  // HEALTH CHECK ROUTES (before other routes)
  // ============================================================
  app.get('/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
  });

  app.get('/health/ping', (req, res) => {
    // Prevent caching so pings always hit the app
    res.set('Cache-Control', 'no-cache, no-store, must-revalidate, max-age=0');
    res.set('Pragma', 'no-cache');
    res.set('Expires', '0');

    const accept = (req.get('Accept') || '').toLowerCase();
    if (accept.includes('application/json')) {
      return res.json({ status: 'ok' });
    }

    return res.type('text/plain').send('OK');
  });

  return app;
}

/**
 * Setup API routes (to be called after creating app)
 */
function setupRoutes(app, routes) {
  // Mount API routes
  app.use('/api', routes);

  // ============================================================
  // ERROR HANDLING (MUST BE LAST)
  // ============================================================

  // 404 handler
  app.use(notFoundHandler);

  // Global error handler
  app.use(errorHandler);

  return app;
}

module.exports = {
  createApp,
  setupRoutes,
};
