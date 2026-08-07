// Item 7 app-level drill, step B: boot the real server.cjs against the old DB,
// let runMigrations upgrade it, then verify API works and repair log exists.
// Usage: node olddb-upgrade.cjs <dataDir> <dbPath> [port]
const { spawn } = require('node:child_process');
const { createRequire } = require('node:module');
const req = createRequire('D:/Desktop/rongyi/source/apps/v2/__probe__.cjs');
const Database = req('better-sqlite3');

const dataDir = process.argv[2];
const dbPath = process.argv[3];
const port = process.argv[4] ?? '3988';
const repo = 'D:/Desktop/rongyi/source/apps/v2';

const child = spawn(process.execPath, [require('node:path').join(repo, 'dist-electron', 'server.cjs')], {
  env: {
    ...process.env,
    V2_PORT: port,
    V2_HOST: '127.0.0.1',
    NODE_ENV: 'development',
    V2_ALLOW_DEV_SEED: '1',
    V2_DB_PATH: dbPath,
    V2_DATA_DIR: dataDir,
    V2_BACKUP_DIR: require('node:path').join(dataDir, 'backups'),
    V2_LOG_DIR: require('node:path').join(dataDir, 'logs'),
    V2_LEGACY_DB_PATH: require('node:path').join(repo, 'legacy', 'dental.sqlite'),
    V2_LEGACY_SCHEMA_DIR: require('node:path').join(repo, 'legacy', 'schema'),
    V2_JWT_SECRET: 't2r22-item7-secret-0123456789abcdef0123456789abcdef',
    V2_BACKUP_KEY: 't2r22-item7-backup-key-0123456789abcdef',
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
        if (String(body?.data?.status) === 'ok') return body;
      }
    } catch { /* retry */ }
    await new Promise((r) => setTimeout(r, 400));
  }
  return null;
}

async function main() {
  const health = await waitHealthy();
  if (!health) {
    console.error('UPGRADE FAILED, server log tail:\n' + out.slice(-3000));
    child.kill();
    process.exit(1);
  }
  console.log('health ok:', JSON.stringify(health.data));
  // login
  const lr = await fetch(`http://127.0.0.1:${port}/api/v2/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: 'REDACTED' }),
  });
  const lb = await lr.json();
  console.log('login status:', lr.status, 'token:', Boolean(lb.data?.token));
  const headers = { Authorization: `Bearer ${lb.data.token}` };
  // patients list API
  const pr = await fetch(`http://127.0.0.1:${port}/api/v2/resources/patients?page=1&pageSize=20`, { headers });
  const pb = await pr.json();
  console.log('patients status:', pr.status, 'success:', pb.success, 'count:', pb.data?.items?.length ?? null);
  child.kill();
  await new Promise((r) => child.once('exit', r));

  // verify DB post-upgrade
  const db = new Database(dbPath);
  const versions = db.prepare('SELECT version FROM schema_migrations ORDER BY CAST(version AS INTEGER) DESC LIMIT 3').all();
  console.log('top applied versions after upgrade:', versions.map((r) => r.version).join(','));
  const cards = db.prepare(`SELECT id, clinicId, cardNo FROM MemberCard WHERE cardNo LIKE 'LEGACY-DUP%' ORDER BY id`).all();
  console.log('member cards after upgrade:', JSON.stringify(cards));
  const logs = db.prepare(`SELECT tableName, field, recordId, beforeValue, afterValue, reason FROM MigrationRepairLog WHERE tableName='MemberCard'`).all();
  console.log('repair log entries:', JSON.stringify(logs, null, 2));
  const dupCount = db.prepare(`SELECT COUNT(*) AS n FROM MigrationRepairLog WHERE afterValue LIKE '%-dup-%'`).get().n;
  console.log('DUP-LOG-COUNT:', dupCount);
  const clinicBackfilled = cards.every((c) => c.clinicId !== null);
  console.log('CLINIC-BACKFILLED:', clinicBackfilled);
  const uniqueOk = new Set(cards.map((c) => c.cardNo)).size === cards.length;
  console.log('CARDNOS-UNIQUE:', uniqueOk);
  db.close();
  console.log('DONE');
}
main().catch((e) => { console.error('FAILED', e); child.kill(); process.exit(1); });
