# Wacom - Treasury Signature Capture Server

Centralized signing server for Business Central treasury transactions. Railway-hosted, station-routed Wacom capture.

## Features
- **Station-scoped** kiosk (`/s/<STATION>`) + monitor (`/m/<STATION>`) with login
- Dispatch polling from Business Central `signpadDispatches` API
- Live signature streaming via SSE (`/api/session/events`)
- BC OAuth2 client_credentials + token caching

## Quick Start (local)

```bash
cp config.example.json config.json   # fill CLIENT_ID / CLIENT_SECRET
npm start
# open http://localhost:3000/login
```

Or with env vars (Railway):

```
TENANT_ID, ENVIRONMENT, COMPANY, COMPANY_GUID, CLIENT_ID, CLIENT_SECRET
APP_USERS="alice:pass123|CON001,bob:pass456|CON002"
PORT=3000
```

## Routes
- `GET /login` - login page
- `GET /s/:station` - Wacom signpad (requires station match)
- `GET /m/:station` - monitoring view with live strokes
- `POST /api/login` / `POST /api/logout`
- `POST /api/session` / `GET /api/session/current` / `DELETE /api/session`

## Deploy to Railway
Connect repo, set env vars above. `config.json` is gitignored - never commit secrets.
