/**
 * Hermes Kanban boards + task workspace discovery for Aether HUD.
 * Reads local ~/.hermes kanban SQLite and filesystem (no dashboard auth).
 */
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const Database = require('better-sqlite3');

const DEFAULT_BOARD = 'default';
const KANBAN_INIT_HINT = 'Run `hermes kanban init` to create the Kanban database.';
const SLUG_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/;

const STATUS_SORT = {
  running: 0,
  ready: 1,
  review: 2,
  blocked: 3,
  scheduled: 4,
  todo: 5,
  triage: 6,
  done: 7,
  archived: 8,
};

function getKanbanHome() {
  const override = (process.env.HERMES_KANBAN_HOME || '').trim();
  if (override) return path.resolve(override.replace(/^~/, process.env.HOME || ''));
  const hermesHome = (process.env.HERMES_HOME || path.join(process.env.HOME || '', '.hermes')).replace(
    /^~/,
    process.env.HOME || ''
  );
  // Kanban is shared at the default hermes root, not per-profile subdirs.
  if (hermesHome.includes(`${path.sep}profiles${path.sep}`)) {
    const parts = hermesHome.split(path.sep);
    const idx = parts.indexOf('profiles');
    if (idx > 0) return parts.slice(0, idx).join(path.sep) || path.join(process.env.HOME || '', '.hermes');
  }
  return path.resolve(hermesHome);
}

function normalizeBoardSlug(slug) {
  const raw = String(slug || '').trim().toLowerCase();
  if (!raw) return null;
  if (!SLUG_RE.test(raw)) {
    throw new Error(`Invalid board slug: ${slug}`);
  }
  return raw;
}

function boardsRoot() {
  return path.join(getKanbanHome(), 'kanban', 'boards');
}

function currentBoardPath() {
  return path.join(getKanbanHome(), 'kanban', 'current');
}

function boardDir(slug) {
  return path.join(boardsRoot(), normalizeBoardSlug(slug) || DEFAULT_BOARD);
}

function boardExists(slug) {
  const normed = normalizeBoardSlug(slug) || DEFAULT_BOARD;
  if (normed === DEFAULT_BOARD) return true;
  const d = boardDir(normed);
  return fs.existsSync(path.join(d, 'board.json')) || fs.existsSync(path.join(d, 'kanban.db'));
}

function kanbanDbPath(slug) {
  const override = (process.env.HERMES_KANBAN_DB || '').trim();
  if (override) return path.resolve(override.replace(/^~/, process.env.HOME || ''));
  const normed = normalizeBoardSlug(slug) || DEFAULT_BOARD;
  if (normed === DEFAULT_BOARD) return path.join(getKanbanHome(), 'kanban.db');
  return path.join(boardDir(normed), 'kanban.db');
}

function workspacesRoot(slug) {
  const override = (process.env.HERMES_KANBAN_WORKSPACES_ROOT || '').trim();
  if (override) return path.resolve(override.replace(/^~/, process.env.HOME || ''));
  const normed = normalizeBoardSlug(slug) || DEFAULT_BOARD;
  if (normed === DEFAULT_BOARD) return path.join(getKanbanHome(), 'kanban', 'workspaces');
  return path.join(boardDir(normed), 'workspaces');
}

function boardMetadataPath(slug) {
  return path.join(boardDir(slug), 'board.json');
}

function defaultBoardDisplayName(slug) {
  return slug
    .replace(/_/g, '-')
    .split('-')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ') || slug;
}

function readBoardMetadata(slug) {
  const normed = normalizeBoardSlug(slug) || DEFAULT_BOARD;
  const meta = {
    slug: normed,
    name: defaultBoardDisplayName(normed),
    description: '',
    icon: '',
    color: '',
    default_workdir: null,
    created_at: null,
    archived: false,
    db_path: kanbanDbPath(normed),
  };
  try {
    const p = boardMetadataPath(normed);
    if (fs.existsSync(p)) {
      const raw = JSON.parse(fs.readFileSync(p, 'utf8'));
      if (raw && typeof raw === 'object') {
        Object.assign(meta, raw, { slug: normed });
      }
    }
  } catch {
    /* use defaults */
  }
  return meta;
}

