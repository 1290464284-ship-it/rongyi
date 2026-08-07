// Seed a data dir for the packaged app: runs dist-electron/server.cjs in dev mode
// against <appdata>/Dental Clinic V2/data, waits for health, then exits.
// Usage: node seed.mjs <appdataDir> [port]
import { spawn } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';

const appdata = process.argv[2];
const port = process.argv[3] ?? '3980';
const repo = 'D:/Desktop/rongyi/source/apps/v2';
const userData = path.join(appdata, 'Dental Clinic V2');

fs.mkdirSync(path.join(userData, 'data'), { recursive: true });

const child = spawn(process.execPath, [path.join(repo, 'dist-electron', 'server.cjs')], {
  env: {
    ...process.env,
    V2_PORT: port,
    V2_HOST: '127.0.0.1',
    NODE_ENV: 'development',
    V2_ALLOW_DEV_SEED: '1',
    V2_DATA_DIR: path.join(userData, 'data'),
    V2_BACKUP_DIR: path.join(userData, 'data', 'backups'),
    V2_LOG_DIR: path.join(userData, 'data', 'logs'),
    V2_LEGACY_DB_PATH: path.join(repo, 'legacy', 'dental.sqlite'),
    V2_LEGACY_SCHEMA_DIR: path.join(repo, 'legacy', 'schema'),
    V2_JWT_SECRET: 't2r22-seed-secret-0123456789abcdef0123456789abcdef',
    V2_BACKUP_KEY: 't2r22-seed-backup-key-0123456789abcdef',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});

let out = '';
child.stdout.on('data', (d) => (out += d));
child.stderr.on('data', (d) => (out += d));

async function waitHealthy() {
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/v2/health`);
      if (res.ok) {
        const body = await res.json();
        if (String(body?.data?.status) === 'ok') return true;
      }
    } catch {
      /* retry */
    }
    await new Promise((r) => setTimeout(r, 400));
  }
  return false;
}

const ok = await waitHealthy();
if (!ok) {
  console.error('SEED FAILED, server log:\n' + out.slice(-4000));
  child.kill();
  process.exit(1);
}
console.log('SEED OK on port', port);
console.log('--- server log tail ---');
console.log(out.split('\n').filter((l) => /listen|seed|migrat|import|error/i.test(l)).slice(-20).join('\n'));
child.kill();
// wait for exit
await new Promise((r) => child.once('exit', r));
console.log('seed server exited');
