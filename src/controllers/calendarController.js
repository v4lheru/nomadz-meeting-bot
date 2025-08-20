const logger = require('../utils/logger');
const { asyncHandler, handleValidationErrors } = require('../middlewares/errorHandler');
const { body } = require('express-validator');
const { supabase } = require('../config/database');

/**
 * Calendar Events Controller
 * Handles Google Calendar event data from n8n
 */

/**
 * Store calendar event data from n8n
 * This endpoint receives the full Google Calendar event data and stores it
 * Later, ChatterBox webhooks will link sessions to these events
 */
const storeCalendarEvent = [
  // Validation middleware
  body('id').notEmpty().withMessage('Calendar event ID is required'),
  body('summary').notEmpty().withMessage('Event summary is required'),
  body('conferenceData.conferenceId').notEmpty().withMessage('Conference ID is required'),
  
  handleValidationErrors,
  
  asyncHandler(async (req, res) => {
    const eventData = req.body;
    
    logger.info('Calendar event received from n8n', {
      eventId: eventData.id,
      summary: eventData.summary,
      conferenceId: eventData.conferenceData?.conferenceId,
      timestamp: new Date().toISOString()
    });

    try {
      // Extract key data from the Google Calendar event
      const calendarEventData = {
        calendar_event_id: eventData.id,
        etag: eventData.etag,
        status: eventData.status,
        html_link: eventData.htmlLink,
        
        // Event details
        summary: eventData.summary,
        description: eventData.description || null,
        location: eventData.location || null,
        
        // Timing
        start_datetime: eventData.start?.dateTime ? new Date(eventData.start.dateTime) : null,
        end_datetime: eventData.end?.dateTime ? new Date(eventData.end.dateTime) : null,
        timezone: eventData.start?.timeZone || null,
        
        // People
        creator_email: eventData.creator?.email || null,
        organizer_email: eventData.organizer?.email || null,
        attendees: eventData.attendees || null,
        
        // Conference data
        conference_id: eventData.conferenceData?.conferenceId || null,
        hangout_link: eventData.hangoutLink || null,
        conference_data: eventData.conferenceData || null,
        
        // Store complete raw data
        raw_event_data: eventData
      };

      // Insert or update calendar event
      const { data, error } = await supabase
        .from('calendar_events')
        .upsert(calendarEventData, {
          onConflict: 'calendar_event_id',
          ignoreDuplicates: false
        })
        .select()
        .single();
      
      if (error) {
        throw error;
      }
      
      logger.info('Calendar event stored successfully', {
        eventId: data.calendar_event_id,
        summary: data.summary,
        conferenceId: data.conference_id,
        dbId: data.id,
        timestamp: new Date().toISOString()
      });

      res.status(200).json({
        success: true,
        message: 'Calendar event stored successfully',
        eventId: data.calendar_event_id,
        conferenceId: data.conference_id,
        dbId: data.id,
        timestamp: new Date().toISOString()
      });

    } catch (error) {
      logger.error('Failed to store calendar event', {
        eventId: eventData.id,
        summary: eventData.summary,
        error: error.message,
        timestamp: new Date().toISOString()
      });

      res.status(500).json({
        success: false,
        error: 'Failed to store calendar event',
        details: error.message,
        timestamp: new Date().toISOString()
      });
    }
  })
];

/**
 * Get calendar event by ID
 */
const getCalendarEvent = [
  asyncHandler(async (req, res) => {
    const { eventId } = req.params;
    
    try {
      const { data, error } = await supabase
        .from('calendar_events')
        .select('*')
        .eq('calendar_event_id', eventId)
        .single();
      
      if (error) {
        if (error.code === 'PGRST116') {
          return res.status(404).json({
            success: false,
            error: 'Calendar event not found',
            timestamp: new Date().toISOString()
          });
        }
        throw error;
      }
      
      res.status(200).json({
        success: true,
        event: data,
        timestamp: new Date().toISOString()
      });

    } catch (error) {
      logger.error('Failed to get calendar event', {
        eventId,
        error: error.message,
        timestamp: new Date().toISOString()
      });

      res.status(500).json({
        success: false,
        error: 'Failed to get calendar event',
        details: error.message,
        timestamp: new Date().toISOString()
      });
    }
  })
];

/**
 * Link ChatterBox session to calendar event
 * This is called internally when ChatterBox sends webhooks
 */
const linkSessionToEvent = async (conferenceId, sessionId) => {
  try {
    const { data, error } = await supabase
      .from('calendar_events')
      .update({ chatterbox_session_id: sessionId })
      .eq('conference_id', conferenceId)
      .select()
      .single();
    
    if (error) {
      if (error.code === 'PGRST116') {
        logger.warn('No calendar event found for conference ID', {
          conferenceId,
          sessionId
        });
        return null;
      }
      throw error;
    }
    
    logger.info('ChatterBox session linked to calendar event', {
      eventId: data.calendar_event_id,
      summary: data.summary,
      conferenceId,
      sessionId
    });
    
    return data;
  } catch (error) {
    logger.error('Failed to link session to calendar event', {
      conferenceId,
      sessionId,
      error: error.message
    });
    throw error;
  }
};

/**
 * Get calendar event by conference ID
 */
const getEventByConferenceId = async (conferenceId) => {
  try {
    const { data, error } = await supabase
      .from('calendar_events')
      .select('*')
      .eq('conference_id', conferenceId)
      .single();
    
    if (error) {
      if (error.code === 'PGRST116') {
        return null; // No event found
      }
      throw error;
    }
    
    return data;
  } catch (error) {
    logger.error('Failed to get event by conference ID', {
      conferenceId,
      error: error.message
    });
    throw error;
  }
};

/**
 * Get calendar event by session ID
 */
const getEventBySessionId = async (sessionId) => {
  try {
    const { data, error } = await supabase
      .from('calendar_events')
      .select('*')
      .eq('chatterbox_session_id', sessionId)
      .single();
    
    if (error) {
      if (error.code === 'PGRST116') {
        return null; // No event found
      }
      throw error;
    }
    
    return data;
  } catch (error) {
    logger.error('Failed to get event by session ID', {
      sessionId,
      error: error.message
    });
    throw error;
  }
};

module.exports = {
  storeCalendarEvent,
  getCalendarEvent,
  linkSessionToEvent,
  getEventByConferenceId,
  getEventBySessionId
};
