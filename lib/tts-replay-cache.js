/**
 * FIFO ring buffer for TTS replay (audio files + browser text entries).
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const userStore = require('./user-store');

const DATA_DIR = userStore.dataDir;
const REPLAY_DIR = path.join(DATA_DIR, 'tts-replay');
const DB_PATH = userStore.dbPath;

const DEFAULT_MAX_SLOTS = 5;
const MIN_SLOTS = 1;
const MAX_SLOTS = 20;

let db;

function getDb() {
  if (db) return db;
  fs.mkdirSync(REPLAY_DIR, { recursive: true });
  // eslint-disable-next-line global-require
  const Database = require('better-sqlite3');
  db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');
  db.exec(`
    CREATE TABLE IF NOT EXISTS tts_replay (
      id TEXT PRIMARY KEY,
      created_at TEXT NOT NULL,
      provider TEXT NOT NULL,
      content_type TEXT,
      file_name TEXT,
      text TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_tts_replay_created ON tts_replay(created_at);
  `);
  return db;
}

function clampSlots(n) {
  const parsed = parseInt(String(n), 10);
  if (!Number.isFinite(parsed)) return DEFAULT_MAX_SLOTS;
  return Math.min(MAX_SLOTS, Math.max(MIN_SLOTS, parsed));
}

function getMaxSlots() {
  const raw = userStore.get('aether_tts_replay_cache_size');
  return clampSlots(raw || DEFAULT_MAX_SLOTS);
}

function extensionForContentType(contentType) {
  const ct = (contentType || '').toLowerCase();
  if (ct.includes('wav')) return '.wav';
  if (ct.includes('ogg')) return '.ogg';
  if (ct.includes('mpeg') || ct.includes('mp3')) return '.mp3';
  return '.bin';
}

function deleteEntryFiles(entry) {
  if (!entry?.file_name) return;
  const filePath = path.join(REPLAY_DIR, entry.file_name);
  try {
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  } catch (e) {
    console.warn('[tts-replay] Failed to delete file:', filePath, e.message);
  }
}

function deleteEntry(id) {
  const row = getDb().prepare('SELECT * FROM tts_replay WHERE id = ?').get(id);
  if (!row) return false;
  getDb().prepare('DELETE FROM tts_replay WHERE id = ?').run(id);
  deleteEntryFiles(row);
  return true;
}

function evictOldest(maxSlots) {
  const limit = maxSlots ?? getMaxSlots();
  while (true) {
    const countRow = getDb().prepare('SELECT COUNT(*) AS n FROM tts_replay').get();
    if (countRow.n <= limit) break;
    const oldest = getDb()
      .prepare('SELECT id FROM tts_replay ORDER BY created_at ASC LIMIT 1')
      .get();
    if (!oldest) break;
    deleteEntry(oldest.id);
  }
}

function rowToEntry(row) {
  if (!row) return null;
  return {
    id: row.id,
    provider: row.provider,
    contentType: row.content_type || null,
    fileName: row.file_name || null,
    text: row.text || null,
    createdAt: row.created_at,
    hasAudio: Boolean(row.file_name),
    filePath: row.file_name ? path.join(REPLAY_DIR, row.file_name) : null,
  };
}

function addEntry({ provider, buffer, contentType, text }) {
  getDb();
  const id = crypto.randomUUID();
  const createdAt = new Date().toISOString();
  let fileName = null;

  if (buffer && Buffer.isBuffer(buffer) && buffer.length > 0) {
    const ext = extensionForContentType(contentType);
    fileName = `${id}${ext}`;
    fs.writeFileSync(path.join(REPLAY_DIR, fileName), buffer);
  }

  const textStored = text ? String(text).trim().slice(0, 15000) : null;

  getDb()
    .prepare(
      `INSERT INTO tts_replay (id, created_at, provider, content_type, file_name, text)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    .run(id, createdAt, provider || 'unknown', contentType || null, fileName, textStored);

  evictOldest(getMaxSlots());

  return { id, createdAt, provider, hasAudio: Boolean(fileName) };
}

function getEntry(id) {
  const row = getDb().prepare('SELECT * FROM tts_replay WHERE id = ?').get(id);
  return rowToEntry(row);
}

function readEntryBuffer(id) {
  const entry = getEntry(id);
  if (!entry?.filePath || !fs.existsSync(entry.filePath)) return null;
  return {
    entry,
    buffer: fs.readFileSync(entry.filePath),
    contentType: entry.contentType || 'application/octet-stream',
  };
}

function listStatus() {
  const maxSlots = getMaxSlots();
  const rows = getDb()
    .prepare('SELECT id, created_at, provider, file_name FROM tts_replay ORDER BY created_at DESC')
    .all();
  return {
    maxSlots,
    count: rows.length,
    entries: rows.map((r) => ({
      id: r.id,
      provider: r.provider,
      createdAt: r.created_at,
      hasAudio: Boolean(r.file_name),
    })),
  };
}

module.exports = {
  addEntry,
  getEntry,
  readEntryBuffer,
  deleteEntry,
  listStatus,
  getMaxSlots,
  REPLAY_DIR,
};
