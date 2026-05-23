/**
 * Aether Vault — SQLite index of files Hermes creates during sessions.
 *
 * IMPORTANT: Vault stores metadata only. Previews read directly from the
 * original paths on disk. Hermes is never modified.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const userStore = require('./user-store.js');
const { resolveAbsolutePath, readWorkspaceFile, writeWorkspaceFile, mimeFromExt } = require('./workspace-sandbox.js');
const { getHermesHome } = require('./hermes-workspaces.js');

const DB_PATH = userStore.dbPath;
const MAX_HASH_BYTES = 10 * 1024 * 1024;
const MAX_SESSIONS_SCAN = 150;

const WRITE_TOOLS = new Set(['write_file', 'patch', 'code', 'execute_code', 'kanban_complete']);
const CODE_WRITE_PATH_RE = /write_file\(\s*(?:path\s*=\s*)?["']([^"']+)["']/g;
const CODE_WRITE_PATH_POS_RE = /write_file\(\s*["']([^"']+)["']/g;

const HERMES_INTERNAL_BASENAMES = new Set([
  '.env', '.hermes_history', '.install_method', '.skills_prompt_snapshot.json',
  '.update_check', 'auth.json', 'auth.lock', 'config.yaml', 'kanban.db', 'state.db',
  'SOUL.md', 'channel_directory.json',
]);

const VAULT_NOTE = 'Aether Vault indexes files Hermes creates. Previews read from the original paths on disk.';

let db;

function getDb() {
  if (db) return db;
  // eslint-disable-next-line global-require
  const Database = require('better-sqlite3');
  db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');
  db.exec(`
    CREATE TABLE IF NOT EXISTS aether_vault (
      id TEXT PRIMARY KEY NOT NULL,
      session_id TEXT,
      title TEXT NOT NULL,
      original_path TEXT NOT NULL UNIQUE,
      vault_rel_path TEXT NOT NULL DEFAULT '',
      size_bytes INTEGER,
      sha256 TEXT,
      source TEXT,
      tool_name TEXT,
      original_mtime REAL,
      original_exists INTEGER NOT NULL DEFAULT 1,
      ingested_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_aether_vault_ingested ON aether_vault(ingested_at DESC);
    CREATE INDEX IF NOT EXISTS idx_aether_vault_session ON aether_vault(session_id);
  `);
  return db;
}

function displayRelativePath(absPath) {
  const home = process.env.HOME || '';
  if (home && absPath.startsWith(home + path.sep)) {
    return `~${absPath.slice(home.length)}`;
  }
  return absPath;
}

function normalizeIndexedPath(raw) {
  if (!raw || typeof raw !== 'string') return null;
  let value = raw.trim();
  if (!value || value.includes('*') || value.includes('\n')) return null;
  if (value.startsWith('file://')) value = value.slice(7);
  const abs = resolveAbsolutePath(value);
  if (!abs || abs === '/') return null;
  return abs;
}

function isVaultExcludedFile(absPath) {
  if (isHermesInternalFile(absPath)) return true;
  const base = path.basename(absPath);
  if (base === '.env' || base.startsWith('.env.')) return true;
  if (base.endsWith('.pem') || base.endsWith('.key')) return true;
  return false;
}

function isHermesInternalFile(absPath) {
  const base = path.basename(absPath);
  if (HERMES_INTERNAL_BASENAMES.has(base)) return true;
  if (absPath.includes(`${path.sep}node_modules${path.sep}`)) return true;
  const hermesHome = getHermesHome();
  const relToHermes = path.relative(hermesHome, absPath);
  const insideHermes = relToHermes && !relToHermes.startsWith('..') && !path.isAbsolute(relToHermes);
  if (!insideHermes) return false;
  if (base.startsWith('.') && base !== '.hermes') return true;
  const rel = relToHermes.split(path.sep).join('/');
  if (rel.startsWith('cache/') || rel.startsWith('logs/') || rel.startsWith('bin/')) return true;
  if (rel.startsWith('hermes-agent/') || rel.startsWith('checkpoints/') || rel.startsWith('sessions/')) return true;
  return false;
}

function extractPathsFromToolCall(name, argsRaw) {
  if (!argsRaw) return [];
  let args;
  try {
    args = typeof argsRaw === 'string' ? JSON.parse(argsRaw) : argsRaw;
  } catch {
    return [];
  }
  if (!args || typeof args !== 'object') return [];

  const paths = [];
  if (args.path && (name === 'write_file' || name === 'patch')) paths.push(args.path);
  if (name === 'skill_manage' && args.action === 'write_file' && args.file_path) paths.push(args.file_path);
  if (name === 'kanban_complete') {
    if (Array.isArray(args.artifacts)) paths.push(...args.artifacts);
    if (Array.isArray(args.changed_files)) paths.push(...args.changed_files);
    if (args.metadata?.changed_files) paths.push(...args.metadata.changed_files);
  }
  if (name === 'code' || name === 'execute_code') {
    const source = typeof args.code === 'string' ? args.code : '';
    for (const match of source.matchAll(CODE_WRITE_PATH_RE)) {
      if (match[1]) paths.push(match[1]);
    }
    for (const match of source.matchAll(CODE_WRITE_PATH_POS_RE)) {
      if (match[1]) paths.push(match[1]);
    }
  }
  return paths;
}

function collectStateDbWrites() {
  const dbPath = path.join(getHermesHome(), 'state.db');
  if (!fs.existsSync(dbPath)) return [];

  let dbConn;
  try {
    // eslint-disable-next-line global-require
    const Database = require('better-sqlite3');
    dbConn = new Database(dbPath, { readonly: true, fileMustExist: true });
  } catch {
    return [];
  }

  const writes = [];
  try {
    const rows = dbConn.prepare(`
      SELECT session_id, tool_calls FROM messages
      WHERE tool_calls IS NOT NULL AND tool_calls != '' AND tool_calls != '[]'
      ORDER BY timestamp DESC
      LIMIT 800
    `).all();
    for (const row of rows) {
      let calls;
      try {
        calls = JSON.parse(row.tool_calls);
      } catch {
        continue;
      }
      if (!Array.isArray(calls)) continue;
      const sessionId = row.session_id || '';
      for (const call of calls) {
        const fn = call?.function || call;
        const toolName = fn?.name || '';
        if (!WRITE_TOOLS.has(toolName)) continue;
        for (const rawPath of extractPathsFromToolCall(toolName, fn?.arguments)) {
          const abs = normalizeIndexedPath(rawPath);
          if (!abs || isVaultExcludedFile(abs)) continue;
          writes.push({ sessionId, absPath: abs, toolName, source: 'state-db' });
        }
      }
    }
  } catch {
    /* state.db optional */
  } finally {
    try {
      dbConn?.close();
    } catch {
      /* ignore */
    }
  }
  return writes;
}

