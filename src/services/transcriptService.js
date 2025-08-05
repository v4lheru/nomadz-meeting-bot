const { docs, drive } = require('../config/google');
const logger = require('../utils/logger');

/**
 * Transcript service for creating formatted Google Docs
 * Converts ChatterBox transcript data into professional meeting transcripts
 */
class TranscriptService {
  /**
   * Create a formatted transcript document in Google Docs
   */
  async createTranscriptDocument(meeting, transcriptArray) {
    try {
      logger.info('Creating transcript document', {
        meetingId: meeting.id,
        meetingTitle: meeting.meeting_title,
        transcriptLength: transcriptArray?.length || 0,
        timestamp: new Date().toISOString()
      });

      // Create the document
      const docTitle = `Meeting Transcript - ${meeting.meeting_title}`;
      const document = await docs.documents.create({
        requestBody: {
          title: docTitle
        }
      });

      const documentId = document.data.documentId;

      // Generate document content
      const documentContent = this.generateDocumentContent(meeting, transcriptArray);

      // Insert content into the document
      await docs.documents.batchUpdate({
        documentId,
        requestBody: {
          requests: documentContent
        }
      });

      // Move document to transcripts folder
      await drive.files.update({
        fileId: documentId,
        addParents: process.env.GOOGLE_DRIVE_TRANSCRIPTS_FOLDER,
        fields: 'id,parents'
      });

      // Make document shareable
      await drive.permissions.create({
        fileId: documentId,
        requestBody: {
          role: 'reader',
          type: 'anyone'
        }
      });

      // Get document info
      const docInfo = await drive.files.get({
        fileId: documentId,
        fields: 'id,name,webViewLink,webContentLink,createdTime'
      });

      logger.info('Transcript document created successfully', {
        meetingId: meeting.id,
        documentId,
        docTitle,
        webViewLink: docInfo.data.webViewLink,
        timestamp: new Date().toISOString()
      });

      return {
        id: documentId,
        name: docInfo.data.name,
        webViewLink: docInfo.data.webViewLink,
        webContentLink: docInfo.data.webContentLink,
        createdTime: docInfo.data.createdTime
      };

    } catch (error) {
      logger.error('Failed to create transcript document', {
        meetingId: meeting.id,
        meetingTitle: meeting.meeting_title,
        error: error.message,
        timestamp: new Date().toISOString()
      });
      throw error;
    }
  }

  /**
   * Generate document content requests for Google Docs API
   */
  generateDocumentContent(meeting, transcriptArray) {
    const requests = [];
    let insertIndex = 1; // Start after the title

    // Document header
    const headerText = this.generateHeaderText(meeting);
    requests.push({
      insertText: {
        location: { index: insertIndex },
        text: headerText
      }
    });
    insertIndex += headerText.length;

    // Format header
    requests.push({
      updateTextStyle: {
        range: {
          startIndex: 1,
          endIndex: insertIndex
        },
        textStyle: {
          fontSize: { magnitude: 11, unit: 'PT' },
          weightedFontFamily: {
            fontFamily: 'Arial',
            weight: 400
          }
        },
        fields: 'fontSize,weightedFontFamily'
      }
    });

    // Add transcript content
    if (transcriptArray && transcriptArray.length > 0) {
      const transcriptText = this.generateTranscriptText(transcriptArray);
      requests.push({
        insertText: {
          location: { index: insertIndex },
          text: transcriptText
        }
      });
      insertIndex += transcriptText.length;
    } else {
      const noTranscriptText = '\n\n⚠️ No transcript data available\n\nThe recording was processed successfully, but no transcript data was provided by the transcription service.\n\n';
      requests.push({
        insertText: {
          location: { index: insertIndex },
          text: noTranscriptText
        }
      });
      insertIndex += noTranscriptText.length;
    }

    // Add footer
    const footerText = this.generateFooterText();
    requests.push({
      insertText: {
        location: { index: insertIndex },
        text: footerText
      }
    });

    return requests;
  }

  /**
   * Generate header text for the document
   */
  generateHeaderText(meeting) {
    const startTime = meeting.meeting_started_at 
      ? new Date(meeting.meeting_started_at).toLocaleString('en-US', {
          weekday: 'long',
          year: 'numeric',
          month: 'long',
          day: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
          timeZoneName: 'short'
        })
      : 'Unknown';

    const endTime = meeting.meeting_ended_at 
      ? new Date(meeting.meeting_ended_at).toLocaleString('en-US', {
          hour: '2-digit',
          minute: '2-digit',
          timeZoneName: 'short'
        })
      : 'Unknown';

    const duration = this.calculateDuration(meeting.recording_start_timestamp, meeting.recording_end_timestamp);

    const headerLines = [
      '📝 MEETING TRANSCRIPT',
      '',
      `Meeting: ${meeting.meeting_title}`,
      `Date: ${startTime}`,
      `End Time: ${endTime}`,
      `Duration: ${duration}`,
      `Conference ID: ${meeting.conference_id}`,
      ''
    ];

    if (meeting.meeting_description) {
      headerLines.push(`Description: ${meeting.meeting_description}`);
      headerLines.push('');
    }

    headerLines.push(`Generated: ${new Date().toLocaleString('en-US', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      timeZoneName: 'short'
    })}`);

    headerLines.push('');
    headerLines.push('━'.repeat(120));
    headerLines.push('');

    return headerLines.join('\n');
  }

