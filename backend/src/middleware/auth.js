const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { generateSecret, generateURI, verify: verifyOtp } = require('otplib');
const QRCode = require('qrcode');
const { getDb } = require('../db/database');

const TOKEN_COOKIE = 'app_token';
const APP_NAME = 'Tesla Charger';

// ─── Session token store (SQLite — survives restarts) ───────────────────────
const TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

// Temporary MFA tokens (issued after password OK, before TOTP verified)
const pendingMfaTokens = new Map();
const MFA_TOKEN_TTL_MS = 5 * 60 * 1000; // 5 minutes

function issueToken() {
  const token = crypto.randomBytes(32).toString('hex');
  const expiresAt = Date.now() + TOKEN_TTL_MS;
  getDb().prepare('INSERT INTO app_sessions (token, expires_at) VALUES (?, ?)').run(token, expiresAt);
  return token;
}

function isValidToken(token) {
  if (!token) return false;
  const row = getDb().prepare('SELECT expires_at FROM app_sessions WHERE token = ?').get(token);
  if (!row) return false;
  if (Date.now() > row.expires_at) {
    getDb().prepare('DELETE FROM app_sessions WHERE token = ?').run(token);
    return false;
  }
  return true;
}

function revokeAllTokens() {
  getDb().prepare('DELETE FROM app_sessions').run();
}

function issueMfaToken(userId) {
  const token = crypto.randomBytes(16).toString('hex');
  pendingMfaTokens.set(token, { userId, expiry: Date.now() + MFA_TOKEN_TTL_MS });
  return token;
}

function consumeMfaToken(token) {
  const entry = pendingMfaTokens.get(token);
  if (!entry) return null;
  pendingMfaTokens.delete(token);
  if (Date.now() > entry.expiry) return null;
  return entry.userId;
}

// ─── User helpers ────────────────────────────────────────────────────────────
function hasAnyUser() {
  return !!getDb().prepare('SELECT 1 FROM users LIMIT 1').get();
}

function getUserByUsername(username) {
  return getDb().prepare('SELECT * FROM users WHERE username = ?').get(username);
}

function getUserById(id) {
  return getDb().prepare('SELECT * FROM users WHERE id = ?').get(id);
}

async function createUser(username, password) {
  const hash = await bcrypt.hash(password, 12);
  const info = getDb()
    .prepare('INSERT INTO users (username, password_hash) VALUES (?, ?)')
    .run(username, hash);
  return info.lastInsertRowid;
}

async function verifyPassword(username, password) {
  const user = getUserByUsername(username);
  if (!user) return null;
  const ok = await bcrypt.compare(password, user.password_hash);
  return ok ? user : null;
}

async function changePassword(userId, newPassword) {
  const hash = await bcrypt.hash(newPassword, 12);
  getDb().prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hash, userId);
}

// ─── TOTP helpers ─────────────────────────────────────────────────────────────
function generateTotpSecret(username) {
  const secret = generateSecret();
  const otpauth = generateURI({ strategy: 'totp', issuer: APP_NAME, label: username, secret });
  return { secret, otpauth };
}

async function generateTotpQr(otpauth) {
  return QRCode.toDataURL(otpauth);
}

function verifyTotpCode(secret, code) {
  return verifyOtp({ token: code, secret });
}

function enableTotp(userId, secret) {
  getDb()
    .prepare('UPDATE users SET totp_secret = ?, totp_enabled = 1 WHERE id = ?')
    .run(secret, userId);
}

function disableTotp(userId) {
  getDb()
    .prepare('UPDATE users SET totp_secret = NULL, totp_enabled = 0 WHERE id = ?')
    .run(userId);
}

// ─── Express middleware ───────────────────────────────────────────────────────
function requireAppAuth(req, res, next) {
  // If no users are set up yet, pass through so /api/auth/setup can be reached
  if (!hasAnyUser()) return next();

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
  if (!hasAnyUser()) return true; // no users configured → open
  return isValidToken(token);
}

module.exports = {
  TOKEN_COOKIE,
  requireAppAuth,
  issueToken,
  revokeAllTokens,
  issueMfaToken,
  consumeMfaToken,
  hasAnyUser,
  getUserByUsername,
  getUserById,
  createUser,
  verifyPassword,
  changePassword,
  generateTotpSecret,
  generateTotpQr,
  verifyTotpCode,
  enableTotp,
  disableTotp,
  isValidWsToken,
};
