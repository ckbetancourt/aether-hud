/**
 * Hermes agent skills (SKILL.md files under ~/.hermes/skills).
 * Enable/disable follows Hermes config.yaml skills.disabled (not file renames).
 */
const fs = require('fs');
const path = require('path');

const SKILL_FILE = 'SKILL.md';
const EXCLUDED_DIRS = new Set(['.git', '.github', '.hub', '.archive']);

function getHermesHome() {
  const raw = process.env.HERMES_HOME || path.join(process.env.HOME || '', '.hermes');
  return path.resolve(String(raw).replace(/^~/, process.env.HOME || ''));
}

function getSkillsDir() {
  const raw = process.env.HERMES_SKILLS_DIR || path.join(getHermesHome(), 'skills');
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

function resolveSkillDir(relativePath) {
  const safePath = sanitizeSkillPath(relativePath);
  const skillsDir = getSkillsDir();
  const dir = path.resolve(skillsDir, ...safePath.split('/'));
  if (dir !== skillsDir && !dir.startsWith(`${skillsDir}${path.sep}`)) {
    throw Object.assign(new Error('Invalid skill path'), { statusCode: 400 });
  }
  return { path: safePath, dir, skillFile: path.join(dir, SKILL_FILE) };
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

function skillCategory(relativePath) {
  const parts = String(relativePath || '').split('/').filter(Boolean);
  return parts.length >= 2 ? parts[0] : '';
}

function readSkillsConfigBlock(configText) {
  const match = configText.match(/^skills:\s*\n(?:[ \t].+\n)*/m);
  return match ? match[0] : '';
}

function parseDisabledSkills(configText) {
  const block = readSkillsConfigBlock(configText);
  if (!block) return [];

  const inline = block.match(/^\s+disabled:\s*\[(.*)\]\s*$/m);
  if (inline) {
    const inner = inline[1].trim();
    if (!inner) return [];
    return inner
      .split(',')
      .map((part) => part.trim().replace(/^['"]|['"]$/g, ''))
      .filter(Boolean);
  }

  const list = [];
  const lines = block.split('\n');
  let inDisabled = false;
  for (const line of lines) {
    if (/^\s+disabled:\s*$/.test(line)) {
      inDisabled = true;
      continue;
    }
    if (inDisabled) {
      const item = line.match(/^\s+-\s+(.+)\s*$/);
      if (item) {
        list.push(item[1].trim().replace(/^['"]|['"]$/g, ''));
        continue;
      }
      if (/^\S/.test(line) || /^\s+[a-zA-Z0-9_-]+:/.test(line)) {
        break;
      }
    }
  }
  return list;
}

function formatDisabledYaml(disabled) {
  const sorted = [...new Set(disabled.map((name) => String(name).trim()).filter(Boolean))].sort();
  if (!sorted.length) return '  disabled: []';
  if (sorted.length <= 4) {
    return `  disabled: [${sorted.join(', ')}]`;
  }
  return `  disabled:\n${sorted.map((name) => `  - ${name}`).join('\n')}`;
}

function readDisabledSkillSet() {
  const configPath = path.join(getHermesHome(), 'config.yaml');
  if (!fs.existsSync(configPath)) return new Set();
  const text = fs.readFileSync(configPath, 'utf8');
  return new Set(parseDisabledSkills(text));
}

function writeDisabledSkillSet(disabledSet) {
  const configPath = path.join(getHermesHome(), 'config.yaml');
  if (!fs.existsSync(configPath)) {
    throw Object.assign(new Error('Hermes config.yaml not found'), { statusCode: 404 });
  }

  const text = fs.readFileSync(configPath, 'utf8');
  const disabledYaml = formatDisabledYaml([...disabledSet]);
  const block = readSkillsConfigBlock(text);

  let nextText;
  if (!block) {
    nextText = `${text.replace(/\s*$/, '')}\nskills:\n${disabledYaml}\n`;
  } else if (/^\s+disabled:/m.test(block)) {
    const updatedBlock = block.replace(/^(\s+)disabled:.*(?:\n(?:\1  - .+\n?)*)?/m, `${disabledYaml}\n`);
    nextText = text.replace(block, updatedBlock.endsWith('\n') ? updatedBlock : `${updatedBlock}\n`);
  } else {
    const updatedBlock = block.replace(/\s*$/, `\n${disabledYaml}\n`);
    nextText = text.replace(block, updatedBlock);
  }

  fs.writeFileSync(configPath, nextText.endsWith('\n') ? nextText : `${nextText}\n`, 'utf8');
}

function findSkillEntries() {
  const skillsDir = getSkillsDir();
  if (!fs.existsSync(skillsDir)) return [];

  const entries = [];

  function walk(currentDir) {
    let dirEntries;
    try {
      dirEntries = fs.readdirSync(currentDir, { withFileTypes: true });
    } catch {
      return;
    }

    const skillFile = path.join(currentDir, SKILL_FILE);
    if (fs.existsSync(skillFile)) {
      const relativePath = path.relative(skillsDir, currentDir).split(path.sep).join('/');
      entries.push({
        path: relativePath,
        dir: currentDir,
        skillFile,
      });
    }

    for (const entry of dirEntries) {
      if (!entry.isDirectory()) continue;
      if (entry.name.startsWith('.') || EXCLUDED_DIRS.has(entry.name)) continue;
      walk(path.join(currentDir, entry.name));
    }
  }

  walk(skillsDir);
  return entries;
}

function readBundledManifest() {
  const manifestPath = path.join(getSkillsDir(), '.bundled_manifest');
  if (!fs.existsSync(manifestPath)) return new Set();
  const names = new Set();
  for (const line of fs.readFileSync(manifestPath, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const name = trimmed.includes(':') ? trimmed.split(':')[0].trim() : trimmed;
    if (name) names.add(name);
  }
  return names;
}

function readHubInstalledMap() {
  const lockPath = path.join(getSkillsDir(), '.hub', 'lock.json');
  if (!fs.existsSync(lockPath)) return new Map();
  try {
    const data = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
    const installed = data?.installed && typeof data.installed === 'object' ? data.installed : {};
    return new Map(Object.entries(installed));
  } catch {
    return new Map();
  }
}

function classifySkillSource(skillName, builtinNames, hubInstalled) {
  const hubEntry = hubInstalled.get(skillName);
  if (hubEntry) {
    return {
      source: 'hub',
      origin: 'custom',
      sourceLabel: 'Downloaded',
      hubSource: hubEntry.source || 'hub',
    };
  }
  if (builtinNames.has(skillName)) {
    return {
      source: 'builtin',
      origin: 'native',
      sourceLabel: 'Native',
      hubSource: null,
    };
  }
  return {
    source: 'local',
    origin: 'custom',
    sourceLabel: 'Custom',
    hubSource: null,
  };
}

function buildSkillRecord(entry, disabledSet, provenance) {
  const content = fs.readFileSync(entry.skillFile, 'utf8');
  const meta = parseSkillFrontmatter(content);
  const skillName = meta.name || path.basename(entry.path);
  const category = skillCategory(entry.path);
  const stat = fs.statSync(entry.skillFile);
  const sourceInfo = classifySkillSource(skillName, provenance.builtinNames, provenance.hubInstalled);

  return {
    name: entry.path,
    skillName,
    displayName: skillName,
    category,
    description: meta.description || '',
    version: meta.version || null,
    tags: meta.tags || [],
    enabled: !disabledSet.has(skillName),
    path: entry.skillFile,
    mtime: stat.mtimeMs,
    source: sourceInfo.source,
    origin: sourceInfo.origin,
    sourceLabel: sourceInfo.sourceLabel,
    hubSource: sourceInfo.hubSource,
  };
}

function summarizeSkillSources(items) {
  const counts = { native: 0, custom: 0, builtin: 0, hub: 0, local: 0 };
  for (const item of items) {
    if (item.origin === 'native') counts.native += 1;
    else counts.custom += 1;
    if (item.source === 'builtin') counts.builtin += 1;
    else if (item.source === 'hub') counts.hub += 1;
    else if (item.source === 'local') counts.local += 1;
  }
  return counts;
}

function listHermesSkills() {
  const skillsDir = getSkillsDir();
  const disabledSet = readDisabledSkillSet();
  const provenance = {
    builtinNames: readBundledManifest(),
    hubInstalled: readHubInstalledMap(),
  };
  const seenSkillNames = new Set();
  const items = [];

  for (const entry of findSkillEntries()) {
    try {
      const item = buildSkillRecord(entry, disabledSet, provenance);
      if (seenSkillNames.has(item.skillName)) continue;
      seenSkillNames.add(item.skillName);
      items.push(item);
    } catch {
      /* skip unreadable skills */
    }
  }

  items.sort((a, b) => {
    const originCompare = a.origin.localeCompare(b.origin);
    if (originCompare !== 0) return originCompare;
    const categoryCompare = (a.category || '').localeCompare(b.category || '', undefined, { sensitivity: 'base' });
    if (categoryCompare !== 0) return categoryCompare;
    return a.displayName.localeCompare(b.displayName, undefined, { sensitivity: 'base' });
  });

  const counts = summarizeSkillSources(items);

  return {
    available: true,
    skillsDir,
    items,
    disabled: [...disabledSet].sort(),
    counts,
  };
}

function getSkillRecordByPath(relativePath) {
  const resolved = resolveSkillDir(relativePath);
  if (!fs.existsSync(resolved.skillFile)) {
    throw Object.assign(new Error('Skill not found'), { statusCode: 404 });
  }
  const disabledSet = readDisabledSkillSet();
  const provenance = {
    builtinNames: readBundledManifest(),
    hubInstalled: readHubInstalledMap(),
  };
  const item = buildSkillRecord(
    { path: resolved.path, dir: resolved.dir, skillFile: resolved.skillFile },
    disabledSet,
    provenance
  );
  return {
    available: true,
    ...item,
    content: fs.readFileSync(resolved.skillFile, 'utf8'),
  };
}

function getHermesSkill(name) {
  return getSkillRecordByPath(name);
}

function saveHermesSkill(name, content) {
  const resolved = resolveSkillDir(name);
  if (!fs.existsSync(resolved.skillFile)) {
    throw Object.assign(new Error('Skill not found'), { statusCode: 404 });
  }

  const text = String(content ?? '');
  if (!text.trim()) {
    throw Object.assign(new Error('Skill content cannot be empty'), { statusCode: 400 });
  }

  fs.mkdirSync(resolved.dir, { recursive: true });
  fs.writeFileSync(resolved.skillFile, text.endsWith('\n') ? text : `${text}\n`, 'utf8');
  return getSkillRecordByPath(resolved.path);
}

function setHermesSkillEnabled(name, enabled) {
  const record = getSkillRecordByPath(name);
  const disabledSet = readDisabledSkillSet();
  const shouldEnable = !!enabled;

  if (shouldEnable) disabledSet.delete(record.skillName);
  else disabledSet.add(record.skillName);

  writeDisabledSkillSet(disabledSet);
  return getSkillRecordByPath(record.name);
}

module.exports = {
  getHermesHome,
  getSkillsDir,
  listHermesSkills,
  getHermesSkill,
  saveHermesSkill,
  setHermesSkillEnabled,
};
