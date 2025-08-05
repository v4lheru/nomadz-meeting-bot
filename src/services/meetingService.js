const logger = require('../utils/logger');
const { handleCriticalError } = require('../middlewares/errorHandler');

// Import services
const databaseService = require('./databaseService');
const chatterboxService = require('./chatterboxService');
const fileService = require('./fileService');
const transcriptService = require('./transcriptService');
const notificationService = require('./notificationService');

/**
 * Meeting service - orchestrates the entire meeting recording workflow
 * Handles the critical 5-minute processing window for ChatterBox recordings
 */
class MeetingService {
  /**
   * Process recording urgently within 5-minute window
   * ⚠️ CRITICAL: ChatterBox recording URLs expire in 5 minutes!
   */
  async processRecordingUrgently(meetingId, recordingUrl, sessionId) {
    const startTime = Date.now();
    
    try {
      logger.logMeetingEvent(meetingId, 'urgent_processing_started', {
        sessionId,
        hasRecordingUrl: !!recordingUrl,
        startTime: new Date().toISOString()
      });

      // Update meeting status immediately
      await databaseService.updateMeeting(meetingId, {
        status: 'processing',
        recording_s3_url: recordingUrl,
        processing_started_at: new Date().toISOString()
      });

      // Get meeting details
      const meeting = await databaseService.getMeetingById(meetingId);
      if (!meeting) {
        throw new Error(`Meeting not found: ${meetingId}`);
      }

      let processedRecordingUrl = recordingUrl;
      let transcriptData = null;

      // Step 1: If no recording URL provided, try to get session data
      if (!recordingUrl) {
        logger.logProcessingStep(meetingId, 'fetch_session_data', 'started');
        
        const sessionData = await this.processStep(
          meetingId,
          'fetch_session_data',
          () => chatterboxService.getSessionData(sessionId)
        );
        
        processedRecordingUrl = sessionData.recordingLink;
        transcriptData = sessionData;
        
        if (!processedRecordingUrl) {
          throw new Error('No recording URL available from ChatterBox session');
        }
      }

      // Step 2: Validate recording URL is still accessible
      logger.logProcessingStep(meetingId, 'validate_recording_url', 'started');
      
      const isUrlValid = await this.processStep(
        meetingId,
        'validate_recording_url',
        () => chatterboxService.isRecordingUrlValid(processedRecordingUrl)
      );

      if (!isUrlValid) {
        throw new Error('Recording URL has expired or is not accessible');
      }

      // Step 3: Download and stream recording to Google Drive immediately
      logger.logProcessingStep(meetingId, 'stream_to_drive', 'started');
      
      const driveFile = await this.processStep(
        meetingId,
        'stream_to_drive',
        () => fileService.streamRecordingToGoogleDrive(
          processedRecordingUrl,
          meeting.meeting_title
        )
      );

      // Step 4: Get transcript data if not already fetched
      if (!transcriptData) {
        logger.logProcessingStep(meetingId, 'fetch_transcript', 'started');
        
        transcriptData = await this.processStep(
          meetingId,
          'fetch_transcript',
          () => chatterboxService.getSessionData(sessionId)
        );
      }

      // Step 5: Create transcript document
      logger.logProcessingStep(meetingId, 'create_transcript', 'started');
      
      const transcriptDoc = await this.processStep(
        meetingId,
        'create_transcript',
        () => transcriptService.createTranscriptDocument(meeting, transcriptData.transcript)
      );

      // Step 6: Send Slack notification
      logger.logProcessingStep(meetingId, 'send_notification', 'started');
      
      const slackResult = await this.processStep(
        meetingId,
        'send_notification',
        () => notificationService.sendMeetingCompletedNotification(
          meeting,
          driveFile,
          transcriptDoc,
          transcriptData
        )
      );

      // Step 7: Update meeting as completed
      await databaseService.updateMeeting(meetingId, {
        status: 'completed',
        google_drive_recording_id: driveFile.id,
        google_drive_recording_url: driveFile.webViewLink,
        google_drive_transcript_id: transcriptDoc.id,
        google_drive_transcript_url: transcriptDoc.webViewLink,
        recording_start_timestamp: transcriptData.startTimestamp ? new Date(transcriptData.startTimestamp) : null,
        recording_end_timestamp: transcriptData.endTimestamp ? new Date(transcriptData.endTimestamp) : null,
        transcript_data: transcriptData.transcript,
        slack_message_ts: slackResult.messageTs,
        processing_completed_at: new Date().toISOString()
      });

      const processingTime = Date.now() - startTime;
      
      logger.logMeetingEvent(meetingId, 'urgent_processing_completed', {
        sessionId,
        processingTimeMs: processingTime,
        processingTimeSeconds: Math.round(processingTime / 1000),
        driveFileId: driveFile.id,
        transcriptDocId: transcriptDoc.id,
        timestamp: new Date().toISOString()
      });

      return {
        success: true,
        meetingId,
        sessionId,
        processingTime,
        driveFile,
        transcriptDoc,
        slackResult
      };

    } catch (error) {
      const processingTime = Date.now() - startTime;
      
      // Mark meeting as failed
      await databaseService.updateMeeting(meetingId, {
        status: 'failed',
        processing_completed_at: new Date().toISOString()
      }).catch(dbError => {
        logger.error('Failed to update meeting status to failed', {
          meetingId,
          dbError: dbError.message,
          timestamp: new Date().toISOString()
        });
      });

      // Handle critical error with immediate alerting
      await handleCriticalError(meetingId, 'urgent_processing', error, {
        sessionId,
        recordingUrl: recordingUrl ? 'provided' : 'not_provided',
        processingTime,
        timestamp: new Date().toISOString()
      });

      logger.logMeetingEvent(meetingId, 'urgent_processing_failed', {
        sessionId,
        error: error.message,
        processingTime,
        timestamp: new Date().toISOString()
      });

      throw error;
    }
  }