function getCurrentBoardSlug() {
  const env = (process.env.HERMES_KANBAN_BOARD || '').trim();
  if (env) {
    try {
      const normed = normalizeBoardSlug(env);
      if (normed && boardExists(normed)) return normed;
    } catch {
      /* fall through */
    }
  }
  try {
    const f = currentBoardPath();
    if (fs.existsSync(f)) {
      const val = fs.readFileSync(f, 'utf8').trim();
      if (val) {
        const normed = normalizeBoardSlug(val);
        if (normed && boardExists(normed)) return normed;
      }
    }
  } catch {
    /* fall through */
  }
  return DEFAULT_BOARD;
}

function openKanbanDbReadonly(slug) {
  const dbPath = kanbanDbPath(slug);
  if (!fs.existsSync(dbPath)) return null;
  const db = new Database(dbPath, { readonly: true, fileMustExist: true });
  db.pragma('journal_mode = WAL');
  db.pragma('query_only = true');
  return db;
}

function countTasksByStatus(db) {
  const counts = {};
  try {
    const rows = db.prepare('SELECT status, COUNT(*) AS n FROM tasks GROUP BY status').all();
    for (const row of rows) counts[row.status] = row.n;
  } catch {
    /* empty or missing schema */
  }
  return counts;
}

function kanbanAvailable() {
  const current = getCurrentBoardSlug();
  return fs.existsSync(kanbanDbPath(current));
}

function listBoards() {
  if (!kanbanAvailable()) {
    return {
      available: false,
      boards: [],
      current: DEFAULT_BOARD,
      hint: KANBAN_INIT_HINT,
    };
  }

  const entries = [];
  const seen = new Set();

  const addBoard = (slug) => {
    if (seen.has(slug)) return;
    const meta = readBoardMetadata(slug);
    let counts = {};
    let total = 0;
    const db = openKanbanDbReadonly(slug);
    if (db) {
      try {
        counts = countTasksByStatus(db);
        total = Object.values(counts).reduce((a, b) => a + b, 0);
      } finally {
        db.close();
      }
    }
    entries.push({
      slug: meta.slug,
      name: meta.name || defaultBoardDisplayName(slug),
      description: meta.description || '',
      defaultWorkdir: meta.default_workdir || null,
      counts,
      total,
      isCurrent: false,
      dbPath: kanbanDbPath(slug),
    });
    seen.add(slug);
  };

  addBoard(DEFAULT_BOARD);

  const root = boardsRoot();
  if (fs.existsSync(root)) {
    for (const name of fs.readdirSync(root).sort((a, b) => a.localeCompare(b))) {
      if (name.startsWith('_')) continue;
      try {
        const normed = normalizeBoardSlug(name);
        if (!normed || seen.has(normed)) continue;
        const child = path.join(root, name);
        if (!fs.statSync(child).isDirectory()) continue;
        if (!fs.existsSync(path.join(child, 'kanban.db')) && !fs.existsSync(path.join(child, 'board.json'))) {
          continue;
        }
        const meta = readBoardMetadata(normed);
        if (meta.archived) continue;
        addBoard(normed);
      } catch {
        /* skip invalid dirs */
      }
    }
  }

  const current = getCurrentBoardSlug();
  for (const b of entries) {
    b.isCurrent = b.slug === current;
  }

  return { available: true, boards: entries, current };
}

function switchBoard(slug) {
  const normed = normalizeBoardSlug(slug);
  if (!normed) throw new Error('Board slug is required');
  if (!boardExists(normed)) throw new Error(`Board "${normed}" does not exist`);
  const dir = path.dirname(currentBoardPath());
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(currentBoardPath(), `${normed}\n`, 'utf8');
  return { ok: true, current: normed };
}

function getProfileWorkspaceDir() {
  const hermesHome = getKanbanHome();
  const profile = (process.env.HERMES_PROFILE || '').trim();
  if (profile && profile !== 'default') {
    return path.join(hermesHome, 'profiles', profile, 'workspace');
  }
  return path.join(hermesHome, 'workspace');
}

