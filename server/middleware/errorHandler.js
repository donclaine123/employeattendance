/**
 * Error Handler Middleware
 * Centralized error handling for Express
 */

const { ERROR_MESSAGES, HTTP_STATUS } = require('../utils/constants');

class AppError extends Error {
  constructor(message, statusCode = 500) {
    super(message);
    this.statusCode = statusCode;
    this.isOperational = true;
    Error.captureStackTrace(this, this.constructor);
  }
}

/**
 * Catch async route errors
 */
function catchAsync(fn) {
  return (req, res, next) => {
    fn(req, res, next).catch(next);
  };
}

/**
 * Global error handling middleware
 */
function errorHandler(err, req, res, next) {
  // Default error properties
  err.statusCode = err.statusCode || HTTP_STATUS.SERVER_ERROR;
  err.message = err.message || ERROR_MESSAGES.SERVER_ERROR;

  // Log error
  console.error(`[error] ${err.statusCode} - ${err.message}`, {
    path: req.path,
    method: req.method,
    timestamp: new Date().toISOString(),
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack }),
  });

  // Handle specific error types
  if (err.name === 'JsonWebTokenError') {
    err.statusCode = HTTP_STATUS.UNAUTHORIZED;
    err.message = ERROR_MESSAGES.INVALID_TOKEN;
  }

  if (err.name === 'TokenExpiredError') {
    err.statusCode = HTTP_STATUS.UNAUTHORIZED;
    err.message = 'Token has expired';
  }

  // Send response
  res.status(err.statusCode).json({
    success: false,
    error: err.message,
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack }),
  });
}

/**
 * 404 Not Found handler
 */
function notFoundHandler(req, res) {
  console.warn(`[404] Route not found: ${req.method} ${req.path}`);
  
  res.status(HTTP_STATUS.NOT_FOUND).json({
    success: false,
    error: 'Route not found',
    path: req.path,
  });
}

module.exports = {
  AppError,
  catchAsync,
  errorHandler,
  notFoundHandler,
};
