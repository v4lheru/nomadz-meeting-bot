const { slack, DEFAULT_CHANNEL, formatFileSize, formatDuration } = require('../config/slack');
const logger = require('../utils/logger');

/**
 * Notification service for Slack integration
 * Sends formatted notifications about meeting processing status
 */
class NotificationService {
  /**
   * Send meeting completed notification to Slack
   */
  async sendMeetingCompletedNotification(meeting, driveFile, transcriptDoc, transcriptData) {
    try {
      logger.logSlackNotification(DEFAULT_CHANNEL, 'meeting_completed', 'started', {
        meetingId: meeting.id,
        meetingTitle: meeting.meeting_title
      });

      const duration = formatDuration(
        meeting.recording_start_timestamp || meeting.meeting_started_at,
        meeting.recording_end_timestamp || meeting.meeting_ended_at
      );

      const fileSize = driveFile.size ? formatFileSize(parseInt(driveFile.size)) : 'Unknown size';
      
      const processingTime = meeting.processing_started_at && meeting.processing_completed_at
        ? Math.round((new Date(meeting.processing_completed_at) - new Date(meeting.processing_started_at)) / 1000)
        : null;

      // Get list of actual speakers from transcript
      let speakersList = 'No speakers identified';
      if (transcriptData && transcriptData.transcript && transcriptData.transcript.length > 0) {
        const uniqueSpeakers = [...new Set(transcriptData.transcript.map(entry => entry.speaker).filter(Boolean))];
        speakersList = uniqueSpeakers.length > 0 ? uniqueSpeakers.join(', ') : 'No speakers identified';
      }

      const blocks = [
        {
          type: 'header',
          text: {
            type: 'plain_text',
            text: `✅ ${meeting.meeting_title} Recording Completed`,
            emoji: true
          }
        },
        {
          type: 'section',
          fields: [
            {
              type: 'mrkdwn',
              text: `*Date:*\n${new Date(meeting.meeting_started_at || meeting.created_at).toLocaleString('en-US', {
                weekday: 'short',
                year: 'numeric',
                month: 'short',
                day: 'numeric',
                hour: '2-digit',
                minute: '2-digit',
                timeZoneName: 'short'
              })}`
            },
            {
              type: 'mrkdwn',
              text: `*Speakers:*\n${speakersList}`
            }
          ]
        },
        {
          type: 'actions',
          elements: [
            {
              type: 'button',
              text: {
                type: 'plain_text',
                text: '🎥 View Recording',
                emoji: true
              },
              url: driveFile.webViewLink,
              style: 'primary'
            },
            {
              type: 'button',
              text: {
                type: 'plain_text',
                text: '📝 View Transcript',
                emoji: true
              },
              url: transcriptDoc.webViewLink
            }
          ]
        }
      ];


      const response = await slack.chat.postMessage({
        channel: DEFAULT_CHANNEL,
        text: `✅ Meeting recording complete: ${meeting.meeting_title}`,
        blocks
      });

      logger.logSlackNotification(DEFAULT_CHANNEL, 'meeting_completed', 'success', {
        meetingId: meeting.id,
        messageTs: response.ts,
        channel: response.channel
      });

      return {
        success: true,
        messageTs: response.ts,
        channel: response.channel,
        permalink: response.permalink
      };

    } catch (error) {
      logger.error('Failed to send meeting completed notification', {
        meetingId: meeting.id,
        meetingTitle: meeting.meeting_title,
        error: error.message,
        timestamp: new Date().toISOString()
      });
      throw error;
    }
  }

