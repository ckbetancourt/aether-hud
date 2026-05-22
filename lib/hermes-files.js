/**
 * Discover files Hermes created — from session write logs and Hermes user-content dirs.
 */
const fs = require('fs');
const path = require('path');
const { resolveAbsolutePath, listWorkspaceFiles } = require('./workspace-sandbox.js');
const {
  getHermesHome,
  getProfileWorkspaceDir,
  readConfigYamlTerminalCwd,
  resolveTerminalCwd,
  listCheckpointProjects,
} = require('./hermes-workspaces.js');
const { getKanbanBrowseRoots } = require('./hermes-kanban.js');

const HERMES_HOME = getHermesHome();

const WRITE_TOOLS = new Set(['write_file', 'patch', 'code', 'execute_code', 'kanban_complete']);
const CODE_WRITE_PATH_RE = /write_file\(\s*(?:path\s*=\s*)?["']([^"']+)["']/g;
const CODE_WRITE_PATH_POS_RE = /write_file\(\s*["']([^"']+)["']/g;

const HERMES_INTERNAL_BASENAMES = new Set([
  '.env',
  '.hermes_history',
  '.install_method',
  '.skills_prompt_snapshot.json',
  '.update_check',
  'auth.json',
  'auth.lock',
  'config.yaml',
  'kanban.db',
  'state.db',
  'SOUL.md',
  'channel_directory.json',
]);

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

function statFile(absPath) {
  try {
    const st = fs.statSync(absPath);
    if (!st.isFile()) return null;
    return { size: st.size, mtime: st.mtimeMs };
  } catch {
    return null;
  }
}

function isHermesInternalFile(absPath) {
  const base = path.basename(absPath);
  if (HERMES_INTERNAL_BASENAMES.has(base)) return true;
  if (absPath.includes(`${path.sep}node_modules${path.sep}`)) return true;

  const relToHermes = path.relative(HERMES_HOME, absPath);
  const insideHermes = relToHermes && !relToHermes.startsWith('..') && !path.isAbsolute(relToHermes);
  if (!insideHermes) return false;

  if (base.startsWith('.') && base !== '.hermes') return true;
  const rel = relToHermes.split(path.sep).join('/');
  if (rel.startsWith('cache/') || rel.startsWith('logs/') || rel.startsWith('bin/')) return true;
  if (rel.startsWith('hermes-agent/')) return true;
  if (rel.startsWith('checkpoints/')) return true;
  if (rel.startsWith('sessions/')) return true;
  return false;
}

function addIndexedPath(index, rawPath, meta = {}) {
  const abs = normalizeIndexedPath(rawPath);
  if (!abs) return;
  if (isHermesInternalFile(abs)) return;
  const st = statFile(abs);
  if (!st) return;

  const existing = index.get(abs);
  const entry = {
    name: path.basename(abs),
    path: abs,
    relativePath: displayRelativePath(abs),
    size: st.size,
    mtime: st.mtime,
    source: meta.source || 'hermes',
    sessionId: meta.sessionId || null,
  };

  if (!existing || (entry.mtime || 0) >= (existing.mtime || 0)) {
    index.set(abs, entry);
  }
}

function addIndexedPaths(index, paths, meta = {}) {
  for (const p of paths || []) addIndexedPath(index, p, meta);
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

function indexSessionFiles(index) {
  const sessionsDir = path.join(HERMES_HOME, 'sessions');
  if (!fs.existsSync(sessionsDir)) return;

  let names;
  try {
    names = fs.readdirSync(sessionsDir).filter((n) => n.endsWith('.json')).sort().reverse();
  } catch {
    return;
  }

  for (const name of names.slice(0, 150)) {
    const full = path.join(sessionsDir, name);
    let session;
    try {
      session = JSON.parse(fs.readFileSync(full, 'utf8'));
    } catch {
      continue;
    }

    const sessionId = session.session_id || name.replace(/\.json$/, '');
    const messages = Array.isArray(session.messages) ? session.messages : [];
    for (const message of messages) {
      const toolCalls = message?.tool_calls || [];
      for (const call of toolCalls) {
        const fn = call?.function || call;
        const toolName = fn?.name || '';
        if (!WRITE_TOOLS.has(toolName)) continue;
        addIndexedPaths(index, extractPathsFromToolCall(toolName, fn?.arguments), {
          source: 'session',
          sessionId,
        });
      }
    }
  }
}

function indexDirectoryFiles(index, root, source) {
  if (!root || !fs.existsSync(root)) return;
  try {
    const result = listWorkspaceFiles(root, 400, 10);
    for (const file of result.files || []) {
      addIndexedPath(index, file.path, { source });
    }
  } catch {
    /* skip unreadable roots */
  }
}

function indexHermesUserContent(index) {
  indexDirectoryFiles(index, getProfileWorkspaceDir(), 'profile-workspace');

  const profilesDir = path.join(HERMES_HOME, 'profiles');
  if (fs.existsSync(profilesDir)) {
    for (const profile of fs.readdirSync(profilesDir)) {
      if (profile.startsWith('.')) continue;
      indexDirectoryFiles(index, path.join(profilesDir, profile, 'workspace'), 'profile-workspace');
    }
  }

  indexDirectoryFiles(index, path.join(HERMES_HOME, 'kanban', 'workspaces'), 'kanban');
  indexDirectoryFiles(index, path.join(HERMES_HOME, 'plans'), 'plans');
  indexDirectoryFiles(index, path.join(HERMES_HOME, 'uploads'), 'uploads');
  indexDirectoryFiles(index, path.join(HERMES_HOME, 'media'), 'media');
  indexDirectoryFiles(index, path.join(HERMES_HOME, 'artifacts'), 'artifacts');
}

function getHermesOutputRoots() {
  const roots = new Set();
  const push = (p) => {
    const abs = resolveAbsolutePath(p);
    if (abs && fs.existsSync(abs)) roots.add(abs);
  };

  push(getProfileWorkspaceDir());
  push(path.join(HERMES_HOME, 'kanban', 'workspaces'));
  push(path.join(HERMES_HOME, 'plans'));
  push(path.join(HERMES_HOME, 'uploads'));
  push(path.join(HERMES_HOME, 'media'));
  push(path.join(HERMES_HOME, 'artifacts'));
  push(path.join(HERMES_HOME, 'skills'));

  const terminal = resolveTerminalCwd(readConfigYamlTerminalCwd());
  if (terminal.path) push(terminal.path);

  for (const proj of listCheckpointProjects()) {
    if (proj.path) push(proj.path);
  }

  try {
    const kanban = getKanbanBrowseRoots();
    for (const root of kanban.roots || []) push(root);
  } catch {
    /* kanban optional */
  }

  return [...roots];
}

function buildHermesFileIndex() {
  const index = new Map();
  indexSessionFiles(index);
  indexHermesUserContent(index);
  return index;
}

function listHermesOutputFiles() {
  const index = buildHermesFileIndex();
  const files = [...index.values()].sort((a, b) => (b.mtime || 0) - (a.mtime || 0));
  return {
    available: true,
    roots: getHermesOutputRoots(),
    files,
  };
}

function getIndexedHermesFilePaths() {
  const index = buildHermesFileIndex();
  return new Set(index.keys());
}

function assertHermesFileReadable(requestedPath, extraRoots = []) {
  const abs = resolveAbsolutePath(requestedPath);
  if (!abs) throw Object.assign(new Error('Path is required'), { statusCode: 400 });

  const st = statFile(abs);
  if (!st) throw Object.assign(new Error('File does not exist'), { statusCode: 404 });

  const indexed = getIndexedHermesFilePaths();
  if (indexed.has(abs)) return abs;

  const roots = [...new Set([...getHermesOutputRoots(), ...extraRoots])];
  const { assertBrowseAllowed } = require('./workspace-sandbox.js');
  return assertBrowseAllowed(abs, roots);
}

module.exports = {
  getHermesOutputRoots,
  listHermesOutputFiles,
  getIndexedHermesFilePaths,
  assertHermesFileReadable,
  buildHermesFileIndex,
};
