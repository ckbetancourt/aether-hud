/**
 * Long-lived Hermes kanban Python bridge — avoids cold-start per request.
 */
const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { spawn } = require('child_process');

const ROOT = path.join(__dirname, '..');
const BRIDGE_SCRIPT = path.join(__dirname, 'hermes_kanban_bridge.py');
const HERMES_HOME = process.env.HERMES_HOME || path.join(process.env.HOME || '', '.hermes');
const HERMES_AGENT_ROOT = process.env.HERMES_AGENT_ROOT || path.join(HERMES_HOME, 'hermes-agent');

let workerProcess = null;
let workerStarting = null;
let nextId = 1;
const pending = new Map();

function resolveHermesPythonBin() {
  const candidates = [
    process.env.HERMES_PYTHON,
    path.join(HERMES_AGENT_ROOT, 'venv', 'bin', 'python'),
    path.join(HERMES_AGENT_ROOT, 'venv', 'bin', 'python3'),
    'python3',
  ].filter(Boolean);
  for (const candidate of candidates) {
    try {
      if (candidate.includes(path.sep) && fs.existsSync(candidate)) return candidate;
      if (!candidate.includes(path.sep)) return candidate;
    } catch {
      /* continue */
    }
  }
  return 'python3';
}

function hermesPythonEnv() {
  return {
    ...process.env,
    HERMES_HOME,
    HERMES_AGENT_ROOT,
    PYTHONPATH: [HERMES_AGENT_ROOT, process.env.PYTHONPATH].filter(Boolean).join(path.delimiter),
  };
}

function rejectAllPending(reason) {
  for (const [, entry] of pending) {
    clearTimeout(entry.timer);
    entry.reject(reason);
  }
  pending.clear();
}

function handleWorkerExit(code, signal) {
  workerProcess = null;
  workerStarting = null;
  const err = new Error(`Kanban bridge worker exited (${signal || code || 'unknown'})`);
  rejectAllPending(err);
}

function ensureWorker() {
  if (workerProcess) return Promise.resolve();
  if (workerStarting) return workerStarting;

  workerStarting = new Promise((resolve, reject) => {
    const python = resolveHermesPythonBin();
    const child = spawn(python, [BRIDGE_SCRIPT, '--worker'], {
      cwd: ROOT,
      env: hermesPythonEnv(),
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    workerProcess = child;

    const rl = readline.createInterface({ input: child.stdout });
    rl.on('line', (line) => {
      let msg;
      try {
        msg = JSON.parse(line);
      } catch {
        return;
      }
      if (msg.ready === true) {
        resolve();
        return;
      }
      if (msg.ready === false) {
        const err = new Error(msg.error || 'Kanban bridge worker failed to start');
        reject(err);
        return;
      }
      if (msg.id == null || !pending.has(msg.id)) return;
      const entry = pending.get(msg.id);
      pending.delete(msg.id);
      clearTimeout(entry.timer);
      if (msg.ok === false) {
        const err = new Error(msg.error || 'Kanban operation failed');
        err.status = msg.status || 500;
        entry.reject(err);
      } else {
        entry.resolve(msg);
      }
    });

    child.stderr.on('data', (chunk) => {
      const text = String(chunk || '').trim();
      if (text) console.error('[kanban-bridge-worker]', text.split('\n')[0]);
    });
    child.on('error', (err) => {
      handleWorkerExit(null, err.message);
      reject(err);
    });
    child.on('exit', (code, signal) => {
      handleWorkerExit(code, signal);
    });
  }).finally(() => {
    workerStarting = null;
  });

  return workerStarting;
}

async function request(op, params = {}, timeoutMs = 120000) {
  await ensureWorker();
  if (!workerProcess?.stdin?.writable) {
    throw new Error('Kanban bridge worker is not running');
  }

  const id = nextId++;
  const payload = JSON.stringify({ id, op, params });

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`Kanban bridge timeout for ${op}`));
    }, timeoutMs);

    pending.set(id, { resolve, reject, timer });

    try {
      workerProcess.stdin.write(`${payload}\n`);
    } catch (err) {
      clearTimeout(timer);
      pending.delete(id);
      reject(err);
    }
  });
}

function shutdown() {
  if (workerProcess) {
    try {
      workerProcess.kill('SIGTERM');
    } catch {
      /* ignore */
    }
  }
  workerProcess = null;
  workerStarting = null;
  rejectAllPending(new Error('Kanban bridge worker shut down'));
}

module.exports = {
  request,
  shutdown,
  ensureWorker,
};
