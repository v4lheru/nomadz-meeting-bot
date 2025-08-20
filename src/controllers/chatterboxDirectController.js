const logger = require('../utils/logger');
const { asyncHandler, handleValidationErrors } = require('../middlewares/errorHandler');
const { body } = require('express-validator');

// Import services
const meetingService = require('../services/meetingService');
const databaseService = require('../services/databaseService');
const chatterboxConfig = require('../config/chatterbox');

/**
 * Handle all ChatterBox webhook events directly
 * This replaces the need for our Railway webhook to be the initial trigger
 * ChatterBox will send us: started, transcript, finished events
 */
const handleChatterBoxDirectWebhook = [
  // Validation middleware
  body('type').notEmpty().withMessage('Webhook type is required'),
  body('payload').isObject().withMessage('Payload must be an object'),
  
  handleValidationErrors,
  
  asyncHandler(async (req, res) => {
    const { type, payload } = req.body;
    
    logger.logChatterBoxEvent(payload.sessionId || 'unknown', 'direct_webhook_received', {
      type,
      payload
    });

    try {
      // Validate webhook payload
      chatterboxConfig.validateWebhookPayload(req.body);

      switch (type) {
        case 'started':
          await handleSessionStarted(payload);
          break;
          
        case 'transcript':
          await handleTranscriptReceived(payload);
          break;
          
        case 'finished':
          await handleSessionFinished(payload);
          break;
          
        default:
          logger.warn('Unknown ChatterBox webhook type', {
            type,
            payload,
            timestamp: new Date().toISOString()
          });
      }

      // Always respond successfully to ChatterBox
      res.status(200).json({
        success: true,
        message: `${type} event processed successfully`,
        sessionId: payload.sessionId,
        timestamp: new Date().toISOString()
      });

    } catch (error) {
      logger.error('ChatterBox direct webhook processing failed', {
        type,
        payload,
        error: error.message,
        timestamp: new Date().toISOString()
      });

      // Still respond with 200 to ChatterBox to avoid retries
      res.status(200).json({
        success: false,
        error: 'Webhook processing failed',
        details: error.message,
        type,
        sessionId: payload.sessionId,
        timestamp: new Date().toISOString()
      });
    }
  })
];

/**
 * Handle session started event
 * This is when the bot successfully joins the meeting
 * Links ChatterBox session to calendar event and creates meeting record
 */
async function handleSessionStarted(payload) {
  const { sessionId, timestamp } = payload;
  
  logger.logChatterBoxEvent(sessionId, 'session_started', { timestamp });
  
  // Check if meeting already exists (in case of duplicate webhooks)
  let meeting = await databaseService.getMeetingBySessionId(sessionId);
  
  if (!meeting) {
    try {
      // First, try to find calendar event that already has this session ID
      // (This would happen if n8n stored it when calling ChatterBox)
      const calendarController = require('./calendarController');
      let calendarEvent = await calendarController.getEventBySessionId(sessionId);
      
      if (!calendarEvent) {
        // If not found by session ID, we need to find the calendar event by conference ID
        // The issue is that ChatterBox's getSessionData() doesn't return meetingId
        // But we can find the calendar event that was created for this meeting
        // by looking for recent events that don't have a session ID yet
        try {
          // Get recent calendar events without session IDs (within last 2 hours)
          const { supabase } = require('../config/database');
          const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
          
          const { data: recentEvents, error } = await supabase
            .from('calendar_events')
            .select('*')
            .is('chatterbox_session_id', null)
            .gte('start_datetime', twoHoursAgo.toISOString())
            .order('start_datetime', { ascending: false });
          
          if (error) {
            logger.error('Failed to query recent calendar events', {
              sessionId,
              error: error.message
            });
          } else if (recentEvents && recentEvents.length > 0) {
            // For now, link to the most recent event without a session ID
            // In a production system, you might want more sophisticated matching
            const eventToLink = recentEvents[0];
            
            // Link this session to the calendar event
            calendarEvent = await calendarController.linkSessionToEvent(eventToLink.conference_id, sessionId);
            
            logger.info('Linked ChatterBox session to recent calendar event', {
              sessionId,
              conferenceId: eventToLink.conference_id,
              eventSummary: eventToLink.summary,
              eventId: eventToLink.calendar_event_id
            });
          }
        } catch (linkingError) {
          logger.warn('Could not link session to recent calendar event', {
            sessionId,
            error: linkingError.message
          });
        }
      }
      
      if (calendarEvent) {
        // Create meeting record using calendar event data
        meeting = await databaseService.createMeeting({
          calendar_event_id: calendarEvent.calendar_event_id,
          chatterbox_session_id: sessionId,
          conference_id: calendarEvent.conference_id,
          meeting_title: calendarEvent.summary, // Use actual meeting title!
          meeting_description: calendarEvent.description,
          meeting_started_at: calendarEvent.start_datetime || new Date(timestamp * 1000),
          meeting_ended_at: calendarEvent.end_datetime,
          status: 'recording',
          bot_join_status: 'joined'
        });
        
        logger.logMeetingEvent(meeting.id, 'meeting_created_from_calendar_event', {
          sessionId,
          conferenceId: calendarEvent.conference_id,
          calendarEventId: calendarEvent.calendar_event_id,
          meetingTitle: calendarEvent.summary
        });
      } else {
        // Fallback: create meeting with generic title if no calendar event found
        meeting = await databaseService.createMeeting({
          calendar_event_id: `chatterbox-${sessionId}`,
          chatterbox_session_id: sessionId,
          conference_id: 'unknown',
          meeting_title: `Meeting ${sessionId.substring(0, 8)}`,
          meeting_description: 'Meeting started via ChatterBox (no calendar event found)',
          status: 'recording',
          bot_join_status: 'joined',
          meeting_started_at: new Date(timestamp * 1000)
        });
        
        logger.logMeetingEvent(meeting.id, 'meeting_created_fallback', {
          sessionId,
          reason: 'no_calendar_event_found'
        });
      }
      
    } catch (error) {
      logger.error('Failed to create meeting record from ChatterBox started event', {
        sessionId,
        error: error.message,
        timestamp: new Date().toISOString()
      });
      return;
    }
  } else {
    // Update existing meeting status
    await databaseService.updateMeeting(meeting.id, {
      status: 'recording',
      bot_join_status: 'joined'
    });
  }
  
  logger.logMeetingEvent(meeting.id, 'recording_started', { sessionId });
}

