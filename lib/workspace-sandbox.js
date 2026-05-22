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
};