function collectSessionWrites() {
  const sessionsDir = path.join(getHermesHome(), 'sessions');
  const writes = [];
  if (!fs.existsSync(sessionsDir)) return writes;

  let names;
  try {
    names = fs.readdirSync(sessionsDir).filter((n) => n.endsWith('.json')).sort().reverse();
  } catch {
    return writes;
  }

  const seen = new Set();
  for (const name of names.slice(0, MAX_SESSIONS_SCAN)) {
    const full = path.join(sessionsDir, name);
    let session;
    try {
      session = JSON.parse(fs.readFileSync(full, 'utf8'));
    } catch {
      continue;
    }
    const sessionId = session.session_id || name.replace(/\.json$/, '').replace(/^session_/, '');
    for (const message of session.messages || []) {
      for (const call of message?.tool_calls || []) {
        const fn = call?.function || call;
        const toolName = fn?.name || '';
        if (!WRITE_TOOLS.has(toolName)) continue;
        for (const rawPath of extractPathsFromToolCall(toolName, fn?.arguments)) {
          const abs = normalizeIndexedPath(rawPath);
          if (!abs || isVaultExcludedFile(abs)) continue;
          const key = `${sessionId}:${abs}`;
          if (seen.has(key)) continue;
          seen.add(key);
          writes.push({ sessionId, absPath: abs, toolName, source: 'session' });
        }
      }
    }
  }
  return writes;
}

function collectAllWrites() {
  const seen = new Set();
  const merged = [];
  const pushWrite = (write) => {
    const key = `${write.sessionId}:${write.absPath}`;
    if (seen.has(key)) return;
    seen.add(key);
    merged.push(write);
  };
  for (const write of collectStateDbWrites()) pushWrite(write);
  for (const write of collectSessionWrites()) pushWrite(write);
  return merged;
}

