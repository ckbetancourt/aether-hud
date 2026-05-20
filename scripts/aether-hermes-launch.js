#!/usr/bin/env node
const { spawn } = require('child_process');
const http = require('http');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const PORT = Number(process.env.PORT) || 8787;
const HOST = process.env.AETHER_HOST || '127.0.0.1';
const URL = process.env.AETHER_URL || `http://localhost:${PORT}`;
const SHOULD_OPEN = process.argv.includes('--open') || process.argv.includes('-o');

function request(pathname) {
  return new Promise((resolve) => {
    const req = http.get({ hostname: HOST, port: PORT, path: pathname, timeout: 1200 }, (res) => {
      res.resume();
      resolve(res.statusCode || 0);
    });
    req.on('timeout', () => {
      req.destroy();
      resolve(0);
    });
    req.on('error', () => resolve(0));
  });
}

function requestJson(pathname) {
  return new Promise((resolve) => {
    const req = http.get({ hostname: HOST, port: PORT, path: pathname, timeout: 1200 }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode || 0, json: JSON.parse(Buffer.concat(chunks).toString('utf8')) });
        } catch {
          resolve({ status: res.statusCode || 0, json: null });
        }
      });
    });
    req.on('timeout', () => {
      req.destroy();
      resolve({ status: 0, json: null });
    });
    req.on('error', () => resolve({ status: 0, json: null }));
  });
}

async function waitForHud() {
  for (let i = 0; i < 20; i += 1) {
    const status = await request('/');
    if (status >= 200 && status < 500) return true;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return false;
}

function startHud() {
  const child = spawn(process.execPath, [path.join(ROOT, 'server.js')], {
    cwd: ROOT,
    detached: true,
    stdio: 'ignore',
    env: {
      ...process.env,
      AETHER_BACKEND: process.env.AETHER_BACKEND || 'hermes',
    },
  });
  child.unref();
}

function openHud() {
  if (!SHOULD_OPEN) return;
  const command = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'cmd' : 'xdg-open';
  const args = process.platform === 'win32' ? ['/c', 'start', '', URL] : [URL];
  const opener = spawn(command, args, { detached: true, stdio: 'ignore' });
  opener.unref();
}

async function main() {
  const alreadyRunning = (await request('/')) >= 200;
  if (!alreadyRunning) {
    startHud();
  }

  const ready = await waitForHud();
  if (!ready) {
    console.error(`Aether HUD did not become ready on ${URL}. Check PORT=${PORT} and server logs.`);
    process.exit(1);
  }

  openHud();
  console.log(`Aether HUD ready: ${URL}`);
  const hermesStatus = await requestJson('/api/hermes/status');
  if (hermesStatus.json?.enabled) {
    console.log(`Hermes bridge mode: ${hermesStatus.json.connected ? 'connected' : 'waiting for Hermes API'}.`);
  } else {
    console.warn('Aether is running, but this server was not started in Hermes mode. Set AETHER_BACKEND=hermes or restart with npm run hermes:launch.');
  }
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
