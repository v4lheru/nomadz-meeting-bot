const axios = require('axios');
const { drive } = require('../config/google');
const logger = require('../utils/logger');

/**
 * File service for handling large video file streaming
 * ⚠️ CRITICAL: Streams directly to Google Drive to handle large .mkv files
 * and avoid ChatterBox URL expiration (5-minute window)
 */
class FileService {
  /**
   * Stream recording directly from ChatterBox URL to Google Drive
   * ⚠️ CRITICAL: Must complete within 5 minutes before URL expires!
   */
  async streamRecordingToGoogleDrive(recordingUrl, meetingTitle) {
    const startTime = Date.now();
    
    try {
      logger.logFileOperation('stream_to_drive', meetingTitle, 'started', {
        url: recordingUrl.substring(0, 50) + '...',
        startTime: new Date().toISOString()
      });

      // Create readable stream from ChatterBox URL
      const response = await axios({
        method: 'GET',
        url: recordingUrl,
        responseType: 'stream',
        timeout: 300000, // 5 minutes timeout
        headers: {
          'User-Agent': 'meeting-recording-service/1.0.0'
        }
      });

      const contentLength = response.headers['content-length'];
      const contentType = response.headers['content-type'] || 'video/x-matroska';
      
      logger.logFileOperation('stream_to_drive', meetingTitle, 'streaming', {
        contentLength: contentLength ? parseInt(contentLength) : 'unknown',
        contentType,
        timestamp: new Date().toISOString()
      });

      // Prepare file metadata for Google Drive
      const fileName = `Meeting Recording - ${meetingTitle}.mkv`;
      const fileMetadata = {
        name: fileName,
        parents: [process.env.GOOGLE_DRIVE_RECORDINGS_FOLDER],
        properties: {
          source: 'chatterbox-recording',
          meetingTitle: meetingTitle,
          uploadedAt: new Date().toISOString()
        }
      };

      const media = {
        mimeType: contentType,
        body: response.data
      };

      // Upload to Google Drive with streaming
      const driveResponse = await drive.files.create({
        requestBody: fileMetadata,
        media: media,
        fields: 'id,name,webViewLink,webContentLink,size,createdTime'
      });

      const uploadTime = Date.now() - startTime;
      const fileSizeBytes = driveResponse.data.size ? parseInt(driveResponse.data.size) : null;
      
      logger.logFileOperation('stream_to_drive', meetingTitle, 'completed', {
        driveFileId: driveResponse.data.id,
        fileName: driveResponse.data.name,
        fileSizeBytes,
        fileSizeMB: fileSizeBytes ? Math.round(fileSizeBytes / 1024 / 1024) : null,
        uploadTimeMs: uploadTime,
        uploadTimeSeconds: Math.round(uploadTime / 1000),
        webViewLink: driveResponse.data.webViewLink,
        timestamp: new Date().toISOString()
      });

      // Make file shareable
      await this.makeFileShareable(driveResponse.data.id);

      return {
        id: driveResponse.data.id,
        name: driveResponse.data.name,
        webViewLink: driveResponse.data.webViewLink,
        webContentLink: driveResponse.data.webContentLink,
        size: fileSizeBytes,
        createdTime: driveResponse.data.createdTime,
        uploadTime,
        mimeType: contentType
      };

    } catch (error) {
      const uploadTime = Date.now() - startTime;
      
      logger.error('Failed to stream recording to Google Drive', {
        meetingTitle,
        url: recordingUrl.substring(0, 50) + '...',
        uploadTime,
        error: error.message,
        timestamp: new Date().toISOString()
      });

      // Check if this is a URL expiration error
      if (error.response?.status === 403 || error.response?.status === 404) {
        throw new Error(`Recording URL has expired or is not accessible (${error.response.status})`);
      }

      // Check if this is a timeout error
      if (error.code === 'ECONNABORTED') {
        throw new Error('Upload timeout - recording URL may have expired during transfer');
      }

      throw error;
    }
  }

