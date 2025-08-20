const { supabase } = require('../config/database');
const logger = require('../utils/logger');
const { v4: uuidv4 } = require('uuid');

/**
 * Database service for meeting recording operations
 * Handles all database interactions with proper error handling and logging
 */
class DatabaseService {
  /**
   * Create a new meeting record
   */
  async createMeeting(meetingData) {
    try {
      const { data, error } = await supabase
        .from('meetings')
        .insert({
          ...meetingData,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        })
        .select()
        .single();
      
      if (error) {
        throw error;
      }
      
      logger.info('Meeting created in database', {
        meetingId: data.id,
        calendarEventId: data.calendar_event_id,
        title: data.meeting_title,
        timestamp: new Date().toISOString()
      });
      
      return data;
    } catch (error) {
      logger.error('Failed to create meeting', {
        meetingData,
        error: error.message,
        timestamp: new Date().toISOString()
      });
      throw error;
    }
  }

  /**
   * Update meeting record
   */
  async updateMeeting(meetingId, updates) {
    try {
      const { data, error } = await supabase
        .from('meetings')
        .update({
          ...updates,
          updated_at: new Date().toISOString()
        })
        .eq('id', meetingId)
        .select()
        .single();
      
      if (error) {
        throw error;
      }
      
      logger.info('Meeting updated in database', {
        meetingId,
        updates: Object.keys(updates),
        timestamp: new Date().toISOString()
      });
      
      return data;
    } catch (error) {
      logger.error('Failed to update meeting', {
        meetingId,
        updates,
        error: error.message,
        timestamp: new Date().toISOString()
      });
      throw error;
    }
  }

  /**
   * Get meeting by ID
   */
  async getMeetingById(meetingId) {
    try {
      const { data, error } = await supabase
        .from('meetings')
        .select('*')
        .eq('id', meetingId)
        .single();
      
      if (error) {
        if (error.code === 'PGRST116') {
          // No rows returned
          return null;
        }
        throw error;
      }
      
      return data;
    } catch (error) {
      logger.error('Failed to get meeting by ID', {
        meetingId,
        error: error.message,
        timestamp: new Date().toISOString()
      });
      throw error;
    }
  }

  /**
   * Get meeting by ChatterBox session ID
   */
  async getMeetingBySessionId(sessionId) {
    try {
      const { data, error } = await supabase
        .from('meetings')
        .select('*')
        .eq('chatterbox_session_id', sessionId)
        .single();
      
      if (error) {
        if (error.code === 'PGRST116') {
          // No rows returned
          return null;
        }
        throw error;
      }
      
      return data;
    } catch (error) {
      logger.error('Failed to get meeting by session ID', {
        sessionId,
        error: error.message,
        timestamp: new Date().toISOString()
      });
      throw error;
    }
  }

  /**
   * Get meeting by calendar event ID
   */
  async getMeetingByCalendarEventId(eventId) {
    try {
      const { data, error } = await supabase
        .from('meetings')
        .select('*')
        .eq('calendar_event_id', eventId)
        .single();
      
      if (error) {
        if (error.code === 'PGRST116') {
          // No rows returned
          return null;
        }
        throw error;
      }
      
      return data;
    } catch (error) {
      logger.error('Failed to get meeting by calendar event ID', {
        eventId,
        error: error.message,
        timestamp: new Date().toISOString()
      });
      throw error;
    }
  }

  /**
   * Log processing step
   */
  async logProcessingStep(meetingId, step, status, metadata = {}, errorMessage = null, errorDetails = null) {
    try {
      const logData = {
        id: uuidv4(),
        meeting_id: meetingId,
        step,
        status,
        metadata,
        started_at: new Date().toISOString()
      };

      if (status === 'completed' || status === 'failed') {
        logData.completed_at = new Date().toISOString();
      }

      if (errorMessage) {
        logData.error_message = errorMessage;
      }

      if (errorDetails) {
        logData.error_details = errorDetails;
      }

      const { data, error } = await supabase
        .from('processing_logs')
        .insert(logData)
        .select()
        .single();
      
      if (error) {
        throw error;
      }
      
      logger.logProcessingStep(meetingId, step, status, {
        logId: data.id,
        metadata,
        timestamp: new Date().toISOString()
      });
      
      return data;
    } catch (error) {
      logger.error('Failed to log processing step', {
        meetingId,
        step,
        status,
        error: error.message,
        timestamp: new Date().toISOString()
      });
      throw error;
    }
  }

