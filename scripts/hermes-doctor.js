#!/usr/bin/env node
/**
 * Checks Hermes API gateway + Aether .env.local configuration.
 */
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
require('dotenv').config({ path: path.join(ROOT, '.env') });
require('dotenv').config({ path: path.join(ROOT, '.env.local'), override: true });

const HERMES_HOME = process.env.HERMES_HOME || path.join(process.env.HOME || '', '.hermes');
const HERMES_ENV_PATH = path.join(HERMES_HOME, '.env');
const AETHER_BACKEND = (process.env.AETHER_BACKEND || 'hermes').toLowerCase();
const HERMES_API_BASE_URL = (process.env.HERMES_API_BASE_URL || 'http://127.0.0.1:8642/v1').replace(
  /\/$/,
  ''
);
const HERMES_API_KEY = process.env.HERMES_API_KEY || '';
const HERMES_SESSIONS_URL = (process.env.HERMES_SESSIONS_URL || '').trim();
const HERMES_DASHBOARD_URL = (process.env.HERMES_DASHBOARD_URL || 'http://127.0.0.1:9119').replace(
  /\/$/,
  ''
);

function resolveHermesSessionsListUrl() {
  if (HERMES_SESSIONS_URL) return HERMES_SESSIONS_URL;
  return `${HERMES_DASHBOARD_URL}/api/sessions`;
}

