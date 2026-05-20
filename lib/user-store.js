/**
 * Tiny SQLite key-value store for HUD settings and local user data.
 */
const fs = require('fs');
const path = require('path');

const DATA_DIR = process.env.AETHER_DATA_DIR || path.join(__dirname, '..', 'data');
const DB_PATH = path.join(DATA_DIR, 'aether.db');

let db;

function getDb() {
  if (db) return db;
  fs.mkdirSync(DATA_DIR, { recursive: true });
  // eslint-disable-next-line global-require
  const Database = require('better-sqlite3');
  db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');
  db.exec(`
    CREATE TABLE IF NOT EXISTS user_data (
      key TEXT PRIMARY KEY NOT NULL,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
  return db;
}

function getAll() {
  const rows = getDb().prepare('SELECT key, value FROM user_data ORDER BY key').all();
  const data = {};
  for (const row of rows) {
    data[row.key] = row.value;
  }
  return data;
}

function get(key) {
  const row = getDb().prepare('SELECT value FROM user_data WHERE key = ?').get(key);
  return row ? row.value : null;
}

function setMany(entries) {
  if (!entries || typeof entries !== 'object') return 0;
  const stmt = getDb().prepare(`
    INSERT INTO user_data (key, value, updated_at)
    VALUES (@key, @value, datetime('now'))
    ON CONFLICT(key) DO UPDATE SET
      value = excluded.value,
      updated_at = datetime('now')
  `);
  let count = 0;
  const tx = getDb().transaction((items) => {
    for (const [key, value] of Object.entries(items)) {
      if (typeof key !== 'string' || !key.startsWith('aether_')) continue;
      if (value === undefined || value === null) continue;
      const stored = typeof value === 'string' ? value : JSON.stringify(value);
      stmt.run({ key, value: stored });
      count += 1;
    }
  });
  tx(entries);
  return count;
}

function deleteKeys(keys) {
  if (!Array.isArray(keys) || !keys.length) return 0;
  const stmt = getDb().prepare('DELETE FROM user_data WHERE key = ?');
  let count = 0;
  const tx = getDb().transaction((list) => {
    for (const key of list) {
      if (typeof key !== 'string' || !key.startsWith('aether_')) continue;
      count += stmt.run(key).changes;
    }
  });
  tx(keys);
  return count;
}

module.exports = {
  getAll,
  get,
  setMany,
  deleteKeys,
  dbPath: DB_PATH,
  dataDir: DATA_DIR,
};
