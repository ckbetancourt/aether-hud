/**
 * Node wrapper for lib/hermes_kanban_bridge.py (Hermes kanban_db via plugin_api).
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const worker = require('./hermes-kanban-bridge-worker.js');

const ROOT = path.join(__dirname, '..');
const BRIDGE_SCRIPT = path.join(__dirname, 'hermes_kanban_bridge.py');
const HERMES_HOME = process.env.HERMES_HOME || path.join(process.env.HOME || '', '.hermes');
const HERMES_AGENT_ROOT = process.env.HERMES_AGENT_ROOT || path.join(HERMES_HOME, 'hermes-agent');

function resolveHermesPythonBin() {
  const candidates = [
    process.env.HERMES_PYTHON,
    path.join(HERMES_AGENT_ROOT, 'venv', 'bin', 'python'),
    path.join(HERMES_AGENT_ROOT, 'venv', 'bin', 'python3'),
    'python3',
  ].filter(Boolean);
  for (const candidate of candidates) {
    try {
      if (candidate.includes(path.sep) && fs.existsSync(candidate)) return candidate;
      if (!candidate.includes(path.sep)) return candidate;
    } catch {
      /* continue */
    }
  }
  return 'python3';
}

function hermesPythonEnv() {
  return {
    ...process.env,
    HERMES_HOME,
    HERMES_AGENT_ROOT,
    PYTHONPATH: [HERMES_AGENT_ROOT, process.env.PYTHONPATH].filter(Boolean).join(path.delimiter),
  };
}

function invokeKanbanBridgeSync(op, params = {}, timeoutMs = 120000) {
  const python = resolveHermesPythonBin();
  const payload = JSON.stringify({ op, params });
  let stdout;
  try {
    stdout = execFileSync(python, [BRIDGE_SCRIPT], {
      cwd: ROOT,
      input: payload,
      timeout: timeoutMs,
      encoding: 'utf-8',
      env: hermesPythonEnv(),
      maxBuffer: 1024 * 1024 * 16,
    });
  } catch (e) {
    const err = new Error(e.stderr?.trim() || e.message || 'Kanban bridge failed');
    err.cause = e;
    throw err;
  }
  const trimmed = stdout.trim();
  if (!trimmed) {
    throw new Error('Kanban bridge returned empty response');
  }
  const data = JSON.parse(trimmed);
  if (data.ok === false) {
    const err = new Error(data.error || 'Kanban operation failed');
    err.status = data.status || 500;
    throw err;
  }
  return data;
}

async function invokeKanbanBridge(op, params = {}, timeoutMs = 120000) {
  try {
    return await worker.request(op, params, timeoutMs);
  } catch (workerErr) {
    if (process.env.KANBAN_BRIDGE_WORKER_ONLY === '1') throw workerErr;
    return invokeKanbanBridgeSync(op, params, timeoutMs);
  }
}

function withBoard(board, params = {}) {
  const p = { ...params };
  if (board) p.board = board;
  return p;
}

async function getBootstrap(board, query = {}) {
  return invokeKanbanBridge('bootstrap', withBoard(board, query));
}

async function getBoard(board, query = {}) {
  return invokeKanbanBridge('get_board', withBoard(board, query));
}

async function getTask(board, taskId, query = {}) {
  return invokeKanbanBridge('get_task', withBoard(board, { task_id: taskId, ...query }));
}

async function createTask(board, body) {
  return invokeKanbanBridge('create_task', withBoard(board, { body }));
}

async function updateTask(board, taskId, body) {
  return invokeKanbanBridge('update_task', withBoard(board, { task_id: taskId, body }));
}

async function deleteTask(board, taskId) {
  return invokeKanbanBridge('delete_task', withBoard(board, { task_id: taskId }));
}

async function addComment(board, taskId, body) {
  return invokeKanbanBridge('add_comment', withBoard(board, { task_id: taskId, body }));
}

async function addLink(board, body) {
  return invokeKanbanBridge('add_link', withBoard(board, { body }));
}

async function deleteLink(board, parentId, childId) {
  return invokeKanbanBridge('delete_link', withBoard(board, { parent_id: parentId, child_id: childId }));
}

async function bulkUpdate(board, body) {
  return invokeKanbanBridge('bulk_update', withBoard(board, { body }));
}

async function specifyTask(board, taskId, body = {}) {
  return invokeKanbanBridge('specify_task', withBoard(board, { task_id: taskId, body }), 600000);
}

async function decomposeTask(board, taskId, body = {}) {
  return invokeKanbanBridge('decompose_task', withBoard(board, { task_id: taskId, body }), 600000);
}

async function dispatchNudge(board, query = {}) {
  return invokeKanbanBridge('dispatch', withBoard(board, query));
}

async function listBoards(query = {}) {
  return invokeKanbanBridge('list_boards', query);
}

async function createBoard(body) {
  return invokeKanbanBridge('create_board', { body });
}

async function switchBoard(slug) {
  return invokeKanbanBridge('switch_board', { slug });
}

async function renameBoard(slug, body) {
  return invokeKanbanBridge('rename_board', { slug, body });
}

async function deleteBoard(slug, hard = false) {
  return invokeKanbanBridge('delete_board', { slug, delete: hard });
}

async function getKanbanConfig() {
  return invokeKanbanBridge('get_config', {});
}

async function getOrchestration() {
  return invokeKanbanBridge('get_orchestration', {});
}

async function setOrchestration(body) {
  return invokeKanbanBridge('set_orchestration', { body });
}

async function listProfiles() {
  return invokeKanbanBridge('list_profiles', {});
}

async function updateProfile(profileName, body) {
  return invokeKanbanBridge('update_profile', { profile_name: profileName, body });
}

async function describeProfileAuto(profileName, body = {}) {
  return invokeKanbanBridge('describe_profile_auto', { profile_name: profileName, body }, 120000);
}

async function getStats(board) {
  return invokeKanbanBridge('get_stats', withBoard(board, {}));
}

async function getAssignees(board) {
  return invokeKanbanBridge('get_assignees', withBoard(board, {}));
}

async function getTaskLog(board, taskId, tail = 8192) {
  return invokeKanbanBridge('get_task_log', withBoard(board, { task_id: taskId, tail }));
}

async function getHomeChannels(board, taskId) {
  return invokeKanbanBridge('get_home_channels', withBoard(board, { task_id: taskId }));
}

async function subscribeHome(board, taskId, platform) {
  return invokeKanbanBridge('subscribe_home', withBoard(board, { task_id: taskId, platform }));
}

async function unsubscribeHome(board, taskId, platform) {
  return invokeKanbanBridge('unsubscribe_home', withBoard(board, { task_id: taskId, platform }));
}

module.exports = {
  invokeKanbanBridge,
  getBootstrap,
  getBoard,
  getTask,
  createTask,
  updateTask,
  deleteTask,
  addComment,
  addLink,
  deleteLink,
  bulkUpdate,
  specifyTask,
  decomposeTask,
  dispatchNudge,
  listBoards,
  createBoard,
  switchBoard,
  renameBoard,
  deleteBoard,
  getKanbanConfig,
  getOrchestration,
  setOrchestration,
  listProfiles,
  updateProfile,
  describeProfileAuto,
  getStats,
  getAssignees,
  getTaskLog,
  getHomeChannels,
  subscribeHome,
  unsubscribeHome,
};
