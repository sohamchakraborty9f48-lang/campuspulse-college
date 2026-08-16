# CampusPulse — College-wide edition

## Run locally
1. Install Node.js 18+.
2. Open a terminal in this folder.
3. Run:
   npm install
   npm start
4. Open http://localhost:3000

## Deploy
Deploy this folder to any Node.js host that supports long-lived WebSocket connections.
Set the `PORT` environment variable if your host provides one.

## Architecture
- Frontend: HTML/CSS/JavaScript + Tailwind CDN
- Real-time: Node.js + `ws` WebSockets
- No Firebase / Firestore / Realtime Database
- Public chat, private 1-to-1 chat, anonymous whispers, polls, block and report
- This demo stores messages/reports in server memory; restarting the server clears them.
