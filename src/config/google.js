const { google } = require('googleapis');
const { OAuth2Client } = require('google-auth-library');
const logger = require('../utils/logger');

// Validate required environment variables
const requiredEnvVars = [
  'GOOGLE_CLIENT_ID',
  'GOOGLE_CLIENT_SECRET',
  'GOOGLE_REFRESH_TOKEN'
];

const missingEnvVars = requiredEnvVars.filter(envVar => !process.env[envVar]);

if (missingEnvVars.length > 0) {
  logger.error('Missing required Google API environment variables', {
    missing: missingEnvVars,
    timestamp: new Date().toISOString()
  });
  throw new Error(`Missing required environment variables: ${missingEnvVars.join(', ')}`);
}

// Create OAuth2 client
const oauth2Client = new OAuth2Client(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET
  // No redirect URI needed - we use refresh token directly
);

// Set credentials
oauth2Client.setCredentials({
  refresh_token: process.env.GOOGLE_REFRESH_TOKEN
});

// Create Google Drive API client
const drive = google.drive({
  version: 'v3',
  auth: oauth2Client
});

// Create Google Docs API client
const docs = google.docs({
  version: 'v1',
  auth: oauth2Client
});

// Create Google Sheets API client (for potential future use)
const sheets = google.sheets({
  version: 'v4',
  auth: oauth2Client
});

/**
 * Test Google API connection
 */
const testConnection = async () => {
  try {
    // Test Drive API
    const driveResponse = await drive.about.get({
      fields: 'user'
    });
    
    logger.info('Google APIs connection successful', {
      user: driveResponse.data.user.emailAddress,
      timestamp: new Date().toISOString()
    });
    
    return {
      status: 'connected',
      user: driveResponse.data.user.emailAddress
    };
  } catch (error) {
    logger.error('Google APIs connection failed', {
      error: error.message,
      timestamp: new Date().toISOString()
    });
    throw error;
  }
};

/**
 * Health check for Google APIs
 */
const healthCheck = async () => {
  try {
    const startTime = Date.now();
    
    // Test with a simple Drive API call
    const response = await drive.about.get({
      fields: 'user'
    });
    
    const responseTime = Date.now() - startTime;
    
    return {
      status: 'healthy',
      responseTime,
      user: response.data.user.emailAddress,
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
 * Refresh access token if needed
 */
const refreshTokenIfNeeded = async () => {
  try {
    const { credentials } = await oauth2Client.refreshAccessToken();
    oauth2Client.setCredentials(credentials);
    
    logger.info('Google API access token refreshed', {
      expiryDate: credentials.expiry_date,
      timestamp: new Date().toISOString()
    });
    
    return credentials;
  } catch (error) {
    logger.error('Failed to refresh Google API access token', {
      error: error.message,
      timestamp: new Date().toISOString()
    });
    throw error;
  }
};

/**
 * Get folder information
 */
const getFolderInfo = async (folderId) => {
  try {
    const response = await drive.files.get({
      fileId: folderId,
      fields: 'id,name,parents,permissions'
    });
    
    return response.data;
  } catch (error) {
    logger.error(`Failed to get folder info for ID: ${folderId}`, {
      error: error.message,
      timestamp: new Date().toISOString()
    });
    throw error;
  }
};

/**
 * Verify folder access and permissions
 */
const verifyFolderAccess = async (folderId, folderName) => {
  try {
    const folderInfo = await getFolderInfo(folderId);
    
    logger.info(`Verified access to ${folderName} folder`, {
      folderId,
      folderName: folderInfo.name,
      timestamp: new Date().toISOString()
    });
    
    return {
      id: folderInfo.id,
      name: folderInfo.name,
      accessible: true
    };
  } catch (error) {
    logger.error(`Cannot access ${folderName} folder`, {
      folderId,
      error: error.message,
      timestamp: new Date().toISOString()
    });
    
    return {
      id: folderId,
      name: folderName,
      accessible: false,
      error: error.message
    };
  }
};

/**
 * Verify all configured folders
 */
const verifyAllFolders = async () => {
  const folders = [
    {
      id: process.env.GOOGLE_DRIVE_RECORDINGS_FOLDER,
      name: 'Recordings'
    },
    {
      id: process.env.GOOGLE_DRIVE_TRANSCRIPTS_FOLDER,
      name: 'Transcripts'
    }
  ];
  
  const results = await Promise.all(
    folders.map(folder => verifyFolderAccess(folder.id, folder.name))
  );
  
  const inaccessibleFolders = results.filter(result => !result.accessible);
  
  if (inaccessibleFolders.length > 0) {
    logger.warn('Some Google Drive folders are not accessible', {
      inaccessibleFolders,
      timestamp: new Date().toISOString()
    });
  }
  
  return results;
};

/**
 * Create a shareable link for a file
 */
const createShareableLink = async (fileId) => {
  try {
    // Make file viewable by anyone with the link
    await drive.permissions.create({
      fileId,
      requestBody: {
        role: 'reader',
        type: 'anyone'
      }
    });
    
    // Get the file with webViewLink
    const response = await drive.files.get({
      fileId,
      fields: 'webViewLink,webContentLink'
    });
    
    return {
      viewLink: response.data.webViewLink,
      downloadLink: response.data.webContentLink
    };
  } catch (error) {
    logger.error(`Failed to create shareable link for file: ${fileId}`, {
      error: error.message,
      timestamp: new Date().toISOString()
    });
    throw error;
  }
};

// Test connection on module load
testConnection().catch(error => {
  logger.error('Initial Google APIs connection test failed', {
    error: error.message,
    timestamp: new Date().toISOString()
  });
});

// Verify folder access on module load
verifyAllFolders().catch(error => {
  logger.error('Initial folder verification failed', {
    error: error.message,
    timestamp: new Date().toISOString()
  });
});

logger.info('Google APIs configuration initialized', {
  clientId: process.env.GOOGLE_CLIENT_ID.substring(0, 20) + '...',
  timestamp: new Date().toISOString()
});

module.exports = {
  oauth2Client,
  drive,
  docs,
  sheets,
  testConnection,
  healthCheck,
  refreshTokenIfNeeded,
  getFolderInfo,
  verifyFolderAccess,
  verifyAllFolders,
  createShareableLink
};
