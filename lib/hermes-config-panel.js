/**
 * Read Hermes config.yaml highlights for HUD runtime panel (MCP, toolsets, security, terminal).
 */
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

function getHermesHome() {
  return path.resolve(
    (process.env.HERMES_HOME || path.join(process.env.HOME || '', '.hermes')).replace(
      /^~/,
      process.env.HOME || ''
    )
  );
}

function readConfigYaml() {
  const configPath = path.join(getHermesHome(), 'config.yaml');
  if (!fs.existsSync(configPath)) {
    return { path: configPath, exists: false, text: '' };
  }
  return { path: configPath, exists: true, text: fs.readFileSync(configPath, 'utf8') };
}

function readBlock(text, key) {
  const re = new RegExp(`^${key}:\\s*\\n(?:[ \\t].+\\n)*`, 'm');
  const match = text.match(re);
  return match ? match[0] : '';
}

function parseYamlList(block, listKey) {
  const inline = block.match(new RegExp(`^\\s+${listKey}:\\s*\\[(.*)\\]\\s*$`, 'm'));
  if (inline) {
    const inner = inline[1].trim();
    if (!inner) return [];
    return inner.split(',').map((s) => s.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean);
  }
  const items = [];
  const lines = block.split('\n');
  let inList = false;
  for (const line of lines) {
    if (new RegExp(`^\\s+${listKey}:\\s*$`).test(line)) {
      inList = true;
      continue;
    }
    if (inList) {
      const m = line.match(/^\s+-\s+(.+)$/);
      if (m) items.push(m[1].trim().replace(/^['"]|['"]$/g, ''));
      else if (/^\S/.test(line)) break;
    }
  }
  return items;
}

function parseScalar(block, key) {
  const m = block.match(new RegExp(`^\\s+${key}:\\s*(.+?)\\s*$`, 'm'));
  if (!m) return null;
  let val = m[1].trim();
  if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
    val = val.slice(1, -1);
  }
  return val;
}

function parseMcpServers(text) {
  const block = readBlock(text, 'mcp');
  if (!block) return [];
  const serversBlock = block.match(/^(\s+servers:\s*\n(?:\s+.+\n)*)/m);
  if (!serversBlock) return [];
  const servers = [];
  const lines = serversBlock[1].split('\n');
  let current = null;
  for (const line of lines) {
    const nameMatch = line.match(/^\s{4}(\S+):\s*$/);
    if (nameMatch) {
      if (current) servers.push(current);
      current = { name: nameMatch[1], command: null, url: null, enabled: true };
      continue;
    }
    if (!current) continue;
    const cmd = line.match(/^\s+command:\s*(.+)$/);
    if (cmd) current.command = cmd[1].trim();
    const url = line.match(/^\s+url:\s*(.+)$/);
    if (url) current.url = url[1].trim();
    const dis = line.match(/^\s+enabled:\s*(false|true)/i);
    if (dis) current.enabled = dis[1].toLowerCase() === 'true';
  }
  if (current) servers.push(current);
  return servers;
}

function getConfigSummary() {
  const { path: configPath, exists, text } = readConfigYaml();
  if (!exists) {
    return {
      available: false,
      configPath,
      error: 'config.yaml not found',
      mcpServers: [],
      toolsets: { enabled: [], disabled: [] },
      security: {},
      terminal: {},
    };
  }

  const toolsBlock = readBlock(text, 'tools');
  const securityBlock = readBlock(text, 'security');
  const terminalBlock = readBlock(text, 'terminal');

  return {
    available: true,
    configPath,
    mcpServers: parseMcpServers(text),
    toolsets: {
      enabled: parseYamlList(toolsBlock, 'enabled_toolsets'),
      disabled: parseYamlList(toolsBlock, 'disabled_toolsets'),
    },
    security: {
      requireApproval: parseScalar(securityBlock, 'require_approval'),
      allowedUsers: parseYamlList(securityBlock, 'allowed_users'),
      containerMode: parseScalar(securityBlock, 'container_mode'),
    },
    terminal: {
      backend: parseScalar(terminalBlock, 'backend') || 'local',
      cwd: parseScalar(terminalBlock, 'cwd'),
    },
    rawLength: text.length,
  };
}

function setConfigViaCli(key, value) {
  try {
    const out = execSync(`hermes config set ${JSON.stringify(key)} ${JSON.stringify(String(value))} 2>&1`, {
      encoding: 'utf8',
      timeout: 15000,
    });
    return { ok: true, output: out.trim() };
  } catch (e) {
    const err = new Error(e.stderr?.toString() || e.stdout?.toString() || e.message);
    err.statusCode = 502;
    throw err;
  }
}

module.exports = {
  getConfigSummary,
  setConfigViaCli,
  readConfigYaml,
};
