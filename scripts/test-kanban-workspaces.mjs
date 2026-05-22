#!/usr/bin/env node
/**
 * Smoke test: Kanban boards + workspace list API.
 * Requires: npm start (Aether server on PORT, default 8787)
 *
 *   npm run test:kanban-workspaces
 */
const BASE_URL = process.env.AETHER_TEST_URL || 'http://127.0.0.1:8787';

async function fetchJson(path) {
  const res = await fetch(`${BASE_URL}${path}`);
  const data = await res.json().catch(() => ({}));
  if (!res.ok && !data.boards && !data.items) {
    throw new Error(data.error || `HTTP ${res.status} from ${path}`);
  }
  return { status: res.status, data };
}

async function main() {
  const agent = await fetchJson('/api/hermes/workspaces/agent');
  if (!agent.data.available || !Array.isArray(agent.data.items)) {
    throw new Error('Agent workspaces unavailable');
  }
  console.log('OK agent workspaces', agent.data.items.length, 'terminal.cwd=', agent.data.terminalCwd);

  const boards = await fetchJson('/api/hermes/kanban/boards');
  if (!boards.data.available) {
    console.log('SKIP kanban not initialized:', boards.data.hint || boards.data.error);
    process.exit(0);
  }
  if (!Array.isArray(boards.data.boards) || !boards.data.boards.length) {
    throw new Error('Expected at least one board');
  }
  const current = boards.data.current || boards.data.boards[0].slug;
  console.log('OK boards', boards.data.boards.length, 'current=', current);

  const workspaces = await fetchJson(`/api/hermes/kanban/workspaces?board=${encodeURIComponent(current)}`);
  if (!workspaces.data.available) {
    throw new Error(workspaces.data.error || 'workspaces unavailable');
  }
  console.log('OK workspaces', workspaces.data.items?.length ?? 0);

  const first = workspaces.data.items?.[0];
  if (first?.path) {
    const params = new URLSearchParams({ path: first.path, board: current });
    const browse = await fetchJson(`/api/hermes/kanban/browse?${params}`);
    if (!browse.data.available && browse.data.error) {
      throw new Error(browse.data.error);
    }
    console.log('OK browse entries', browse.data.entries?.length ?? 0, 'at', browse.data.path);
  }

  const forbidden = await fetch(`${BASE_URL}/api/hermes/kanban/browse?path=${encodeURIComponent('/etc/passwd')}`);
  const forbiddenData = await forbidden.json().catch(() => ({}));
  if (forbidden.status !== 403) {
    throw new Error(`Expected 403 for /etc/passwd browse, got ${forbidden.status}`);
  }
  console.log('OK sandbox rejects /etc/passwd');

  console.log(JSON.stringify({ boards: boards.data.boards.length, workspaces: workspaces.data.items?.length ?? 0 }, null, 2));
}

main().catch((err) => {
  console.error('FAIL', err.message || err);
  process.exit(1);
});
