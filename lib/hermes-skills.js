/**
 * Hermes agent skills (SKILL.md files under ~/.hermes/skills).
 * Disabled skills use SKILL.md.disabled so Hermes skips them until re-enabled.
 */
const fs = require('fs');
const path = require('path');

const SKILL_FILE = 'SKILL.md';
const DISABLED_SKILL_FILE = 'SKILL.md.disabled';

function getSkillsDir() {
  const raw = process.env.HERMES_SKILLS_DIR || path.join(process.env.HOME || '', '.hermes', 'skills');
  return path.resolve(String(raw).replace(/^~/, process.env.HOME || ''));
}

function sanitizeSkillName(name) {
  const value = String(name || '').trim();
  if (!value || !/^[a-zA-Z0-9._-]+$/.test(value)) {
    throw Object.assign(new Error('Invalid skill name'), { statusCode: 400 });
  }
  return value;
}

function parseSkillFrontmatter(content) {
  const text = String(content || '');
  const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) {
    return { name: null, description: null, version: null, tags: [] };
  }

  const block = match[1];
  const readField = (key) => {
    const m = block.match(new RegExp(`^${key}:\\s*(.+)$`, 'm'));
    return m ? m[1].trim().replace(/^['"]|['"]$/g, '') : null;
  };

  let tags = [];
  const tagsMatch = block.match(/tags:\s*\[([^\]]*)\]/);
  if (tagsMatch) {
    tags = tagsMatch[1]
      .split(',')
      .map((t) => t.trim().replace(/^['"]|['"]$/g, ''))
      .filter(Boolean);
  }

  return {
    name: readField('name'),
    description: readField('description'),
    version: readField('version'),
    tags,
  };
}

function resolveSkillPaths(name) {
  const safeName = sanitizeSkillName(name);
  const dir = path.join(getSkillsDir(), safeName);
  return {
    name: safeName,
    dir,
    activePath: path.join(dir, SKILL_FILE),
    disabledPath: path.join(dir, DISABLED_SKILL_FILE),
  };
}

function readSkillContent(paths) {
  if (fs.existsSync(paths.activePath)) {
    return { content: fs.readFileSync(paths.activePath, 'utf8'), enabled: true, file: SKILL_FILE };
  }
  if (fs.existsSync(paths.disabledPath)) {
    return { content: fs.readFileSync(paths.disabledPath, 'utf8'), enabled: false, file: DISABLED_SKILL_FILE };
  }
  return null;
}

function listHermesSkills() {
  const skillsDir = getSkillsDir();
  if (!fs.existsSync(skillsDir)) {
    return { available: true, skillsDir, items: [] };
  }

  const items = [];
  for (const entry of fs.readdirSync(skillsDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const name = entry.name;
    if (!/^[a-zA-Z0-9._-]+$/.test(name)) continue;

    const paths = resolveSkillPaths(name);
    const read = readSkillContent(paths);
    if (!read) continue;

    const meta = parseSkillFrontmatter(read.content);
    items.push({
      name,
      displayName: meta.name || name,
      description: meta.description || '',
      version: meta.version || null,
      tags: meta.tags || [],
      enabled: read.enabled,
      path: read.enabled ? paths.activePath : paths.disabledPath,
      mtime: fs.statSync(read.enabled ? paths.activePath : paths.disabledPath).mtimeMs,
    });
  }

  items.sort((a, b) => a.displayName.localeCompare(b.displayName, undefined, { sensitivity: 'base' }));
  return { available: true, skillsDir, items };
}

function getHermesSkill(name) {
  const paths = resolveSkillPaths(name);
  const read = readSkillContent(paths);
  if (!read) {
    throw Object.assign(new Error('Skill not found'), { statusCode: 404 });
  }

  const meta = parseSkillFrontmatter(read.content);
  return {
    available: true,
    name: paths.name,
    displayName: meta.name || paths.name,
    description: meta.description || '',
    version: meta.version || null,
    tags: meta.tags || [],
    enabled: read.enabled,
    content: read.content,
    path: read.enabled ? paths.activePath : paths.disabledPath,
  };
}

function saveHermesSkill(name, content) {
  const paths = resolveSkillPaths(name);
  const read = readSkillContent(paths);
  if (!read) {
    throw Object.assign(new Error('Skill not found'), { statusCode: 404 });
  }

  const text = String(content ?? '');
  if (!text.trim()) {
    throw Object.assign(new Error('Skill content cannot be empty'), { statusCode: 400 });
  }

  fs.mkdirSync(paths.dir, { recursive: true });
  const target = read.enabled ? paths.activePath : paths.disabledPath;
  fs.writeFileSync(target, text.endsWith('\n') ? text : `${text}\n`, 'utf8');

  return getHermesSkill(name);
}

function setHermesSkillEnabled(name, enabled) {
  const paths = resolveSkillPaths(name);
  const read = readSkillContent(paths);
  if (!read) {
    throw Object.assign(new Error('Skill not found'), { statusCode: 404 });
  }

  const shouldEnable = !!enabled;
  if (read.enabled === shouldEnable) {
    return getHermesSkill(name);
  }

  if (shouldEnable) {
    fs.renameSync(paths.disabledPath, paths.activePath);
  } else {
    fs.renameSync(paths.activePath, paths.disabledPath);
  }

  return getHermesSkill(name);
}

module.exports = {
  getSkillsDir,
  listHermesSkills,
  getHermesSkill,
  saveHermesSkill,
  setHermesSkillEnabled,
};
