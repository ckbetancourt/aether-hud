/**
 * Hermes agent / project workspaces (non-Kanban).
 * Sources: terminal.cwd, checkpoint projects, profile workspace dir, user favorites.
 */
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { resolveAbsolutePath } = require('./workspace-sandbox.js');

const FAVORITES_FILE = path.join(__dirname, '..', 'data', 'aether-workspaces.json');

function getHermesHome() {
  return path.resolve(
    (process.env.HERMES_HOME || path.join(process.env.HOME || '', '.hermes')).replace(
      /^~/,
      process.env.HOME || ''
    )
  );
}

function getActiveProfileName() {
  return (process.env.HERMES_PROFILE || '').trim();
}

function getProfileWorkspaceDir() {
  const hermesHome = getHermesHome();
  const profile = getActiveProfileName();
  if (profile && profile !== 'default') {
    return path.join(hermesHome, 'profiles', profile, 'workspace');
  }
  return path.join(hermesHome, 'workspace');
}

function readConfigYamlTerminalCwd() {
  const configPath = path.join(getHermesHome(), 'config.yaml');
  if (!fs.existsSync(configPath)) return null;
  const text = fs.readFileSync(configPath, 'utf8');
  const terminalBlock = text.match(/^terminal:\s*\n(?:[ \t].+\n)*/m);
  if (!terminalBlock) return null;
  const cwdMatch = terminalBlock[0].match(/^\s+cwd:\s*(.+)\s*$/m);
  if (!cwdMatch) return null;
  let raw = cwdMatch[1].trim();
  if ((raw.startsWith('"') && raw.endsWith('"')) || (raw.startsWith("'") && raw.endsWith("'"))) {
    raw = raw.slice(1, -1);
  }
  return raw || null;
}

function resolveTerminalCwd(raw) {
  if (!raw || raw === '.' || raw === 'auto' || raw === 'cwd') {
    return { raw: raw || '.', path: null, label: 'Gateway launch directory' };
  }
  const abs = resolveAbsolutePath(raw);
  return { raw, path: abs, label: abs };
}

function listCheckpointProjects(limit = 50) {
  const storeDir = path.join(getHermesHome(), 'checkpoints', 'store', 'projects');
  if (!fs.existsSync(storeDir)) return [];
  const items = [];
  for (const file of fs.readdirSync(storeDir)) {
    if (!file.endsWith('.json')) continue;
    try {
      const meta = JSON.parse(fs.readFileSync(path.join(storeDir, file), 'utf8'));
      const workdir = resolveAbsolutePath(meta.workdir);
      if (!workdir) continue;
      items.push({
        id: file.replace(/\.json$/, ''),
        kind: 'checkpoint',
        title: path.basename(workdir),
        path: workdir,
        exists: fs.existsSync(workdir),
        lastTouch: meta.last_touch || null,
        createdAt: meta.created_at || null,
      });
    } catch {
      /* skip bad metadata */
    }
  }
  items.sort((a, b) => (b.lastTouch || 0) - (a.lastTouch || 0));
  return items.slice(0, limit);
}

function loadUserFavorites() {
  try {
    if (!fs.existsSync(FAVORITES_FILE)) return [];
    const raw = JSON.parse(fs.readFileSync(FAVORITES_FILE, 'utf8'));
    return Array.isArray(raw) ? raw : [];
  } catch {
    return [];
  }
}

function saveUserFavorites(favorites) {
  const dir = path.dirname(FAVORITES_FILE);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(FAVORITES_FILE, `${JSON.stringify(favorites, null, 2)}\n`, 'utf8');
}

function addUserFavorite(workspacePath) {
  const abs = resolveAbsolutePath(workspacePath);
  if (!abs || !fs.existsSync(abs)) {
    throw Object.assign(new Error('Path does not exist'), { statusCode: 400 });
  }
  const st = fs.statSync(abs);
  if (!st.isDirectory()) {
    throw Object.assign(new Error('Only directories can be saved as workspaces'), { statusCode: 400 });
  }
  const favorites = loadUserFavorites();
  if (!favorites.some((f) => f.path === abs)) {
    favorites.unshift({
      path: abs,
      title: path.basename(abs) || abs,
      addedAt: Date.now(),
    });
    saveUserFavorites(favorites.slice(0, 32));
  }
  return { ok: true, path: abs };
}

