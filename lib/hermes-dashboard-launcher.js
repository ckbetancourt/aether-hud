/**
 * Spawn and track Hermes dashboard for sessions/model picker (not Kanban UI).
 */
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const HERMES_HOME = process.env.HERMES_HOME || path.join(process.env.HOME || '', '.hermes');
const HERMES_DASHBOARD_URL = (process.env.HERMES_DASHBOARD_URL || 'http://127.0.0.1:9119').replace(/\/$/, '');
const LOG_DIR = path.join(HERMES_HOME, 'logs');
const LOG_PATH = path.join(LOG_DIR, 'aether-dashboard.log');
const PID_PATH = path.join(LOG_DIR, 'aether-dashboard.pid');

let launcherState = {
  state: 'stopped',
  pid: null,
  startedAt: null,
  error: null,
  buildHint: 'First run may build the web UI (1–3 minutes).',
};

async function probeDashboardReachable() {
  try {
    const res = await fetch(`${HERMES_DASHBOARD_URL}/api/status`, {
      method: 'GET',
      signal: AbortSignal.timeout(4000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

function readPidFile() {
  try {
    if (!fs.existsSync(PID_PATH)) return null;
    const pid = Number(fs.readFileSync(PID_PATH, 'utf8').trim());
    return Number.isFinite(pid) ? pid : null;
  } catch {
    return null;
  }
}

function writePidFile(pid) {
  fs.mkdirSync(LOG_DIR, { recursive: true });
  fs.writeFileSync(PID_PATH, String(pid));
}

function clearPidFile() {
  try {
    if (fs.existsSync(PID_PATH)) fs.unlinkSync(PID_PATH);
  } catch {
    /* ignore */
  }
}

function isProcessAlive(pid) {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function refreshLauncherState() {
  if (await probeDashboardReachable()) {
    launcherState.state = 'ready';
    launcherState.error = null;
    return { ...launcherState, dashboardReachable: true, url: HERMES_DASHBOARD_URL };
  }

  const pid = launcherState.pid || readPidFile();
  if (pid && isProcessAlive(pid)) {
    launcherState.state = 'starting';
    launcherState.pid = pid;
    return {
      ...launcherState,
      dashboardReachable: false,
      url: HERMES_DASHBOARD_URL,
      hint: launcherState.buildHint,
    };
  }

  if (launcherState.state === 'starting') {
    launcherState.state = 'error';
    launcherState.error = launcherState.error || 'Dashboard process exited before becoming ready.';
    clearPidFile();
  } else {
    launcherState.state = 'stopped';
  }

  return {
    ...launcherState,
    dashboardReachable: false,
    url: HERMES_DASHBOARD_URL,
  };
}

async function startDashboard(options = {}) {
  const { force = false } = options;
  const status = await refreshLauncherState();
  if (status.dashboardReachable) {
    launcherState.state = 'ready';
    return status;
  }

  const existingPid = readPidFile();
  if (!force && existingPid && isProcessAlive(existingPid)) {
    launcherState.state = 'starting';
    launcherState.pid = existingPid;
    return refreshLauncherState();
  }

  fs.mkdirSync(LOG_DIR, { recursive: true });
  const logFd = fs.openSync(LOG_PATH, 'a');

  let child;
  try {
    child = spawn('hermes', ['dashboard', '--no-open'], {
      detached: true,
      stdio: ['ignore', logFd, logFd],
      env: process.env,
    });
  } catch (e) {
    launcherState.state = 'error';
    launcherState.error = e.message || 'Failed to spawn hermes dashboard';
    return refreshLauncherState();
  }

  child.unref();
  launcherState.state = 'starting';
  launcherState.pid = child.pid;
  launcherState.startedAt = Date.now();
  launcherState.error = null;
  writePidFile(child.pid);

  child.on('exit', (code) => {
    if (launcherState.pid === child.pid) {
      if (launcherState.state === 'starting') {
        launcherState.state = 'error';
        launcherState.error = `Dashboard exited (code ${code ?? 'unknown'}). See ${LOG_PATH}`;
      }
      clearPidFile();
    }
  });

  return refreshLauncherState();
}

module.exports = {
  HERMES_DASHBOARD_URL,
  refreshLauncherState,
  startDashboard,
  probeDashboardReachable,
};
