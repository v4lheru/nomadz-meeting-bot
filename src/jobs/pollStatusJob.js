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

      // If meeting has been in bot_joined status for more than 10 minutes, something might be wrong
      if (meeting.status === 'bot_joined' && statusAgeMinutes > 10) {
        logger.warn('Meeting stuck in bot_joined status', {
          meetingId: meeting.id,
          title: meeting.meeting_title,
          statusAgeMinutes,
          sessionId: meeting.chatterbox_session_id
        });

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
          logger.error('Failed to get session data for stuck meeting', {
            meetingId: meeting.id,
            sessionId: meeting.chatterbox_session_id,
            error: sessionError.message
          });
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
