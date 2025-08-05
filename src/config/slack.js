const { WebClient } = require('@slack/web-api');
const logger = require('../utils/logger');

// Validate required environment variables
const requiredEnvVars = ['SLACK_BOT_TOKEN'];
const missingEnvVars = requiredEnvVars.filter(envVar => !process.env[envVar]);

if (missingEnvVars.length > 0) {
  logger.error('Missing required Slack environment variables', {
    missing: missingEnvVars,
    timestamp: new Date().toISOString()
  });
  throw new Error(`Missing required environment variables: ${missingEnvVars.join(', ')}`);
}

// Create Slack Web API client
const slack = new WebClient(process.env.SLACK_BOT_TOKEN, {
  logLevel: process.env.LOG_LEVEL === 'debug' ? 'DEBUG' : 'INFO',
  retryConfig: {
    retries: 3,
    factor: 2
  }
});

// Default channel for meeting notifications
const DEFAULT_CHANNEL = process.env.SLACK_MEETINGS_CHANNEL || 'C0985UTH8UF';

/**
 * Test Slack API connection
 */
const testConnection = async () => {
  try {
    const response = await slack.auth.test();
    
    logger.info('Slack API connection successful', {
      teamName: response.team,
      botUserId: response.user_id,
      timestamp: new Date().toISOString()
    });
    
    return {
      status: 'connected',
      team: response.team,
      botUserId: response.user_id,
      botName: response.user
    };
  } catch (error) {
    logger.error('Slack API connection failed', {
      error: error.message,
      timestamp: new Date().toISOString()
    });
    throw error;
  }
};

/**
 * Health check for Slack API
 */
const healthCheck = async () => {
  try {
    const startTime = Date.now();
    
    const response = await slack.auth.test();
    const responseTime = Date.now() - startTime;
    
    return {
      status: 'healthy',
      responseTime,
      team: response.team,
      botUserId: response.user_id,
      timestamp: new Date().toISOString()
    };
  } catch (error) {
    return {
      status: 'unhealthy',
      error: error.message,
      timestamp: new Date().toISOString()
    };
  }
};

/**
 * Get channel information
 */
const getChannelInfo = async (channelId) => {
  try {
    const response = await slack.conversations.info({
      channel: channelId
    });
    
    return {
      id: response.channel.id,
      name: response.channel.name,
      isPrivate: response.channel.is_private,
      isMember: response.channel.is_member
    };
  } catch (error) {
    logger.error(`Failed to get channel info for: ${channelId}`, {
      error: error.message,
      timestamp: new Date().toISOString()
    });
    throw error;
  }
};

/**
 * Verify bot has access to the default channel
 */
const verifyChannelAccess = async (channelId = DEFAULT_CHANNEL) => {
  try {
    const channelInfo = await getChannelInfo(channelId);
    
    if (!channelInfo.isMember) {
      logger.warn(`Bot is not a member of channel: ${channelInfo.name}`, {
        channelId,
        channelName: channelInfo.name,
        timestamp: new Date().toISOString()
      });
      
      return {
        accessible: false,
        reason: 'Bot is not a member of the channel',
        channelInfo
      };
    }
    
    logger.info(`Verified access to Slack channel: ${channelInfo.name}`, {
      channelId,
      channelName: channelInfo.name,
      timestamp: new Date().toISOString()
    });
    
    return {
      accessible: true,
      channelInfo
    };
  } catch (error) {
    logger.error(`Cannot access Slack channel: ${channelId}`, {
      channelId,
      error: error.message,
      timestamp: new Date().toISOString()
    });
    
    return {
      accessible: false,
      reason: error.message,
      channelId
    };
  }
};

/**
 * Send a test message to verify posting capability
 */
const sendTestMessage = async (channelId = DEFAULT_CHANNEL) => {
  try {
    const response = await slack.chat.postMessage({
      channel: channelId,
      text: '🤖 Meeting Recording Service - Connection Test',
      blocks: [
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: '✅ *Meeting Recording Service Connected*\n\nThis is a test message to verify Slack integration is working properly.'
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
      ]
    });
    
    logger.info('Test message sent successfully', {
      channelId,
      messageTs: response.ts,
      timestamp: new Date().toISOString()
    });
    
    return {
      success: true,
      messageTs: response.ts,
      channel: response.channel
    };
  } catch (error) {
    logger.error('Failed to send test message', {
      channelId,
      error: error.message,
      timestamp: new Date().toISOString()
    });
    throw error;
  }
};

/**
 * Get bot user information
 */
const getBotInfo = async () => {
  try {
    const authResponse = await slack.auth.test();
    const userResponse = await slack.users.info({
      user: authResponse.user_id
    });
    
    return {
      id: userResponse.user.id,
      name: userResponse.user.name,
      realName: userResponse.user.real_name,
      displayName: userResponse.user.profile.display_name,
      isBot: userResponse.user.is_bot,
      teamId: authResponse.team_id,
      teamName: authResponse.team
    };
  } catch (error) {
    logger.error('Failed to get bot info', {
      error: error.message,
      timestamp: new Date().toISOString()
    });
    throw error;
  }
};

/**
 * Format file size for display
 */
const formatFileSize = (bytes) => {
  if (bytes === 0) return '0 Bytes';
  
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
};

/**
 * Format duration for display
 */
const formatDuration = (startTime, endTime) => {
  if (!startTime || !endTime) return 'Unknown duration';
  
  const start = new Date(startTime);
  const end = new Date(endTime);
  const durationMs = end - start;
  
  const minutes = Math.floor(durationMs / 60000);
  const seconds = Math.floor((durationMs % 60000) / 1000);
  
  if (minutes > 0) {
    return `${minutes}m ${seconds}s`;
  } else {
    return `${seconds}s`;
  }
};

logger.info('Slack configuration initialized', {
  defaultChannel: DEFAULT_CHANNEL,
  timestamp: new Date().toISOString()
});

module.exports = {
  slack,
  DEFAULT_CHANNEL,
  testConnection,
  healthCheck,
  getChannelInfo,
  verifyChannelAccess,
  sendTestMessage,
  getBotInfo,
  formatFileSize,
  formatDuration
};
