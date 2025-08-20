// Load environment variables first
require('dotenv').config();

const meetingService = require('./src/services/meetingService');
const chatterboxService = require('./src/services/chatterboxService');
const databaseService = require('./src/services/databaseService');
const logger = require('./src/utils/logger');

async function testLocalProcessing() {
  try {
    console.log('🧪 Starting local test with session ID: 18bf1e04-31ab-4b4e-91fe-f57b7f6ad65a');
    
    // Step 1: Get session data from ChatterBox
    console.log('\n📡 Step 1: Getting session data from ChatterBox...');
    const sessionData = await chatterboxService.getSessionData('18bf1e04-31ab-4b4e-91fe-f57b7f6ad65a');
    console.log('✅ Session data retrieved:', {
      hasRecording: !!sessionData.recordingLink,
      hasTranscript: !!sessionData.transcript,
      transcriptLength: sessionData.transcript?.length || 0,
      status: sessionData.status
    });

    if (!sessionData.recordingLink) {
      console.log('❌ No recording link found in session data');
      return;
    }

    // Step 2: Create a test meeting record
    console.log('\n📝 Step 2: Creating test meeting record...');
    const testMeeting = await databaseService.createMeeting({
      calendar_event_id: 'test-local-' + Date.now(),
      conference_id: 'test-local-meeting',
      meeting_title: 'Local Test Meeting',
      meeting_description: 'Testing local processing with session 18bf1e04-31ab-4b4e-91fe-f57b7f6ad65a',
      chatterbox_session_id: '18bf1e04-31ab-4b4e-91fe-f57b7f6ad65a',
      bot_join_status: 'joined',
      status: 'bot_joined',
      meeting_started_at: new Date(sessionData.startTimestamp),
      recording_start_timestamp: sessionData.startTimestamp,
      recording_end_timestamp: sessionData.endTimestamp
    });
    console.log('✅ Test meeting created:', testMeeting.id);

    // Step 3: Process the recording
    console.log('\n🚀 Step 3: Processing recording urgently...');
    await meetingService.processRecordingUrgently(
      testMeeting.id,
      sessionData.recordingLink,
      '18bf1e04-31ab-4b4e-91fe-f57b7f6ad65a'
    );

    console.log('\n🎉 Local test completed successfully!');
    console.log('Check your Google Drive and Slack for the results.');

  } catch (error) {
    console.error('❌ Local test failed:', error.message);
    console.error('Stack trace:', error.stack);
  }
}

// Run the test
testLocalProcessing();
