const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
require('dotenv').config();

const logger = require('./utils/logger');
const errorHandler = require('./middlewares/errorHandler');
const rateLimit = require('./middlewares/rateLimit');

// Import controllers with error handling
let webhookController, healthController, pollStatusJob, cleanupJob;

try {
  logger.info('Loading webhook controller...');
  webhookController = require('./controllers/webhookController');
  logger.info('Webhook controller loaded successfully');
} catch (error) {
  logger.error('Failed to load webhook controller:', error);
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

const app = express();
const PORT = process.env.PORT || 3000;

// Security middleware
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

// CORS configuration
app.use(cors({
  origin: process.env.NODE_ENV === 'production' 
    ? (process.env.BASE_URL ? [process.env.BASE_URL] : ['*'])
    : ['http://localhost:3000', 'http://127.0.0.1:3000'],
  credentials: true,
}));

// Rate limiting
app.use(rateLimit);

// Body parsing middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Request logging
app.use((req, res, next) => {
  logger.info(`${req.method} ${req.path}`, {
    ip: req.ip,
    userAgent: req.get('User-Agent'),
    timestamp: new Date().toISOString()
  });
  next();
});

// Health check endpoint
app.get('/health', healthController.healthCheck);

// Webhook endpoints
app.post('/webhook/meeting-started', webhookController.handleMeetingStarted);
app.post('/webhook/chatterbox', webhookController.handleChatterBoxWebhook);

// API endpoints
app.get('/api/meetings/:id/status', webhookController.getMeetingStatus);
app.post('/api/meetings/:id/retry', webhookController.retryMeetingProcessing);
app.post('/api/meetings/:id/process', webhookController.manualProcessMeeting);

// 404 handler
app.use('*', (req, res) => {
  res.status(404).json({
    error: 'Not Found',
    message: `Route ${req.method} ${req.originalUrl} not found`,
    timestamp: new Date().toISOString()
  });
});

// Global error handler
app.use(errorHandler);

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
