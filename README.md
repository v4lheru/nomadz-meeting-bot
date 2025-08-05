# Meeting Recording Service - Nomadz

A robust Node.js service deployed on Railway that automatically handles meeting recordings from ChatterBox API, processes large video files, creates formatted transcripts, and integrates with Google Drive and Slack for seamless team collaboration.

## 🎯 Features

- **Automated Meeting Bot Joining** via ChatterBox API
- **Large File Handling** (stream processing for .mkv files)
- **Google Drive Integration** (recordings + transcript documents)
- **Slack Notifications** with direct links
- **Supabase Database** for state management and logging
- **Error Recovery** with retry logic and detailed logging
- **Background Jobs** for status polling and cleanup
- **Health Monitoring** with comprehensive service checks

## 🏗️ Architecture

### Service Type: Railway Web Service
- **Runtime**: Node.js 18+
- **Framework**: Express.js
- **Database**: Supabase (PostgreSQL)
- **File Storage**: Google Drive API
- **Deployment**: Railway with auto-deploy from GitHub

### Core Components
```
┌─────────────────┐    ┌──────────────────┐    ┌─────────────────┐
│  Google Cal     │───▶│  Railway Service │───▶│  ChatterBox API │
│  Webhook        │    │                  │    │                 │
└─────────────────┘    └──────────────────┘    └─────────────────┘
                                │
                                ▼
┌─────────────────┐    ┌──────────────────┐    ┌─────────────────┐
│  Supabase DB    │◀───│  File Processor  │───▶│  Google Drive   │
│                 │    │  (Stream Handler)│    │                 │
└─────────────────┘    └──────────────────┘    └─────────────────┘
                                │
                                ▼
                       ┌──────────────────┐
                       │  Slack Notifier  │
                       │                  │
                       └──────────────────┘
```

## 🚀 Quick Start

### Prerequisites

1. **Node.js 18+** installed
2. **Supabase** project with database setup
3. **Google Cloud** project with Drive and Docs APIs enabled
4. **Slack** bot with appropriate permissions
5. **ChatterBox** API access
6. **Railway** account for deployment

### Environment Variables

Create a `.env` file based on `.env.example`:

```bash
# Server Configuration
NODE_ENV=production
PORT=3000
BASE_URL=https://your-railway-app.railway.app

# Supabase Database
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key

# ChatterBox API  
CHATTERBOX_API_KEY=your-chatterbox-api-key

# Google APIs
GOOGLE_CLIENT_ID=your-google-client-id
GOOGLE_CLIENT_SECRET=your-google-client-secret
GOOGLE_REFRESH_TOKEN=your-google-refresh-token

# Google Drive Folders
GOOGLE_DRIVE_RECORDINGS_FOLDER=your-recordings-folder-id
GOOGLE_DRIVE_TRANSCRIPTS_FOLDER=your-transcripts-folder-id

# Slack Integration
SLACK_BOT_TOKEN=xoxb-your-slack-bot-token
SLACK_MEETINGS_CHANNEL=your-channel-id

# Service Configuration
WEBHOOK_SECRET=your-webhook-secret
MAX_RETRIES=3
LOG_LEVEL=info
```

### Installation

```bash
# Clone the repository
git clone https://github.com/v4lheru/nomadz-meeting-bot.git
cd nomadz-meeting-bot

# Install dependencies
npm install

# Set up database schema
# Run the SQL from database/schema.sql in your Supabase project

# Start development server
npm run dev

# Or start production server
npm start
```

## 📊 Database Schema

The service uses Supabase (PostgreSQL) with the following main tables:

### meetings
- Stores meeting metadata and processing status
- Tracks ChatterBox session IDs and Google Drive file IDs
- Maintains processing timestamps and status

### processing_logs
- Detailed logs for each processing step
- Error tracking and retry information
- Debugging and monitoring data

See `database/schema.sql` for complete schema definition.

## 🔌 API Endpoints

### Webhook Endpoints
```
POST /webhook/meeting-started    # Google Calendar webhook
POST /webhook/chatterbox         # ChatterBox completion webhook
```

### Management Endpoints
```
GET  /health                     # Comprehensive health check
GET  /api/meetings/:id/status    # Meeting processing status
POST /api/meetings/:id/retry     # Retry failed processing
POST /api/meetings/:id/process   # Manual processing trigger
```

## 🔄 Workflow

