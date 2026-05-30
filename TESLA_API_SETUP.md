# Tesla API Setup Guide

## Background: Why "Unofficial"?

Tesla provides two API paths:

| API | Access | Cost |
|-----|--------|------|
| **Fleet API** (official) | Requires registering at developer.tesla.com, domain verification, annual fee for commercial use | Paid |
| **Owner API** (unofficial) | Uses the same endpoints as the Tesla mobile app | Free |

This app uses the **Owner API** — the same API Tesla's own mobile app uses. It is not officially documented but is widely used by community tools (TeslaMate, TeslaFi, etc).

---

## How Authentication Works

Tesla deprecated simple username/password login in 2024. Authentication now uses **OAuth 2.0 + PKCE** (Proof Key for Code Exchange):

```
App generates PKCE challenge
       ↓
User opens Tesla login URL (auth.tesla.com)
       ↓
User logs in + completes 2FA
       ↓
Tesla redirects to: https://auth.tesla.com/void/callback?code=XXX&state=YYY
       ↓
User copies that redirect URL and pastes it into this app
       ↓
App exchanges code → SSO token → Owner API token
       ↓
Tokens stored encrypted in SQLite
       ↓
Auto-refresh handled automatically
```

**Your Tesla password is never seen or stored by this app.**

---

## Step-by-Step: First Time Setup

### 1. Start the app
```bash
docker-compose up -d
```
Open **http://localhost:4001** in your browser.

### 2. Click "Connect with Tesla"
The app generates a PKCE challenge and opens the Tesla login page in a new browser tab.

### 3. Log in on Tesla's website
- Enter your Tesla account email + password
- Complete MFA/2FA if prompted (authenticator app or SMS)

### 4. Copy the redirect URL
After a successful login, Tesla redirects your browser to a blank page that looks like:
```
https://accounts.tesla.com/oauth2/callback?code=EU_abc123...&state=xyz789&issuer=...
```
The page appears blank — **that's normal**. Copy the **entire URL** from your browser's address bar.

### 5. Paste the URL into the app
Back in the app, paste the full URL into the "Redirect URL" field and click **Complete Setup**.

The app exchanges the code for access + refresh tokens and stores them encrypted in SQLite.

---

## Token Lifecycle

| Token | Lifetime | What happens on expiry |
|-------|----------|------------------------|
| Access token | ~8 hours | Auto-refreshed using refresh token |
| Refresh token | ~45 days | You must re-authenticate via Setup page |

The app automatically refreshes the access token before API calls. If the refresh token expires (after ~45 days of inactivity), go back to the Setup page and re-authenticate.

---

## Re-authentication

If the app stops working (token expired), navigate to:
```
http://localhost:4001/setup
```
Or wipe and re-authenticate via the backend API:
```bash
# Check token status
curl http://localhost:4002/api/auth/status

# Start new OAuth flow
curl http://localhost:4002/api/auth/start
# → Returns { authUrl: "https://auth.tesla.com/..." }
# Open authUrl, log in, paste redirect URL, then:
curl -X POST http://localhost:4002/api/auth/callback \
  -H "Content-Type: application/json" \
  -d '{"code":"NA_...", "state":"..."}'
```

---

## API Endpoints Used

All calls go to `https://owner-api.teslamotors.com/api/1/`:

| Endpoint | What it does |
|----------|--------------|
| `GET /vehicles` | List your vehicles |
| `POST /vehicles/:id/wake_up` | Wake sleeping car |
| `GET /vehicles/:id/data_request/charge_state` | Battery %, charging state, plug status |
| `POST /vehicles/:id/command/charge_start` | Start charging |
| `POST /vehicles/:id/command/charge_stop` | Stop charging |
| `POST /vehicles/:id/command/set_charge_limit` | Set charge limit % |

---

## Troubleshooting

### "State mismatch" error
You waited too long (>10 min) between starting the flow and submitting the code. Click **Start Over** and complete the flow quickly.

### "Token exchange failed"
The auth code is single-use and expires in ~2 minutes. If you see this, start the flow again.

### Car shows "unknown" state
The car is sleeping. Commands will automatically wake it first (takes ~30 seconds).

### Refresh token expired
Re-authenticate from the Setup page. This happens after ~45 days without a successful API call.

### 2FA / MFA issues
The Tesla login page handles MFA natively — use your authenticator app or SMS code as normal during the Tesla login step.

---

## Privacy & Security

- **No Tesla credentials stored** — only OAuth tokens (access + refresh)
- Tokens are AES-encrypted using your `TESLA_ENCRYPTION_KEY` env var before being written to SQLite
- All API calls are made server-side from the Docker container — the mobile app never touches Tesla's API directly
- Set a strong random value for `TESLA_ENCRYPTION_KEY` in `backend/.env`

---

## Multi-Vehicle Accounts

The app currently uses the **first vehicle** in your Tesla account. If you have multiple vehicles, you can select a specific one by adding to `backend/.env`:
```
TESLA_VEHICLE_ID=your_vehicle_id_s
```
Find your vehicle ID from the backend logs on first connection, or via:
```bash
curl -H "Authorization: Bearer <token>" https://owner-api.teslamotors.com/api/1/vehicles
```
