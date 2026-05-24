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

async function requestJson(path, { method = 'GET', body } = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      Accept: 'application/json',
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(`${method} ${path}: invalid JSON (${res.status}): ${text.slice(0, 200)}`);
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

async function deleteTask(taskId) {
  if (!taskId) return;
  try {
    await requestJson(`/api/hermes/kanban/tasks/${encodeURIComponent(taskId)}`, { method: 'DELETE' });
  } catch {
    // best-effort cleanup
  }
}

async function testCreateDefaults() {
  const stamp = Date.now();
  const createdIds = [];

  try {
    const readyRes = await requestJson('/api/hermes/kanban/tasks', {
      method: 'POST',
      body: { title: `aether-smoke-ready-${stamp}` },
    });
    if (!readyRes.ok) {
      fail(`POST /tasks (ready default) failed: HTTP ${readyRes.status} ${readyRes.data?.error || ''}`);
      return;
    }
    const readyTask = readyRes.data?.task;
    if (!readyTask?.id) {
      fail('POST /tasks (ready default) missing task.id');
      return;
    }
    createdIds.push(readyTask.id);
    if (readyTask.status !== 'ready') {
      fail(`POST /tasks expected status ready, got ${readyTask.status}`);
    } else {
      pass('create without parents lands in ready');
    }

    const triageRes = await requestJson('/api/hermes/kanban/tasks', {
      method: 'POST',
      body: { title: `aether-smoke-triage-${stamp}`, triage: true },
    });
    if (!triageRes.ok) {
      fail(`POST /tasks (triage) failed: HTTP ${triageRes.status} ${triageRes.data?.error || ''}`);
      return;
    }
    const triageTask = triageRes.data?.task;
    if (!triageTask?.id) {
      fail('POST /tasks (triage) missing task.id');
      return;
    }
    createdIds.push(triageTask.id);
    if (triageTask.status !== 'triage') {
      fail(`POST /tasks with triage:true expected triage, got ${triageTask.status}`);
    } else {
      pass('create with triage:true lands in triage');
    }

    const childRes = await requestJson('/api/hermes/kanban/tasks', {
      method: 'POST',
      body: { title: `aether-smoke-child-${stamp}`, parents: [readyTask.id] },
    });
    if (!childRes.ok) {
      fail(`POST /tasks (child) failed: HTTP ${childRes.status} ${childRes.data?.error || ''}`);
      return;
    }
    const childTask = childRes.data?.task;
    if (!childTask?.id) {
      fail('POST /tasks (child) missing task.id');
      return;
    }
    createdIds.push(childTask.id);
    if (childTask.status !== 'todo') {
      fail(`POST /tasks with incomplete parent expected todo, got ${childTask.status}`);
    } else {
      pass('create with incomplete parent lands in todo');
    }

    const blockedRes = await requestJson('/api/hermes/kanban/tasks', {
      method: 'POST',
      body: { title: `aether-smoke-blocked-${stamp}`, initial_status: 'blocked' },
    });
    if (!blockedRes.ok) {
      fail(`POST /tasks (blocked) failed: HTTP ${blockedRes.status} ${blockedRes.data?.error || ''}`);
      return;
    }
    const blockedTask = blockedRes.data?.task;
    if (!blockedTask?.id) {
      fail('POST /tasks (blocked) missing task.id');
      return;
    }
    createdIds.push(blockedTask.id);
    if (blockedTask.status !== 'blocked') {
      fail(`POST /tasks with initial_status:blocked expected blocked, got ${blockedTask.status}`);
    } else {
      pass('create with initial_status:blocked lands in blocked');
    }
  } finally {
    for (const id of createdIds.reverse()) {
      await deleteTask(id);
    }
  }
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

  console.log('\nTask creation defaults:');
  await testCreateDefaults();

  console.log('\nDone.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
