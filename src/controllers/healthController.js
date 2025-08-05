const logger = require('../utils/logger');
const { asyncHandler } = require('../middlewares/errorHandler');

// Import all service configurations for health checks
const database = require('../config/database');
const google = require('../config/google');
const slack = require('../config/slack');
const chatterbox = require('../config/chatterbox');

/**
 * Comprehensive health check endpoint
 * Tests all external service connections and system health
 */
const healthCheck = asyncHandler(async (req, res) => {
  const startTime = Date.now();
  const healthStatus = {
    status: 'healthy',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    environment: process.env.NODE_ENV || 'development',
    version: '1.0.0',
    services: {},
    system: {}
  };

  // Check system resources
  const memoryUsage = process.memoryUsage();
  healthStatus.system = {
    memory: {
      used: Math.round(memoryUsage.heapUsed / 1024 / 1024) + ' MB',
      total: Math.round(memoryUsage.heapTotal / 1024 / 1024) + ' MB',
      external: Math.round(memoryUsage.external / 1024 / 1024) + ' MB',
      rss: Math.round(memoryUsage.rss / 1024 / 1024) + ' MB'
    },
    cpu: {
      loadAverage: process.platform !== 'win32' ? require('os').loadavg() : 'N/A (Windows)'
    },
    nodeVersion: process.version,
    platform: process.platform
  };

  // Test all services in parallel
  const serviceChecks = await Promise.allSettled([
    testDatabaseHealth(),
    testGoogleApisHealth(),
    testSlackHealth(),
    testChatterBoxHealth()
  ]);

  // Process service check results
  const [dbResult, googleResult, slackResult, chatterboxResult] = serviceChecks;

  healthStatus.services.database = processServiceResult(dbResult, 'Database');
  healthStatus.services.google = processServiceResult(googleResult, 'Google APIs');
  healthStatus.services.slack = processServiceResult(slackResult, 'Slack');
  healthStatus.services.chatterbox = processServiceResult(chatterboxResult, 'ChatterBox');

  // Determine overall health status
  const unhealthyServices = Object.values(healthStatus.services)
    .filter(service => service.status !== 'healthy');

  if (unhealthyServices.length > 0) {
    healthStatus.status = 'degraded';
    
    // If critical services are down, mark as unhealthy
    const criticalServices = ['database', 'chatterbox'];
    const criticalDown = unhealthyServices.some(service => 
      criticalServices.includes(service.name?.toLowerCase())
    );
    
    if (criticalDown) {
      healthStatus.status = 'unhealthy';
    }
  }

  // Add response time
  healthStatus.responseTime = Date.now() - startTime;

  // Log health check
  logger.info('Health check completed', {
    status: healthStatus.status,
    responseTime: healthStatus.responseTime,
    unhealthyServices: unhealthyServices.length,
    timestamp: healthStatus.timestamp
  });

  // Return appropriate HTTP status
  const httpStatus = healthStatus.status === 'healthy' ? 200 : 
                    healthStatus.status === 'degraded' ? 200 : 503;

  res.status(httpStatus).json(healthStatus);
});

/**
 * Simple liveness probe for container orchestration
 */
const livenessProbe = asyncHandler(async (req, res) => {
  res.status(200).json({
    status: 'alive',
    timestamp: new Date().toISOString(),
    uptime: process.uptime()
  });
});

/**
 * Readiness probe for container orchestration
 */
const readinessProbe = asyncHandler(async (req, res) => {
  try {
    // Quick database connectivity check
    await database.testConnection();
    
    res.status(200).json({
      status: 'ready',
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    logger.error('Readiness probe failed', {
      error: error.message,
      timestamp: new Date().toISOString()
    });
    
    res.status(503).json({
      status: 'not ready',
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * Test database health
 */
async function testDatabaseHealth() {
  try {
    const result = await database.healthCheck();
    return {
      name: 'Database',
      ...result
    };
  } catch (error) {
    return {
      name: 'Database',
      status: 'unhealthy',
      error: error.message,
      timestamp: new Date().toISOString()
    };
  }
}

/**
 * Test Google APIs health
 */
async function testGoogleApisHealth() {
  try {
    const result = await google.healthCheck();
    return {
      name: 'Google APIs',
      ...result
    };
  } catch (error) {
    return {
      name: 'Google APIs',
      status: 'unhealthy',
      error: error.message,
      timestamp: new Date().toISOString()
    };
  }
}

/**
 * Test Slack health
 */
async function testSlackHealth() {
  try {
    const result = await slack.healthCheck();
    return {
      name: 'Slack',
      ...result
    };
  } catch (error) {
    return {
      name: 'Slack',
      status: 'unhealthy',
      error: error.message,
      timestamp: new Date().toISOString()
    };
  }
}

/**
 * Test ChatterBox health
 */
async function testChatterBoxHealth() {
  try {
    const result = await chatterbox.healthCheck();
    return {
      name: 'ChatterBox',
      ...result
    };
  } catch (error) {
    return {
      name: 'ChatterBox',
      status: 'unhealthy',
      error: error.message,
      timestamp: new Date().toISOString()
    };
  }
}

/**
 * Process service check result from Promise.allSettled
 */
function processServiceResult(result, serviceName) {
  if (result.status === 'fulfilled') {
    return result.value;
  } else {
    return {
      name: serviceName,
      status: 'unhealthy',
      error: result.reason?.message || 'Unknown error',
      timestamp: new Date().toISOString()
    };
  }
}

/**
 * Get detailed service status
 */
const getServiceStatus = asyncHandler(async (req, res) => {
  const { service } = req.params;
  
  let result;
  
  switch (service.toLowerCase()) {
    case 'database':
      result = await testDatabaseHealth();
      break;
    case 'google':
      result = await testGoogleApisHealth();
      break;
    case 'slack':
      result = await testSlackHealth();
      break;
    case 'chatterbox':
      result = await testChatterBoxHealth();
      break;
    default:
      return res.status(400).json({
        error: 'Invalid service name',
        validServices: ['database', 'google', 'slack', 'chatterbox'],
        timestamp: new Date().toISOString()
      });
  }
  
  const httpStatus = result.status === 'healthy' ? 200 : 503;
  res.status(httpStatus).json(result);
});

module.exports = {
  healthCheck,
  livenessProbe,
  readinessProbe,
  getServiceStatus
};