function resolveAbsolutePath(p) {
  if (!p) return null;
  const expanded = String(p).replace(/^~/, process.env.HOME || '');
  return path.resolve(expanded);
}

function isPathInside(child, parent) {
  if (!child || !parent) return false;
  const resolvedChild = path.resolve(child);
  const resolvedParent = path.resolve(parent);
  if (resolvedChild === resolvedParent) return true;
  return resolvedChild.startsWith(resolvedParent + path.sep);
}

function collectAllowedBrowseRoots(boardSlug) {
  const slug = normalizeBoardSlug(boardSlug) || getCurrentBoardSlug();
  const roots = new Set();

  const wsRoot = workspacesRoot(slug);
  if (fs.existsSync(wsRoot)) roots.add(path.resolve(wsRoot));

  const meta = readBoardMetadata(slug);
  if (meta.default_workdir) {
    const wd = resolveAbsolutePath(meta.default_workdir);
    if (wd && fs.existsSync(wd)) roots.add(wd);
  }

  const profileWs = getProfileWorkspaceDir();
  if (fs.existsSync(profileWs)) roots.add(path.resolve(profileWs));

  const db = openKanbanDbReadonly(slug);
  if (db) {
    try {
      const rows = db
        .prepare(
          `SELECT workspace_path FROM tasks
           WHERE workspace_path IS NOT NULL AND TRIM(workspace_path) != ''`
        )
        .all();
      for (const row of rows) {
        const wp = resolveAbsolutePath(row.workspace_path);
        if (wp && fs.existsSync(wp)) roots.add(wp);
      }
    } finally {
      db.close();
    }
  }

  return { slug, roots: [...roots] };
}

function assertBrowseAllowed(requestedPath, boardSlug) {
  const abs = resolveAbsolutePath(requestedPath);
  if (!abs) throw Object.assign(new Error('Path is required'), { statusCode: 400 });
  const { roots } = collectAllowedBrowseRoots(boardSlug);
  if (!roots.length) {
    throw Object.assign(new Error('No workspace roots available for this board'), { statusCode: 403 });
  }
  for (const root of roots) {
    if (isPathInside(abs, root)) return abs;
  }
  throw Object.assign(new Error('Path is outside allowed workspace roots'), { statusCode: 403 });
}

function sortWorkspaces(items) {
  return items.sort((a, b) => {
    const sa = STATUS_SORT[a.status] ?? 99;
    const sb = STATUS_SORT[b.status] ?? 99;
    if (sa !== sb) return sa - sb;
    const ta = a.sortTime || 0;
    const tb = b.sortTime || 0;
    return tb - ta;
  });
}

function listWorkspaces(boardSlug) {
  const slug = normalizeBoardSlug(boardSlug) || getCurrentBoardSlug();
  const dbPath = kanbanDbPath(slug);
  if (!fs.existsSync(dbPath)) {
    return {
      available: false,
      board: slug,
      defaultWorkdir: null,
      items: [],
      hint: KANBAN_INIT_HINT,
    };
  }

  const meta = readBoardMetadata(slug);
  const items = [];
  const knownPaths = new Set();

  if (meta.default_workdir) {
    const wd = resolveAbsolutePath(meta.default_workdir);
    if (wd) {
      knownPaths.add(wd);
      items.push({
        id: '__board_default__',
        kind: 'default_workdir',
        title: 'Board default workdir',
        status: 'default',
        workspaceKind: 'dir',
        path: wd,
        sortTime: Date.now(),
      });
    }
  }

  const db = openKanbanDbReadonly(slug);
  if (db) {
    try {
      const rows = db
        .prepare(
          `SELECT id, title, status, workspace_kind, workspace_path,
                  created_at, started_at, completed_at
           FROM tasks
           WHERE workspace_path IS NOT NULL AND TRIM(workspace_path) != ''
           ORDER BY COALESCE(completed_at, started_at, created_at) DESC`
        )
        .all();
      for (const row of rows) {
        const wp = resolveAbsolutePath(row.workspace_path);
        if (!wp) continue;
        knownPaths.add(wp);
        items.push({
          id: row.id,
          kind: 'task',
          title: row.title || row.id,
          status: row.status,
          workspaceKind: row.workspace_kind || 'scratch',
          path: wp,
          sortTime: row.completed_at || row.started_at || row.created_at || 0,
        });
      }
    } finally {
      db.close();
    }
  }

  const wsRoot = workspacesRoot(slug);
  if (fs.existsSync(wsRoot)) {
    try {
      for (const name of fs.readdirSync(wsRoot)) {
        if (name.startsWith('.')) continue;
        const full = path.join(wsRoot, name);
        if (!fs.statSync(full).isDirectory()) continue;
        const resolved = path.resolve(full);
        if (knownPaths.has(resolved)) continue;
        items.push({
          id: name,
          kind: 'orphan',
          title: name,
          status: 'unknown',
          workspaceKind: 'scratch',
          path: resolved,
          sortTime: fs.statSync(full).mtimeMs,
        });
      }
    } catch {
      /* ignore scan errors */
    }
  }

  return {
    available: true,
    board: slug,
    defaultWorkdir: meta.default_workdir || null,
    workspacesRoot: wsRoot,
    items: sortWorkspaces(items),
  };
}

