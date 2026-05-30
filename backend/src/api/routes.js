const express = require('express');
const crypto = require('crypto');
const router = express.Router();
const { hasCredentials, saveTokens } = require('../tesla/credentials');
const {
  generateCodeVerifier, generateCodeChallenge, buildAuthUrl,
  authenticateWithCode, getStatus, startCharging, stopCharging,
  setChargeLimit, setChargingAmps, setSentryMode, setSeatHeater,
  climateStart, climateStop, getVehicleId, hasClientCredentials, wakeUp,
} = require('../tesla/client');
const { getPublicKeyPem } = require('../tesla/keys');
const { getPricesForDate, storePrices, getTodayAndTomorrow } = require('../prices/energinet');
const { calculateOptimalWindow, getTodaySchedule, getSessionHistory } = require('../charging/optimizer');
const { getConfig, updateConfig, getConfigValue } = require('../db/config');
const { notify } = require('../notifications/ntfy');
const { broadcastUpdate, setLastScheduledSoc, broadcastNow } = require('../websocket');
const {
  requireAppAuth, issueToken, revokeAllTokens, TOKEN_COOKIE,
  issueMfaToken, consumeMfaToken,
  hasAnyUser, createUser, verifyPassword, changePassword,
  generateTotpSecret, generateTotpQr, verifyTotpCode, enableTotp, disableTotp,
  getUserById,
} = require('../middleware/auth');

// In-memory PKCE state store (single-user app — one pending auth at a time)
let pendingAuth = null; // { state, codeVerifier, createdAt }

const COOKIE_OPTS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'Strict',
  maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
};

// ─── First-time account setup ─────────────────────────────────────────
// POST /api/auth/setup { username, password }
// Only works if no users exist yet.
router.post('/auth/setup', async (req, res) => {
  if (hasAnyUser()) return res.status(400).json({ error: 'Account already exists' });
  const { username, password } = req.body;
  if (!username || !password || password.length < 6) {
    return res.status(400).json({ error: 'Username and password (min 6 chars) required' });
  }
  try {
    await createUser(username.trim(), password);
    res.json({ ok: true });
  } catch (e) {
    if (e.message?.includes('UNIQUE')) return res.status(400).json({ error: 'Username already taken' });
    res.status(500).json({ error: 'Failed to create account' });
  }
});

// ─── Auth status ──────────────────────────────────────────────────────
// GET /api/auth/status  — returns setup_required, ok, or 401
router.get('/auth/status', requireAppAuth, (req, res) => {
  if (!hasAnyUser()) return res.json({ status: 'setup_required', code: 'SETUP_REQUIRED' });
  res.json({ status: 'ok' });
});

// ─── Login: step 1 — username + password ─────────────────────────────
// POST /api/auth/login  { username, password }
router.post('/auth/login', async (req, res) => {
  if (!hasAnyUser()) return res.status(400).json({ error: 'No account set up', code: 'SETUP_REQUIRED' });
  const { username, password } = req.body;
  const user = await verifyPassword(username, password);
  if (!user) {
    await new Promise(r => setTimeout(r, 500)); // slow down brute force
    return res.status(401).json({ error: 'Invalid username or password' });
  }
  if (user.totp_enabled) {
    const mfaToken = issueMfaToken(user.id);
    return res.json({ ok: true, mfaRequired: true, mfaToken });
  }
  // No MFA — issue full session
  const token = issueToken();
  res.cookie(TOKEN_COOKIE, token, COOKIE_OPTS);
  res.json({ ok: true, mfaRequired: false });
});

