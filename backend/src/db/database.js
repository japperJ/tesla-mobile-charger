const Database = require('better-sqlite3');
const path = require('path');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '../../data/charger.db');
let db;

function getDb() {
  if (!db) {
    db = new Database(DB_PATH);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
  }
  return db;
}

function initDb() {
  const db = getDb();

  db.exec(`
    CREATE TABLE IF NOT EXISTS config (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS tesla_credentials (
      id            INTEGER PRIMARY KEY CHECK (id = 1),
      email_enc     TEXT NOT NULL,
      password_enc  TEXT NOT NULL,
      access_token  TEXT,
      refresh_token TEXT,
      token_expires INTEGER
    );

    CREATE TABLE IF NOT EXISTS price_cache (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      date        TEXT NOT NULL,
      hour        INTEGER NOT NULL CHECK (hour >= 0 AND hour <= 23),
      spot_dkk    REAL NOT NULL,
      tariff_dkk  REAL NOT NULL,
      total_dkk   REAL NOT NULL,
      UNIQUE(date, hour)
    );

    CREATE TABLE IF NOT EXISTS charging_sessions (
      id             TEXT PRIMARY KEY,
      date           TEXT NOT NULL,
      planned_start  TEXT,
      planned_end    TEXT,
      actual_start   TEXT,
      actual_end     TEXT,
      start_soc      INTEGER,
      end_soc        INTEGER,
      status         TEXT NOT NULL DEFAULT 'planned',
      created_at     INTEGER NOT NULL DEFAULT (unixepoch())
    );

    CREATE TABLE IF NOT EXISTS users (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      username      TEXT NOT NULL UNIQUE COLLATE NOCASE,
      password_hash TEXT NOT NULL,
      totp_secret   TEXT,
      totp_enabled  INTEGER NOT NULL DEFAULT 0,
      created_at    TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS app_sessions (
      token      TEXT PRIMARY KEY,
      expires_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_price_cache_date ON price_cache(date);
    CREATE INDEX IF NOT EXISTS idx_sessions_date ON charging_sessions(date);
  `);

  // Default config values
  const defaults = {
    departure_time: '07:00',
    days_of_week: '62',        // Mon–Fri bitmask (0b0111110)
    target_soc: '90',
    schedule_mode: 'standard',
    per_day_schedule: JSON.stringify({
      mon: { active: true, departure: '07:00', soc: 90 },
      tue: { active: true, departure: '07:00', soc: 90 },
      wed: { active: true, departure: '07:00', soc: 90 },
      thu: { active: true, departure: '07:00', soc: 90 },
      fri: { active: true, departure: '07:00', soc: 90 },
      sat: { active: false, departure: '07:00', soc: 90 },
      sun: { active: false, departure: '07:00', soc: 90 },
    }),
    last_departure_date: '',
    last_departure_hour: '',
    charger_kw: '11',
    battery_kwh: '75',
    ntfy_topic: '',
    ntfy_server: 'https://ntfy.sh',
  };

  const upsert = db.prepare(`INSERT OR IGNORE INTO config (key, value) VALUES (?, ?)`);
  for (const [key, value] of Object.entries(defaults)) {
    upsert.run(key, value);
  }

  console.log('Database initialized:', DB_PATH);
}

module.exports = { getDb, initDb };
