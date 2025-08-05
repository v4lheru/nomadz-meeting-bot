const logger = require('../utils/logger');

/**
 * Global error handling middleware
 * Handles all errors that occur in the application
 */
const errorHandler = (err, req, res, next) => {
  let error = { ...err };
  error.message = err.message;

  // Log error details
  logger.logError(err, {
    method: req.method,
    url: req.originalUrl,
    ip: req.ip,
    userAgent: req.get('User-Agent'),
    body: req.body,
    params: req.params,
    query: req.query
  });

  // Mongoose bad ObjectId
  if (err.name === 'CastError') {
    const message = 'Resource not found';
    error = { message, statusCode: 404 };
  }

  // Mongoose duplicate key
  if (err.code === 11000) {
    const message = 'Duplicate field value entered';
    error = { message, statusCode: 400 };
  }

  // Mongoose validation error
  if (err.name === 'ValidationError') {
    const message = Object.values(err.errors).map(val => val.message);
    error = { message, statusCode: 400 };
  }

  // JWT errors
  if (err.name === 'JsonWebTokenError') {
    const message = 'Invalid token';
    error = { message, statusCode: 401 };
  }

  if (err.name === 'TokenExpiredError') {
    const message = 'Token expired';
    error = { message, statusCode: 401 };
  }

  // Supabase errors
  if (err.code && err.code.startsWith('PGRST')) {
    const message = 'Database operation failed';
    error = { message, statusCode: 500 };
  }

  // ChatterBox API errors
  if (err.response && err.response.status) {
    if (err.response.status === 401) {
      const message = 'ChatterBox API authentication failed';
      error = { message, statusCode: 500 };
    } else if (err.response.status === 429) {
      const message = 'ChatterBox API rate limit exceeded';
      error = { message, statusCode: 429 };
    } else if (err.response.status >= 500) {
      const message = 'ChatterBox API service unavailable';
      error = { message, statusCode: 503 };
    }
  }

  // Google API errors
  if (err.code && (err.code === 'ENOTFOUND' || err.code === 'ECONNREFUSED')) {
    const message = 'External service unavailable';
    error = { message, statusCode: 503 };
  }

  // File processing errors
  if (err.code === 'ENOENT') {
    const message = 'File not found';
    error = { message, statusCode: 404 };
  }

  if (err.code === 'EMFILE' || err.code === 'ENFILE') {
    const message = 'Too many open files';
    error = { message, statusCode: 507 };
  }

  // Default to 500 server error
  const statusCode = error.statusCode || 500;
  const message = error.message || 'Internal Server Error';

  // Prepare error response
  const errorResponse = {
    success: false,
    error: message,
    timestamp: new Date().toISOString(),
    path: req.originalUrl,
    method: req.method
  };

  // Add stack trace in development
  if (process.env.NODE_ENV === 'development') {
    errorResponse.stack = err.stack;
  }

  // Add request ID if available
  if (req.id) {
    errorResponse.requestId = req.id;
  }

  // Send error response
  res.status(statusCode).json(errorResponse);
};

/**
 * Handle 404 errors for undefined routes
 */
const notFound = (req, res, next) => {
  const error = new Error(`Not found - ${req.originalUrl}`);
  error.statusCode = 404;
  next(error);
};

/**
 * Async error handler wrapper
 * Wraps async route handlers to catch errors
 */
const asyncHandler = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};

/**
 * Validation error handler
 * Handles express-validator errors
 */
const handleValidationErrors = (req, res, next) => {
  const { validationResult } = require('express-validator');
  const errors = validationResult(req);
  
  if (!errors.isEmpty()) {
    const errorMessages = errors.array().map(error => ({
      field: error.param,
      message: error.msg,
      value: error.value
    }));

    logger.warn('Validation errors', {
      method: req.method,
      url: req.originalUrl,
      errors: errorMessages,
      body: req.body
    });

    return res.status(400).json({
      success: false,
      error: 'Validation failed',
      details: errorMessages,
      timestamp: new Date().toISOString()
    });
  }
  
  next();
};

/**
 * Critical error handler for urgent processing failures
 * Used specifically for ChatterBox URL expiration scenarios
 */
const handleCriticalError = async (meetingId, step, error, context = {}) => {
  const criticalError = {
    meetingId,
    step,
    error: error.message,
    stack: error.stack,
    context,
    timestamp: new Date().toISOString(),
    severity: 'CRITICAL'
  };

  logger.error('🚨 CRITICAL ERROR - Immediate attention required', criticalError);

  // Send immediate alert to monitoring systems
  // This could be extended to send alerts to Slack, email, etc.
  try {
    const notificationService = require('../services/notificationService');
    await notificationService.sendCriticalAlert(criticalError);
  } catch (notificationError) {
    logger.error('Failed to send critical error notification', notificationError);
  }

  return criticalError;
};

module.exports = {
  errorHandler,
  notFound,
  asyncHandler,
  handleValidationErrors,
  handleCriticalError
};
