const { getDb } = require('../db/database');

function getConfig() {
  const db = getDb();
  const rows = db.prepare('SELECT key, value FROM config').all();
  return Object.fromEntries(rows.map(r => [r.key, r.value]));
}

function getConfigValue(key) {
  const db = getDb();
  const row = db.prepare('SELECT value FROM config WHERE key = ?').get(key);
  return row ? row.value : null;
}

function setConfigValue(key, value) {
  const db = getDb();
  db.prepare('INSERT OR REPLACE INTO config (key, value) VALUES (?, ?)').run(key, String(value));
}

function updateConfig(updates) {
  const db = getDb();
  const stmt = db.prepare('INSERT OR REPLACE INTO config (key, value) VALUES (?, ?)');
  const updateMany = db.transaction((kvs) => {
    for (const [key, value] of Object.entries(kvs)) {
      stmt.run(key, String(value));
    }
  });
  updateMany(updates);
}

module.exports = { getConfig, getConfigValue, setConfigValue, updateConfig };