function sha256File(absPath) {
  const hash = crypto.createHash('sha256');
  hash.update(fs.readFileSync(absPath));
  return hash.digest('hex');
}

function rowToEntry(row) {
  if (!row) return null;
  return {
    id: row.id,
    sessionId: row.session_id,
    title: row.title,
    originalPath: row.original_path,
    originalDisplayPath: displayRelativePath(row.original_path),
    size: row.size_bytes,
    sha256: row.sha256,
    source: row.source,
    toolName: row.tool_name,
    originalMtime: row.original_mtime,
    originalExists: row.original_exists === 1,
    indexedAt: row.ingested_at,
    updatedAt: row.updated_at,
  };
}

function indexOriginalFile(absPath, sessionId, meta = {}) {
  const exists = fs.existsSync(absPath);
  if (!exists) return { skipped: 'missing' };

  const st = fs.statSync(absPath);
  if (!st.isFile()) return { skipped: 'not_file' };

  const existing = getDb().prepare('SELECT * FROM aether_vault WHERE original_path = ?').get(absPath);
  const mtime = st.mtimeMs;
  if (existing && existing.original_mtime === mtime) {
    return { skipped: 'unchanged', id: existing.id };
  }

  const id = existing?.id || crypto.randomUUID();
  let digest = existing?.sha256 || null;
  if (st.size <= MAX_HASH_BYTES) {
    digest = sha256File(absPath);
  }
  const now = new Date().toISOString();
  const title = path.basename(absPath);

  getDb().prepare(`
    INSERT INTO aether_vault (
      id, session_id, title, original_path, vault_rel_path, size_bytes, sha256,
      source, tool_name, original_mtime, original_exists, ingested_at, updated_at
    ) VALUES (?, ?, ?, ?, '', ?, ?, ?, ?, ?, 1, ?, ?)
    ON CONFLICT(original_path) DO UPDATE SET
      session_id = excluded.session_id,
      title = excluded.title,
      size_bytes = excluded.size_bytes,
      sha256 = excluded.sha256,
      source = excluded.source,
      tool_name = excluded.tool_name,
      original_mtime = excluded.original_mtime,
      original_exists = 1,
      updated_at = excluded.updated_at
  `).run(
    id,
    sessionId || null,
    title,
    absPath,
    st.size,
    digest,
    meta.source || 'session',
    meta.toolName || null,
    mtime,
    existing?.ingested_at || now,
    now
  );

  return { ingested: true, id, updated: Boolean(existing) };
}

function ingestFromSessions() {
  const writes = collectAllWrites();
  const result = { scanned: writes.length, ingested: 0, updated: 0, skipped: 0, errors: [] };

  for (const write of writes) {
    try {
      const indexResult = indexOriginalFile(write.absPath, write.sessionId, {
        source: write.source,
        toolName: write.toolName,
      });
      if (indexResult.ingested) {
        if (indexResult.updated) result.updated += 1;
        else result.ingested += 1;
      } else {
        result.skipped += 1;
      }
    } catch (e) {
      result.errors.push({ path: write.absPath, error: e.message });
    }
  }

  refreshOriginalExistsFlags();
  return result;
}

function refreshOriginalExistsFlags() {
  const rows = getDb().prepare('SELECT id, original_path FROM aether_vault').all();
  const stmt = getDb().prepare('UPDATE aether_vault SET original_exists = ? WHERE id = ?');
  for (const row of rows) {
    const exists = fs.existsSync(row.original_path) ? 1 : 0;
    stmt.run(exists, row.id);
  }
}

function listVaultFiles(limit = 200, sessionId = null, query = null) {
  const like = query ? `%${query}%` : null;
  let rows;
  if (sessionId && like) {
    rows = getDb().prepare(
      `SELECT * FROM aether_vault
       WHERE session_id = ? AND (title LIKE ? OR original_path LIKE ?)
       ORDER BY updated_at DESC LIMIT ?`
    ).all(sessionId, like, like, limit);
  } else if (sessionId) {
    rows = getDb().prepare(
      `SELECT * FROM aether_vault WHERE session_id = ? ORDER BY updated_at DESC LIMIT ?`
    ).all(sessionId, limit);
  } else if (like) {
    rows = getDb().prepare(
      `SELECT * FROM aether_vault
       WHERE title LIKE ? OR original_path LIKE ?
       ORDER BY updated_at DESC LIMIT ?`
    ).all(like, like, limit);
  } else {
    rows = getDb().prepare(
      `SELECT * FROM aether_vault ORDER BY updated_at DESC LIMIT ?`
    ).all(limit);
  }
  return {
    available: true,
    note: VAULT_NOTE,
    files: rows.map(rowToEntry),
  };
}

