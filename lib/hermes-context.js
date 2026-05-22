/**
 * Hermes memory and context files (MEMORY.md, USER.md, SOUL.md, project context).
 */
const fs = require('fs');
const path = require('path');

const GLOBAL_FILES = [
  { id: 'memory', name: 'MEMORY.md', description: 'Long-term memory Hermes persists across sessions' },
  { id: 'user', name: 'USER.md', description: 'User profile and preferences' },
  { id: 'soul', name: 'SOUL.md', description: 'Global personality and voice defaults' },
];

const PROJECT_FILE_NAMES = ['.hermes.md', 'AGENTS.md', 'CLAUDE.md', '.cursorrules'];

function getHermesHome() {
  return path.resolve(
    (process.env.HERMES_HOME || path.join(process.env.HOME || '', '.hermes')).replace(
      /^~/,
      process.env.HOME || ''
    )
  );
}

function readConfigTerminalCwd(hermesHome) {
  const configPath = path.join(hermesHome, 'config.yaml');
  if (!fs.existsSync(configPath)) return null;
  const text = fs.readFileSync(configPath, 'utf8');
  const block = text.match(/^terminal:\s*\n(?:[ \t].+\n)*/m);
  if (!block) return null;
  const m = block[0].match(/^\s+cwd:\s*(.+)\s*$/m);
  if (!m) return null;
  let raw = m[1].trim();
  if ((raw.startsWith('"') && raw.endsWith('"')) || (raw.startsWith("'") && raw.endsWith("'"))) {
    raw = raw.slice(1, -1);
  }
  if (!raw || raw === '.' || raw === 'auto' || raw === 'cwd') return null;
  return path.resolve(raw.replace(/^~/, process.env.HOME || ''));
}

function safeReadFile(absPath) {
  if (!absPath || !fs.existsSync(absPath)) {
    return { path: absPath, exists: false, content: '', size: 0 };
  }
  const stat = fs.statSync(absPath);
  if (!stat.isFile()) return { path: absPath, exists: false, content: '', size: 0 };
  const content = fs.readFileSync(absPath, 'utf8');
  return { path: absPath, exists: true, content, size: stat.size, mtime: stat.mtimeMs };
}

function listContextFiles(projectCwd) {
  const hermesHome = getHermesHome();
  const cwd = projectCwd || readConfigTerminalCwd(hermesHome);
  const items = [];

  for (const spec of GLOBAL_FILES) {
    const abs = path.join(hermesHome, spec.name);
    const read = safeReadFile(abs);
    items.push({
      id: spec.id,
      scope: 'global',
      name: spec.name,
      path: abs,
      description: spec.description,
      exists: read.exists,
      size: read.size,
      mtime: read.mtime || null,
    });
  }

  if (cwd && fs.existsSync(cwd)) {
    for (const name of PROJECT_FILE_NAMES) {
      const abs = path.join(cwd, name);
      const read = safeReadFile(abs);
      items.push({
        id: `project:${name}`,
        scope: 'project',
        name,
        path: abs,
        description: `Project context in ${cwd}`,
        exists: read.exists,
        size: read.size,
        mtime: read.mtime || null,
        projectRoot: cwd,
      });
    }
  }

  return { items, hermesHome, projectRoot: cwd || null };
}

function readContextFileById(fileId, projectCwd) {
  const { items } = listContextFiles(projectCwd);
  const item = items.find((f) => f.id === fileId);
  if (!item) {
    throw Object.assign(new Error('Unknown context file'), { statusCode: 404 });
  }
  const read = safeReadFile(item.path);
  return { ...item, content: read.content, exists: read.exists };
}

function writeContextFileById(fileId, content, projectCwd) {
  const { items, hermesHome } = listContextFiles(projectCwd);
  const item = items.find((f) => f.id === fileId);
  if (!item) {
    throw Object.assign(new Error('Unknown context file'), { statusCode: 404 });
  }
  const abs = item.path;
  if (item.scope === 'global') {
    if (!abs.startsWith(hermesHome + path.sep) && abs !== hermesHome) {
      throw Object.assign(new Error('Invalid path'), { statusCode: 400 });
    }
  }
  const dir = path.dirname(abs);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(abs, String(content ?? ''), 'utf8');
  return readContextFileById(fileId, projectCwd);
}

module.exports = {
  listContextFiles,
  readContextFileById,
  writeContextFileById,
  GLOBAL_FILES,
};
