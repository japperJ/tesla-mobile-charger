/**
 * Tesla Fleet API Client
 * Auth: OAuth 2.0 + PKCE with user-registered Tesla Developer credentials
 * API:  Tesla Fleet API (fleet-api.prd.{region}.vn.cloud.tesla.com)
 *
 * Setup required: user must register an app at https://developer.tesla.com
 * and enter their client_id + client_secret in this app's Settings.
 */
const axios = require('axios');
const crypto = require('crypto');
const https = require('https');
const { getCredentials, saveTokens } = require('./credentials');

const TESLA_AUTH_URL = 'https://auth.tesla.com/oauth2/v3';
const FLEET_API = {
  eu: 'https://fleet-api.prd.eu.vn.cloud.tesla.com',
  na: 'https://fleet-api.prd.na.vn.cloud.tesla.com',
};

// Vehicle Command Proxy — signs commands with EC key before forwarding to Tesla
// VCP uses HTTPS with self-signed cert; skip verification for Docker-internal calls
const VCP_URL = process.env.VCP_URL || 'https://vcp:4040';
const vcpAgent = new https.Agent({ rejectUnauthorized: false });

// ─── Config helpers (lazy-loaded to avoid circular deps) ──────────────
function getClientConfig() {
  const { getConfigValue } = require('../db/config');
  const clientId     = getConfigValue('tesla_client_id');
  const clientSecret = getConfigValue('tesla_client_secret');
  const serverUrl    = (getConfigValue('server_url') || 'http://localhost:4001').replace(/\/$/, '');
  const region       = getConfigValue('fleet_region') || 'eu';
  return { clientId, clientSecret, serverUrl, region };
}

function getRedirectUri() {
  return `${getClientConfig().serverUrl}/api/auth/callback`;
}

function getFleetBase() {
  const { region } = getClientConfig();
  return FLEET_API[region] || FLEET_API.eu;
}

function hasClientCredentials() {
  const { clientId, clientSecret } = getClientConfig();
  return !!(clientId && clientSecret);
}

// ─── PKCE helpers ─────────────────────────────────────────────────────
function generateCodeVerifier() {
  return crypto.randomBytes(64).toString('base64url').slice(0, 128);
}

function generateCodeChallenge(verifier) {
  return crypto.createHash('sha256').update(verifier).digest('base64url');
}

// ─── Build OAuth URL (step 1 — browser navigates here) ────────────────
function buildAuthUrl(state, codeChallenge) {
  const { clientId } = getClientConfig();
  if (!clientId) throw new Error('Tesla client_id not configured. Add it in Setup.');

  const params = new URLSearchParams({
    client_id: clientId,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
    redirect_uri: getRedirectUri(),
    response_type: 'code',
    scope: 'openid email offline_access vehicle_device_data vehicle_cmds vehicle_charging_cmds',
    state,
  });
  return `${TESLA_AUTH_URL}/authorize?${params}`;
}

// ─── Exchange auth code for tokens ────────────────────────────────────
async function exchangeCodeForTokens(code, codeVerifier) {
  const { clientId, clientSecret } = getClientConfig();
  const { data } = await axios.post(`${TESLA_AUTH_URL}/token`, {
    grant_type: 'authorization_code',
    client_id: clientId,
    client_secret: clientSecret,
    code,
    code_verifier: codeVerifier,
    redirect_uri: getRedirectUri(),
  }, { headers: { 'Content-Type': 'application/json' } });
  return data; // { access_token, refresh_token, expires_in }
}

// ─── Full token setup from auth code ──────────────────────────────────
async function authenticateWithCode(code, codeVerifier) {
  const tokenData = await exchangeCodeForTokens(code, codeVerifier);

  const tokens = {
    accessToken:  tokenData.access_token,
    refreshToken: tokenData.refresh_token,
    expiresAt:    Date.now() + (tokenData.expires_in || 28800) * 1000,
  };
  saveTokens(tokens);
  return tokens;
}

// ─── Refresh using stored refresh token ───────────────────────────────
async function refreshTokens(refreshToken) {
  const { clientId, clientSecret } = getClientConfig();
  const { data } = await axios.post(`${TESLA_AUTH_URL}/token`, {
    grant_type: 'refresh_token',
    client_id: clientId,
    client_secret: clientSecret,
    refresh_token: refreshToken,
  }, { headers: { 'Content-Type': 'application/json' } });

  const tokens = {
    accessToken:  data.access_token,
    refreshToken: data.refresh_token || refreshToken,
    expiresAt:    Date.now() + (data.expires_in || 28800) * 1000,
  };
  saveTokens(tokens);
  return tokens.accessToken;
}

