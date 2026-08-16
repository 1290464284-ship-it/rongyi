import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveSimulatedDataDir } from './simulated-data.mjs';
import { SIM_ADMIN_PASSWORD } from './lib/sim-admin.mjs';
import { pickFreePort } from './lib/smoke-runtime.mjs';
import { createDrill } from './lib/drill-runtime.mjs';

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const serverScript = path.join(appRoot, 'dist-electron', 'server.cjs');
const restoreScript = path.join(appRoot, 'scripts', 'restore-backup.mjs');
const verifyScript = path.join(appRoot, 'scripts', 'verify-database.mjs');
const legacyDb = path.join(appRoot, 'legacy', 'dental.sqlite');
const legacySchemaDir = path.join(appRoot, 'legacy', 'schema');
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'v2-disaster-drill-'));
const dataDir = path.join(tempRoot, 'data');
const backupDir = path.join(dataDir, 'backups');
const logDir = path.join(dataDir, 'logs');
const port = await pickFreePort(40000, 40999);
const jwtSecret = 'disaster-drill-secret-0123456789abcdef0123456789abcdef';
const goodKey = 'disaster-good-key-0123456789abcdef';
const wrongKey = 'disaster-wrong-key-9876543210abcdef';
// 模拟库管理员密码固定（simulate-clinic-data.ts 硬编码，不读外层 env）。
// 本 drill 复制模拟库启动 API，登录必须用该固定口令；取外层 V2_ADMIN_PASSWORD
// （CI smoke job 的 dev-server 引导口令）会 401。
const adminPassword = SIM_ADMIN_PASSWORD;

const sourceSimDir = resolveSimulatedDataDir();
if (!sourceSimDir) {
  console.error('Simulated clinic database not found. Run simulate:clinic-data first.');
  process.exit(1);
}

fs.mkdirSync(dataDir, { recursive: true });
fs.mkdirSync(backupDir, { recursive: true });
fs.mkdirSync(logDir, { recursive: true });
for (const suffix of ['', '-wal', '-shm']) {
  const source = path.join(sourceSimDir, `v2.sqlite${suffix}`);
  if (fs.existsSync(source)) fs.copyFileSync(source, path.join(dataDir, `v2.sqlite${suffix}`));
}

const drill = createDrill({
  appRoot,
  serverScript,
  legacyDb,
  legacySchemaDir,
  dataDir,
  backupDir,
  logDir,
  port,
  jwtSecret,
  backupKey: goodKey,
  adminPassword,
  readyLabel: 'disaster drill',
});

const { startApi, stopApi, request, baseEnv, assert } = drill;

function runNode(scriptPath, args = [], env = {}) {
  return spawnSync(process.execPath, [scriptPath, ...args], {
    cwd: appRoot,
    env: baseEnv(env),
    encoding: 'utf8',
  });
}

try {
  await startApi();
  const login = await request('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ username: 'admin', password: adminPassword }),
  });
  const patient = await request('/resources/patients', {
    method: 'POST',
    body: JSON.stringify({
      code: `DISASTER-${Date.now()}`,
      name: 'Disaster Drill Patient',
      gender: 'UNKNOWN',
      phone: '13600000001',
      source: 'OTHER',
      active: true,
    }),
  }, login.token);
  const backup = await request('/backups', { method: 'POST', body: '{}' }, login.token);
  const backupPath = path.join(backupDir, backup.filename);
  const verified = await request(`/backups/${encodeURIComponent(backup.filename)}/verify`, {}, login.token);
  assert(verified.integrity === 'ok', 'backup verification failed');
  await stopApi();

  const wrongTarget = path.join(dataDir, 'restore-wrong-key.sqlite');
  const wrongResult = runNode(restoreScript, [backupPath, wrongTarget], { V2_BACKUP_KEY: wrongKey });
  assert(wrongResult.status !== 0, 'wrong backup key restore must fail');
  assert(!fs.existsSync(wrongTarget), 'wrong backup key must not write the target database');
  console.log('PASS wrong backup key is rejected and target is untouched');

  const corruptPath = path.join(dataDir, 'corrupt.enc');
  fs.copyFileSync(backupPath, corruptPath);
  const bytes = fs.readFileSync(corruptPath);
  bytes[Math.floor(bytes.length / 2)] ^= 0xff;
  fs.writeFileSync(corruptPath, bytes);
  const corruptTarget = path.join(dataDir, 'restore-corrupt.sqlite');
  const corruptResult = runNode(restoreScript, [corruptPath, corruptTarget], { V2_BACKUP_KEY: goodKey });
  assert(corruptResult.status !== 0, 'corrupt backup restore must fail');
  assert(!fs.existsSync(corruptTarget), 'corrupt backup must not write the target database');
  console.log('PASS corrupt backup is rejected and target is untouched');

  const goodTarget = path.join(dataDir, 'restore-good.sqlite');
  const goodResult = runNode(restoreScript, [backupPath, goodTarget], { V2_BACKUP_KEY: goodKey });
  assert(goodResult.status === 0, 'good backup restore must succeed');
  const verifyResult = runNode(verifyScript, [], { V2_DB_PATH: goodTarget });
  assert(verifyResult.status === 0, 'restored database integrity check failed');
  console.log(`PASS good backup restores with integrity ok (patient=${patient.id})`);
  console.log('disaster drill passed: wrong key, corrupt backup, good restore');
} finally {
  await stopApi();
  fs.rmSync(tempRoot, { recursive: true, force: true });
}