// ─── Login: step 2 — TOTP verification ───────────────────────────────
// POST /api/auth/mfa/verify  { mfaToken, code }
router.post('/auth/mfa/verify', (req, res) => {
  const { mfaToken, code } = req.body;
  const userId = consumeMfaToken(mfaToken);
  if (!userId) return res.status(401).json({ error: 'MFA session expired. Please log in again.' });
  const user = getUserById(userId);
  if (!user || !user.totp_secret) return res.status(401).json({ error: 'MFA not configured' });
  if (!verifyTotpCode(user.totp_secret, (code || '').replace(/\s/g, ''))) {
    return res.status(401).json({ error: 'Incorrect code. Try again.' });
  }
  const token = issueToken();
  res.cookie(TOKEN_COOKIE, token, COOKIE_OPTS);
  res.json({ ok: true });
});

// ─── App logout ───────────────────────────────────────────────────────
router.post('/auth/logout', requireAppAuth, (req, res) => {
  revokeAllTokens();
  res.clearCookie(TOKEN_COOKIE);
  res.json({ ok: true });
});

// ─── Apply app auth to ALL routes below this line ────────────────────
router.use(requireAppAuth);

// ─── TOTP setup (protected — user must be logged in) ─────────────────
// GET /api/auth/mfa/setup  → returns QR code data URL + secret
router.get('/auth/mfa/setup', async (req, res) => {
  // Single-user app: get first (only) user
  const user = getUserById(1);
  if (!user) return res.status(404).json({ error: 'User not found' });
  const { secret, otpauth } = generateTotpSecret(user.username);
  const qr = await generateTotpQr(otpauth);
  // Store pending secret in memory (confirmed when /mfa/enable is called)
  req._pendingTotpSecret = secret;
  res.json({ secret, qr });
  // Stash secret for next enable call — use in-process cache keyed by user id
  global._pendingTotp = global._pendingTotp || {};
  global._pendingTotp[user.id] = { secret, expiry: Date.now() + 10 * 60 * 1000 };
});

// POST /api/auth/mfa/enable  { code }  → verify code then save secret
router.post('/auth/mfa/enable', (req, res) => {
  const user = getUserById(1);
  if (!user) return res.status(404).json({ error: 'User not found' });
  const pending = (global._pendingTotp || {})[user.id];
  if (!pending || Date.now() > pending.expiry) {
    return res.status(400).json({ error: 'Setup session expired. Start again.' });
  }
  const code = (req.body.code || '').replace(/\s/g, '');
  if (!verifyTotpCode(pending.secret, code)) {
    return res.status(401).json({ error: 'Incorrect code. Open your authenticator app and try again.' });
  }
  enableTotp(user.id, pending.secret);
  delete global._pendingTotp[user.id];
  res.json({ ok: true });
});

// POST /api/auth/mfa/disable  { code }  → verify current code then disable
router.post('/auth/mfa/disable', (req, res) => {
  const user = getUserById(1);
  if (!user) return res.status(404).json({ error: 'User not found' });
  if (!user.totp_enabled) return res.json({ ok: true, already: true });
  const code = (req.body.code || '').replace(/\s/g, '');
  if (!verifyTotpCode(user.totp_secret, code)) {
    return res.status(401).json({ error: 'Incorrect code' });
  }
  disableTotp(user.id);
  res.json({ ok: true });
});

// POST /api/auth/change-password  { currentPassword, newPassword }
router.post('/auth/change-password', async (req, res) => {
  const user = getUserById(1);
  if (!user) return res.status(404).json({ error: 'User not found' });
  const { currentPassword, newPassword } = req.body;
  const verified = await verifyPassword(user.username, currentPassword);
  if (!verified) return res.status(401).json({ error: 'Current password is incorrect' });
  if (!newPassword || newPassword.length < 6) return res.status(400).json({ error: 'New password must be at least 6 characters' });
  await changePassword(user.id, newPassword);
  res.json({ ok: true });
});

// ─── Tesla credentials check middleware ──────────────────────────────
function requireCreds(req, res, next) {
  if (!hasCredentials()) {
    return res.status(401).json({ error: 'Tesla not authenticated. Complete setup first.' });
  }
  next();
}

