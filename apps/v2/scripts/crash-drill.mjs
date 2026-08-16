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
const legacyDb = path.join(appRoot, 'legacy', 'dental.sqlite');
const legacySchemaDir = path.join(appRoot, 'legacy', 'schema');
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'v2-crash-drill-'));
const dataDir = path.join(tempRoot, 'data');
const backupDir = path.join(dataDir, 'backups');
const logDir = path.join(dataDir, 'logs');
const port = await pickFreePort(42000, 42999);
// 模拟库管理员密码固定（simulate-clinic-data.ts 硬编码）；本 drill 复制模拟库，
// 登录必须用固定口令（同 disaster-drill），统一取自 lib/sim-admin.mjs。
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
  jwtSecret: 'crash-drill-jwt-0123456789abcdef0123456789abcdef',
  backupKey: 'crash-drill-backup-key-0123456789abcdef',
  adminPassword,
  stdio: ['ignore', 'ignore', 'inherit'],
  readyLabel: 'crash drill',
});

const { spawnApi, stopApi, request, waitForApi, assert } = drill;

function forceKillApi() {
  const target = drill.apiProcess;
  if (!target || target.exitCode !== null) return Promise.resolve();
  const pid = target.pid;
  if (pid == null) return Promise.resolve();
  return new Promise((resolve) => {
    target.once('exit', resolve);
    if (process.platform === 'win32') {
      spawnSync('taskkill', ['/pid', String(pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
    } else {
      target.kill('SIGKILL');
    }
    setTimeout(() => {
      if (target && target.exitCode === null && drill.apiProcess === target) target.kill('SIGKILL');
    }, 5000).unref();
  });
}

try {
  spawnApi();
  await waitForApi();
  const login = await request('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ username: 'admin', password: adminPassword }),
  });
  const code = `CRASH-${Date.now()}`;
  const patient = await request('/resources/patients', {
    method: 'POST',
    body: JSON.stringify({
      code,
      name: 'Crash Drill Patient',
      gender: 'UNKNOWN',
      phone: '13600000002',
      source: 'OTHER',
      active: true,
    }),
  }, login.token);
  await forceKillApi();
  await stopApi();

  spawnApi();
  await waitForApi();
  const relogin = await request('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ username: 'admin', password: adminPassword }),
  });
  const list = await request('/resources/patients?page=1&pageSize=100', {}, relogin.token);
  const restored = (list.items ?? []).some((row) => String(row.id) === String(patient.id));
  assert(restored, 'patient written before the crash was lost after restart');
  const integrity = await request('/health/deep', {}, relogin.token);
  console.log('crash drill passed', {
    patient: patient.id,
    integrity: integrity.database?.quickCheck ?? integrity,
  });
} finally {
  await stopApi();
  fs.rmSync(tempRoot, { recursive: true, force: true });
}