  /**
   * Make a Google Drive file shareable by anyone with the link
   */
  async makeFileShareable(fileId) {
    try {
      await drive.permissions.create({
        fileId,
        requestBody: {
          role: 'reader',
          type: 'anyone'
        }
      });

      logger.info('File made shareable', {
        fileId,
        timestamp: new Date().toISOString()
      });

      return true;
    } catch (error) {
      logger.error('Failed to make file shareable', {
        fileId,
        error: error.message,
        timestamp: new Date().toISOString()
      });
      
      // Don't throw error - file upload succeeded, sharing is optional
      return false;
    }
  }

  /**
   * Get file information from Google Drive
   */
  async getFileInfo(fileId) {
    try {
      const response = await drive.files.get({
        fileId,
        fields: 'id,name,webViewLink,webContentLink,size,createdTime,mimeType,parents'
      });

      return response.data;
    } catch (error) {
      logger.error('Failed to get file info', {
        fileId,
        error: error.message,
        timestamp: new Date().toISOString()
      });
      throw error;
    }
  }

  /**
   * Delete file from Google Drive
   */
  async deleteFile(fileId) {
    try {
      await drive.files.delete({
        fileId
      });

      logger.info('File deleted from Google Drive', {
        fileId,
        timestamp: new Date().toISOString()
      });

      return true;
    } catch (error) {
      logger.error('Failed to delete file', {
        fileId,
        error: error.message,
        timestamp: new Date().toISOString()
      });
      throw error;
    }
  }

  /**
   * List files in a Google Drive folder
   */
  async listFilesInFolder(folderId, maxResults = 50) {
    try {
      const response = await drive.files.list({
        q: `'${folderId}' in parents and trashed=false`,
        fields: 'files(id,name,webViewLink,size,createdTime,mimeType)',
        orderBy: 'createdTime desc',
        pageSize: maxResults
      });

      return response.data.files || [];
    } catch (error) {
      logger.error('Failed to list files in folder', {
        folderId,
        error: error.message,
        timestamp: new Date().toISOString()
      });
      throw error;
    }
  }

  /**
   * Get folder storage usage
   */
  async getFolderStorageUsage(folderId) {
    try {
      const files = await this.listFilesInFolder(folderId, 1000); // Get more files for accurate count
      
      const totalSize = files.reduce((sum, file) => {
        return sum + (file.size ? parseInt(file.size) : 0);
      }, 0);

      const totalSizeMB = Math.round(totalSize / 1024 / 1024);
      const totalSizeGB = Math.round(totalSize / 1024 / 1024 / 1024 * 100) / 100;

      return {
        fileCount: files.length,
        totalSizeBytes: totalSize,
        totalSizeMB,
        totalSizeGB,
        files: files.slice(0, 10) // Return first 10 files as sample
      };
    } catch (error) {
      logger.error('Failed to get folder storage usage', {
        folderId,
        error: error.message,
        timestamp: new Date().toISOString()
      });
      throw error;
    }
  }

  /**
   * Validate recording URL accessibility
   * ⚠️ DEPRECATED: URL validation removed due to false failures with AWS S3 signed URLs
   * Always returns accessible: true to avoid blocking processing
   */
  async validateRecordingUrl(recordingUrl) {
    logger.warn('URL validation is deprecated - always returning accessible: true', {
      url: recordingUrl.substring(0, 50) + '...',
      reason: 'URL validation causes false failures with AWS S3 signed URLs',
      timestamp: new Date().toISOString()
    });

    return {
      accessible: true,
      status: 200,
      contentLength: null,
      contentType: 'video/x-matroska',
      estimatedSizeMB: null,
      deprecated: true
    };
  }

  /**
   * Format file size for display
   */
  formatFileSize(bytes) {
    if (!bytes || bytes === 0) return '0 Bytes';
    
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }

  /**
   * Estimate upload time based on file size
   */
  estimateUploadTime(fileSizeBytes, connectionSpeedMbps = 10) {
    if (!fileSizeBytes) return null;
    
    const fileSizeMb = fileSizeBytes / 1024 / 1024 * 8; // Convert to megabits
    const estimatedSeconds = Math.ceil(fileSizeMb / connectionSpeedMbps);
    
    return {
      estimatedSeconds,
      estimatedMinutes: Math.ceil(estimatedSeconds / 60),
      fileSizeMB: Math.round(fileSizeBytes / 1024 / 1024),
      connectionSpeedMbps
    };
  }
}

// Export singleton instance
module.exports = new FileService();