  /**
   * Send meeting processing failed notification
   */
  async sendMeetingFailedNotification(meeting, error, processingStep = null) {
    try {
      logger.logSlackNotification(DEFAULT_CHANNEL, 'meeting_failed', 'started', {
        meetingId: meeting.id,
        meetingTitle: meeting.meeting_title,
        error: error.message
      });

      const blocks = [
        {
          type: 'header',
          text: {
            type: 'plain_text',
            text: '❌ Meeting Recording Failed',
            emoji: true
          }
        },
        {
          type: 'section',
          fields: [
            {
              type: 'mrkdwn',
              text: `*Meeting:*\n${meeting.meeting_title}`
            },
            {
              type: 'mrkdwn',
              text: `*Conference ID:*\n${meeting.conference_id}`
            }
          ]
        },
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `*Error:* ${error.message}${processingStep ? `\n*Failed Step:* ${processingStep}` : ''}\n*Time:* ${new Date().toLocaleString('en-US', {
              weekday: 'short',
              year: 'numeric',
              month: 'short',
              day: 'numeric',
              hour: '2-digit',
              minute: '2-digit',
              timeZoneName: 'short'
            })}`
          }
        },
        {
          type: 'actions',
          elements: [
            {
              type: 'button',
              text: {
                type: 'plain_text',
                text: '🔄 Retry Processing',
                emoji: true
              },
              url: `${process.env.BASE_URL}/api/meetings/${meeting.id}/retry`,
              style: 'danger'
            }
          ]
        }
      ];

      const response = await slack.chat.postMessage({
        channel: DEFAULT_CHANNEL,
        text: `❌ Meeting recording failed: ${meeting.meeting_title}`,
        blocks
      });

      logger.logSlackNotification(DEFAULT_CHANNEL, 'meeting_failed', 'success', {
        meetingId: meeting.id,
        messageTs: response.ts,
        channel: response.channel
      });

