const logger = require('../utils/logger');
const { asyncHandler, handleValidationErrors } = require('../middlewares/errorHandler');
const { body, param } = require('express-validator');

// Import services
const meetingService = require('../services/meetingService');
const chatterboxService = require('../services/chatterboxService');
const databaseService = require('../services/databaseService');
const chatterboxConfig = require('../config/chatterbox');

/**
 * Handle meeting started webhook from Google Calendar
 * This is the entry point for the entire meeting recording workflow
 */
const handleMeetingStarted = [
  // Validation middleware
  body('summary').notEmpty().withMessage('Meeting summary is required'),
  body('conferenceData.conferenceId').notEmpty().withMessage('Conference ID is required'),
  body('id').notEmpty().withMessage('Calendar event ID is required'),
  
  handleValidationErrors,
  
  asyncHandler(async (req, res) => {
    const { summary, conferenceData, id: eventId, description, start, end } = req.body;
    
    logger.logMeetingEvent('webhook_received', 'meeting_started', {
      eventId,
      summary,
      conferenceId: conferenceData.conferenceId
    });

    try {
      // Create meeting record in database
      const meeting = await databaseService.createMeeting({
        calendar_event_id: eventId,
        conference_id: conferenceData.conferenceId,
        meeting_title: summary,
        meeting_description: description || null,
        meeting_started_at: start?.dateTime ? new Date(start.dateTime) : new Date(),
        meeting_ended_at: end?.dateTime ? new Date(end.dateTime) : null,
        status: 'started'
      });

      logger.logMeetingEvent(meeting.id, 'created', {
        eventId,
        summary,
        conferenceId: conferenceData.conferenceId
      });

      // Join bot to meeting immediately
      const sessionData = await chatterboxService.joinMeeting({
        meetingId: conferenceData.conferenceId,
        botName: `Nomadz Bot - ${summary}`,
        webhookUrl: `${process.env.BASE_URL}/webhook/chatterbox`
      });

      // Update meeting with session information
      await databaseService.updateMeeting(meeting.id, {
        chatterbox_session_id: sessionData.sessionId,
        bot_join_status: 'joined',
        status: 'bot_joined'
      });

      logger.logMeetingEvent(meeting.id, 'bot_joined', {
        sessionId: sessionData.sessionId,
        conferenceId: conferenceData.conferenceId
      });

      res.status(200).json({
        success: true,
        meetingId: meeting.id,
        sessionId: sessionData.sessionId,
        message: 'Meeting recording started successfully',
        timestamp: new Date().toISOString()
      });

    } catch (error) {
      logger.error('Failed to start meeting recording', {
        eventId,
        summary,
        conferenceId: conferenceData.conferenceId,
        error: error.message,
        timestamp: new Date().toISOString()
      });

      res.status(500).json({
        success: false,
        error: 'Failed to start meeting recording',
        details: error.message,
        timestamp: new Date().toISOString()
      });
    }
  })
];

/**
 * Handle ChatterBox webhook when recording is finished
 * ⚠️ CRITICAL: This must process within 5 minutes before recording URL expires!
 */
const handleChatterBoxWebhook = [
  // Validation middleware
  body('type').notEmpty().withMessage('Webhook type is required'),
  body('payload').isObject().withMessage('Payload must be an object'),
  
  handleValidationErrors,
  
  asyncHandler(async (req, res) => {
    const { type, payload } = req.body;
    
    logger.logChatterBoxEvent(payload.sessionId || 'unknown', 'webhook_received', {
      type,
      payload
    });

    try {
      // Validate webhook payload
      chatterboxConfig.validateWebhookPayload(req.body);

      if (type === 'finished') {
        const { sessionId, recordingUrl, timestamp } = payload;
        
        // Find meeting by session ID
        const meeting = await databaseService.getMeetingBySessionId(sessionId);
        if (!meeting) {
          logger.warn('Meeting not found for ChatterBox session', {
            sessionId,
            timestamp: new Date().toISOString()
          });
          
          return res.status(404).json({
            success: false,
            error: 'Meeting not found for session ID',
            sessionId,
            timestamp: new Date().toISOString()
          });
        }

        logger.logMeetingEvent(meeting.id, 'recording_finished', {
          sessionId,
          recordingUrl: recordingUrl ? 'provided' : 'not_provided'
        });

        // ⚠️ CRITICAL: Start urgent processing immediately!
        // Recording URL expires in 5 minutes - no time to waste!
        meetingService.processRecordingUrgently(meeting.id, recordingUrl || null, sessionId)
          .catch(error => {
            logger.error('🚨 URGENT: Recording processing failed within 5-minute window', {
              meetingId: meeting.id,
              sessionId,
              error: error.message,
              timestamp: new Date().toISOString()
            });
          });

        // Respond immediately to ChatterBox
        res.status(200).json({
          success: true,
          message: 'Recording processing started',
          meetingId: meeting.id,
          sessionId,
          timestamp: new Date().toISOString()
        });

      } else if (type === 'started') {
        const { sessionId } = payload;
        
        // Update meeting status
        const meeting = await databaseService.getMeetingBySessionId(sessionId);
        if (meeting) {
          await databaseService.updateMeeting(meeting.id, {
            status: 'recording'
          });
          
          logger.logMeetingEvent(meeting.id, 'recording_started', { sessionId });
        }

        res.status(200).json({
          success: true,
          message: 'Recording started notification received',
          sessionId,
          timestamp: new Date().toISOString()
        });

      } else {
        logger.warn('Unknown ChatterBox webhook type', {
          type,
          payload,
          timestamp: new Date().toISOString()
        });

        res.status(200).json({
          success: true,
          message: 'Webhook received but not processed',
          type,
          timestamp: new Date().toISOString()
        });
      }

    } catch (error) {
      logger.error('ChatterBox webhook processing failed', {
        type,
        payload,
        error: error.message,
        timestamp: new Date().toISOString()
      });

      res.status(500).json({
        success: false,
        error: 'Webhook processing failed',
        details: error.message,
        timestamp: new Date().toISOString()
      });
    }
  })
];

