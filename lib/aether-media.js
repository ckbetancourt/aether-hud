/**
 * Secure local media serving for Hermes MEDIA: tokens in chat.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { assertBrowseAllowed, resolveAbsolutePath, IMAGE_EXTENSIONS, mimeFromExt } = require('./workspace-sandbox.js');
const { getAgentBrowseRoots } = require('./hermes-workspaces.js');

function getHermesHome() {
  return path.resolve(
    (process.env.HERMES_HOME || path.join(process.env.HOME || '', '.hermes')).replace(
      /^~/,
      process.env.HOME || ''
    )
  );
}

function parseExtraMediaRoots(envValue) {
  const roots = [];
  if (!envValue) return roots;
  for (const chunk of String(envValue).split(os.platform() === 'win32' ? ';' : ':')) {
    for (const raw of chunk.split(',')) {
      const trimmed = raw.trim();
      if (!trimmed) continue;
      const abs = resolveAbsolutePath(trimmed);
      if (abs) roots.push(abs);
    }
  }
  return roots;
}

function getHermesCacheRoots(hermesHome) {
  return [
    path.join(hermesHome, 'cache', 'images'),
    path.join(hermesHome, 'cache', 'audio'),
    path.join(hermesHome, 'cache', 'videos'),
    path.join(hermesHome, 'cache', 'documents'),
    path.join(hermesHome, 'cache', 'screenshots'),
    path.join(hermesHome, 'image_cache'),
    path.join(hermesHome, 'audio_cache'),
    path.join(hermesHome, 'video_cache'),
    path.join(hermesHome, 'document_cache'),
    path.join(hermesHome, 'browser_screenshots'),
  ];
}

function getMediaAllowedRoots() {
  const roots = new Set(getAgentBrowseRoots());

  const home = process.env.HOME || os.homedir();
  if (home) roots.add(path.resolve(home));

  const hermesHome = getHermesHome();
  for (const cacheRoot of getHermesCacheRoots(hermesHome)) {
    roots.add(cacheRoot);
  }

  for (const extra of parseExtraMediaRoots(process.env.HERMES_MEDIA_ALLOW_DIRS)) {
    roots.add(extra);
  }
  for (const extra of parseExtraMediaRoots(process.env.AETHER_MEDIA_ALLOW_DIRS)) {
    roots.add(extra);
  }

  return [...roots];
}

function cleanMediaPath(raw) {
  let candidate = String(raw || '').trim();
  if (!candidate) return '';

  if (candidate.length >= 2 && candidate[0] === candidate[candidate.length - 1] && '`"\'*'.includes(candidate[0])) {
    candidate = candidate.slice(1, -1).trim();
  }
  candidate = candidate.replace(/^[`"'*]+/, '').replace(/[`"'*,.;:)}]+$/, '');
  return candidate;
}

function resolveMediaFilePath(requestedPath) {
  const cleaned = cleanMediaPath(requestedPath);
  if (!cleaned) {
    throw Object.assign(new Error('Path is required'), { statusCode: 400 });
  }

  if (/^https?:\/\//i.test(cleaned)) {
    throw Object.assign(new Error('Remote URLs must be loaded by the browser'), { statusCode: 400 });
  }

  const abs = assertBrowseAllowed(cleaned, getMediaAllowedRoots());

  let resolved;
  try {
    resolved = fs.realpathSync(abs);
  } catch {
    throw Object.assign(new Error('File not found'), { statusCode: 404 });
  }

  if (!fs.existsSync(resolved) || !fs.statSync(resolved).isFile()) {
    throw Object.assign(new Error('File not found'), { statusCode: 404 });
  }

  const ext = path.extname(resolved).toLowerCase();
  if (!IMAGE_EXTENSIONS.has(ext)) {
    throw Object.assign(new Error('Only image files are supported'), { statusCode: 400 });
  }

  return {
    path: resolved,
    name: path.basename(resolved),
    mime: mimeFromExt(ext),
    size: fs.statSync(resolved).size,
  };
}

module.exports = {
  getMediaAllowedRoots,
  resolveMediaFilePath,
  cleanMediaPath,
  IMAGE_EXTENSIONS,
};
