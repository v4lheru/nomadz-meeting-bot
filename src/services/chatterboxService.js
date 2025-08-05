const chatterboxConfig = require('../config/chatterbox');
const logger = require('../utils/logger');

/**
 * ChatterBox service for meeting bot operations
 * Handles all ChatterBox API interactions with proper error handling and logging
 */
class ChatterBoxService {
  /**
   * Join bot to a meeting
   */
  async joinMeeting({ meetingId, botName, webhookUrl }) {
    try {
      logger.logChatterBoxEvent('join_meeting', 'started', {
        meetingId,
        botName,
        webhookUrl
      });

      const sessionData = await chatterboxConfig.joinMeeting({
        meetingId,
        botName,
        webhookUrl
      });

      logger.logChatterBoxEvent('join_meeting', 'success', {
        meetingId,
        sessionId: sessionData.sessionId,
        botName
      });

      return sessionData;
    } catch (error) {
      logger.error('Failed to join meeting with ChatterBox', {
        meetingId,
        botName,
        webhookUrl,
        error: error.message,
        status: error.response?.status,
        timestamp: new Date().toISOString()
      });
      throw error;
    }
  }

  /**
   * Get session data (recording and transcript)
   */
  async getSessionData(sessionId) {
    try {
      logger.logChatterBoxEvent(sessionId, 'get_session_data', 'started');

      const sessionData = await chatterboxConfig.getSessionData(sessionId);

      logger.logChatterBoxEvent(sessionId, 'get_session_data', 'success', {
        hasRecording: !!sessionData.recordingLink,
        hasTranscript: !!sessionData.transcript,
        transcriptLength: sessionData.transcript?.length || 0,
        startTimestamp: sessionData.startTimestamp,
        endTimestamp: sessionData.endTimestamp
      });

      return sessionData;
    } catch (error) {
      logger.error('Failed to get session data from ChatterBox', {
        sessionId,
        error: error.message,
        status: error.response?.status,
        timestamp: new Date().toISOString()
      });
      throw error;
    }
  }

  /**
   * Force leave session (if needed for cleanup)
   */
  async forceLeaveSession(sessionId) {
    try {
      logger.logChatterBoxEvent(sessionId, 'force_leave', 'started');

      const success = await chatterboxConfig.forceLeaveSession(sessionId);

      if (success) {
        logger.logChatterBoxEvent(sessionId, 'force_leave', 'success');
      } else {
        logger.warn('Force leave session returned false', { sessionId });
      }

      return success;
    } catch (error) {
      logger.error('Failed to force leave session', {
        sessionId,
        error: error.message,
        status: error.response?.status,
        timestamp: new Date().toISOString()
      });
      throw error;
    }
  }

  /**
   * Validate webhook payload from ChatterBox
   */
  validateWebhookPayload(payload) {
    try {
      return chatterboxConfig.validateWebhookPayload(payload);
    } catch (error) {
      logger.error('Invalid ChatterBox webhook payload', {
        payload,
        error: error.message,
        timestamp: new Date().toISOString()
      });
      throw error;
    }
  }

  /**
   * Check if recording URL is still valid (not expired)
   * ⚠️ CRITICAL: ChatterBox URLs expire in 5 minutes!
   */
  async isRecordingUrlValid(recordingUrl) {
    try {
      const isValid = await chatterboxConfig.isRecordingUrlValid(recordingUrl);
      
      logger.info('Recording URL validation result', {
        url: recordingUrl.substring(0, 50) + '...',
        isValid,
        timestamp: new Date().toISOString()
      });

      return isValid;
    } catch (error) {
      logger.error('Failed to validate recording URL', {
        url: recordingUrl.substring(0, 50) + '...',
        error: error.message,
        timestamp: new Date().toISOString()
      });
      return false;
    }
  }

