# ChatterBox Direct Webhook Architecture Upgrade

## 🎯 Overview

This upgrade introduces a more reliable webhook architecture by using ChatterBox's direct webhook system instead of relying on Railway as an intermediary. This reduces failure points and improves reliability.

## 🔄 Architecture Comparison

### Old Architecture (with potential failures)
```
Google Calendar → n8n → Railway webhook → ChatterBox join → ChatterBox webhook back to Railway
```

### New Architecture (more reliable)
```
Google Calendar → n8n → Railway webhook → ChatterBox join (with direct webhook)
ChatterBox → Direct webhook to Railway (for all events: started, transcript, finished)
```

## 🚀 New Endpoints

### 1. `/webhook/chatterbox-direct` (POST)
**Purpose**: Handles all ChatterBox webhook events directly
**Events Handled**:
- `started`: Bot successfully joined meeting
- `transcript`: Real-time transcript chunks (optional logging)
- `finished`: Meeting ended, recording ready (triggers processing)

**Payload Examples**:
```json
// Session Started
{
  "type": "started",
  "payload": {
    "sessionId": "04634659-cad2-454a-87f9-e983bd123456",
    "timestamp": 1724766459
  }
}

// Session Finished (Critical - 5 minute processing window!)
{
  "type": "finished", 
  "payload": {
    "sessionId": "04634659-cad2-454a-87f9-e983bd123456",
    "timestamp": 1724766459,
    "recordingUrl": "https://signed-url-to-recording.mp4"
  }
}
```

### 2. `/webhook/meeting-direct` (POST)
**Purpose**: Alternative to `/webhook/meeting-started` that uses direct ChatterBox webhook
**Usage**: Can be used by n8n for more reliable meeting initiation

## 🔧 Implementation Details

### Key Features
1. **All existing services remain intact**: Google Drive, Slack, database, transcript creation
2. **Backward compatibility**: Old webhooks still work
3. **Improved reliability**: Direct ChatterBox webhook reduces failure points
4. **Same processing logic**: Uses existing `meetingService.processRecordingUrgently()`

### Service Integration
- **Google Drive**: ✅ No changes needed
- **Slack Notifications**: ✅ No changes needed  
- **Database Operations**: ✅ No changes needed
- **Transcript Creation**: ✅ No changes needed
- **File Processing**: ✅ No changes needed

## 📋 Migration Options

### Option 1: Gradual Migration (Recommended)
1. Keep existing n8n workflow as backup
2. Create new n8n workflow using `/webhook/meeting-direct`
3. Test new workflow thoroughly
4. Switch traffic to new workflow
5. Remove old workflow after verification

### Option 2: Direct Switch
1. Update existing n8n workflow to use `/webhook/meeting-direct`
2. Update ChatterBox webhook URL to `/webhook/chatterbox-direct`

## 🔧 n8n Workflow Update

### Current n8n Configuration
```json
{
  "parameters": {
    "method": "POST",
    "url": "https://nomadz-meeting-bot-production.up.railway.app/webhook/meeting-started",
    "sendBody": true,
    "specifyBody": "json",
    "jsonBody": "={\n  \"summary\": \"{{ $json.summary }}\",\n  \"id\": \"{{ $json.id }}\",\n  \"conferenceData\": {\n    \"conferenceId\": \"{{ $json.conferenceData.conferenceId }}\"\n  }\n}"
  }
}
```

### New n8n Configuration (More Reliable)
```json
{
  "parameters": {
    "method": "POST",
    "url": "https://nomadz-meeting-bot-production.up.railway.app/webhook/meeting-direct",
    "sendBody": true,
    "specifyBody": "json",
    "jsonBody": "={\n  \"summary\": \"{{ $json.summary }}\",\n  \"id\": \"{{ $json.id }}\",\n  \"conferenceData\": {\n    \"conferenceId\": \"{{ $json.conferenceData.conferenceId }}\"\n  },\n  \"description\": \"{{ $json.description }}\",\n  \"start\": {{ $json.start }},\n  \"end\": {{ $json.end }}\n}"
  }
}
```

## 🚨 Critical Notes

1. **5-Minute Processing Window**: ChatterBox recording URLs expire in 5 minutes
2. **Webhook URL**: ChatterBox will call `/webhook/chatterbox-direct` for all events
3. **Backward Compatibility**: Old endpoints still work for existing workflows
4. **No Service Disruption**: All existing Google Drive, Slack, and database functionality unchanged

## 🧪 Testing

### Test the New Direct Webhook
```bash
# Test the new direct webhook endpoint
curl -X POST https://nomadz-meeting-bot-production.up.railway.app/webhook/chatterbox-direct \
  -H "Content-Type: application/json" \
  -d '{
    "type": "started",
    "payload": {
      "sessionId": "test-session-123",
      "timestamp": 1724766459
    }
  }'
```

### Test Meeting Creation with Direct Webhook
```bash
# Test meeting creation with direct ChatterBox webhook
curl -X POST https://nomadz-meeting-bot-production.up.railway.app/webhook/meeting-direct \
  -H "Content-Type: application/json" \
  -d '{
    "summary": "Test Meeting",
    "id": "test-event-123",
    "conferenceData": {
      "conferenceId": "abc-def-ghi"
    }
  }'
```

## 📊 Benefits

1. **Reduced Failure Points**: Direct webhook from ChatterBox eliminates intermediary failures
2. **Better Error Handling**: Dedicated handlers for each webhook event type
3. **Improved Logging**: Enhanced logging for troubleshooting
4. **Maintained Functionality**: All existing services (Google Drive, Slack, etc.) work exactly the same
5. **Backward Compatibility**: Old workflows continue to work during migration

## 🔄 Rollback Plan

If issues arise, simply:
1. Switch n8n back to `/webhook/meeting-started`
2. Old architecture continues to work
3. No data loss or service disruption
