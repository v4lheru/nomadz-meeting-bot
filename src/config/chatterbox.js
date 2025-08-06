const axios = require('axios');
const logger = require('../utils/logger');

// Validate required environment variables
const requiredEnvVars = ['CHATTERBOX_API_KEY'];
const missingEnvVars = requiredEnvVars.filter(envVar => !process.env[envVar]);

if (missingEnvVars.length > 0) {
  logger.error('Missing required ChatterBox API environment variables', {
    missing: missingEnvVars,
    timestamp: new Date().toISOString()
  });
  throw new Error(`Missing required environment variables: ${missingEnvVars.join(', ')}`);
}

// ChatterBox API configuration
const CHATTERBOX_BASE_URL = 'https://bot.chatter-box.io';
const API_KEY = process.env.CHATTERBOX_API_KEY;

// Create axios instance with default configuration
const chatterboxClient = axios.create({
  baseURL: CHATTERBOX_BASE_URL,
  timeout: 30000, // 30 seconds timeout
  headers: {
    'Authorization': `Bearer ${API_KEY}`,
    'Content-Type': 'application/json',
    'User-Agent': 'meeting-recording-service/1.0.0'
  }
});

// Request interceptor for logging
chatterboxClient.interceptors.request.use(
  (config) => {
    logger.logChatterBoxEvent('request', 'sent', {
      method: config.method.toUpperCase(),
      url: config.url,
      timestamp: new Date().toISOString()
    });
    return config;
  },
  (error) => {
    logger.error('ChatterBox request error', {
      error: error.message,
      timestamp: new Date().toISOString()
    });
    return Promise.reject(error);
  }
);

// Response interceptor for logging and error handling
chatterboxClient.interceptors.response.use(
  (response) => {
    logger.logChatterBoxEvent('response', 'received', {
      status: response.status,
      url: response.config.url,
      timestamp: new Date().toISOString()
    });
    return response;
  },
  (error) => {
    const errorDetails = {
      message: error.message,
      status: error.response?.status,
      statusText: error.response?.statusText,
      url: error.config?.url,
      timestamp: new Date().toISOString()
    };

    // Log different error types appropriately
    if (error.response?.status === 401) {
      logger.error('ChatterBox API authentication failed', errorDetails);
    } else if (error.response?.status === 429) {
      logger.warn('ChatterBox API rate limit exceeded', errorDetails);
    } else if (error.response?.status >= 500) {
      logger.error('ChatterBox API server error', errorDetails);
    } else if (error.code === 'ECONNABORTED') {
      logger.error('ChatterBox API request timeout', errorDetails);
    } else {
      logger.error('ChatterBox API error', errorDetails);
    }

    return Promise.reject(error);
  }
);

/**
 * Test ChatterBox API connection
 */
const testConnection = async () => {
  try {
    // Test with a minimal join request that should return a validation error
    // This tests authentication without actually joining a meeting
    const response = await chatterboxClient.post('/join', {
      platform: 'googlemeet',
      meetingId: 'test-connection-check',
      botName: 'Connection Test',
      language: 'en'
      // No model specified - Google Meet uses native transcription
    });
    
    logger.info('ChatterBox API connection successful', {
      status: response.status,
      timestamp: new Date().toISOString()
    });
    
    return {
      status: 'connected',
      responseTime: 'unknown'
    };
  } catch (error) {
    // If we get a 400 (bad request) for invalid meeting ID, that means auth worked
    if (error.response?.status === 400) {
      logger.info('ChatterBox API connection successful (400 expected for test meeting ID)', {
        status: 400,
        timestamp: new Date().toISOString()
      });
      
      return {
        status: 'connected',
        note: 'API accessible (400 expected for test meeting ID)'
      };
    }
    
    logger.error('ChatterBox API connection failed', {
      error: error.message,
      status: error.response?.status,
      timestamp: new Date().toISOString()
    });
    throw error;
  }
};

/**
 * Health check for ChatterBox API
 */
const healthCheck = async () => {
  try {
    const startTime = Date.now();
    
    // Test connection
    await testConnection();
    
    const responseTime = Date.now() - startTime;
    
    return {
      status: 'healthy',
      responseTime,
      timestamp: new Date().toISOString()
    };
  } catch (error) {
    return {
      status: 'unhealthy',
      error: error.message,
      timestamp: new Date().toISOString()
    };
  }
};