  /**
   * Retry processing for a failed meeting
   */
  async retryProcessing(meetingId, sessionId) {
    try {
      logger.logMeetingEvent(meetingId, 'retry_processing_started', {
        sessionId,
        timestamp: new Date().toISOString()
      });

      // Reset meeting status
      await databaseService.updateMeeting(meetingId, {
        status: 'processing',
        processing_started_at: new Date().toISOString()
      });

      // Try to get session data (recording URL might still be available)
      const sessionData = await chatterboxService.getSessionData(sessionId);
      
      if (sessionData.recordingLink) {
        // Check if URL is still valid
        const isValid = await chatterboxService.isRecordingUrlValid(sessionData.recordingLink);
        
        if (isValid) {
          // Process with existing URL
          return await this.processRecordingUrgently(meetingId, sessionData.recordingLink, sessionId);
        } else {
          throw new Error('Recording URL has expired and cannot be retried');
        }
      } else {
        throw new Error('No recording URL available for retry');
      }

    } catch (error) {
      logger.error('Retry processing failed', {
        meetingId,
        sessionId,
        error: error.message,
        timestamp: new Date().toISOString()
      });

      await databaseService.updateMeeting(meetingId, {
        status: 'failed'
      });

      throw error;
    }
  }

  /**
   * Manual processing for testing/debugging
   */
  async manualProcessMeeting(meetingId, sessionId) {
    try {
      logger.logMeetingEvent(meetingId, 'manual_processing_started', {
        sessionId,
        timestamp: new Date().toISOString()
      });

      // Get session data
      const sessionData = await chatterboxService.getSessionData(sessionId);
      
      // Process regardless of URL expiration (for testing)
      return await this.processRecordingUrgently(meetingId, sessionData.recordingLink, sessionId);

    } catch (error) {
      logger.error('Manual processing failed', {
        meetingId,
        sessionId,
        error: error.message,
        timestamp: new Date().toISOString()
      });
      throw error;
    }
  }

  /**
   * Process a single step with error handling and logging
   */
  async processStep(meetingId, stepName, processingFunction, maxRetries = 3) {
    const log = await databaseService.logProcessingStep(meetingId, stepName, 'started');
    
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        logger.logProcessingStep(meetingId, stepName, 'attempting', {
          attempt,
          maxRetries
        });

        const result = await processingFunction();
        
        await databaseService.updateProcessingStep(log.id, 'completed', {
          attempt,
          result: typeof result === 'object' ? 'object' : String(result).substring(0, 100)
        });

        logger.logProcessingStep(meetingId, stepName, 'completed', {
          attempt,
          success: true
        });

        return result;
      } catch (error) {
        logger.error(`Step ${stepName} failed (attempt ${attempt}/${maxRetries})`, {
          meetingId,
          stepName,
          attempt,
          error: error.message,
          timestamp: new Date().toISOString()
        });
        
        if (attempt === maxRetries) {
          await databaseService.updateProcessingStep(
            log.id,
            'failed',
            { attempt, maxRetries },
            error.message,
            { stack: error.stack }
          );
          throw error;
        }
        
        // Exponential backoff for retries
        const backoffMs = Math.pow(2, attempt) * 1000;
        logger.info(`Retrying step ${stepName} in ${backoffMs}ms`, {
          meetingId,
          stepName,
          attempt: attempt + 1,
          backoffMs
        });
        
        await new Promise(resolve => setTimeout(resolve, backoffMs));
      }
    }
  }

  /**
   * Get meeting processing status
   */
  async getMeetingStatus(meetingId) {
    try {
      const meeting = await databaseService.getMeetingById(meetingId);
      if (!meeting) {
        throw new Error('Meeting not found');
      }

      const logs = await databaseService.getProcessingLogs(meetingId);

      return {
        meeting,
        logs,
        processingTime: meeting.processing_started_at && meeting.processing_completed_at
          ? new Date(meeting.processing_completed_at) - new Date(meeting.processing_started_at)
          : null
      };
    } catch (error) {
      logger.error('Failed to get meeting status', {
        meetingId,
        error: error.message,
        timestamp: new Date().toISOString()
      });
      throw error;
    }
  }

  /**
   * Clean up old failed meetings
   */
  async cleanupOldMeetings(olderThanDays = 7) {
    try {
      const oldMeetings = await databaseService.getMeetingsForCleanup(olderThanDays);
      
      logger.info('Starting cleanup of old meetings', {
        count: oldMeetings.length,
        olderThanDays,
        timestamp: new Date().toISOString()
      });

      let cleanedCount = 0;
      
      for (const meeting of oldMeetings) {
        try {
          await databaseService.deleteMeeting(meeting.id);
          cleanedCount++;
          
          logger.info('Cleaned up old meeting', {
            meetingId: meeting.id,
            title: meeting.meeting_title,
            status: meeting.status,
            createdAt: meeting.created_at
          });
        } catch (error) {
          logger.error('Failed to cleanup meeting', {
            meetingId: meeting.id,
            error: error.message
          });
        }
      }

      logger.info('Cleanup completed', {
        totalFound: oldMeetings.length,
        cleaned: cleanedCount,
        failed: oldMeetings.length - cleanedCount,
        timestamp: new Date().toISOString()
      });

      return {
        totalFound: oldMeetings.length,
        cleaned: cleanedCount,
        failed: oldMeetings.length - cleanedCount
      };
    } catch (error) {
      logger.error('Cleanup process failed', {
        error: error.message,
        timestamp: new Date().toISOString()
      });
      throw error;
    }
  }
}

// Export singleton instance
module.exports = new MeetingService();
