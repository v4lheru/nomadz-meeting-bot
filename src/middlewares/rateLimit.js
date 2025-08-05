const rateLimit = require('express-rate-limit');
const logger = require('../utils/logger');

/**
 * Rate limiting configuration
 * Protects against abuse and ensures service stability
 */

// General API rate limiting
const generalLimiter = rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000, // 15 minutes
  max: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS) || 100, // limit each IP to 100 requests per windowMs
  message: {
    error: 'Too many requests from this IP, please try again later.',
    retryAfter: Math.ceil((parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000) / 1000)
  },
  standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
  legacyHeaders: false, // Disable the `X-RateLimit-*` headers
  handler: (req, res) => {
    logger.warn('Rate limit exceeded', {
      ip: req.ip,
      method: req.method,
      url: req.originalUrl,
      userAgent: req.get('User-Agent'),
      timestamp: new Date().toISOString()
    });

    res.status(429).json({
      success: false,
      error: 'Too many requests from this IP, please try again later.',
      retryAfter: Math.ceil((parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000) / 1000),
      timestamp: new Date().toISOString()
    });
  },
  skip: (req) => {
    // Skip rate limiting for health checks
    if (req.path === '/health') {
      return true;
    }
    
    // Skip for webhook endpoints (they should have their own authentication)
    if (req.path.startsWith('/webhook/')) {
      return true;
    }
    
    return false;
  }
});

// Strict rate limiting for webhook endpoints
const webhookLimiter = rateLimit({
  windowMs: 5 * 60 * 1000, // 5 minutes
  max: 50, // limit each IP to 50 webhook requests per 5 minutes
  message: {
    error: 'Too many webhook requests from this IP.',
    retryAfter: 300
  },
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => {
    logger.warn('Webhook rate limit exceeded', {
      ip: req.ip,
      method: req.method,
      url: req.originalUrl,
      userAgent: req.get('User-Agent'),
      timestamp: new Date().toISOString()
    });

    res.status(429).json({
      success: false,
      error: 'Too many webhook requests from this IP.',
      retryAfter: 300,
      timestamp: new Date().toISOString()
    });
  }
});

// Very strict rate limiting for retry endpoints
const retryLimiter = rateLimit({
  windowMs: 10 * 60 * 1000, // 10 minutes
  max: 5, // limit each IP to 5 retry requests per 10 minutes
  message: {
    error: 'Too many retry requests. Please wait before trying again.',
    retryAfter: 600
  },
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => {
    logger.warn('Retry rate limit exceeded', {
      ip: req.ip,
      method: req.method,
      url: req.originalUrl,
      userAgent: req.get('User-Agent'),
      timestamp: new Date().toISOString()
    });

    res.status(429).json({
      success: false,
      error: 'Too many retry requests. Please wait before trying again.',
      retryAfter: 600,
      timestamp: new Date().toISOString()
    });
  }
});

// Create a middleware that applies different rate limits based on the route
const createRateLimitMiddleware = () => {
  return (req, res, next) => {
    // Apply webhook rate limiting
    if (req.path.startsWith('/webhook/')) {
      return webhookLimiter(req, res, next);
    }
    
    // Apply retry rate limiting
    if (req.path.includes('/retry')) {
      return retryLimiter(req, res, next);
    }
    
    // Apply general rate limiting
    return generalLimiter(req, res, next);
  };
};

// Export the middleware
module.exports = createRateLimitMiddleware();

// Export individual limiters for specific use cases
module.exports.generalLimiter = generalLimiter;
module.exports.webhookLimiter = webhookLimiter;
module.exports.retryLimiter = retryLimiter;