function listAgentWorkspaces() {
  const terminal = resolveTerminalCwd(readConfigYamlTerminalCwd());
  const items = [];
  const seen = new Set();

  const push = (entry) => {
    if (!entry.path || seen.has(entry.path)) return;
    seen.add(entry.path);
    items.push(entry);
  };

  if (terminal.path && fs.existsSync(terminal.path)) {
    push({
      id: '__terminal_cwd__',
      kind: 'active',
      title: path.basename(terminal.path) || terminal.path,
      path: terminal.path,
      status: 'active',
      workspaceKind: 'terminal.cwd',
      isActive: true,
      configValue: terminal.raw,
    });
  } else if (terminal.raw) {
    items.push({
      id: '__terminal_cwd__',
      kind: 'active',
      title: terminal.label,
      path: null,
      status: 'active',
      workspaceKind: 'terminal.cwd',
      isActive: true,
      configValue: terminal.raw,
    });
  }

  const profileDir = getProfileWorkspaceDir();
  if (fs.existsSync(profileDir)) {
    push({
      id: '__profile_workspace__',
      kind: 'profile',
      title: 'Profile workspace',
      path: profileDir,
      status: 'profile',
      workspaceKind: 'profile',
    });
  }

  for (const fav of loadUserFavorites()) {
    if (!fav.path) continue;
    push({
      id: `fav_${fav.path}`,
      kind: 'favorite',
      title: fav.title || path.basename(fav.path),
      path: fav.path,
      status: fs.existsSync(fav.path) ? 'saved' : 'missing',
      workspaceKind: 'favorite',
    });
  }

  for (const proj of listCheckpointProjects()) {
    push({
      id: proj.id,
      kind: 'project',
      title: proj.title,
      path: proj.path,
      status: proj.exists ? 'live' : 'orphan',
      workspaceKind: 'project',
      lastTouch: proj.lastTouch,
    });
  }

  return {
    available: true,
    terminalCwd: terminal.raw,
    terminalPath: terminal.path,
    profileWorkspace: fs.existsSync(profileDir) ? profileDir : null,
    items,
  };
}

function getAgentBrowseRoots() {
  const roots = new Set();
  const listing = listAgentWorkspaces();
  for (const item of listing.items) {
    if (item.path && fs.existsSync(item.path)) roots.add(item.path);
  }
  return [...roots];
}

function switchAgentWorkspace(workspacePath) {
  const abs = resolveAbsolutePath(workspacePath);
  if (!abs) throw Object.assign(new Error('Path is required'), { statusCode: 400 });
  if (!fs.existsSync(abs)) {
    throw Object.assign(new Error(`Path does not exist: ${abs}`), { statusCode: 400 });
  }
  if (!fs.statSync(abs).isDirectory()) {
    throw Object.assign(new Error('Agent workspace must be a directory'), { statusCode: 400 });
  }
  try {
    execSync(`hermes config set terminal.cwd ${JSON.stringify(abs)}`, {
      timeout: 15000,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (e) {
    throw Object.assign(new Error(e.stderr || e.message || 'Failed to update terminal.cwd'), {
      statusCode: 500,
    });
  }
  addUserFavorite(abs);
  return {
    ok: true,
    path: abs,
    terminalCwd: abs,
    hint: 'Updated config.yaml terminal.cwd. Restart `hermes gateway` for running sessions to pick up the new working directory.',
  };
}

module.exports = {
  getHermesHome,
  getProfileWorkspaceDir,
  listAgentWorkspaces,
  getAgentBrowseRoots,
  switchAgentWorkspace,
  addUserFavorite,
  loadUserFavorites,
  listCheckpointProjects,
  readConfigYamlTerminalCwd,
  resolveTerminalCwd,
};
