#!/usr/bin/env node
const { execSync } = require('child_process');

const port = process.env.PORT || 8787;

try {
  const pids = execSync(`lsof -t -i :${port}`, { encoding: 'utf8' })
    .trim()
    .split('\n')
    .filter(Boolean);

  for (const pid of pids) {
    try {
      process.kill(Number(pid), 'SIGTERM');
      console.log(`Stopped process ${pid} on port ${port}`);
    } catch {
      /* already gone */
    }
  }

  if (pids.length) {
    execSync('sleep 0.3');
  }
} catch {
  /* port already free */
}