// ─── Get a valid access token (auto-refresh) ──────────────────────────
async function getValidToken() {
  const creds = getCredentials();
  if (!creds) throw new Error('No Tesla tokens stored. Complete OAuth setup first.');

  if (creds.accessToken && creds.tokenExpires && Date.now() < creds.tokenExpires - 300000) {
    return creds.accessToken;
  }

  if (creds.refreshToken) {
    return await refreshTokens(creds.refreshToken);
  }

  throw new Error('No valid token or refresh token. Re-authenticate via Setup.');
}

// ─── Partner token (client_credentials flow — for partner registration) ──
async function getPartnerToken() {
  const { clientId, clientSecret, region } = getClientConfig();
  if (!clientId || !clientSecret) throw new Error('Tesla client credentials not configured');
  const audience = FLEET_API[region] || FLEET_API.eu;
  const { data } = await axios.post(`${TESLA_AUTH_URL}/token`, new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: clientId,
    client_secret: clientSecret,
    scope: 'openid vehicle_device_data vehicle_cmds vehicle_charging_cmds',
    audience,
  }), { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });
  return data.access_token;
}

// ─── Fleet API helpers ────────────────────────────────────────────────
async function apiGet(path) {
  const token = await getValidToken();
  try {
    const { data } = await axios.get(`${getFleetBase()}${path}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    return data;
  } catch (err) {
    const detail = err.response?.data;
    console.error(`Fleet API GET ${path} failed [${err.response?.status}]:`, JSON.stringify(detail));
    throw err;
  }
}

async function apiPost(path, body = {}) {
  const token = await getValidToken();
  // Vehicle commands must go through VCP proxy (signs with EC key)
  const isCommand = path.includes('/command/');
  const base = isCommand ? VCP_URL : getFleetBase();
  const extra = isCommand ? { httpsAgent: vcpAgent } : {};
  try {
    const { data } = await axios.post(`${base}${path}`, body, {
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      ...extra,
    });
    return data;
  } catch (err) {
    const detail = err.response?.data;
    console.error(`Fleet API POST ${path} failed [${err.response?.status}]:`, JSON.stringify(detail));
    throw err;
  }
}

// ─── Vehicle API calls ────────────────────────────────────────────────
async function getVehicles() {
  const data = await apiGet('/api/1/vehicles');
  return data.response;
}

async function getVehicleId() {
  const vehicles = await getVehicles();
  if (!vehicles || vehicles.length === 0) throw new Error('No vehicles found');
  // VCP requires the 17-character VIN; Fleet API data endpoints accept VIN too
  return vehicles[0].vin || vehicles[0].id_s;
}

async function wakeUp(vehicleId) {
  const data = await apiPost(`/api/1/vehicles/${vehicleId}/wake_up`);
  return data.response;
}

async function waitForOnline(vehicleId, timeoutMs = 30000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const vehicles = await getVehicles();
    // Match by VIN or numeric id_s
    const vehicle = vehicles.find(v => v.vin === vehicleId || v.id_s === vehicleId);
    if (vehicle && vehicle.state === 'online') return true;
    await wakeUp(vehicleId);
    await new Promise(r => setTimeout(r, 3000));
  }
  throw new Error('Vehicle did not come online in time');
}

async function getChargeState(vehicleId) {
  const data = await apiGet(`/api/1/vehicles/${vehicleId}/vehicle_data?endpoints=charge_state`);
  return data.response?.charge_state || data.response;
}

async function getClimateState(vehicleId) {
  const data = await apiGet(`/api/1/vehicles/${vehicleId}/vehicle_data?endpoints=climate_state`);
  return data.response?.climate_state || {};
}

async function getDriveState(vehicleId) {
  const data = await apiGet(`/api/1/vehicles/${vehicleId}/vehicle_data?endpoints=drive_state`);
  return data.response?.drive_state || {};
}

async function getVehicleState(vehicleId) {
  const data = await apiGet(`/api/1/vehicles/${vehicleId}/vehicle_data?endpoints=vehicle_state`);
  return data.response?.vehicle_state || {};
}

async function startCharging(vehicleId) {
  await waitForOnline(vehicleId);
  const data = await apiPost(`/api/1/vehicles/${vehicleId}/command/charge_start`);
  return data.response;
}

async function stopCharging(vehicleId) {
  await waitForOnline(vehicleId);
  const data = await apiPost(`/api/1/vehicles/${vehicleId}/command/charge_stop`);
  return data.response;
}

async function setChargeLimit(vehicleId, percent) {
  await waitForOnline(vehicleId);
  const data = await apiPost(`/api/1/vehicles/${vehicleId}/command/set_charge_limit`, { percent });
  return data.response;
}

async function setChargingAmps(vehicleId, amps) {
  await waitForOnline(vehicleId);
  const data = await apiPost(`/api/1/vehicles/${vehicleId}/command/set_charging_amps`, { charging_amps: amps });
  return data.response;
}

async function setSentryMode(vehicleId, on) {
  await waitForOnline(vehicleId);
  const data = await apiPost(`/api/1/vehicles/${vehicleId}/command/set_sentry_mode`, { on });
  return data.response;
}

async function setSeatHeater(vehicleId, heater, level) {
  await waitForOnline(vehicleId);
  const data = await apiPost(`/api/1/vehicles/${vehicleId}/command/remote_seat_heater_request`, { seat_position: heater, level });
  return data.response;
}

async function climateStart(vehicleId, temp) {
  await waitForOnline(vehicleId);
  if (temp != null) {
    await apiPost(`/api/1/vehicles/${vehicleId}/command/set_temps`, {
      driver_temp: temp, passenger_temp: temp,
    });
  }
  const data = await apiPost(`/api/1/vehicles/${vehicleId}/command/auto_conditioning_start`);
  return data.response;
}

async function climateStop(vehicleId) {
  await waitForOnline(vehicleId);
  const data = await apiPost(`/api/1/vehicles/${vehicleId}/command/auto_conditioning_stop`);
  return data.response;
}

async function getStatus() {
  const vehicleId = await getVehicleId();
  const vehicles = await getVehicles();
  const vehicle = vehicles.find(v => v.vin === vehicleId || v.id_s === vehicleId);

  if (!vehicle || vehicle.state !== 'online') {
    return {
      vehicleId,
      state: vehicle?.state || 'unknown',
      soc: null, chargingState: null, pluggedIn: null,
    };
  }

  // Fetch charge_state (required), climate + drive + vehicle_state (best-effort)
  const [csResult, clResult, dsResult, vsResult] = await Promise.allSettled([
    getChargeState(vehicleId),
    getClimateState(vehicleId),
    getDriveState(vehicleId),
    getVehicleState(vehicleId),
  ]);

  const cs = csResult.status === 'fulfilled' ? csResult.value : {};
  const cl = clResult.status === 'fulfilled' ? clResult.value : {};
  const ds = dsResult.status === 'fulfilled' ? dsResult.value : {};
  const vs = vsResult.status === 'fulfilled' ? vsResult.value : {};

  if (csResult.status === 'rejected') {
    console.warn('[Tesla] charge_state fetch failed:', csResult.reason?.message);
  }

  return {
    vehicleId,
    state: vehicle.state,
    // Charging
    soc: cs.usable_battery_level ?? cs.battery_level ?? null,
    chargeLimit: cs.charge_limit_soc ?? null,
    chargingState: cs.charging_state ?? null,
    pluggedIn: cs.charging_state != null ? cs.charging_state !== 'Disconnected' : null,
    minutesToFull: cs.minutes_to_full_charge ?? null,
    chargeRate: cs.charge_rate ?? null,
    chargerPower: cs.charger_power ?? null,
    chargeCurrentRequest: cs.charge_current_request ?? null,
    chargeCurrentRequestMax: cs.charge_current_request_max ?? null,
    chargerActualCurrent: cs.charger_actual_current ?? null,
    // Climate
    climateOn: cl.is_climate_on ?? null,
    insideTemp: cl.inside_temp ?? null,
    outsideTemp: cl.outside_temp ?? null,
    driverTempSetting: cl.driver_temp_setting ?? null,
    seatHeatersLeft: cl.seat_heater_left ?? null,
    seatHeatersRight: cl.seat_heater_right ?? null,
    seatHeatersRearLeft: cl.seat_heater_rear_left ?? null,
    seatHeatersRearRight: cl.seat_heater_rear_right ?? null,
    // Location
    latitude: ds.latitude ?? null,
    longitude: ds.longitude ?? null,
    // Security
    sentryMode: vs.sentry_mode ?? null,
  };
}

module.exports = {
  generateCodeVerifier,
  generateCodeChallenge,
  buildAuthUrl,
  authenticateWithCode,
  hasClientCredentials,
  getValidToken,
  getPartnerToken,
  getFleetBase,
  getStatus,
  getVehicleId,
  wakeUp,
  waitForOnline,
  getChargeState,
  startCharging,
  stopCharging,
  setChargeLimit,
  setChargingAmps,
  setSentryMode,
  setSeatHeater,
  climateStart,
  climateStop,
};

