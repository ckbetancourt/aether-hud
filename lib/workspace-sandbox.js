/**
 * Shared path sandbox for workspace file browsing.
 */
const fs = require('fs');
const path = require('path');

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

function assertBrowseAllowed(requestedPath, allowedRoots) {
  const abs = resolveAbsolutePath(requestedPath);
  if (!abs) throw Object.assign(new Error('Path is required'), { statusCode: 400 });
  const roots = (allowedRoots || []).map((r) => resolveAbsolutePath(r)).filter(Boolean);
  if (!roots.length) {
    throw Object.assign(new Error('No workspace roots available'), { statusCode: 403 });
  }
  for (const root of roots) {
    if (fs.existsSync(root) && isPathInside(abs, root)) return abs;
  }
  throw Object.assign(new Error('Path is outside allowed workspace roots'), { statusCode: 403 });
}

const IMAGE_EXTENSIONS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.bmp', '.ico', '.avif',
]);

const TEXT_EXTENSIONS = new Set([
  '.txt', '.md', '.markdown', '.json', '.js', '.jsx', '.ts', '.tsx', '.css',
  '.html', '.htm', '.xml', '.yaml', '.yml', '.csv', '.log', '.py', '.sh', '.rb',
  '.go', '.rs', '.sql', '.toml', '.env', '.ini', '.cfg', '.conf', '.vue', '.svelte',
]);

const MIME_BY_EXT = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.bmp': 'image/bmp',
  '.ico': 'image/x-icon',
  '.avif': 'image/avif',
  '.pdf': 'application/pdf',
};

const MAX_READ_BYTES = 512 * 1024;
const MAX_LIST_FILES = 500;
const MAX_LIST_DEPTH = 10;

function mimeFromExt(ext) {
  return MIME_BY_EXT[ext.toLowerCase()] || 'application/octet-stream';
}

function isLikelyTextFile(absPath, buf) {
  const ext = path.extname(absPath).toLowerCase();
  if (TEXT_EXTENSIONS.has(ext)) return true;
  if (IMAGE_EXTENSIONS.has(ext)) return false;
  if (!buf.length) return true;
  if (buf.includes(0)) return false;
  const sample = buf.subarray(0, Math.min(buf.length, 8192));
  for (const byte of sample) {
    if (byte === 9 || byte === 10 || byte === 13) continue;
    if (byte < 32 || byte === 127) return false;
  }
  return true;
}

const SKIP_DIR_NAMES = new Set([
  'node_modules', '.git', 'venv', '.venv', '__pycache__', 'dist', 'build', '.next', '.cache',
]);

function listWorkspaceFiles(absPath, maxFiles = MAX_LIST_FILES, maxDepth = MAX_LIST_DEPTH) {
  if (!fs.existsSync(absPath)) {
    throw Object.assign(new Error('Path does not exist'), { statusCode: 404 });
  }

  const rootStat = fs.statSync(absPath);
  if (rootStat.isFile()) {
    return {
      path: absPath,
      files: [{
        name: path.basename(absPath),
        path: absPath,
        relativePath: path.basename(absPath),
        size: rootStat.size,
        mtime: rootStat.mtimeMs,
      }],
    };
  }

  const files = [];

  function walk(dir, relPrefix, depth) {
    if (depth > maxDepth || files.length >= maxFiles) return;
    let names;
    try {
      names = fs.readdirSync(dir);
    } catch {
      return;
    }
    for (const name of names.sort((a, b) => a.localeCompare(b))) {
      if (name.startsWith('.') && name !== '.hermes') continue;
      const full = path.join(dir, name);
      const rel = relPrefix ? `${relPrefix}/${name}` : name;
      let entryStat;
      try {
        entryStat = fs.statSync(full);
      } catch {
        continue;
      }
      if (entryStat.isDirectory()) {
        if (SKIP_DIR_NAMES.has(name)) continue;
        walk(full, rel, depth + 1);
      } else if (entryStat.isFile()) {
        files.push({
          name,
          path: full,
          relativePath: rel,
          size: entryStat.size,
          mtime: entryStat.mtimeMs,
        });
        if (files.length >= maxFiles) return;
      }
    }
  }

  walk(absPath, '', 0);
  files.sort((a, b) => (b.mtime || 0) - (a.mtime || 0));
  return { path: absPath, files };
}

function readWorkspaceFile(absPath) {
  if (!fs.existsSync(absPath)) {
    throw Object.assign(new Error('File does not exist'), { statusCode: 404 });
  }
  const st = fs.statSync(absPath);
  if (!st.isFile()) {
    throw Object.assign(new Error('Path is not a file'), { statusCode: 400 });
  }

  const ext = path.extname(absPath).toLowerCase();
  if (IMAGE_EXTENSIONS.has(ext)) {
    return {
      kind: 'image',
      path: absPath,
      name: path.basename(absPath),
      mime: mimeFromExt(ext),
      size: st.size,
    };
  }

  if (st.size > MAX_READ_BYTES) {
    throw Object.assign(new Error('File too large to preview in HUD'), { statusCode: 413 });
  }

  const buf = fs.readFileSync(absPath);
  if (!isLikelyTextFile(absPath, buf)) {
    return {
      kind: 'binary',
      path: absPath,
      name: path.basename(absPath),
      size: st.size,
    };
  }

  return {
    kind: 'text',
    path: absPath,
    name: path.basename(absPath),
    content: buf.toString('utf8'),
    size: st.size,
  };
}

function browseDirectory(absPath, maxEntries = 200) {
  if (!fs.existsSync(absPath)) {
    throw Object.assign(new Error('Path does not exist'), { statusCode: 404 });
  }
  const st = fs.statSync(absPath);
  if (!st.isDirectory()) {
    return { path: absPath, type: 'file', entries: [] };
  }

  const entries = [];
  let names;
  try {
    names = fs.readdirSync(absPath);
  } catch (e) {
    throw Object.assign(new Error(e.message || 'Cannot read directory'), { statusCode: 403 });
  }

  for (const name of names.sort((a, b) => a.localeCompare(b))) {
    if (name.startsWith('.') && name !== '.hermes') continue;
    if (entries.length >= maxEntries) break;
    const full = path.join(absPath, name);
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

  return { path: absPath, type: 'directory', entries };
}

module.exports = {
  resolveAbsolutePath,
  isPathInside,
  assertBrowseAllowed,
  browseDirectory,
  listWorkspaceFiles,
  readWorkspaceFile,
  mimeFromExt,
  IMAGE_EXTENSIONS,
  TEXT_EXTENSIONS,
  MAX_READ_BYTES,
};
