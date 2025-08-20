-- Meeting Recording Service Database Schema
-- Supabase PostgreSQL Database

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Create meetings table
CREATE TABLE meetings (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  
  -- Meeting Identity
  calendar_event_id TEXT UNIQUE NOT NULL,
  conference_id TEXT NOT NULL,
  meeting_title TEXT NOT NULL,
  meeting_description TEXT,
  meeting_started_at TIMESTAMPTZ,
  meeting_ended_at TIMESTAMPTZ,
  
  -- ChatterBox Integration
  chatterbox_session_id TEXT,
  bot_join_status TEXT DEFAULT 'pending', -- pending, joined, failed
  
  -- Processing Status
  status TEXT DEFAULT 'started', -- started, bot_joined, recording, processing, completed, failed
  
  -- ChatterBox Response Data
  recording_s3_url TEXT,
  recording_start_timestamp TIMESTAMPTZ,
  recording_end_timestamp TIMESTAMPTZ,
  transcript_data JSONB, -- Store full transcript array
  
  -- Google Drive Files
  google_drive_recording_id TEXT,
  google_drive_recording_url TEXT,
  google_drive_transcript_id TEXT, 
  google_drive_transcript_url TEXT,
  
  -- Notifications
  slack_message_ts TEXT,
  slack_channel TEXT DEFAULT 'C0985UTH8UF', -- meetings channel
  
  -- Timestamps
  processing_started_at TIMESTAMPTZ,
  processing_completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Add indexes for common queries
CREATE INDEX idx_meetings_calendar_event_id ON meetings(calendar_event_id);
CREATE INDEX idx_meetings_session_id ON meetings(chatterbox_session_id);
CREATE INDEX idx_meetings_status ON meetings(status);
CREATE INDEX idx_meetings_created_at ON meetings(created_at);

-- Create processing_logs table
CREATE TABLE processing_logs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  meeting_id UUID REFERENCES meetings(id) ON DELETE CASCADE,
  
  step TEXT NOT NULL, -- join_bot, poll_status, download_recording, upload_drive, create_transcript, send_slack
  status TEXT NOT NULL, -- started, completed, failed, retrying
  
  error_message TEXT,
  error_details JSONB,
  retry_count INTEGER DEFAULT 0,
  
  started_at TIMESTAMPTZ DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  
  -- Step-specific data
  metadata JSONB
);

-- Add indexes for processing_logs
CREATE INDEX idx_processing_logs_meeting_id ON processing_logs(meeting_id);
CREATE INDEX idx_processing_logs_step_status ON processing_logs(step, status);

-- Create calendar_events table to store Google Calendar data
CREATE TABLE calendar_events (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  
  -- Google Calendar Event Data
  calendar_event_id TEXT UNIQUE NOT NULL, -- Google Calendar event ID
  etag TEXT,
  status TEXT,
  html_link TEXT,
  
  -- Event Details
  summary TEXT NOT NULL, -- Meeting title
  description TEXT,
  location TEXT,
  
  -- Timing
  start_datetime TIMESTAMPTZ,
  end_datetime TIMESTAMPTZ,
  timezone TEXT,
  
  -- People
  creator_email TEXT,
  organizer_email TEXT,
  attendees JSONB, -- Array of attendee objects
  
  -- Conference Data
  conference_id TEXT, -- Google Meet conference ID (e.g., "zjh-daed-bmj")
  hangout_link TEXT,
  conference_data JSONB, -- Full conferenceData object
  
  -- ChatterBox Integration
  chatterbox_session_id TEXT, -- Will be populated when bot joins
  
  -- Raw Data
  raw_event_data JSONB, -- Store complete Google Calendar event data
  
  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Add indexes for calendar_events
CREATE INDEX idx_calendar_events_calendar_event_id ON calendar_events(calendar_event_id);
CREATE INDEX idx_calendar_events_conference_id ON calendar_events(conference_id);
CREATE INDEX idx_calendar_events_session_id ON calendar_events(chatterbox_session_id);
CREATE INDEX idx_calendar_events_start_datetime ON calendar_events(start_datetime);

-- Create service_config table
CREATE TABLE service_config (
  key TEXT PRIMARY KEY,
  value JSONB NOT NULL,
  description TEXT,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Insert default configuration
INSERT INTO service_config (key, value, description) VALUES
('google_drive_recordings_folder', '"1PCFc4ZaUe5xR3jDIQy4DMjd-Iu1VYI3s"', 'Google Drive folder ID for meeting recordings'),
('google_drive_transcripts_folder', '"1HER44rFU288z8C_munUkKAiVdnoMN5MW"', 'Google Drive folder ID for transcripts'),
('slack_meetings_channel', '"C0985UTH8UF"', 'Default Slack channel for notifications'),
('chatterbox_poll_interval', '30000', 'Polling interval in milliseconds'),
('max_retries', '3', 'Maximum retry attempts for failed operations');

-- Create function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Create trigger for meetings table
CREATE TRIGGER update_meetings_updated_at 
    BEFORE UPDATE ON meetings 
    FOR EACH ROW 
    EXECUTE FUNCTION update_updated_at_column();

-- Create trigger for service_config table
CREATE TRIGGER update_service_config_updated_at 
    BEFORE UPDATE ON service_config 
    FOR EACH ROW 
    EXECUTE FUNCTION update_updated_at_column();

-- Add Row Level Security (RLS) policies
ALTER TABLE meetings ENABLE ROW LEVEL SECURITY;
ALTER TABLE processing_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE service_config ENABLE ROW LEVEL SECURITY;

-- Create policies for service role access
CREATE POLICY "Service role can manage meetings" ON meetings
    FOR ALL USING (auth.role() = 'service_role');

CREATE POLICY "Service role can manage processing_logs" ON processing_logs
    FOR ALL USING (auth.role() = 'service_role');

CREATE POLICY "Service role can manage service_config" ON service_config
    FOR ALL USING (auth.role() = 'service_role');

-- Create views for common queries
CREATE VIEW meeting_status_summary AS
SELECT 
    status,
    COUNT(*) as count,
    AVG(EXTRACT(EPOCH FROM (processing_completed_at - processing_started_at))) as avg_processing_time_seconds
FROM meetings 
WHERE processing_started_at IS NOT NULL
GROUP BY status;

CREATE VIEW recent_meetings AS
SELECT 
    id,
    meeting_title,
    status,
    created_at,
    processing_started_at,
    processing_completed_at,
    google_drive_recording_url,
    google_drive_transcript_url
FROM meetings 
ORDER BY created_at DESC 
LIMIT 50;

-- Grant permissions to service role
GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO service_role;
GRANT ALL ON ALL FUNCTIONS IN SCHEMA public TO service_role;
