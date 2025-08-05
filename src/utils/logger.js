const winston = require('winston');

// Define log levels
const levels = {
  error: 0,
  warn: 1,
  info: 2,
  http: 3,
  debug: 4,
};

// Define colors for each level
const colors = {
  error: 'red',
  warn: 'yellow',
  info: 'green',
  http: 'magenta',
  debug: 'white',
};

// Tell winston that you want to link the colors
winston.addColors(colors);

// Define which transports the logger must use
const transports = [
  // Console transport
  new winston.transports.Console({
    format: winston.format.combine(
      winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss:ms' }),
      winston.format.colorize({ all: true }),
      winston.format.printf(
        (info) => `${info.timestamp} ${info.level}: ${info.message}${
          info.stack ? `\n${info.stack}` : ''
        }${
          Object.keys(info).length > 3 ? `\n${JSON.stringify(
            Object.fromEntries(
              Object.entries(info).filter(([key]) => 
                !['timestamp', 'level', 'message', 'stack'].includes(key)
              )
            ), 
            null, 
            2
          )}` : ''
        }`
      ),
    ),
  }),
];

// Add file transports in production
if (process.env.NODE_ENV === 'production') {
  transports.push(
    // Error log file
    new winston.transports.File({
      filename: 'logs/error.log',
      level: 'error',
      format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.errors({ stack: true }),
        winston.format.json()
      ),
    }),
    // Combined log file
    new winston.transports.File({
      filename: 'logs/combined.log',
      format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.errors({ stack: true }),
        winston.format.json()
      ),
    })
  );
}

// Create the logger
const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  levels,
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    winston.format.json()
  ),
  transports,
  // Handle exceptions and rejections
  exceptionHandlers: [
    new winston.transports.File({ filename: 'logs/exceptions.log' })
  ],
  rejectionHandlers: [
    new winston.transports.File({ filename: 'logs/rejections.log' })
  ],
});

// Create a stream object for Morgan HTTP logging
logger.stream = {
  write: (message) => {
    logger.http(message.trim());
  },
};

// Add helper methods for structured logging
logger.logMeetingEvent = (meetingId, event, data = {}) => {
  logger.info(`Meeting ${event}`, {
    meetingId,
    event,
    ...data,
    timestamp: new Date().toISOString()
  });
};

logger.logProcessingStep = (meetingId, step, status, data = {}) => {
  logger.info(`Processing step: ${step} - ${status}`, {
    meetingId,
    step,
    status,
    ...data,
    timestamp: new Date().toISOString()
  });
};

logger.logError = (error, context = {}) => {
  logger.error('Application error', {
    error: error.message,
    stack: error.stack,
    ...context,
    timestamp: new Date().toISOString()
  });
};

logger.logChatterBoxEvent = (sessionId, event, data = {}) => {
  logger.info(`ChatterBox ${event}`, {
    sessionId,
    event,
    ...data,
    timestamp: new Date().toISOString()
  });
};

logger.logFileOperation = (operation, filename, status, data = {}) => {
  logger.info(`File operation: ${operation} - ${status}`, {
    operation,
    filename,
    status,
    ...data,
    timestamp: new Date().toISOString()
  });
};

logger.logSlackNotification = (channel, messageType, status, data = {}) => {
  logger.info(`Slack notification: ${messageType} - ${status}`, {
    channel,
    messageType,
    status,
    ...data,
    timestamp: new Date().toISOString()
  });
};

// Log startup information
logger.info('Logger initialized', {
  level: process.env.LOG_LEVEL || 'info',
  environment: process.env.NODE_ENV || 'development',
  timestamp: new Date().toISOString()
});

// Add custom logging methods for specific operations
logger.logMeetingEvent = (meetingId, event, status, metadata = {}) => {
  logger.info(`Meeting ${event}: ${status}`, {
    meetingId,
    event,
    status,
    ...metadata,
    timestamp: new Date().toISOString()
  });
};

logger.logChatterBoxEvent = (sessionId, event, status, metadata = {}) => {
  logger.info(`ChatterBox ${event}: ${status}`, {
    sessionId,
    event,
    status,
    ...metadata,
    timestamp: new Date().toISOString()
  });
};

logger.logProcessingStep = (meetingId, step, status, metadata = {}) => {
  logger.info(`Processing step ${step}: ${status}`, {
    meetingId,
    step,
    status,
    ...metadata,
    timestamp: new Date().toISOString()
  });
};

logger.logFileOperation = (operation, fileName, status, metadata = {}) => {
  logger.info(`File operation ${operation}: ${status}`, {
    operation,
    fileName,
    status,
    ...metadata,
    timestamp: new Date().toISOString()
  });
};

logger.logSlackNotification = (channel, type, status, metadata = {}) => {
  logger.info(`Slack notification ${type}: ${status}`, {
    channel,
    type,
    status,
    ...metadata,
    timestamp: new Date().toISOString()
  });
};

module.exports = logger;
