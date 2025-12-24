/**
 * Validators
 * Input validation functions
 */

const { ERROR_MESSAGES } = require('./constants');

/**
 * Validate email format
 */
function validateEmail(email) {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
}

/**
 * Validate password strength
 */
function validatePassword(password) {
  return password && password.length >= 6;
}

/**
 * Validate phone number (Philippine format)
 */
function validatePhoneNumber(phone) {
  if (!phone) return true; // Optional field
  return /^\+63[0-9]{10}$/.test(phone);
}

/**
 * Validate date format (YYYY-MM-DD)
 */
function validateDateFormat(dateString) {
  const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
  if (!dateRegex.test(dateString)) return false;

  const date = new Date(dateString);
  return date instanceof Date && !isNaN(date);
}

/**
 * Validate date range
 */
function validateDateRange(startDate, endDate) {
  if (!validateDateFormat(startDate) || !validateDateFormat(endDate)) {
    return false;
  }

  return new Date(startDate) <= new Date(endDate);
}

/**
 * Validate login input
 */
function validateLoginInput(email, password) {
  if (!email || !password) {
    throw new Error(ERROR_MESSAGES.MISSING_REQUIRED_FIELDS);
  }

  if (!validateEmail(email)) {
    throw new Error(ERROR_MESSAGES.INVALID_EMAIL);
  }

  if (!validatePassword(password)) {
    throw new Error(ERROR_MESSAGES.PASSWORD_TOO_SHORT);
  }
}

/**
 * Validate user creation input
 */
function validateUserInput(data) {
  const errors = [];

  if (!data.first_name || !data.first_name.trim()) {
    errors.push('First name is required');
  }

  if (!data.last_name || !data.last_name.trim()) {
    errors.push('Last name is required');
  }

  if (!data.email || !validateEmail(data.email)) {
    errors.push(ERROR_MESSAGES.INVALID_EMAIL);
  }

  if (data.phone && !validatePhoneNumber(data.phone)) {
    errors.push(ERROR_MESSAGES.INVALID_PHONE);
  }

  if (data.password && !validatePassword(data.password)) {
    errors.push(ERROR_MESSAGES.PASSWORD_TOO_SHORT);
  }

  return {
    isValid: errors.length === 0,
    errors,
  };
}

/**
 * Validate pagination parameters
 */
function validatePagination(page, limit) {
  const validPage = Math.max(1, parseInt(page || 1, 10));
  const validLimit = Math.min(
    100,
    Math.max(1, parseInt(limit || 10, 10))
  );

  return {
    page: validPage,
    limit: validLimit,
    offset: (validPage - 1) * validLimit,
  };
}

/**
 * Validate UUID format
 */
function validateUUID(uuid) {
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  return uuidRegex.test(uuid);
}

/**
 * Validate integer ID
 */
function validateIntegerId(id) {
  const intId = parseInt(id, 10);
  return !isNaN(intId) && intId > 0;
}

/**
 * Sanitize input string (remove leading/trailing whitespace)
 */
function sanitizeString(str) {
  return typeof str === 'string' ? str.trim() : str;
}

module.exports = {
  validateEmail,
  validatePassword,
  validatePhoneNumber,
  validateDateFormat,
  validateDateRange,
  validateLoginInput,
  validateUserInput,
  validatePagination,
  validateUUID,
  validateIntegerId,
  sanitizeString,
};