### 1. Meeting Started
1. Google Calendar sends webhook to `/webhook/meeting-started`
2. Service creates meeting record in database
3. ChatterBox bot joins the meeting
4. Meeting status updated to `bot_joined`

### 2. Recording Processing (⚠️ CRITICAL: 5-minute window!)
1. ChatterBox sends webhook when recording is ready
2. Service immediately starts urgent processing
3. Recording streamed directly to Google Drive
4. Transcript fetched and formatted into Google Doc
5. Slack notification sent with links
6. Meeting status updated to `completed`

### 3. Error Handling
- Automatic retries with exponential backoff
- Critical error alerts for URL expiration
- Comprehensive logging and monitoring
- Manual retry capabilities

## 🛠️ Services Architecture

### Core Services
- **meetingService**: Orchestrates the entire workflow
- **chatterboxService**: ChatterBox API integration
- **fileService**: Large file streaming to Google Drive
- **transcriptService**: Google Docs creation and formatting
- **notificationService**: Slack notifications
- **databaseService**: All database operations

### Background Jobs
- **pollStatusJob**: Monitors stuck meetings (every 30 seconds)
- **cleanupJob**: Removes old data (daily at 2 AM UTC)

## 🚨 Critical Considerations

### ChatterBox URL Expiration
- **Recording URLs expire in 5 minutes!**
- Service must download and process immediately
- Streaming implementation avoids local storage
- Urgent processing with timeout handling

### Security
- No API keys in code (environment variables only)
- `.env` files in `.gitignore`
- Secure credential handling throughout
- Rate limiting and input validation

### Error Recovery
- Comprehensive retry logic
- Critical error alerting
- Processing step logging
- Manual intervention capabilities

## 📈 Monitoring

### Health Checks
- `/health` endpoint tests all services
- Database connectivity verification
- External API status checks
- System resource monitoring

### Logging
- Structured logging with Winston
- Processing step tracking
- Error categorization and alerting
- Performance metrics

### Slack Notifications
- Meeting completion with file links
- Processing failure alerts
- Critical error notifications
- Service health status updates

## 🚀 Deployment

### Railway Deployment
1. Connect GitHub repository to Railway
2. Set environment variables in Railway dashboard
3. Deploy automatically on push to main branch
4. Monitor via Railway dashboard and logs

### Configuration Files
- `railway.toml`: Railway deployment configuration
- `package.json`: Dependencies and scripts
- `.env.example`: Environment variable template

## 🧪 Testing

```bash
# Run tests (when implemented)
npm test

# Health check
curl https://your-app.railway.app/health

# Test Slack integration
# Use the test notification endpoint
```

## 📝 Development

### Project Structure
```
src/
├── config/          # Service configurations
├── controllers/     # Request handlers
├── middlewares/     # Express middlewares
├── services/        # Business logic
├── utils/          # Utilities and helpers
└── jobs/           # Background jobs

database/           # Database schema and migrations
docs/              # Additional documentation
```

### Adding New Features
1. Follow the existing service pattern
2. Add comprehensive error handling
3. Include logging and monitoring
4. Update health checks if needed
5. Document API changes

## 🔧 Troubleshooting

### Common Issues

**ChatterBox URL Expired**
- Check processing logs for timing
- Verify webhook delivery speed
- Monitor urgent processing timeouts

**Google Drive Upload Fails**
- Verify folder permissions
- Check API quotas and limits
- Validate OAuth credentials

**Slack Notifications Not Sent**
- Verify bot token and permissions
- Check channel membership
- Review rate limiting

**Database Connection Issues**
- Verify Supabase credentials
- Check network connectivity
- Review connection pooling

### Debugging
1. Check `/health` endpoint for service status
2. Review logs in Railway dashboard
3. Use `/api/meetings/:id/status` for processing details
4. Monitor Slack for error notifications

## 📄 License

This project is proprietary to Nomadz. All rights reserved.

## 🤝 Contributing

1. Follow existing code patterns
2. Add comprehensive tests
3. Update documentation
4. Ensure security best practices
5. Test thoroughly before deployment

## 📞 Support

For issues or questions:
1. Check the troubleshooting section
2. Review logs and health checks
3. Contact the development team
4. Create GitHub issues for bugs

---

**⚠️ Important**: This service handles critical meeting recordings with time-sensitive processing. Always test changes thoroughly and monitor deployments closely.
