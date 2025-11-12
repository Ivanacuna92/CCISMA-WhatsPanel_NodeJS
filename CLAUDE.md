# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

WhatsApp Bot application with AI-powered responses using DeepSeek API and a React-based web dashboard for monitoring conversations.

## Commands

### Development
```bash
# Install dependencies
npm install

# Install system dependencies (Linux only, requires sudo)
sudo bash install-dependencies.sh

# Start development server with hot reload
npm run dev

# Start production server
npm start

# Build React frontend
npm run build

# Preview production build
npm run preview
```

## Architecture

### Core Components

1. **WhatsApp Bot** (`src/bot/whatsappBot.js`)
   - Uses whatsapp-web.js library with Puppeteer for browser automation
   - Handles message events, session management, and QR authentication
   - Integrates with human mode manager for operator takeover functionality

2. **AI Service** (`src/services/aiService.js`)
   - Integrates with DeepSeek API for generating intelligent responses
   - Manages conversation context with configurable message history limit
   - Custom prompt loaded from `prompt.txt` file

3. **Session Management** (`src/services/sessionManager.js`)
   - Tracks user conversations with automatic cleanup after 5 minutes of inactivity
   - Maintains conversation context per user
   - Sends notification before session reset

4. **Human Mode Manager** (`src/services/humanModeManager.js`)
   - Allows human operators to take over conversations
   - Persists human mode states in `data/human-states.json`
   - Toggle between AI and human responses per contact

5. **Web Server** (`src/web/server.js`)
   - Express server with API endpoints for logs, stats, and conversations
   - Vite integration for React development
   - Serves production build from `dist/` directory

6. **React Dashboard** (`src/web/react/`)
   - Real-time conversation monitoring
   - Contact list with human mode toggle
   - Chat panel for viewing conversations
   - Statistics dashboard with activity graphs

## Configuration

### Environment Variables
Create `.env` file with:
```
DEEPSEEK_API_KEY=your_api_key_here
WEB_PORT=3001
```

### Key Configuration (`src/config/config.js`)
- `sessionTimeout`: 5 minutes (conversation reset timeout)
- `checkInterval`: 1 minute (cleanup check frequency)
- `maxMessages`: 10 (conversation context limit)
- API validation on startup

## Development Workflow

### Frontend Development
- React components in `src/web/react/src/components/`
- Vite dev server runs in middleware mode with Express
- Tailwind CSS with custom Navetec color scheme
- API service in `src/web/react/src/services/api.js`

### Backend Development
- Nodemon watches `index.js` and `src/**/*.js`
- Ignores logs, data, dist, and React directories
- 1-second delay before restart

### Data Persistence
- Logs stored in `logs/` directory as daily JSON files
- Human mode states in `data/human-states.json`
- WhatsApp session in `.wwebjs_auth/` directory

## Important Notes

- The bot only responds to private messages (ignores groups)
- Requires QR code scan for initial WhatsApp authentication
- Web panel accessible at http://localhost:4242 (configurable via WEB_PORT in .env)
- Vite config includes ngrok domains for development tunneling
- No test framework currently configured
- No linting or formatting tools configured

## Deployment

### Linux Server Requirements
When deploying to a Linux server, Chromium requires system dependencies. See `DEPLOYMENT.md` for detailed instructions.

Quick install:
```bash
sudo bash install-dependencies.sh
```

### Docker
A Dockerfile is recommended for production deployment. The bot automatically detects and uses system Chrome if available, otherwise falls back to bundled Chromium.