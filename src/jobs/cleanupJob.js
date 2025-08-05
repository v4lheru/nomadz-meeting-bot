const cron = require('node-cron');
const logger = require('../utils/logger');
const meetingService = require('../services/meetingService');
const databaseService = require('../services/databaseService');

/**
 * Background job to clean up old failed meetings and logs
 * Runs daily at 2 AM to maintain database hygiene
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

    // Run daily at 2:00 AM
    this.task = cron.schedule('0 2 * * *', async () => {
      await this.performCleanup();
    }, {
      scheduled: false,
      timezone: 'UTC'
    });

    this.task.start();
    this.isRunning = true;

    logger.info('Cleanup job started', {
      schedule: 'daily at 2:00 AM UTC',
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
    const startTime = Date.now();
    
    try {
      logger.info('Starting daily cleanup', {
        timestamp: new Date().toISOString()
      });

      // Clean up old failed meetings (older than 7 days)
      const cleanupResult = await meetingService.cleanupOldMeetings(7);
      
      // Clean up old processing logs (older than 30 days)
      const oldLogsResult = await this.cleanupOldLogs(30);
      
      // Log cleanup statistics
      const cleanupTime = Date.now() - startTime;
      
      logger.info('Daily cleanup completed', {
        meetingsFound: cleanupResult.totalFound,
        meetingsCleaned: cleanupResult.cleaned,
        meetingsFailedToClean: cleanupResult.failed,
        oldLogsFound: oldLogsResult.totalFound,
        oldLogsCleaned: oldLogsResult.cleaned,
        oldLogsFailedToClean: oldLogsResult.failed,
        cleanupTimeMs: cleanupTime,
        cleanupTimeSeconds: Math.round(cleanupTime / 1000),
        timestamp: new Date().toISOString()
      });

    } catch (error) {
      logger.error('Daily cleanup failed', {
        error: error.message,
        stack: error.stack,
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
        
        return {
          totalFound: 0,
          cleaned: 0,
          failed: 0
        };
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
        failed: 0,
        olderThanDays,
        timestamp: new Date().toISOString()
      });

      return {
        totalFound,
        cleaned: totalFound,
        failed: 0
      };

    } catch (error) {
      logger.error('Failed to cleanup old logs', {
        olderThanDays,
        error: error.message,
        timestamp: new Date().toISOString()
      });

      return {
        totalFound: 0,
        cleaned: 0,
        failed: 1
      };
    }
  }

  /**
   * Clean up orphaned processing logs (logs without corresponding meetings)
   */
  async cleanupOrphanedLogs() {
    try {
      logger.info('Starting orphaned logs cleanup', {
        timestamp: new Date().toISOString()
      });

      // Find logs that don't have corresponding meetings
      const { data: orphanedLogs, error: findError } = await databaseService.supabase
        .from('processing_logs')
        .select('id, meeting_id')
        .not('meeting_id', 'in', 
          databaseService.supabase
            .from('meetings')
            .select('id')
        );

      if (findError) {
        throw findError;
      }

      const totalFound = orphanedLogs?.length || 0;

      if (totalFound === 0) {
        logger.info('No orphaned logs found', {
          timestamp: new Date().toISOString()
        });
        return { totalFound: 0, cleaned: 0, failed: 0 };
      }

      // Delete orphaned logs
      const orphanedIds = orphanedLogs.map(log => log.id);
      const { error: deleteError } = await databaseService.supabase
        .from('processing_logs')
        .delete()
        .in('id', orphanedIds);

      if (deleteError) {
        throw deleteError;
      }

      logger.info('Orphaned logs cleanup completed', {
        totalFound,
        cleaned: totalFound,
        failed: 0,
        timestamp: new Date().toISOString()
      });

      return {
        totalFound,
        cleaned: totalFound,
        failed: 0
      };

    } catch (error) {
      logger.error('Failed to cleanup orphaned logs', {
        error: error.message,
        timestamp: new Date().toISOString()
      });

      return {
        totalFound: 0,
        cleaned: 0,
        failed: 1
      };
    }
  }

  /**
   * Get database statistics
   */
  async getDatabaseStats() {
    try {
      // Get meeting counts by status
      const { data: meetingStats, error: meetingError } = await databaseService.supabase
        .from('meetings')
        .select('status')
        .then(result => {
          if (result.error) throw result.error;
          
          const stats = {};
          result.data.forEach(meeting => {
            stats[meeting.status] = (stats[meeting.status] || 0) + 1;
          });
          
          return { data: stats, error: null };
        });

      if (meetingError) {
        throw meetingError;
      }

      // Get total processing logs count
      const { count: logsCount, error: logsError } = await databaseService.supabase
        .from('processing_logs')
        .select('*', { count: 'exact', head: true });

      if (logsError) {
        throw logsError;
      }

      return {
        meetings: meetingStats,
        totalMeetings: Object.values(meetingStats).reduce((sum, count) => sum + count, 0),
        totalLogs: logsCount,
        timestamp: new Date().toISOString()
      };

    } catch (error) {
      logger.error('Failed to get database stats', {
        error: error.message,
        timestamp: new Date().toISOString()
      });
      return null;
    }
  }

  /**
   * Run manual cleanup (for testing/debugging)
   */
  async runManualCleanup() {
    logger.info('Running manual cleanup', {
      timestamp: new Date().toISOString()
    });

    await this.performCleanup();
  }

  /**
   * Get job status
   */
  getStatus() {
    return {
      isRunning: this.isRunning,
      hasTask: !!this.task,
      nextRun: this.task ? this.task.nextDate() : null,
      timestamp: new Date().toISOString()
    };
  }
}

// Export singleton instance
module.exports = new CleanupJob();