function listVaultSessions() {
  const rows = getDb().prepare(`
    SELECT session_id, COUNT(*) AS file_count, MAX(updated_at) AS latest_updated
    FROM aether_vault
    WHERE session_id IS NOT NULL AND session_id != ''
    GROUP BY session_id
    ORDER BY latest_updated DESC
  `).all();
  return {
    available: true,
    sessions: rows.map((row) => ({
      sessionId: row.session_id,
      fileCount: row.file_count,
      latestUpdated: row.latest_updated,
    })),
  };
}

function purgeMissingVaultFiles() {
  const result = getDb().prepare('DELETE FROM aether_vault WHERE original_exists = 0').run();
  return { ok: true, removed: result.changes };
}

function revealVaultFile(id) {
  const entry = getVaultFile(id);
  const abs = entry.originalPath;
  if (!fs.existsSync(abs)) {
    throw Object.assign(new Error('Original file no longer exists on disk'), { statusCode: 404 });
  }
  // eslint-disable-next-line global-require
  const { execSync } = require('child_process');
  if (process.platform === 'darwin') {
    execSync(`open -R ${JSON.stringify(abs)}`, { timeout: 5000 });
  } else if (process.platform === 'win32') {
    execSync(`explorer /select,${JSON.stringify(abs)}`, { timeout: 5000 });
  } else {
    execSync(`xdg-open ${JSON.stringify(path.dirname(abs))}`, { timeout: 5000 });
  }
  return { ok: true, path: abs };
}

function getVaultFile(id) {
  const row = getDb().prepare('SELECT * FROM aether_vault WHERE id = ?').get(id);
  if (!row) throw Object.assign(new Error('Vault file not found'), { statusCode: 404 });
  return rowToEntry(row);
}

function readVaultFileContent(id) {
  const entry = getVaultFile(id);
  const abs = entry.originalPath;
  if (!fs.existsSync(abs)) {
    throw Object.assign(new Error('Original file no longer exists on disk'), { statusCode: 404 });
  }
  const payload = readWorkspaceFile(abs);
  return {
    ...payload,
    vault: entry,
    note: VAULT_NOTE,
    editable: payload.kind === 'text' && !isVaultExcludedFile(abs),
  };
}

function writeVaultFileContent(id, content) {
  const entry = getVaultFile(id);
  if (!entry.originalExists || !fs.existsSync(entry.originalPath)) {
    throw Object.assign(new Error('Original file no longer exists on disk'), { statusCode: 404 });
  }
  if (isVaultExcludedFile(entry.originalPath)) {
    throw Object.assign(new Error('This file cannot be edited from the vault'), { statusCode: 403 });
  }

  const payload = writeWorkspaceFile(entry.originalPath, content);
  const st = fs.statSync(entry.originalPath);
  let digest = entry.sha256 || null;
  if (st.size <= MAX_HASH_BYTES) {
    digest = sha256File(entry.originalPath);
  }
  const now = new Date().toISOString();
  getDb().prepare(`
    UPDATE aether_vault
    SET size_bytes = ?, sha256 = ?, original_mtime = ?, original_exists = 1, updated_at = ?
    WHERE id = ?
  `).run(st.size, digest, st.mtimeMs, now, id);

  return {
    ...payload,
    vault: getVaultFile(id),
    note: VAULT_NOTE,
    editable: true,
    saved: true,
  };
}

function resolveVaultRawPath(id) {
  const entry = getVaultFile(id);
  return entry.originalPath;
}

module.exports = {
  VAULT_NOTE,
  ingestFromSessions,
  listVaultFiles,
  listVaultSessions,
  purgeMissingVaultFiles,
  revealVaultFile,
  getVaultFile,
  readVaultFileContent,
  writeVaultFileContent,
  resolveVaultRawPath,
  mimeFromExt,
  displayRelativePath,
};
