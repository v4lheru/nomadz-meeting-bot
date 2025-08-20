# ChatterBox-First Architecture Design

## 🎯 New Architecture: ChatterBox-First Approach

Perfect! This is a much cleaner architecture. Let's design it so Railway only handles what it does best (post-meeting processing) and ChatterBox handles bot joining directly.

## 🔄 Architecture Comparison

### Current Architecture (with Railway bottleneck)
```
Google Calendar → n8n → Railway → ChatterBox → Railway (processing)
```

### New ChatterBox-First Architecture
```
Google Calendar → n8n → ChatterBox (direct) → Railway (processing only)
```

## 🚀 Implementation Plan

### Phase 1: n8n Calls ChatterBox Directly

**n8n HTTP Request Node Configuration:**
```json
{
  "method": "POST",
  "url": "https://bot.chatter-box.io/join",
  "headers": {
    "Authorization": "Bearer {{ $env.CHATTERBOX_API_KEY }}",
    "Content-Type": "application/json"
  },
  "sendBody": true,
  "specifyBody": "json",
  "jsonBody": {
    "platform": "googlemeet",
    "meetingId": "{{ $json.conferenceData.conferenceId }}",
    "botName": "Nomadz Meeting Bot",
    "webhookUrl": "https://nomadz-meeting-bot-production.up.railway.app/webhook/chatterbox-direct",
    "language": "multi",
    "noTranscriptTimeoutSeconds": 1200
  }
}
```

### Phase 2: Railway Handles Only Post-Meeting Processing

**Railway Responsibilities:**
- ✅ Receive ChatterBox webhooks (started, transcript, finished)
- ✅ Download recordings from ChatterBox URLs
- ✅ Upload to Google Drive
- ✅ Create transcript documents
- ✅ Send Slack notifications
- ✅ Database logging and state management

**Railway Does NOT Handle:**
- ❌ Bot joining logic (ChatterBox handles this directly)
- ❌ Meeting creation from n8n (not needed)
- ❌ ChatterBox API calls for joining

## 🔧 Required Changes

### 1. n8n Workflow Update

**Current n8n Node:**
```json
{
  "method": "POST",
  "url": "https://nomadz-meeting-bot-production.up.railway.app/webhook/meeting-started"
}
```

**New n8n Node (Direct ChatterBox):**
```json
{
  "method": "POST",
  "url": "https://bot.chatter-box.io/join",
  "headers": {
    "Authorization": "Bearer YOUR_CHATTERBOX_API_KEY",
    "Content-Type": "application/json"
  },
  "body": {
    "platform": "googlemeet",
    "meetingId": "{{ $json.conferenceData.conferenceId }}",
    "botName": "Nomadz Meeting Bot",
    "webhookUrl": "https://nomadz-meeting-bot-production.up.railway.app/webhook/chatterbox-direct"
  }
}
```

### 2. Railway Webhook Handler Update

We need to modify the ChatterBox webhook handler to create meeting records when it receives the "started" event (since n8n won't be calling Railway anymore).

**Updated `/webhook/chatterbox-direct` Handler:**
```javascript
async function handleSessionStarted(payload) {
  const { sessionId, timestamp } = payload;
  
  // Since n8n called ChatterBox directly, we need to create the meeting record here
  // We'll need to get meeting details from ChatterBox session data
  try {
    const sessionData = await chatterboxService.getSessionData(sessionId);
    
    // Create meeting record when bot starts (not when n8n triggers)
    const meeting = await databaseService.createMeeting({
      chatterbox_session_id: sessionId,
      conference_id: sessionData.meetingId || 'unknown',
      meeting_title: `Meeting ${sessionId.substring(0, 8)}`, // We'll get this from ChatterBox if available
      status: 'recording',
      bot_join_status: 'joined',
      meeting_started_at: new Date(timestamp * 1000)
    });
    
    logger.logMeetingEvent(meeting.id, 'recording_started', { sessionId });
  } catch (error) {
    logger.error('Failed to create meeting record from ChatterBox started event', {
      sessionId,
      error: error.message
    });
  }
}
```

## 🎯 Benefits of ChatterBox-First Architecture

### 1. **Eliminates Railway as Bottleneck**
- No more Railway failures preventing bot joins
- ChatterBox handles bot joining directly (their expertise)
- Railway only does post-processing (our expertise)

### 2. **Faster Bot Joining**
- Direct API call from n8n to ChatterBox
- No intermediate Railway processing
- Reduced latency and failure points

### 3. **Better Error Handling**
- n8n gets immediate response from ChatterBox about join success/failure
- Railway handles processing errors separately
- Clear separation of concerns

### 4. **Simplified Debugging**
- Bot join issues = ChatterBox API problem
- Processing issues = Railway problem
- Clear separation makes troubleshooting easier

## 🚨 Considerations

### 1. **Meeting Metadata**
Since n8n won't call Railway with meeting details, we need to:
- Get meeting title from ChatterBox session data (if available)
- Or use a generic title like "Meeting [sessionId]"
- Store conference ID from ChatterBox

### 2. **Error Handling**
- n8n needs to handle ChatterBox API errors
- Railway needs to handle missing meeting metadata gracefully

### 3. **Database Records**
- Meeting records created when bot joins (not when n8n triggers)
- May need to backfill meeting titles from Google Calendar if needed

## 🔄 Migration Plan

### Step 1: Test ChatterBox Direct Call
1. Create test n8n workflow calling ChatterBox directly
2. Verify bot joins successfully
3. Confirm Railway receives webhooks

### Step 2: Update Railway Handler
1. Modify `/webhook/chatterbox-direct` to create meeting records
2. Test with ChatterBox webhooks
3. Verify Google Drive, Slack, etc. still work

### Step 3: Switch n8n Workflow
1. Update production n8n to call ChatterBox directly
2. Monitor for any issues
3. Remove old Railway meeting-started endpoint

Would you like me to implement this ChatterBox-first architecture?