  /**
   * Get estimated time remaining before URL expires
   * ChatterBox URLs expire 5 minutes after the webhook is sent
   */
  getUrlExpirationInfo(webhookTimestamp) {
    const webhookTime = new Date(webhookTimestamp * 1000); // Convert from Unix timestamp
    const expirationTime = new Date(webhookTime.getTime() + (5 * 60 * 1000)); // Add 5 minutes
    const now = new Date();
    const timeRemaining = expirationTime.getTime() - now.getTime();

    return {
      webhookTime,
      expirationTime,
      timeRemainingMs: Math.max(0, timeRemaining),
      timeRemainingSeconds: Math.max(0, Math.floor(timeRemaining / 1000)),
      isExpired: timeRemaining <= 0,
      isUrgent: timeRemaining <= (2 * 60 * 1000) // Less than 2 minutes remaining
    };
  }

  /**
   * Health check for ChatterBox API
   */
  async healthCheck() {
    try {
      return await chatterboxConfig.healthCheck();
    } catch (error) {
      logger.error('ChatterBox health check failed', {
        error: error.message,
        timestamp: new Date().toISOString()
      });
      throw error;
    }
  }

  /**
   * Test ChatterBox API connection
   */
  async testConnection() {
    try {
      return await chatterboxConfig.testConnection();
    } catch (error) {
      logger.error('ChatterBox connection test failed', {
        error: error.message,
        timestamp: new Date().toISOString()
      });
      throw error;
    }
  }

  /**
   * Process webhook event from ChatterBox
   */
  async processWebhookEvent(type, payload) {
    try {
      logger.logChatterBoxEvent(payload.sessionId || 'unknown', 'webhook_event', type, {
        type,
        payload
      });

      switch (type) {
        case 'started':
          return this.handleSessionStarted(payload);
        
        case 'finished':
          return this.handleSessionFinished(payload);
        
        default:
          logger.warn('Unknown ChatterBox webhook event type', {
            type,
            payload,
            timestamp: new Date().toISOString()
          });
          return { processed: false, reason: 'Unknown event type' };
      }
    } catch (error) {
      logger.error('Failed to process ChatterBox webhook event', {
        type,
        payload,
        error: error.message,
        timestamp: new Date().toISOString()
      });
      throw error;
    }
  }

  /**
   * Handle session started webhook
   */
  async handleSessionStarted(payload) {
    const { sessionId, timestamp } = payload;
    
    logger.logChatterBoxEvent(sessionId, 'session_started', 'received', {
      timestamp,
      receivedAt: new Date().toISOString()
    });

    return {
      processed: true,
      sessionId,
      event: 'started',
      timestamp: new Date().toISOString()
    };
  }

  /**
   * Handle session finished webhook
   * ⚠️ CRITICAL: This triggers urgent processing due to 5-minute URL expiration!
   */
  async handleSessionFinished(payload) {
    const { sessionId, recordingUrl, timestamp } = payload;
    
    // Calculate URL expiration info
    const expirationInfo = this.getUrlExpirationInfo(timestamp);
    
    logger.logChatterBoxEvent(sessionId, 'session_finished', 'received', {
      timestamp,
      recordingUrl: recordingUrl ? 'provided' : 'not_provided',
      expirationInfo,
      receivedAt: new Date().toISOString()
    });

    // Log urgency warning if time is running out
    if (expirationInfo.isUrgent) {
      logger.warn('🚨 URGENT: Recording URL expires soon!', {
        sessionId,
        timeRemainingSeconds: expirationInfo.timeRemainingSeconds,
        expirationTime: expirationInfo.expirationTime,
        timestamp: new Date().toISOString()
      });
    }

    if (expirationInfo.isExpired) {
      logger.error('🚨 CRITICAL: Recording URL has already expired!', {
        sessionId,
        webhookTime: expirationInfo.webhookTime,
        expirationTime: expirationInfo.expirationTime,
        timestamp: new Date().toISOString()
      });
    }

    return {
      processed: true,
      sessionId,
      recordingUrl,
      event: 'finished',
      expirationInfo,
      timestamp: new Date().toISOString()
    };
  }
}

// Export singleton instance
module.exports = new ChatterBoxService();
