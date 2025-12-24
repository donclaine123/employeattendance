/**
 * Environment Configuration
 * Centralized environment variable loading and validation
 */

require('dotenv').config();

const config = {
  // Server
  PORT: process.env.PORT || 5000,
  NODE_ENV: process.env.NODE_ENV || 'development',
  FRONTEND_URL: process.env.FRONTEND_URL || 'https://employeeattendance.me',

  // Database
  DATABASE_URL: process.env.DATABASE_URL,
  SUPABASE_URL: process.env.SUPABASE_URL,
  SUPABASE_ANON_KEY: process.env.SUPABASE_ANON_KEY,
  SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
  
  // Cloud Supabase (for bidirectional sync)
  CLOUD_SUPABASE_URL: process.env.CLOUD_SUPABASE_URL,
  CLOUD_SUPABASE_ANON_KEY: process.env.CLOUD_SUPABASE_ANON_KEY,
  CLOUD_SUPABASE_SERVICE_ROLE_KEY: process.env.CLOUD_SUPABASE_SERVICE_ROLE_KEY,
  LOCAL_SUPABASE_URL: process.env.LOCAL_SUPABASE_URL,
  LOCAL_SUPABASE_ANON_KEY: process.env.SUPABASE_ANON_KEY,
  LOCAL_SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,

  // Authentication
  JWT_SECRET: process.env.JWT_SECRET,
  JWT_EXPIRES_IN: process.env.JWT_EXPIRES_IN || '8h',
  ACCESS_TOKEN_EXPIRES_IN: process.env.ACCESS_TOKEN_EXPIRES_IN || '15m',
  REFRESH_TOKEN_EXPIRES_IN: process.env.REFRESH_TOKEN_EXPIRES_IN || '7d',

  // Email
  EMAIL_PROVIDER: process.env.EMAIL_PROVIDER || 'brevo',
  BREVO_API_KEY: process.env.BREVO_API_KEY,
  EMAIL_FROM: process.env.EMAIL_FROM,
  SENDGRID_API_KEY: process.env.SENDGRID_API_KEY,
  SMTP_HOST: process.env.SMTP_HOST,
  SMTP_PORT: process.env.SMTP_PORT,
  SMTP_USER: process.env.SMTP_USER,
  SMTP_PASS: process.env.SMTP_PASS,
  SMTP_SECURE: process.env.SMTP_SECURE === 'true',

  // QR Automation
  QR_AUTO_GENERATE_ENABLED: process.env.QR_AUTO_GENERATE_ENABLED === 'true',
  QR_AUTO_INTERVAL_SECONDS: parseInt(process.env.QR_AUTO_INTERVAL_SECONDS || '60', 10),

  // Sync Service
  SYNC_INTERVAL: 3000,

  // Feature Flags
  ENABLE_BONJOUR: process.env.ENABLE_BONJOUR !== 'false',
  ENABLE_SYNC_SERVICE: process.env.ENABLE_SYNC_SERVICE !== 'false',
};

/**
 * Validate required configuration
 */
function validateConfig() {
  const required = ['JWT_SECRET', 'SUPABASE_URL'];
  const missing = required.filter(key => !config[key]);

  if (missing.length > 0) {
    throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
  }
}

/**
 * Mask sensitive values for logging
 */
function maskSensitiveValues(obj) {
  const masked = { ...obj };
  const sensitivKeys = ['JWT_SECRET', 'SUPABASE_SERVICE_ROLE_KEY', 'BREVO_API_KEY', 'SENDGRID_API_KEY', 'SMTP_PASS'];
  
  sensitivKeys.forEach(key => {
    if (masked[key]) {
      masked[key] = masked[key].substring(0, 10) + '...';
    }
  });

  return masked;
}

module.exports = {
  ...config,
  validateConfig,
  maskSensitiveValues,
  isDevelopment: config.NODE_ENV === 'development',
  isProduction: config.NODE_ENV === 'production',
};