  /**
   * Generate transcript text from ChatterBox transcript array
   */
  generateTranscriptText(transcriptArray) {
    if (!transcriptArray || transcriptArray.length === 0) {
      return '\n\n⚠️ No transcript data available\n\n';
    }

    const transcriptLines = ['\n🎙️ TRANSCRIPT\n'];
    
    let currentSpeaker = null;
    let speakerCount = 0;
    const speakerMap = new Map();

    for (const entry of transcriptArray) {
      const { speaker, text, timeStart, timeEnd } = entry;
      
      if (!text || text.trim().length === 0) {
        continue;
      }

      // Map speakers to consistent names
      if (!speakerMap.has(speaker)) {
        speakerCount++;
        speakerMap.set(speaker, `Speaker ${speakerCount}`);
      }
      
      const speakerName = speakerMap.get(speaker);
      const timestamp = this.formatTimestamp(timeStart);
      
      // Add speaker header if speaker changed
      if (currentSpeaker !== speakerName) {
        if (currentSpeaker !== null) {
          transcriptLines.push(''); // Add blank line between speakers
        }
        transcriptLines.push(`[${timestamp}] ${speakerName}:`);
        currentSpeaker = speakerName;
      }
      
      // Add the text with proper formatting
      const cleanText = text.trim();
      transcriptLines.push(cleanText);
      transcriptLines.push('');
    }

    return transcriptLines.join('\n');
  }

  /**
   * Generate footer text for the document
   */
  generateFooterText() {
    const footerLines = [
      '',
      '━'.repeat(120),
      '',
      '📋 DOCUMENT INFORMATION',
      '',
      `• Generated by: Nomadz Meeting Recording Service`,
      `• Transcription: ChatterBox AI`,
      `• Document created: ${new Date().toLocaleString('en-US', {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        timeZoneName: 'short'
      })}`,
      '',
      '⚠️ Note: This transcript was generated automatically and may contain errors.',
      'Please review for accuracy before sharing or making decisions based on this content.',
      ''
    ];

    return footerLines.join('\n');
  }

  /**
   * Calculate duration between two timestamps
   */
  calculateDuration(startTimestamp, endTimestamp) {
    if (!startTimestamp || !endTimestamp) {
      return 'Unknown duration';
    }

    try {
      const start = new Date(startTimestamp);
      const end = new Date(endTimestamp);
      const durationMs = end - start;

      if (durationMs <= 0) {
        return 'Unknown duration';
      }

      const hours = Math.floor(durationMs / (1000 * 60 * 60));
      const minutes = Math.floor((durationMs % (1000 * 60 * 60)) / (1000 * 60));
      const seconds = Math.floor((durationMs % (1000 * 60)) / 1000);

      if (hours > 0) {
        return `${hours}h ${minutes}m ${seconds}s`;
      } else if (minutes > 0) {
        return `${minutes}m ${seconds}s`;
      } else {
        return `${seconds}s`;
      }
    } catch (error) {
      logger.error('Failed to calculate duration', {
        startTimestamp,
        endTimestamp,
        error: error.message
      });
      return 'Unknown duration';
    }
  }

  /**
   * Format timestamp for display in transcript
   */
  formatTimestamp(timeStart) {
    if (!timeStart) {
      return '00:00';
    }

    try {
      // timeStart is typically in milliseconds
      const totalSeconds = Math.floor(timeStart / 1000);
      const hours = Math.floor(totalSeconds / 3600);
      const minutes = Math.floor((totalSeconds % 3600) / 60);
      const seconds = totalSeconds % 60;

      if (hours > 0) {
        return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
      } else {
        return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
      }
    } catch (error) {
      logger.error('Failed to format timestamp', {
        timeStart,
        error: error.message
      });
      return '00:00';
    }
  }

  /**
   * Get transcript statistics
   */
  getTranscriptStats(transcriptArray) {
    if (!transcriptArray || transcriptArray.length === 0) {
      return {
        totalEntries: 0,
        totalWords: 0,
        speakers: 0,
        duration: 0
      };
    }

    const speakers = new Set();
    let totalWords = 0;
    let minTime = Infinity;
    let maxTime = 0;

    for (const entry of transcriptArray) {
      if (entry.speaker) {
        speakers.add(entry.speaker);
      }
      
      if (entry.text) {
        totalWords += entry.text.trim().split(/\s+/).length;
      }
      
      if (entry.timeStart) {
        minTime = Math.min(minTime, entry.timeStart);
        maxTime = Math.max(maxTime, entry.timeEnd || entry.timeStart);
      }
    }

    const duration = maxTime > minTime ? maxTime - minTime : 0;

    return {
      totalEntries: transcriptArray.length,
      totalWords,
      speakers: speakers.size,
      duration: Math.floor(duration / 1000) // Convert to seconds
    };
  }
}

// Export singleton instance
module.exports = new TranscriptService();
