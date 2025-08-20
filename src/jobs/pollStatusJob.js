const cron = require('node-cron');
const logger = require('../utils/logger');
const databaseService = require('../services/databaseService');
const chatterboxService = require('../services/chatterboxService');
const meetingService = require('../services/meetingService');

/**
 * Background job to poll ChatterBox for meeting status updates
 * Runs every 30 seconds to check for meetings that might need processing
 */
class PollStatusJob {
  constructor() {
    this.task = null;
    this.isRunning = false;
  }

  /**
   * Start the polling job
   */
  start() {
    if (this.isRunning) {
      logger.warn('Poll status job is already running');
      return;
    }

    // Run every 30 seconds
    this.task = cron.schedule('*/30 * * * * *', async () => {
      await this.pollMeetingStatuses();
    }, {
      scheduled: false
    });

    this.task.start();
    this.isRunning = true;

    logger.info('Poll status job started', {
      schedule: 'every 30 seconds',
      timestamp: new Date().toISOString()
    });
  }

  /**
   * Stop the polling job
   */
  stop() {
    if (this.task) {
      this.task.stop();
      this.task = null;
    }
    this.isRunning = false;

    logger.info('Poll status job stopped', {
      timestamp: new Date().toISOString()
    });
  }

  /**
   * Poll meeting statuses for meetings that might need attention
   */
  async pollMeetingStatuses() {
    try {
      // First check if database is accessible
      await databaseService.healthCheck();
      
      // Get meetings that are in 'bot_joined' or 'recording' status for more than 5 minutes
      // These might be stuck and need manual intervention
      const stuckMeetings = await databaseService.getMeetingsByStatus('bot_joined', 10);
      const recordingMeetings = await databaseService.getMeetingsByStatus('recording', 10);
      
      const allMeetings = [...stuckMeetings, ...recordingMeetings];
      
      if (allMeetings.length === 0) {
        return; // No meetings to check
      }

      logger.info('Polling meeting statuses', {
        stuckMeetings: stuckMeetings.length,
        recordingMeetings: recordingMeetings.length,
        timestamp: new Date().toISOString()
      });

      for (const meeting of allMeetings) {
        await this.checkMeetingStatus(meeting);
      }

    } catch (error) {
      // Don't crash the service if database is not ready or tables don't exist
      if (error.message.includes('relation "meetings" does not exist') || 
          error.message.includes('SUPABASE_SERVICE_ROLE_KEY')) {
        logger.warn('Database not ready, skipping poll cycle', {
          error: error.message,
          timestamp: new Date().toISOString()
        });
        return;
      }
      
      logger.error('Poll status job failed', {
        error: error.message,
        timestamp: new Date().toISOString()
      });
    }
  }

  /**
   * Check individual meeting status
   */
  async checkMeetingStatus(meeting) {
    try {
      if (!meeting.chatterbox_session_id) {
        logger.warn('Meeting has no ChatterBox session ID', {
          meetingId: meeting.id,
          title: meeting.meeting_title
        });
        return;
      }

      // Check how long the meeting has been in current status
      const statusAge = Date.now() - new Date(meeting.updated_at).getTime();
      const statusAgeMinutes = Math.floor(statusAge / (1000 * 60));

      // If meeting has been in bot_joined status for more than 3 hours, mark as failed
      if (meeting.status === 'bot_joined' && statusAgeMinutes > 180) {
        logger.warn('Meeting stuck in bot_joined status for too long, marking as failed', {
          meetingId: meeting.id,
          title: meeting.meeting_title,
          statusAgeMinutes,
          statusAgeHours: Math.round(statusAgeMinutes / 60 * 10) / 10,
          sessionId: meeting.chatterbox_session_id
        });

        // Mark as failed to stop continuous polling
        await databaseService.updateMeeting(meeting.id, {
          status: 'failed',
          processing_completed_at: new Date().toISOString()
        });
        
        return; // Skip further processing for this meeting
      }

      // If meeting has been in bot_joined status for more than 2 minutes, check if recording is ready
      if (meeting.status === 'bot_joined' && statusAgeMinutes > 2) {
        // Only log every 10 minutes to reduce log spam
        if (statusAgeMinutes % 10 === 0) {
          logger.warn('Meeting stuck in bot_joined status', {
            meetingId: meeting.id,
            title: meeting.meeting_title,
            statusAgeMinutes,
            sessionId: meeting.chatterbox_session_id
          });
        }

        // Try to get session data to see if recording is available
        try {
          const sessionData = await chatterboxService.getSessionData(meeting.chatterbox_session_id);
          
          if (sessionData.recordingLink) {
            logger.info('Found recording for stuck meeting, starting processing', {
              meetingId: meeting.id,
              sessionId: meeting.chatterbox_session_id
            });

            // Start processing
            meetingService.processRecordingUrgently(
              meeting.id, 
              sessionData.recordingLink, 
              meeting.chatterbox_session_id
            ).catch(error => {
              logger.error('Failed to process stuck meeting', {
                meetingId: meeting.id,
                error: error.message
              });
            });
          }
        } catch (sessionError) {
          // Only log session errors every 10 minutes to reduce spam
          if (statusAgeMinutes % 10 === 0) {
            logger.error('Failed to get session data for stuck meeting', {
              meetingId: meeting.id,
              sessionId: meeting.chatterbox_session_id,
              error: sessionError.message
            });
          }
        }
      }

      // If meeting has been in recording status for more than 30 minutes, it's likely finished
      if (meeting.status === 'recording' && statusAgeMinutes > 30) {
        logger.warn('Meeting stuck in recording status', {
          meetingId: meeting.id,
          title: meeting.meeting_title,
          statusAgeMinutes,
          sessionId: meeting.chatterbox_session_id
        });

        // Try to get session data
        try {
          const sessionData = await chatterboxService.getSessionData(meeting.chatterbox_session_id);
          
          if (sessionData.recordingLink) {
            logger.info('Found recording for long-running meeting, starting processing', {
              meetingId: meeting.id,
              sessionId: meeting.chatterbox_session_id
            });

            // Start processing
            meetingService.processRecordingUrgently(
              meeting.id, 
              sessionData.recordingLink, 
              meeting.chatterbox_session_id
            ).catch(error => {
              logger.error('Failed to process long-running meeting', {
                meetingId: meeting.id,
                error: error.message
              });
            });
          }
        } catch (sessionError) {
          logger.error('Failed to get session data for long-running meeting', {
            meetingId: meeting.id,
            sessionId: meeting.chatterbox_session_id,
            error: sessionError.message
          });
        }
      }

    } catch (error) {
      logger.error('Failed to check meeting status', {
        meetingId: meeting.id,
        error: error.message,
        timestamp: new Date().toISOString()
      });
    }
  }

  /**
   * Get job status
   */
  getStatus() {
    return {
      isRunning: this.isRunning,
      hasTask: !!this.task,
      timestamp: new Date().toISOString()
    };
  }
}

// Export singleton instance
module.exports = new PollStatusJob();