      return {
        success: true,
        messageTs: response.ts,
        channel: response.channel
      };

    } catch (slackError) {
      logger.error('Failed to send meeting failed notification', {
        meetingId: meeting.id,
        meetingTitle: meeting.meeting_title,
        originalError: error.message,
        slackError: slackError.message,
        timestamp: new Date().toISOString()
      });
      throw slackError;
    }
  }

  /**
   * Send critical error alert (for urgent issues like URL expiration)
   */
  async sendCriticalAlert(criticalError) {
    try {
      logger.logSlackNotification(DEFAULT_CHANNEL, 'critical_alert', 'started', {
        meetingId: criticalError.meetingId,
        step: criticalError.step,
        severity: criticalError.severity
      });

      const blocks = [
        {
          type: 'header',
          text: {
            type: 'plain_text',
            text: '🚨 CRITICAL ALERT - Immediate Attention Required',
            emoji: true
          }
        },
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `*Meeting ID:* ${criticalError.meetingId}\n*Failed Step:* ${criticalError.step}\n*Error:* ${criticalError.error}\n*Severity:* ${criticalError.severity}`
          }
        },
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `*Time:* ${criticalError.timestamp}\n*Context:* ${JSON.stringify(criticalError.context, null, 2)}`
          }
        }
      ];

      const response = await slack.chat.postMessage({
        channel: DEFAULT_CHANNEL,
        text: `🚨 CRITICAL: Meeting processing failure requires immediate attention`,
        blocks
      });

      logger.logSlackNotification(DEFAULT_CHANNEL, 'critical_alert', 'success', {
        meetingId: criticalError.meetingId,
        messageTs: response.ts,
        channel: response.channel
      });

      return {
        success: true,
        messageTs: response.ts,
        channel: response.channel
      };

    } catch (error) {
      logger.error('Failed to send critical alert', {
        criticalError,
        error: error.message,
        timestamp: new Date().toISOString()
      });
      // Don't throw here - we don't want to fail the main process if Slack is down
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Send meeting started notification
   */
  async sendMeetingStartedNotification(meeting, sessionId) {
    try {
      logger.logSlackNotification(DEFAULT_CHANNEL, 'meeting_started', 'started', {
        meetingId: meeting.id,
        meetingTitle: meeting.meeting_title,
        sessionId
      });

      const blocks = [
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `🎙️ *Recording Started*\n\n*Meeting:* ${meeting.meeting_title}\n*Conference ID:* ${meeting.conference_id}\n*Bot Session:* ${sessionId}\n*Started:* ${new Date().toLocaleString('en-US', {
              hour: '2-digit',
              minute: '2-digit',
              timeZoneName: 'short'
            })}`
          }
        }
      ];

      const response = await slack.chat.postMessage({
        channel: DEFAULT_CHANNEL,
        text: `🎙️ Recording started: ${meeting.meeting_title}`,
        blocks
      });

      logger.logSlackNotification(DEFAULT_CHANNEL, 'meeting_started', 'success', {
        meetingId: meeting.id,
        messageTs: response.ts,
        channel: response.channel
      });

      return {
        success: true,
        messageTs: response.ts,
        channel: response.channel
      };

    } catch (error) {
      logger.error('Failed to send meeting started notification', {
        meetingId: meeting.id,
        meetingTitle: meeting.meeting_title,
        sessionId,
        error: error.message,
        timestamp: new Date().toISOString()
      });
      // Don't throw - this is not critical
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Send service health status notification
   */
  async sendHealthStatusNotification(healthStatus) {
    try {
      const isHealthy = healthStatus.status === 'healthy';
      const emoji = isHealthy ? '✅' : '⚠️';
      const color = isHealthy ? 'good' : 'warning';

      const unhealthyServices = Object.entries(healthStatus.services)
        .filter(([name, service]) => service.status !== 'healthy')
        .map(([name, service]) => `• ${name}: ${service.error || 'Unknown error'}`);

      const blocks = [
        {
          type: 'header',
          text: {
            type: 'plain_text',
            text: `${emoji} Service Health Status`,
            emoji: true
          }
        },
        {
          type: 'section',
          fields: [
            {
              type: 'mrkdwn',
              text: `*Status:* ${healthStatus.status.toUpperCase()}`
            },
            {
              type: 'mrkdwn',
              text: `*Uptime:* ${Math.round(healthStatus.uptime / 3600)}h`
            },
            {
              type: 'mrkdwn',
              text: `*Environment:* ${healthStatus.environment}`
            },
            {
              type: 'mrkdwn',
              text: `*Response Time:* ${healthStatus.responseTime}ms`
            }
          ]
        }
      ];

      if (unhealthyServices.length > 0) {
        blocks.push({
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `*Unhealthy Services:*\n${unhealthyServices.join('\n')}`
          }
        });
      }

      const response = await slack.chat.postMessage({
        channel: DEFAULT_CHANNEL,
        text: `${emoji} Service health status: ${healthStatus.status}`,
        blocks
      });

      return {
        success: true,
        messageTs: response.ts,
        channel: response.channel
      };

    } catch (error) {
      logger.error('Failed to send health status notification', {
        healthStatus,
        error: error.message,
        timestamp: new Date().toISOString()
      });
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Update existing Slack message
   */
  async updateMessage(channel, messageTs, text, blocks) {
    try {
      const response = await slack.chat.update({
        channel,
        ts: messageTs,
        text,
        blocks
      });

      return {
        success: true,
        messageTs: response.ts,
        channel: response.channel
      };

    } catch (error) {
      logger.error('Failed to update Slack message', {
        channel,
        messageTs,
        error: error.message,
        timestamp: new Date().toISOString()
      });
      throw error;
    }
  }

  /**
   * Send test notification to verify Slack integration
   */
  async sendTestNotification() {
    try {
      const blocks = [
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: '🧪 *Test Notification*\n\nThis is a test message to verify Slack integration is working properly.'
          }
        },
        {
          type: 'context',
          elements: [
            {
              type: 'mrkdwn',
              text: `🕐 ${new Date().toISOString()}`
            }
          ]
        }
      ];

      const response = await slack.chat.postMessage({
        channel: DEFAULT_CHANNEL,
        text: '🧪 Test notification from Meeting Recording Service',
        blocks
      });

      logger.info('Test notification sent successfully', {
        messageTs: response.ts,
        channel: response.channel,
        timestamp: new Date().toISOString()
      });

      return {
        success: true,
        messageTs: response.ts,
        channel: response.channel
      };

    } catch (error) {
      logger.error('Failed to send test notification', {
        error: error.message,
        timestamp: new Date().toISOString()
      });
      throw error;
    }
  }
}

// Export singleton instance
module.exports = new NotificationService();
