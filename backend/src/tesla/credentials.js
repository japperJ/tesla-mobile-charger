const CryptoJS = require('crypto-js');
const { getDb } = require('../db/database');

const ENCRYPTION_KEY = process.env.TESLA_ENCRYPTION_KEY || 'default-key-change-me-in-production';

function encrypt(text) {
  return CryptoJS.AES.encrypt(text, ENCRYPTION_KEY).toString();
}

function decrypt(ciphertext) {
  const bytes = CryptoJS.AES.decrypt(ciphertext, ENCRYPTION_KEY);
  return bytes.toString(CryptoJS.enc.Utf8);
}

function saveTokens({ accessToken, refreshToken, expiresAt }) {
  const db = getDb();
  // Upsert row id=1
  db.prepare(`
    INSERT INTO tesla_credentials (id, email_enc, password_enc, access_token, refresh_token, token_expires)
    VALUES (1, '', '', ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      access_token = excluded.access_token,
      refresh_token = excluded.refresh_token,
      token_expires = excluded.token_expires
  `).run(accessToken, refreshToken, expiresAt);
}

function getCredentials() {
  const db = getDb();
  const row = db.prepare('SELECT * FROM tesla_credentials WHERE id = 1').get();
  if (!row) return null;
  return {
    accessToken: row.access_token,
    refreshToken: row.refresh_token,
    tokenExpires: row.token_expires,
  };
}

function hasCredentials() {
  const db = getDb();
  const row = db.prepare('SELECT access_token FROM tesla_credentials WHERE id = 1').get();
  return !!(row && row.access_token);
}

function clearCredentials() {
  const db = getDb();
  db.prepare('DELETE FROM tesla_credentials WHERE id = 1').run();
}

module.exports = { saveTokens, getCredentials, hasCredentials, clearCredentials, encrypt, decrypt };

