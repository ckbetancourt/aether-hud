/**
 * Hermes session operations via state.db (read/write) and optional dashboard API.
 */
const path = require('path');
const Database = require('better-sqlite3');

function getStateDbPath() {
  return path.join(process.env.HERMES_HOME || path.join(process.env.HOME || '', '.hermes'), 'state.db');
}

function openWriteDb() {
  const dbPath = getStateDbPath();
  const db = new Database(dbPath, { fileMustExist: true });
  db.pragma('journal_mode = WAL');
  return db;
}

function searchSessions(db, query, limit = 50) {
  const q = String(query || '').trim();
  if (!q) {
    return db.prepare(
      `SELECT id, title, started_at, model, message_count
       FROM sessions ORDER BY started_at DESC LIMIT ?`
    ).all(limit);
  }
  const like = `%${q.replace(/[%_]/g, '')}%`;
  return db.prepare(
    `SELECT DISTINCT s.id, s.title, s.started_at, s.model, s.message_count
     FROM sessions s
     LEFT JOIN messages m ON m.session_id = s.id
     WHERE s.title LIKE ? OR s.id LIKE ? OR m.content LIKE ?
     ORDER BY s.started_at DESC
     LIMIT ?`
  ).all(like, like, like, limit);
}

function updateSessionTitle(db, sessionId, title) {
  const trimmed = String(title || '').trim();
  if (!trimmed) {
    throw Object.assign(new Error('Title is required'), { statusCode: 400 });
  }
  const result = db.prepare('UPDATE sessions SET title = ? WHERE id = ?').run(trimmed, String(sessionId));
  if (result.changes === 0) {
    throw Object.assign(new Error('Session not found'), { statusCode: 404 });
  }
  return { id: sessionId, title: trimmed };
}

function deleteSession(db, sessionId) {
  const id = String(sessionId);
  const exists = db.prepare('SELECT 1 AS ok FROM sessions WHERE id = ?').get(id);
  if (!exists) {
    throw Object.assign(new Error('Session not found'), { statusCode: 404 });
  }
  db.prepare('DELETE FROM messages WHERE session_id = ?').run(id);
  db.prepare('DELETE FROM sessions WHERE id = ?').run(id);
  return { id, deleted: true };
}

function withWriteDb(fn) {
  let db;
  try {
    db = openWriteDb();
    return fn(db);
  } catch (e) {
    if (e.code === 'SQLITE_CANTOPEN' || e.message?.includes('no such file')) {
      throw Object.assign(new Error('Hermes state.db not available'), { statusCode: 503 });
    }
    throw e;
  } finally {
    if (db) db.close();
  }
}

async function tryDashboardSessionPatch(dashboardUrl, sessionId, title) {
  const base = String(dashboardUrl || '').replace(/\/$/, '');
  if (!base) return null;
  const url = `${base}/api/sessions/${encodeURIComponent(sessionId)}`;
  try {
    const res = await fetch(url, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ title: String(title).trim() }),
    });
    if (res.ok) return await res.json().catch(() => ({ ok: true }));
  } catch {
    /* dashboard optional */
  }
  return null;
}

async function tryDashboardSessionDelete(dashboardUrl, sessionId) {
  const base = String(dashboardUrl || '').replace(/\/$/, '');
  if (!base) return null;
  const url = `${base}/api/sessions/${encodeURIComponent(sessionId)}`;
  try {
    const res = await fetch(url, { method: 'DELETE' });
    if (res.ok) return await res.json().catch(() => ({ ok: true }));
  } catch {
    /* dashboard optional */
  }
  return null;
}

module.exports = {
  searchSessions,
  updateSessionTitle,
  deleteSession,
  withWriteDb,
  tryDashboardSessionPatch,
  tryDashboardSessionDelete,
};