  /**
   * Update processing log step
   */
  async updateProcessingStep(logId, status, metadata = {}, errorMessage = null, errorDetails = null) {
    try {
      const updates = {
        status,
        metadata,
        completed_at: new Date().toISOString()
      };

      if (errorMessage) {
        updates.error_message = errorMessage;
      }

      if (errorDetails) {
        updates.error_details = errorDetails;
      }

      const { data, error } = await supabase
        .from('processing_logs')
        .update(updates)
        .eq('id', logId)
        .select()
        .single();
      
      if (error) {
        throw error;
      }
      
      return data;
    } catch (error) {
      logger.error('Failed to update processing step', {
        logId,
        status,
        error: error.message,
        timestamp: new Date().toISOString()
      });
      throw error;
    }
  }

  /**
   * Get processing logs for a meeting
   */
  async getProcessingLogs(meetingId) {
    try {
      const { data, error } = await supabase
        .from('processing_logs')
        .select('*')
        .eq('meeting_id', meetingId)
        .order('started_at', { ascending: true });
      
      if (error) {
        throw error;
      }
      
      return data || [];
    } catch (error) {
      logger.error('Failed to get processing logs', {
        meetingId,
        error: error.message,
        timestamp: new Date().toISOString()
      });
      throw error;
    }
  }

  /**
   * Get meetings by status
   */
  async getMeetingsByStatus(status, limit = 50) {
    try {
      const { data, error } = await supabase
        .from('meetings')
        .select('*')
        .eq('status', status)
        .order('created_at', { ascending: false })
        .limit(limit);
      
      if (error) {
        throw error;
      }
      
      return data || [];
    } catch (error) {
      logger.error('Failed to get meetings by status', {
        status,
        limit,
        error: error.message,
        timestamp: new Date().toISOString()
      });
      throw error;
    }
  }

  /**
   * Get recent meetings
   */
  async getRecentMeetings(limit = 20) {
    try {
      const { data, error } = await supabase
        .from('meetings')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(limit);
      
      if (error) {
        throw error;
      }
      
      return data || [];
    } catch (error) {
      logger.error('Failed to get recent meetings', {
        limit,
        error: error.message,
        timestamp: new Date().toISOString()
      });
      throw error;
    }
  }

  /**
   * Get meetings that need cleanup (old failed meetings)
   */
  async getMeetingsForCleanup(olderThanDays = 7) {
    try {
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - olderThanDays);

      const { data, error } = await supabase
        .from('meetings')
        .select('*')
        .in('status', ['failed', 'started'])
        .lt('created_at', cutoffDate.toISOString())
        .order('created_at', { ascending: true });
      
      if (error) {
        throw error;
      }
      
      return data || [];
    } catch (error) {
      logger.error('Failed to get meetings for cleanup', {
        olderThanDays,
        error: error.message,
        timestamp: new Date().toISOString()
      });
      throw error;
    }
  }

  /**
   * Delete meeting and related logs
   */
  async deleteMeeting(meetingId) {
    try {
      // Delete processing logs first (due to foreign key constraint)
      const { error: logsError } = await supabase
        .from('processing_logs')
        .delete()
        .eq('meeting_id', meetingId);
      
      if (logsError) {
        throw logsError;
      }

      // Delete meeting
      const { data, error } = await supabase
        .from('meetings')
        .delete()
        .eq('id', meetingId)
        .select()
        .single();
      
      if (error) {
        throw error;
      }
      
      logger.info('Meeting deleted from database', {
        meetingId,
        title: data.meeting_title,
        timestamp: new Date().toISOString()
      });
      
      return data;
    } catch (error) {
      logger.error('Failed to delete meeting', {
        meetingId,
        error: error.message,
        timestamp: new Date().toISOString()
      });
      throw error;
    }
  }

  /**
   * Get meeting statistics
   */
  async getMeetingStats() {
    try {
      const { data, error } = await supabase
        .from('meeting_status_summary')
        .select('*');
      
      if (error) {
        throw error;
      }
      
      return data || [];
    } catch (error) {
      logger.error('Failed to get meeting statistics', {
        error: error.message,
        timestamp: new Date().toISOString()
      });
      throw error;
    }
  }

  /**
   * Health check - test database connectivity
   */
  async healthCheck() {
    try {
      const { data, error } = await supabase
        .from('meetings')
        .select('id')
        .limit(1);
      
      if (error) {
        throw error;
      }
      
      return {
        status: 'healthy',
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      logger.error('Database health check failed', {
        error: error.message,
        timestamp: new Date().toISOString()
      });
      throw error;
    }
  }
}

// Export singleton instance
module.exports = new DatabaseService();
