# Meeting Recording Service - Codebase Context

## Project Overview
A robust Node.js service deployed on Railway that automatically handles meeting recordings from ChatterBox API, processes large video files, creates formatted transcripts, and integrates with Google Drive and Slack for seamless team collaboration.

## Architecture
- **Runtime**: Node.js 18+ with Express.js
- **Database**: Supabase (PostgreSQL)
- **File Storage**: Google Drive API
- **Deployment**: Railway with auto-deploy from GitHub
- **Integrations**: ChatterBox API, Slack API, Google Calendar webhooks

## Current State
- Fresh project initialization
- No existing code base
- Ready for complete implementation following PACT framework

## Key Security Requirements
- NO API KEYS in source code - only in .env files
- .env files MUST be in .gitignore
- Highest security standards for credential handling

## Critical Technical Constraints
- ChatterBox recording URLs expire in 5 minutes - URGENT processing required
- Large .mkv file handling via streaming (no local storage)
- Stream directly to Google Drive to handle file size limitations

## Project Structure
```
meeting-recording-service/
├── src/
│   ├── index.js                 # Main Express server
│   ├── config/                  # Service configurations
│   ├── controllers/             # Request handlers
│   ├── services/                # Business logic
│   ├── utils/                   # Utilities and helpers
│   ├── middlewares/             # Express middlewares
│   └── jobs/                    # Background jobs
├── tests/                       # Test suites
├── docs/                        # Documentation
├── database/                    # Database schemas
└── deployment/                  # Deployment configs
```

## Implementation Status
- [ ] Project structure setup
- [ ] Core dependencies installation
- [ ] Database schema creation
- [ ] Service configurations
- [ ] API integrations
- [ ] Webhook handlers
- [ ] File processing pipeline
- [ ] Error handling & recovery
- [ ] Testing suite
- [ ] Railway deployment setup

## Next Steps
1. Create complete project structure
2. Set up package.json with all dependencies
3. Implement core services and configurations
4. Set up database schemas
5. Create webhook handlers
6. Implement file processing pipeline
7. Add comprehensive error handling
8. Configure Railway deployment