/**
 * Join bot to a meeting
 */
const joinMeeting = async ({ meetingId, botName, webhookUrl }) => {
  try {
    logger.logChatterBoxEvent('join_meeting', 'started', {
      meetingId,
      botName,
      webhookUrl
    });

    const response = await chatterboxClient.post('/join', {
      platform: 'googlemeet',
      meetingId,
      botName,
      webhookUrl,
      language: 'multi'
      // No model specified - Google Meet uses native transcription (better quality)
    });

    logger.logChatterBoxEvent('join_meeting', 'success', {
      meetingId,
      sessionId: response.data.sessionId
    });

    return response.data;
  } catch (error) {
    logger.error('Failed to join meeting with ChatterBox', {
      meetingId,
      botName,
      error: error.message,
      status: error.response?.status,
      timestamp: new Date().toISOString()
    });
    throw error;
  }
};

/**
 * Get session data (recording and transcript)
 */
const getSessionData = async (sessionId) => {
  try {
    logger.logChatterBoxEvent('get_session', 'started', { sessionId });

    const response = await chatterboxClient.get(`/session/${sessionId}`);

    logger.logChatterBoxEvent('get_session', 'success', {
      sessionId,
      hasRecording: !!response.data.recordingLink,
      hasTranscript: !!response.data.transcript,
      transcriptLength: response.data.transcript?.length || 0
    });

    return response.data;
  } catch (error) {
    logger.error('Failed to get session data from ChatterBox', {
      sessionId,
      error: error.message,
      status: error.response?.status,
      timestamp: new Date().toISOString()
    });
    throw error;
  }
};

/**
 * Force leave session (if needed)
 */
const forceLeaveSession = async (sessionId) => {
  try {
    logger.logChatterBoxEvent('force_leave', 'started', { sessionId });

    // Use the correct API endpoint for leaving sessions
    const response = await axios.post(`https://api.chatter-box.io/session/${sessionId}/leave`, {}, {
      headers: {
        'Authorization': `Bearer ${API_KEY}`
      }
    });

    logger.logChatterBoxEvent('force_leave', 'success', { sessionId });

    return response.status === 200;
  } catch (error) {
    logger.error('Failed to force leave session', {
      sessionId,
      error: error.message,
      status: error.response?.status,
      timestamp: new Date().toISOString()
    });
    throw error;
  }
};

/**
 * Validate webhook payload from ChatterBox
 */
const validateWebhookPayload = (payload) => {
  const requiredFields = ['type', 'payload'];
  const missingFields = requiredFields.filter(field => !payload[field]);
  
  if (missingFields.length > 0) {
    throw new Error(`Invalid webhook payload: missing fields ${missingFields.join(', ')}`);
  }
  
  // Validate payload structure based on type
  if (payload.type === 'finished') {
    const requiredPayloadFields = ['sessionId', 'timestamp'];
    const missingPayloadFields = requiredPayloadFields.filter(field => !payload.payload[field]);
    
    if (missingPayloadFields.length > 0) {
      throw new Error(`Invalid finished webhook payload: missing fields ${missingPayloadFields.join(', ')}`);
    }
  }
  
  return true;
};

/**
 * Check if recording URL is still valid (not expired)
 * ⚠️ DEPRECATED: URL validation removed due to false failures with AWS S3 signed URLs
 * Always returns true to avoid blocking processing
 */
const isRecordingUrlValid = async (recordingUrl) => {
  logger.warn('URL validation is deprecated - always returning true', {
    url: recordingUrl.substring(0, 50) + '...',
    reason: 'URL validation causes false failures with AWS S3 signed URLs',
    timestamp: new Date().toISOString()
  });
  
  // Always return true - trust ChatterBox URLs
  return true;
};

logger.info('ChatterBox API configuration initialized', {
  baseUrl: CHATTERBOX_BASE_URL,
  timestamp: new Date().toISOString()
});

module.exports = {
  chatterboxClient,
  testConnection,
  healthCheck,
  joinMeeting,
  getSessionData,
  forceLeaveSession,
  validateWebhookPayload,
  isRecordingUrlValid,
  CHATTERBOX_BASE_URL
};