// ─── Save Tesla Developer credentials ────────────────────────────────
// POST /api/auth/credentials  { clientId, clientSecret, serverUrl, region }
router.post('/auth/credentials', (req, res) => {
  const { clientId, clientSecret, serverUrl, region } = req.body;

  const updates = {};
  // _keep_ is a sentinel meaning "don't overwrite existing value"
  if (clientId && clientId !== '_keep_') updates.tesla_client_id = clientId.trim();
  if (clientSecret && clientSecret !== '_keep_') updates.tesla_client_secret = clientSecret.trim();
  if (serverUrl) updates.server_url = serverUrl.trim().replace(/\/$/, '');
  if (region) updates.fleet_region = region;

  if (!Object.keys(updates).length) {
    return res.status(400).json({ error: 'Nothing to update' });
  }

  // If setting new client credentials, both must be present
  if ((updates.tesla_client_id && !updates.tesla_client_secret) ||
      (!updates.tesla_client_id && updates.tesla_client_secret)) {
    const existing = getConfigValue(updates.tesla_client_id ? 'tesla_client_secret' : 'tesla_client_id');
    if (!existing) return res.status(400).json({ error: 'Both clientId and clientSecret are required' });
  }

  updateConfig(updates);
  res.json({ ok: true });
});

// ─── Step 1: Redirect browser to Tesla login ─────────────────────────
// GET /api/auth/start  →  302 to auth.tesla.com
router.get('/auth/start', (req, res) => {
  try {
    const codeVerifier = generateCodeVerifier();
    const codeChallenge = generateCodeChallenge(codeVerifier);
    const state = crypto.randomBytes(32).toString('base64url');

    pendingAuth = { state, codeVerifier, createdAt: Date.now() };

    const authUrl = buildAuthUrl(state, codeChallenge);
    res.redirect(authUrl);
  } catch (err) {
    res.redirect(`/setup?error=${encodeURIComponent(err.message)}`);
  }
});

// ─── Step 2: Tesla redirects browser here with ?code= ────────────────
// GET /api/auth/callback?code=...&state=...
router.get('/auth/callback', async (req, res) => {
  const { code, state, error } = req.query;

  if (error) {
    return res.redirect(`/setup?error=${encodeURIComponent(error)}`);
  }

  if (!code) {
    return res.redirect('/setup?error=No+authorization+code+received');
  }

  if (!pendingAuth) {
    return res.redirect('/setup?error=No+pending+auth+session.+Please+try+again.');
  }

  if (Date.now() - pendingAuth.createdAt > 10 * 60 * 1000) {
    pendingAuth = null;
    return res.redirect('/setup?error=Auth+session+expired.+Please+try+again.');
  }

  if (state && pendingAuth.state && state !== pendingAuth.state) {
    pendingAuth = null;
    return res.redirect('/setup?error=State+mismatch.+Please+try+again.');
  }

  const { codeVerifier } = pendingAuth;
  pendingAuth = null;

  try {
    await authenticateWithCode(code, codeVerifier);
    res.redirect('/dashboard');
  } catch (err) {
    const msg = encodeURIComponent('Token exchange failed: ' + err.message);
    res.redirect(`/setup?error=${msg}`);
  }
});

// ─── Auth status ──────────────────────────────────────────────────────
router.get('/auth/status', (req, res) => {
  const serverUrl = getConfigValue('server_url') || 'http://localhost:4001';
  res.json({
    configured: hasCredentials(),
    hasClientCreds: hasClientCredentials(),
    serverUrl,
    region: getConfigValue('fleet_region') || 'eu',
    redirectUri: `${serverUrl}/api/auth/callback`,
  });
});

// ─── Clear Tesla auth (re-setup) — already protected by requireAppAuth above
router.post('/auth/logout', (req, res) => {
  const { clearCredentials } = require('../tesla/credentials');
  clearCredentials();
  res.json({ ok: true });
});

