const crypto = require('crypto');

const APP_SECRET = process.env.API_SECRET;
const TOKEN_COOKIE = 'app_token';

// Warn loudly on startup if no secret is set
if (!APP_SECRET) {
  console.warn('⚠️  WARNING: API_SECRET is not set. App authentication is DISABLED. Set API_SECRET in backend/.env before exposing this app to the internet.');
}

// ─── Token store (in-memory, single-user app) ────────────────────────────────
// Maps token → expiry timestamp. Tokens are 256-bit random hex strings.
const validTokens = new Map();
const TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

function issueToken() {
  const token = crypto.randomBytes(32).toString('hex');
  validTokens.set(token, Date.now() + TOKEN_TTL_MS);
  return token;
}

function isValidToken(token) {
  if (!token) return false;
  const expiry = validTokens.get(token);
  if (!expiry) return false;
  if (Date.now() > expiry) {
    validTokens.delete(token);
    return false;
  }
  return true;
}

function revokeAllTokens() {
  validTokens.clear();
}

// ─── Express middleware ───────────────────────────────────────────────────────
// If API_SECRET is not configured, skip auth (dev/local mode).
function requireAppAuth(req, res, next) {
  if (!APP_SECRET) return next(); // dev mode — no secret set

  // Accept token from cookie OR Authorization header (Bearer token)
  const cookieToken = req.cookies?.[TOKEN_COOKIE];
  const headerToken = (req.headers['authorization'] || '').replace(/^Bearer\s+/i, '');
  const token = cookieToken || headerToken;

  if (!isValidToken(token)) {
    return res.status(401).json({ error: 'Unauthorized', code: 'APP_AUTH_REQUIRED' });
  }
  next();
}

// ─── WebSocket token validator ────────────────────────────────────────────────
function isValidWsToken(token) {
  if (!APP_SECRET) return true; // dev mode
  return isValidToken(token);
}

module.exports = { requireAppAuth, issueToken, revokeAllTokens, isValidWsToken, TOKEN_COOKIE, APP_SECRET };