/**
 * Get meeting status
 */
const getMeetingStatus = [
  param('id').isUUID().withMessage('Meeting ID must be a valid UUID'),
  
  handleValidationErrors,
  
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    
    try {
      const meeting = await databaseService.getMeetingById(id);
      
      if (!meeting) {
        return res.status(404).json({
          success: false,
          error: 'Meeting not found',
          timestamp: new Date().toISOString()
        });
      }

      // Get processing logs
      const logs = await databaseService.getProcessingLogs(id);

      res.status(200).json({
        success: true,
        meeting: {
          id: meeting.id,
          title: meeting.meeting_title,
          status: meeting.status,
          createdAt: meeting.created_at,
          processingStartedAt: meeting.processing_started_at,
          processingCompletedAt: meeting.processing_completed_at,
          googleDriveRecordingUrl: meeting.google_drive_recording_url,
          googleDriveTranscriptUrl: meeting.google_drive_transcript_url,
          chatterboxSessionId: meeting.chatterbox_session_id
        },
        logs,
        timestamp: new Date().toISOString()
      });

    } catch (error) {
      logger.error('Failed to get meeting status', {
        meetingId: id,
        error: error.message,
        timestamp: new Date().toISOString()
      });

      res.status(500).json({
        success: false,
        error: 'Failed to get meeting status',
        details: error.message,
        timestamp: new Date().toISOString()
      });
    }
  })
];

/**
 * Retry failed meeting processing
 */
const retryMeetingProcessing = [
  param('id').isUUID().withMessage('Meeting ID must be a valid UUID'),
  
  handleValidationErrors,
  
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    
    try {
      const meeting = await databaseService.getMeetingById(id);
      
      if (!meeting) {
        return res.status(404).json({
          success: false,
          error: 'Meeting not found',
          timestamp: new Date().toISOString()
        });
      }

      if (meeting.status === 'completed') {
        return res.status(400).json({
          success: false,
          error: 'Meeting processing already completed',
          timestamp: new Date().toISOString()
        });
      }

      if (meeting.status === 'processing') {
        return res.status(400).json({
          success: false,
          error: 'Meeting is currently being processed',
          timestamp: new Date().toISOString()
        });
      }

      logger.logMeetingEvent(id, 'retry_requested', {
        currentStatus: meeting.status,
        sessionId: meeting.chatterbox_session_id
      });

      // Attempt to retry processing
      if (meeting.chatterbox_session_id) {
        // Try to get session data and process
        meetingService.retryProcessing(id, meeting.chatterbox_session_id)
          .catch(error => {
            logger.error('Retry processing failed', {
              meetingId: id,
              error: error.message,
              timestamp: new Date().toISOString()
            });
          });

        res.status(200).json({
          success: true,
          message: 'Meeting processing retry started',
          meetingId: id,
          timestamp: new Date().toISOString()
        });
      } else {
        res.status(400).json({
          success: false,
          error: 'No ChatterBox session ID available for retry',
          timestamp: new Date().toISOString()
        });
      }

    } catch (error) {
      logger.error('Failed to retry meeting processing', {
        meetingId: id,
        error: error.message,
        timestamp: new Date().toISOString()
      });

      res.status(500).json({
        success: false,
        error: 'Failed to retry meeting processing',
        details: error.message,
        timestamp: new Date().toISOString()
      });
    }
  })
];

/**
 * Manual process meeting (for testing/debugging)
 */
const manualProcessMeeting = [
  param('id').isUUID().withMessage('Meeting ID must be a valid UUID'),
  
  handleValidationErrors,
  
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    
    try {
      const meeting = await databaseService.getMeetingById(id);
      
      if (!meeting) {
        return res.status(404).json({
          success: false,
          error: 'Meeting not found',
          timestamp: new Date().toISOString()
        });
      }

      logger.logMeetingEvent(id, 'manual_processing_requested', {
        currentStatus: meeting.status,
        sessionId: meeting.chatterbox_session_id
      });

      if (meeting.chatterbox_session_id) {
        // Start manual processing
        meetingService.manualProcessMeeting(id, meeting.chatterbox_session_id)
          .catch(error => {
            logger.error('Manual processing failed', {
              meetingId: id,
              error: error.message,
              timestamp: new Date().toISOString()
            });
          });

        res.status(200).json({
          success: true,
          message: 'Manual meeting processing started',
          meetingId: id,
          timestamp: new Date().toISOString()
        });
      } else {
        res.status(400).json({
          success: false,
          error: 'No ChatterBox session ID available',
          timestamp: new Date().toISOString()
        });
      }

    } catch (error) {
      logger.error('Failed to start manual processing', {
        meetingId: id,
        error: error.message,
        timestamp: new Date().toISOString()
      });

      res.status(500).json({
        success: false,
        error: 'Failed to start manual processing',
        details: error.message,
        timestamp: new Date().toISOString()
      });
    }
  })
];

module.exports = {
  handleMeetingStarted,
  handleChatterBoxWebhook,
  getMeetingStatus,
  retryMeetingProcessing,
  manualProcessMeeting
};
