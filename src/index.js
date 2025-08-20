const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
require('dotenv').config();

const logger = require('./utils/logger');
const { errorHandler } = require('./middlewares/errorHandler');
const rateLimit = require('./middlewares/rateLimit');

// Import controllers with error handling
let webhookController, chatterboxDirectController, healthController, pollStatusJob, cleanupJob;

try {
  logger.info('Loading webhook controller...');
  webhookController = require('./controllers/webhookController');
  logger.info('Webhook controller loaded successfully');
} catch (error) {
  logger.error('Failed to load webhook controller:', error);
  throw error;
}

try {
  logger.info('Loading ChatterBox direct controller...');
  chatterboxDirectController = require('./controllers/chatterboxDirectController');
  logger.info('ChatterBox direct controller loaded successfully');
} catch (error) {
  logger.error('Failed to load ChatterBox direct controller:', error);
  throw error;
}

try {
  logger.info('Loading health controller...');
  healthController = require('./controllers/healthController');
  logger.info('Health controller loaded successfully');
} catch (error) {
  logger.error('Failed to load health controller:', error);
  throw error;
}

try {
  logger.info('Loading poll status job...');
  pollStatusJob = require('./jobs/pollStatusJob');
  logger.info('Poll status job loaded successfully');
} catch (error) {
  logger.error('Failed to load poll status job:', error);
  throw error;
}

try {
  logger.info('Loading cleanup job...');
  cleanupJob = require('./jobs/cleanupJob');
  logger.info('Cleanup job loaded successfully');
} catch (error) {
  logger.error('Failed to load cleanup job:', error);
  throw error;
}

logger.info('Creating Express app...');
const app = express();
const PORT = process.env.PORT || 3000;
logger.info('Express app created successfully');

// Security middleware
logger.info('Setting up security middleware...');
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      scriptSrc: ["'self'"],
      imgSrc: ["'self'", "data:", "https:"],
    },
  },
}));
logger.info('Security middleware configured');

// CORS configuration
logger.info('Setting up CORS...');
app.use(cors({
  origin: process.env.NODE_ENV === 'production' 
    ? (process.env.BASE_URL ? [process.env.BASE_URL] : ['*'])
    : ['http://localhost:3000', 'http://127.0.0.1:3000'],
  credentials: true,
}));
logger.info('CORS configured');

// Rate limiting
logger.info('Setting up rate limiting...');
app.use(rateLimit);
logger.info('Rate limiting configured');

// Body parsing middleware
logger.info('Setting up body parsing...');
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
logger.info('Body parsing configured');

// Request logging
logger.info('Setting up request logging...');
app.use((req, res, next) => {
  logger.info(`${req.method} ${req.path}`, {
    ip: req.ip,
    userAgent: req.get('User-Agent'),
    timestamp: new Date().toISOString()
  });
  next();
});
logger.info('Request logging configured');

// Health check endpoint
logger.info('Setting up health check endpoint...');
app.get('/health', healthController.healthCheck);
logger.info('Health check endpoint configured');

// Webhook endpoints
logger.info('Setting up webhook endpoints...');
app.post('/webhook/meeting-started', webhookController.handleMeetingStarted);
app.post('/webhook/chatterbox', webhookController.handleChatterBoxWebhook);

// NEW: Direct ChatterBox webhook endpoints (more reliable)
app.post('/webhook/chatterbox-direct', chatterboxDirectController.handleChatterBoxDirectWebhook);
app.post('/webhook/meeting-direct', chatterboxDirectController.createMeetingAndJoinBot);
logger.info('Webhook endpoints configured');

// API endpoints
logger.info('Setting up API endpoints...');
app.get('/api/meetings/:id/status', webhookController.getMeetingStatus);
app.post('/api/meetings/:id/retry', webhookController.retryMeetingProcessing);
app.post('/api/meetings/:id/process', webhookController.manualProcessMeeting);
logger.info('API endpoints configured');

// 404 handler
logger.info('Setting up 404 handler...');
app.use('*', (req, res) => {
  res.status(404).json({
    error: 'Not Found',
    message: `Route ${req.method} ${req.originalUrl} not found`,
    timestamp: new Date().toISOString()
  });
});
logger.info('404 handler configured');

// Global error handler
logger.info('Setting up global error handler...');
app.use(errorHandler);
logger.info('Global error handler configured');

// Graceful shutdown handler
const gracefulShutdown = (signal) => {
  logger.info(`Received ${signal}. Starting graceful shutdown...`);
  
  server.close(() => {
    logger.info('HTTP server closed.');
    
    // Stop background jobs
    pollStatusJob.stop();
    cleanupJob.stop();
    
    // Close database connections if needed
    process.exit(0);
  });
  
  // Force shutdown after 30 seconds
  setTimeout(() => {
    logger.error('Forced shutdown after timeout');
    process.exit(1);
  }, 30000);
};

// Start server
const server = app.listen(PORT, () => {
  logger.info(`🚀 Meeting Recording Service started on port ${PORT}`, {
    environment: process.env.NODE_ENV,
    baseUrl: process.env.BASE_URL,
    timestamp: new Date().toISOString()
  });
  
  // Start background jobs
  pollStatusJob.start();
  cleanupJob.start();
});

// Handle graceful shutdown
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
  logger.error('Uncaught Exception:', error);
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  logger.error('Unhandled Rejection at:', promise, 'reason:', reason);
  process.exit(1);
});

module.exports = app;
