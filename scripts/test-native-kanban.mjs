#!/usr/bin/env node
/**
 * Smoke test for native Aether Kanban API (no Hermes dashboard required).
 */
const AETHER_PORT = process.env.PORT || 8787;
const BASE = `http://127.0.0.1:${AETHER_PORT}`;

async function getJson(path) {
  const res = await fetch(`${BASE}${path}`, { headers: { Accept: 'application/json' } });
  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(`${path}: invalid JSON (${res.status}): ${text.slice(0, 200)}`);
  }
  return { ok: res.ok, status: res.status, data };
}

function fail(msg) {
  console.error(`✗ ${msg}`);
  process.exitCode = 1;
}

function pass(msg) {
  console.log(`✓ ${msg}`);
}

async function main() {
  console.log(`Native Kanban API smoke test (${BASE})\n`);

  const status = await getJson('/api/hermes/dashboard/status');
  if (!status.ok && status.status !== 503) {
    fail(`dashboard/status HTTP ${status.status}`);
  } else {
    pass(`dashboard/status reachable (kanbanInitialized=${status.data.kanbanInitialized})`);
  }

  if (!status.data.kanbanInitialized) {
    fail('kanban.db not initialized — run: hermes kanban init');
    return;
  }

  const bootstrap = await getJson('/api/hermes/kanban/bootstrap');
  if (!bootstrap.ok) {
    fail(`GET /api/hermes/kanban/bootstrap failed: HTTP ${bootstrap.status}`);
    return;
  }
  if (!bootstrap.data.board?.columns) {
    fail('bootstrap response missing board.columns');
    return;
  }
  pass(`bootstrap ok (${bootstrap.data.board.columns.length} columns, ${(bootstrap.data.boards || []).length} boards)`);

  const board = await getJson('/api/hermes/kanban/board');
  if (!board.ok) {
    fail(`GET /api/hermes/kanban/board failed: HTTP ${board.status} ${board.data.error || ''}`);
    return;
  }
  if (!Array.isArray(board.data.columns)) {
    fail('board response missing columns array');
    return;
  }
  pass(`board loaded (${board.data.columns.length} columns)`);

  const boards = await getJson('/api/hermes/kanban/boards-list');
  if (!boards.ok) {
    fail(`boards-list failed: HTTP ${boards.status}`);
  } else {
    pass(`boards-list ok (${(boards.data.boards || []).length} boards)`);
  }

  const config = await getJson('/api/hermes/kanban/config');
  if (!config.ok) {
    fail(`config failed: HTTP ${config.status}`);
  } else {
    pass('config ok');
  }

  console.log('\nDone.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