// ─── Tesla partner registration (one-time per domain) ─────────────────
// POST /api/auth/register  — calls Tesla Fleet API to register this app
router.post('/auth/register', async (req, res) => {
  if (!hasCredentials()) {
    return res.status(401).json({ error: 'Must be authenticated first' });
  }
  const { getPartnerToken, getFleetBase } = require('../tesla/client');
  const axios = require('axios');
  const domain = (getConfigValue('server_url') || '').replace(/^https?:\/\//, '').replace(/\/.*$/, '');
  if (!domain) {
    return res.status(400).json({ error: 'server_url not configured' });
  }
  try {
    const token = await getPartnerToken();
    const { data } = await axios.post(
      `${getFleetBase()}/api/1/partner_accounts`,
      { domain },
      { headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } }
    );
    updateConfig({ partner_registered: '1' });
    res.json({ ok: true, response: data });
  } catch (err) {
    const detail = err.response?.data || err.message;
    res.status(err.response?.status || 500).json({ error: detail });
  }
});

router.get('/auth/partner-status', (req, res) => {
  res.json({ registered: getConfigValue('partner_registered') === '1' });
});

// ─── Vehicle Status ────────────────────────────────────────────────────
router.get('/status', requireCreds, async (req, res) => {
  try {
    const status = await getStatus();
    res.json(status);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Prices ────────────────────────────────────────────────────────────
router.get('/prices', async (req, res) => {
  const { today, tomorrow } = getTodayAndTomorrow();
  let todayPrices = getPricesForDate(today);
  let tomorrowPrices = getPricesForDate(tomorrow);

  if (!todayPrices.length) {
    await storePrices(today).catch(console.error);
    todayPrices = getPricesForDate(today);
  }

  res.json({ today: todayPrices, tomorrow: tomorrowPrices, dates: { today, tomorrow } });
});

router.post('/prices/refresh', async (req, res) => {
  const { today, tomorrow } = getTodayAndTomorrow();
  try {
    await Promise.all([storePrices(today), storePrices(tomorrow)]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Schedule ───────────────────────────────────────────────────────────
router.get('/schedule', (req, res) => {
  res.json(getTodaySchedule());
});

router.post('/schedule/recalculate', requireCreds, async (req, res) => {
  try {
    const status = await getStatus().catch(() => ({ soc: null }));
    const { today } = getTodayAndTomorrow();
    const result = await calculateOptimalWindow(today, status.soc);
    if (status.soc != null) setLastScheduledSoc(status.soc);
    const departureInfo = result?.departureInfo ?? null;
    broadcastUpdate('schedule', { sessions: getTodaySchedule(), departureInfo });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Config ─────────────────────────────────────────────────────────────
router.get('/config', (req, res) => res.json(getConfig()));

router.post('/config', (req, res) => {
  const allowed = [
    'departure_time', 'days_of_week', 'target_soc', 'charger_kw', 'battery_kwh',
    'schedule_mode', 'per_day_schedule',
    'ntfy_topic', 'ntfy_server',
    'preheat_enabled', 'preheat_offset_min', 'preheat_temp_c',
    'home_lat', 'home_lng',
  ];
  const updates = {};
  for (const key of allowed) {
    if (req.body[key] !== undefined) updates[key] = req.body[key];
  }
  updateConfig(updates);
  res.json({ ok: true, updated: updates });

  // Auto-recalculate schedule in background after config change
  setImmediate(async () => {
    try {
      const { today } = getTodayAndTomorrow();
      const status = await getStatus().catch(() => ({ soc: null }));
      const result = await calculateOptimalWindow(today, status.soc);
      broadcastUpdate('schedule', { sessions: getTodaySchedule(), departureInfo: result?.departureInfo ?? null });
    } catch (err) {
      console.warn('[Schedule] Auto-recalculate after config save failed:', err.message);
    }
  });
});

// ─── Charge Control ─────────────────────────────────────────────────────
router.post('/charge/start', requireCreds, async (req, res) => {
  try {
    const vehicleId = await getVehicleId();
    const result = await startCharging(vehicleId);
    broadcastUpdate('charge_command', { command: 'start', result });
    notify('Charging Started', 'Manual override: charging started', 'default', ['electric_plug']);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/charge/stop', requireCreds, async (req, res) => {
  try {
    const vehicleId = await getVehicleId();
    const result = await stopCharging(vehicleId);
    broadcastUpdate('charge_command', { command: 'stop', result });
    notify('Charging Stopped', 'Manual override: charging stopped', 'default', ['no_entry_sign']);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/charge/limit', requireCreds, async (req, res) => {
  const { percent } = req.body;
  if (!percent || percent < 50 || percent > 100) return res.status(400).json({ error: 'percent must be 50–100' });
  try {
    const vehicleId = await getVehicleId();
    const result = await setChargeLimit(vehicleId, percent);
    broadcastUpdate('charge_limit', { limit: percent });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/charge/amps', requireCreds, async (req, res) => {
  const { amps } = req.body;
  if (amps == null || amps < 0 || amps > 48) return res.status(400).json({ error: 'amps must be 0–48' });
  try {
    const vehicleId = await getVehicleId();
    const result = await setChargingAmps(vehicleId, Math.round(amps));
    broadcastUpdate('charge_amps', { amps });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Sentry Mode ────────────────────────────────────────────────────────
router.post('/sentry', requireCreds, async (req, res) => {
  const { on } = req.body;
  if (typeof on !== 'boolean') return res.status(400).json({ error: '"on" must be boolean' });
  try {
    const vehicleId = await getVehicleId();
    const result = await setSentryMode(vehicleId, on);
    broadcastUpdate('sentry_mode', { on });
    notify(on ? 'Sentry Mode On 🛡️' : 'Sentry Mode Off', on ? 'Sentry mode enabled' : 'Sentry mode disabled', 'default', [on ? 'shield' : 'shield_with_x']);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Seat Heaters ───────────────────────────────────────────────────────
router.post('/seat-heater', requireCreds, async (req, res) => {
  const { heater, level } = req.body;
  if (heater == null || heater < 0 || heater > 6) return res.status(400).json({ error: 'heater must be 0–6' });
  if (level == null || level < 0 || level > 3) return res.status(400).json({ error: 'level must be 0–3' });
  try {
    const vehicleId = await getVehicleId();
    const result = await setSeatHeater(vehicleId, heater, level);
    broadcastUpdate('seat_heater', { heater, level });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Climate Control ────────────────────────────────────────────────────
router.post('/climate/start', requireCreds, async (req, res) => {
  const { temp } = req.body;
  try {
    const vehicleId = await getVehicleId();
    const result = await climateStart(vehicleId, temp ?? null);
    broadcastUpdate('climate_command', { command: 'start', temp });
    notify('Climate Started 🌡️', `Pre-heating${temp ? ` to ${temp}°C` : ''}`, 'default', ['thermometer']);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/climate/stop', requireCreds, async (req, res) => {
  try {
    const vehicleId = await getVehicleId();
    const result = await climateStop(vehicleId);
    broadcastUpdate('climate_command', { command: 'stop' });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Session History ────────────────────────────────────────────────────
router.get('/history', (req, res) => {
  res.json(getSessionHistory(parseInt(req.query.limit) || 50));
});

// ─── Test notification ─────────────────────────────────────────────────
router.post('/notify/test', async (req, res) => {
  await notify('Test Notification', 'Tesla Charger Scheduler is working!', 'default', ['white_check_mark']);
  res.json({ ok: true });
});

// ─── Wake Car ────────────────────────────────────────────────────────
router.post('/wake', requireCreds, async (req, res) => {
  try {
    const vehicleId = await getVehicleId();
    const result = await wakeUp(vehicleId);
    res.json(result);
    // Immediately push fresh status to all WS clients after wake
    broadcastNow().catch(() => {});
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