function readHermesEnv() {
  if (!fs.existsSync(HERMES_ENV_PATH)) return {};
  const out = {};
  for (const line of fs.readFileSync(HERMES_ENV_PATH, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let val = trimmed.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    out[key] = val;
  }
  return out;
}

function hasHermesCli() {
  try {
    execSync('hermes --version', { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

async function probeUrl(url, apiKey) {
  const headers = { Accept: 'application/json' };
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
  try {
    const res = await fetch(url, { method: 'GET', headers });
    const text = await res.text();
    return { ok: res.ok, status: res.status, text: text.slice(0, 200) };
  } catch (e) {
    return { ok: false, status: 0, error: e.message };
  }
}

function fail(msg) {
  console.log(`  ✗ ${msg}`);
}

function pass(msg) {
  console.log(`  ✓ ${msg}`);
}

function warn(msg) {
  console.log(`  ! ${msg}`);
}

async function main() {
  console.log('Aether HUD — Hermes connection check\n');

  const hermesEnv = readHermesEnv();
  const apiEnabled = hermesEnv.API_SERVER_ENABLED === 'true';
  const apiKeyHermes = hermesEnv.API_SERVER_KEY || '';
  const apiPort = hermesEnv.API_SERVER_PORT || '8642';

  console.log('1. Hermes CLI');
  if (hasHermesCli()) {
    pass('hermes is installed');
  } else {
    fail('hermes not found — install Hermes Agent first');
    console.log('     https://hermes-agent.nousresearch.com/docs/getting-started/quickstart\n');
    process.exit(1);
  }

  console.log('\n2. Hermes API server config (~/.hermes/.env)');
  if (fs.existsSync(HERMES_ENV_PATH)) {
    pass(`found ${HERMES_ENV_PATH}`);
  } else {
    fail(`missing ${HERMES_ENV_PATH}`);
    warn('create it and add API_SERVER_ENABLED=true and API_SERVER_KEY=your-secret');
  }

  if (apiEnabled) {
    pass('API_SERVER_ENABLED=true');
  } else {
    fail('API_SERVER_ENABLED is not true');
    warn('add to ~/.hermes/.env: API_SERVER_ENABLED=true');
  }

  if (apiKeyHermes) {
    pass('API_SERVER_KEY is set in ~/.hermes/.env');
  } else {
    warn('API_SERVER_KEY not set in ~/.hermes/.env (required when the gateway is running)');
  }

  console.log('\n3. Aether .env.local');
  const localPath = path.join(ROOT, '.env.local');
  if (fs.existsSync(localPath)) {
    pass('found .env.local');
  } else {
    fail('missing .env.local — run: cp .env.example .env.local');
  }

  if (AETHER_BACKEND === 'hermes') {
    pass('AETHER_BACKEND=hermes');
  } else {
    warn(`AETHER_BACKEND=${AETHER_BACKEND} (Hermes bridge expects hermes)`);
  }

  if (HERMES_API_BASE_URL.includes(':8642')) {
    pass(`HERMES_API_BASE_URL=${HERMES_API_BASE_URL}`);
  } else if (HERMES_API_BASE_URL.includes(':8000')) {
    fail(`HERMES_API_BASE_URL=${HERMES_API_BASE_URL} (wrong port — Hermes default is 8642)`);
    warn('use HERMES_API_BASE_URL=http://127.0.0.1:8642/v1');
  } else {
    warn(`HERMES_API_BASE_URL=${HERMES_API_BASE_URL} (expected port 8642 unless you changed API_SERVER_PORT)`);
  }

  if (HERMES_API_KEY) {
    pass('HERMES_API_KEY is set in .env.local');
    if (apiKeyHermes && HERMES_API_KEY !== apiKeyHermes) {
      warn('HERMES_API_KEY does not match API_SERVER_KEY in ~/.hermes/.env');
    }
  } else if (apiKeyHermes) {
    fail('HERMES_API_KEY missing in .env.local');
    warn(`set HERMES_API_KEY=${apiKeyHermes} (same as API_SERVER_KEY)`);
  } else {
    warn('HERMES_API_KEY empty — OK only if gateway allows unauthenticated local access');
  }

  console.log('\n4. Hermes gateway (must be running)');
  warn('Start in another terminal: hermes gateway');
  warn(`Expect: [API Server] listening on http://127.0.0.1:${apiPort}`);

  const healthUrl = `${HERMES_API_BASE_URL.replace(/\/v1$/, '')}/v1/health`;
  const modelsUrl = `${HERMES_API_BASE_URL}/models`;
  const keyToTry = HERMES_API_KEY || apiKeyHermes;

  const health = await probeUrl(healthUrl, keyToTry);
  if (health.ok) {
    pass(`gateway reachable (${healthUrl})`);
  } else if (health.status === 401) {
    fail(`HTTP 401 — wrong API key (check HERMES_API_KEY matches API_SERVER_KEY)`);
  } else if (health.status === 0) {
    fail(`cannot reach ${healthUrl} — is "hermes gateway" running?`);
  } else {
    fail(`health check failed: HTTP ${health.status || 'error'} ${health.error || health.text || ''}`);
  }

  const models = await probeUrl(modelsUrl, keyToTry);
  if (models.ok) {
    pass('/v1/models responds');
  } else if (models.status === 401) {
    fail('/v1/models returned 401 — fix HERMES_API_KEY');
  }

  console.log('\n5. Hermes dashboard (session restore on reload)');
  warn('Start in another terminal for full session import: hermes dashboard');
  const sessionsUrl = resolveHermesSessionsListUrl();
  warn(`Expect sessions API at ${sessionsUrl}`);

  const sessions = await probeUrl(sessionsUrl, null);
  if (sessions.ok) {
    pass(`sessions list reachable (${sessionsUrl})`);
  } else if (sessions.status === 0) {
    warn(`cannot reach ${sessionsUrl} — session restore on reload will use local archives only`);
    warn('run: hermes dashboard');
  } else {
    warn(`sessions list check failed: HTTP ${sessions.status || 'error'} ${sessions.error || sessions.text || ''}`);
  }

  console.log('\n6. Hermes dashboard model picker');
  const modelOptionsUrl = `${HERMES_DASHBOARD_URL}/api/model/options`;
  warn('Required for HUD model switching: hermes dashboard');
  const modelOptions = await probeUrl(modelOptionsUrl, null);
  if (modelOptions.ok) {
    pass(`model options reachable (${modelOptionsUrl})`);
  } else if (modelOptions.status === 0) {
    warn(`cannot reach ${modelOptionsUrl} — HUD model picker falls back to gateway status list`);
    warn('model switching requires: hermes dashboard');
  } else {
    warn(`model options check failed: HTTP ${modelOptions.status || 'error'} ${modelOptions.error || modelOptions.text || ''}`);
  }

  console.log('\n7. Aether HUD server');
  const aetherStatus = await probeUrl(`http://127.0.0.1:${process.env.PORT || 8787}/api/hermes/status`);
  if (aetherStatus.ok) {
    pass('Aether server running — open http://localhost:8787');
  } else {
    warn('Aether server not running — run: npm start');
  }

  console.log('\nDone.\n');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
