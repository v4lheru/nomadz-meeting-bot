const cron = require('node-cron');
const logger = require('../utils/logger');
const databaseService = require('../services/databaseService');

/**
 * Background job to clean up old meetings and processing logs
 * Runs daily at 2 AM UTC to maintain database hygiene
 */
class CleanupJob {
  constructor() {
    this.task = null;
    this.isRunning = false;
  }

  /**
   * Start the cleanup job
   */
  start() {
    if (this.isRunning) {
      logger.warn('Cleanup job is already running');
      return;
    }

    // Run daily at 2 AM UTC
    this.task = cron.schedule('0 2 * * *', async () => {
      await this.performCleanup();
    }, {
      scheduled: false,
      timezone: 'UTC'
    });

    this.task.start();
    this.isRunning = true;

    logger.info('Cleanup job started', {
      schedule: 'daily at 2 AM UTC',
      timestamp: new Date().toISOString()
    });
  }

  /**
   * Stop the cleanup job
   */
  stop() {
    if (this.task) {
      this.task.stop();
      this.task = null;
    }
    this.isRunning = false;

    logger.info('Cleanup job stopped', {
      timestamp: new Date().toISOString()
    });
  }

  /**
   * Perform cleanup operations
   */
  async performCleanup() {
    try {
      logger.info('Starting cleanup job', {
        timestamp: new Date().toISOString()
      });

      // First check if database is accessible
      await databaseService.healthCheck();

      // Clean up old failed meetings (older than 7 days)
      const oldMeetings = await databaseService.getMeetingsForCleanup(7);
      
      if (oldMeetings.length > 0) {
        logger.info('Found old meetings to clean up', {
          count: oldMeetings.length,
          timestamp: new Date().toISOString()
        });

        for (const meeting of oldMeetings) {
          await databaseService.deleteMeeting(meeting.id);
          logger.info('Deleted old meeting', {
            meetingId: meeting.id,
            title: meeting.meeting_title,
            status: meeting.status,
            age: Math.floor((Date.now() - new Date(meeting.created_at).getTime()) / (1000 * 60 * 60 * 24))
          });
        }
      }

      // Clean up old processing logs (older than 30 days)
      await this.cleanupOldLogs(30);

      logger.info('Cleanup job completed', {
        cleanedMeetings: oldMeetings.length,
        timestamp: new Date().toISOString()
      });

    } catch (error) {
      // Don't crash the service if database is not ready or tables don't exist
      if (error.message.includes('relation "meetings" does not exist') || 
          error.message.includes('SUPABASE_SERVICE_ROLE_KEY')) {
        logger.warn('Database not ready, skipping cleanup cycle', {
          error: error.message,
          timestamp: new Date().toISOString()
        });
        return;
      }
      
      logger.error('Cleanup job failed', {
        error: error.message,
        timestamp: new Date().toISOString()
      });
    }
  }

  /**
   * Clean up old processing logs
   */
  async cleanupOldLogs(olderThanDays = 30) {
    try {
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - olderThanDays);

      logger.info('Starting old logs cleanup', {
        olderThanDays,
        cutoffDate: cutoffDate.toISOString(),
        timestamp: new Date().toISOString()
      });

      // Get count of old logs first
      const { data: oldLogs, error: countError } = await databaseService.supabase
        .from('processing_logs')
        .select('id')
        .lt('started_at', cutoffDate.toISOString());

      if (countError) {
        throw countError;
      }

      const totalFound = oldLogs?.length || 0;

      if (totalFound === 0) {
        logger.info('No old logs found for cleanup', {
          olderThanDays,
          timestamp: new Date().toISOString()
        });
        return;
      }

      // Delete old logs
      const { error: deleteError } = await databaseService.supabase
        .from('processing_logs')
        .delete()
        .lt('started_at', cutoffDate.toISOString());

      if (deleteError) {
        throw deleteError;
      }

      logger.info('Old logs cleanup completed', {
        totalFound,
        cleaned: totalFound,
        olderThanDays,
        timestamp: new Date().toISOString()
      });

    } catch (error) {
      logger.error('Failed to cleanup old logs', {
        olderThanDays,
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
module.exports = new CleanupJob();
