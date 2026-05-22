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

function sanitizeSkillPath(relativePath) {
  const value = String(relativePath || '')
    .trim()
    .replace(/\\/g, '/')
    .replace(/^\/+|\/+$/g, '');
  if (!value || value.includes('..') || !/^[a-zA-Z0-9._/-]+$/.test(value)) {
    throw Object.assign(new Error('Invalid skill path'), { statusCode: 400 });
  }
  return value;
}

function resolveSkillPaths(relativePath) {
  const safePath = sanitizeSkillPath(relativePath);
  const skillsDir = getSkillsDir();
  const dir = path.resolve(skillsDir, ...safePath.split('/'));
  if (dir !== skillsDir && !dir.startsWith(`${skillsDir}${path.sep}`)) {
    throw Object.assign(new Error('Invalid skill path'), { statusCode: 400 });
  }
  return {
    name: safePath,
    dir,
    activePath: path.join(dir, SKILL_FILE),
    disabledPath: path.join(dir, DISABLED_SKILL_FILE),
  };
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

function readSkillContent(paths) {
  if (fs.existsSync(paths.activePath)) {
    return { content: fs.readFileSync(paths.activePath, 'utf8'), enabled: true, file: SKILL_FILE };
  }
  if (fs.existsSync(paths.disabledPath)) {
    return { content: fs.readFileSync(paths.disabledPath, 'utf8'), enabled: false, file: DISABLED_SKILL_FILE };
  }
  return null;
}

function skillCategory(relativePath) {
  const parts = String(relativePath || '').split('/').filter(Boolean);
  return parts.length > 1 ? parts[0] : '';
}

function buildSkillItem(relativePath, paths, read) {
  const meta = parseSkillFrontmatter(read.content);
  const category = skillCategory(relativePath);
  return {
    name: relativePath,
    displayName: meta.name || path.basename(relativePath),
    category,
    description: meta.description || '',
    version: meta.version || null,
    tags: meta.tags || [],
    enabled: read.enabled,
    path: read.enabled ? paths.activePath : paths.disabledPath,
    mtime: fs.statSync(read.enabled ? paths.activePath : paths.disabledPath).mtimeMs,
  };
}

function walkSkillDirectories(baseDir, relativePrefix = '') {
  const items = [];
  if (!fs.existsSync(baseDir)) return items;

  for (const entry of fs.readdirSync(baseDir, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue;
    if (!entry.isDirectory()) continue;

    const relativePath = relativePrefix ? `${relativePrefix}/${entry.name}` : entry.name;
    const dir = path.join(baseDir, entry.name);
    const paths = {
      name: relativePath,
      dir,
      activePath: path.join(dir, SKILL_FILE),
      disabledPath: path.join(dir, DISABLED_SKILL_FILE),
    };
    const read = readSkillContent(paths);

    if (read) {
      items.push(buildSkillItem(relativePath, paths, read));
      continue;
    }

    items.push(...walkSkillDirectories(dir, relativePath));
  }

  return items;
}

function listHermesSkills() {
  const skillsDir = getSkillsDir();
  if (!fs.existsSync(skillsDir)) {
    return { available: true, skillsDir, items: [] };
  }

  const items = walkSkillDirectories(skillsDir);
  items.sort((a, b) => {
    const categoryCompare = (a.category || '').localeCompare(b.category || '', undefined, { sensitivity: 'base' });
    if (categoryCompare !== 0) return categoryCompare;
    return a.displayName.localeCompare(b.displayName, undefined, { sensitivity: 'base' });
  });

  return { available: true, skillsDir, items };
}

function getHermesSkill(name) {
  const paths = resolveSkillPaths(name);
  const read = readSkillContent(paths);
  if (!read) {
    throw Object.assign(new Error('Skill not found'), { statusCode: 404 });
  }

  const item = buildSkillItem(paths.name, paths, read);
  return {
    available: true,
    ...item,
    content: read.content,
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
