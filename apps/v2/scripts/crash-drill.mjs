import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveSimulatedDataDir } from './simulated-data.mjs';

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const serverScript = path.join(appRoot, 'dist-electron', 'server.cjs');
const legacyDb = path.join(appRoot, 'legacy', 'dental.sqlite');
const legacySchemaDir = path.join(appRoot, 'legacy', 'schema');
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'v2-crash-drill-'));
const dataDir = path.join(tempRoot, 'data');
const backupDir = path.join(dataDir, 'backups');
const logDir = path.join(dataDir, 'logs');
const port = 42000 + Math.floor(Math.random() * 1000);
// 模拟库管理员密码固定为 v2-sim-admin-password（simulate-clinic-data.ts
// 硬编码）；本 drill 复制模拟库，登录必须用固定口令（同 disaster-drill）。
const adminPassword = 'v2-sim-admin-password';

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

let apiProcess = null;

function envForStart() {
  return {
    ...process.env,
    V2_PORT: String(port),
    V2_HOST: '127.0.0.1',
    NODE_ENV: 'development',
    V2_DATA_DIR: dataDir,
    V2_BACKUP_DIR: backupDir,
    V2_LOG_DIR: logDir,
    V2_LEGACY_DB_PATH: legacyDb,
    V2_LEGACY_SCHEMA_DIR: legacySchemaDir,
    V2_JWT_SECRET: 'crash-drill-jwt-0123456789abcdef0123456789abcdef',
    V2_BACKUP_KEY: 'crash-drill-backup-key-0123456789abcdef',
    V2_ADMIN_PASSWORD: adminPassword,
  };
}

function waitForApi(timeoutMs = 30_000) {
  const startedAt = Date.now();
  return new Promise((resolve, reject) => {
    const attempt = async () => {
      if (Date.now() - startedAt > timeoutMs) {
        reject(new Error('API did not become ready during crash drill'));
        return;
      }
      try {
        const response = await fetch(`http://127.0.0.1:${port}/api/v2/health`, { signal: AbortSignal.timeout(1000) });
        if (response.ok) {
          resolve();
          return;
        }
      } catch {
        // retry
      }
      setTimeout(() => void attempt(), 500);
    };
    void attempt();
  });
}

function startApi() {
  apiProcess = spawn(process.execPath, [serverScript], {
    cwd: appRoot,
    env: envForStart(),
    stdio: ['ignore', 'ignore', 'pipe'],
    windowsHide: true,
  });
}

function stopApi() {
  return new Promise((resolve) => {
    const target = apiProcess;
    if (!target || target.killed || target.exitCode !== null) {
      resolve();
      return;
    }
    target.once('exit', resolve);
    target.kill();
    setTimeout(() => {
      if (target && target.exitCode === null) target.kill('SIGKILL');
    }, 5000).unref();
  });
}

function forceKillApi() {
  const target = apiProcess;
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
      if (target && target.exitCode === null && apiProcess === target) target.kill('SIGKILL');
    }, 5000).unref();
  });
}

async function request(pathname, options = {}, token = null) {
  const headers = { 'content-type': 'application/json', ...(options.headers ?? {}) };
  if (token) headers.authorization = `Bearer ${token}`;
  const response = await fetch(`http://127.0.0.1:${port}/api/v2${pathname}`, { ...options, headers });
  const body = await response.json().catch(() => null);
  if (!response.ok || !body?.success) {
    throw new Error(`${options.method ?? 'GET'} ${pathname}: ${response.status} ${JSON.stringify(body)}`);
  }
  return body.data;
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

try {
  startApi();
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

  startApi();
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