function browseWorkspacePath(requestedPath, boardSlug) {
  const abs = assertBrowseAllowed(requestedPath, boardSlug);
  if (!fs.existsSync(abs)) {
    throw Object.assign(new Error('Path does not exist'), { statusCode: 404 });
  }
  const st = fs.statSync(abs);
  if (!st.isDirectory()) {
    return {
      path: abs,
      type: 'file',
      entries: [],
    };
  }

  const entries = [];
  let names;
  try {
    names = fs.readdirSync(abs);
  } catch (e) {
    throw Object.assign(new Error(e.message || 'Cannot read directory'), { statusCode: 403 });
  }

  for (const name of names.sort((a, b) => a.localeCompare(b))) {
    if (name.startsWith('.') && name !== '.hermes') continue;
    if (entries.length >= 200) break;
    const full = path.join(abs, name);
    let entryStat;
    try {
      entryStat = fs.statSync(full);
    } catch {
      continue;
    }
    entries.push({
      name,
      type: entryStat.isDirectory() ? 'directory' : 'file',
      size: entryStat.isFile() ? entryStat.size : null,
      mtime: entryStat.mtimeMs,
    });
  }

  return { path: abs, type: 'directory', entries };
}

function revealWorkspacePath(requestedPath, boardSlug) {
  const abs = assertBrowseAllowed(requestedPath, boardSlug);
  if (process.platform === 'darwin') {
    execSync(`open ${JSON.stringify(abs)}`, { timeout: 5000 });
  } else if (process.platform === 'win32') {
    execSync(`explorer ${JSON.stringify(abs)}`, { timeout: 5000 });
  } else {
    execSync(`xdg-open ${JSON.stringify(abs)}`, { timeout: 5000 });
  }
  return { ok: true, path: abs };
}

function listBoardsViaCli() {
  try {
    const output = execSync('hermes kanban boards list 2>&1', {
      timeout: 10000,
      encoding: 'utf-8',
      maxBuffer: 1024 * 64,
    });
    const boards = [];
    let current = DEFAULT_BOARD;
    for (const line of output.split('\n')) {
      if (line.includes('Current board:')) {
        current = line.split(':').slice(1).join(':').trim() || DEFAULT_BOARD;
      }
      const match = line.match(/^[●○]\s+(\S+)/);
      if (match) {
        boards.push({ slug: match[1], name: match[1], isCurrent: line.startsWith('●') });
      }
    }
    if (boards.length) return { available: true, boards, current, source: 'cli' };
  } catch {
    /* fall through */
  }
  return null;
}

module.exports = {
  DEFAULT_BOARD,
  KANBAN_INIT_HINT,
  getKanbanHome,
  getCurrentBoardSlug,
  kanbanAvailable,
  listBoards,
  switchBoard,
  listWorkspaces,
  browseWorkspacePath,
  revealWorkspacePath,
  listBoardsViaCli,
};
