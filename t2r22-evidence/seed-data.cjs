// Seed a data dir for the packaged app: runs dist-electron/server.cjs in dev mode
// against <dataDir> directly (V2_DATA_DIR=<dataDir>), waits for health, then exits.
// Usage: node seed-data.cjs <dataDir> [port]
const { spawn } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');

const dataDir = process.argv[2];
const port = process.argv[3] ?? '3981';
const repo = 'D:/Desktop/rongyi/source/apps/v2';

fs.mkdirSync(dataDir, { recursive: true });

const child = spawn(process.execPath, [path.join(repo, 'dist-electron', 'server.cjs')], {
  env: {
    ...process.env,
    V2_PORT: port,
    V2_HOST: '127.0.0.1',
    NODE_ENV: 'development',
    V2_ALLOW_DEV_SEED: '1',
    V2_DATA_DIR: dataDir,
    V2_BACKUP_DIR: path.join(dataDir, 'backups'),
    V2_LOG_DIR: path.join(dataDir, 'logs'),
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

async function main() {
  const ok = await waitHealthy();
  if (!ok) {
    console.error('SEED FAILED, server log:\n' + out.slice(-4000));
    child.kill();
    process.exit(1);
  }
  console.log('SEED OK on port', port, '->', dataDir);
  console.log('--- server log tail ---');
  console.log(out.split('\n').filter((l) => /listen|seed|migrat|import|error/i.test(l)).slice(-20).join('\n'));
  child.kill();
  await new Promise((r) => child.once('exit', r));
  console.log('seed server exited');
}

main();