/**
 * Handle transcript received event
 * This gives us real-time transcripts during the meeting
 */
async function handleTranscriptReceived(payload) {
  const { sessionId, timeStart, timeEnd, speaker, text } = payload;
  
  logger.logChatterBoxEvent(sessionId, 'transcript_received', {
    speaker,
    textLength: text?.length || 0,
    timeStart,
    timeEnd
  });
  
  // Find meeting and optionally store real-time transcript
  const meeting = await databaseService.getMeetingBySessionId(sessionId);
  if (meeting) {
    // You could store real-time transcripts in a separate table if needed
    // For now, we'll just log them and wait for the final transcript
    logger.logMeetingEvent(meeting.id, 'transcript_chunk', {
      speaker,
      textLength: text?.length || 0
    });
  }
}

/**
 * Handle session finished event
 * ⚠️ CRITICAL: This must process within 5 minutes before recording URL expires!
 */
async function handleSessionFinished(payload) {
  const { sessionId, recordingUrl, timestamp } = payload;
  
  logger.logChatterBoxEvent(sessionId, 'session_finished', {
    recordingUrl: recordingUrl ? 'provided' : 'not_provided',
    timestamp
  });
  
  // Find meeting by session ID
  const meeting = await databaseService.getMeetingBySessionId(sessionId);
  if (!meeting) {
    logger.warn('Meeting not found for finished session', {
      sessionId,
      timestamp: new Date().toISOString()
    });
    return;
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
}

/**
 * Create meeting from n8n trigger and join bot with direct webhook
 * This replaces the old meeting-started webhook
 */
const createMeetingAndJoinBot = [
  // Validation middleware
  body('summary').notEmpty().withMessage('Meeting summary is required'),
  body('conferenceData.conferenceId').notEmpty().withMessage('Conference ID is required'),
  body('id').notEmpty().withMessage('Calendar event ID is required'),
  
  handleValidationErrors,
  
  asyncHandler(async (req, res) => {
    const { summary, conferenceData, id: eventId, description, start, end } = req.body;
    
    logger.logMeetingEvent('webhook_received', 'meeting_started_direct', {
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

      // Join bot to meeting with ChatterBox direct webhook
      // This webhook will handle started, transcript, and finished events
      const chatterboxService = require('../services/chatterboxService');
      const sessionData = await chatterboxService.joinMeeting({
        meetingId: conferenceData.conferenceId,
        botName: 'Nomadz Meeting Bot',
        webhookUrl: `${process.env.BASE_URL}/webhook/chatterbox-direct`
      });

      // Update meeting with session information
      await databaseService.updateMeeting(meeting.id, {
        chatterbox_session_id: sessionData.sessionId,
        bot_join_status: 'joining',
        status: 'bot_joining'
      });

      logger.logMeetingEvent(meeting.id, 'bot_join_requested', {
        sessionId: sessionData.sessionId,
        conferenceId: conferenceData.conferenceId
      });

      res.status(200).json({
        success: true,
        meetingId: meeting.id,
        sessionId: sessionData.sessionId,
        message: 'Meeting recording started with direct ChatterBox webhook',
        timestamp: new Date().toISOString()
      });

    } catch (error) {
      logger.error('Failed to start meeting recording with direct webhook', {
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

module.exports = {
  handleChatterBoxDirectWebhook,
  createMeetingAndJoinBot
};
