import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveSimulatedDataDir } from './simulated-data.mjs';

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const serverScript = path.join(appRoot, 'dist-electron', 'server.cjs');
const restoreScript = path.join(appRoot, 'scripts', 'restore-backup.mjs');
const verifyScript = path.join(appRoot, 'scripts', 'verify-database.mjs');
const legacyDb = path.join(appRoot, 'legacy', 'dental.sqlite');
const legacySchemaDir = path.join(appRoot, 'legacy', 'schema');
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'v2-disaster-drill-'));
const dataDir = path.join(tempRoot, 'data');
const dbPath = path.join(dataDir, 'v2.sqlite');
const backupDir = path.join(dataDir, 'backups');
const logDir = path.join(dataDir, 'logs');
const port = 40000 + Math.floor(Math.random() * 1000);
const jwtSecret = 'disaster-drill-secret-0123456789abcdef0123456789abcdef';
const goodKey = 'disaster-good-key-0123456789abcdef';
const wrongKey = 'disaster-wrong-key-9876543210abcdef';
const adminPassword = process.env.V2_ADMIN_PASSWORD ?? 'REDACTED';

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

function baseEnv(overrides = {}) {
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
    V2_DB_PATH: dbPath,
    V2_JWT_SECRET: jwtSecret,
    V2_BACKUP_KEY: goodKey,
    V2_ADMIN_PASSWORD: adminPassword,
    ...overrides,
  };
}

function waitForApi(timeoutMs = 30_000) {
  const startedAt = Date.now();
  return new Promise((resolve, reject) => {
    const attempt = async () => {
      if (Date.now() - startedAt > timeoutMs) {
        reject(new Error('API did not become ready during disaster drill'));
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

async function startApi() {
  apiProcess = spawn(process.execPath, [serverScript], {
    cwd: appRoot,
    env: baseEnv(),
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  await waitForApi();
}

function stopApi() {
  return new Promise((resolve) => {
    if (!apiProcess || apiProcess.killed) {
      resolve();
      return;
    }
    apiProcess.once('exit', resolve);
    apiProcess.kill();
    setTimeout(() => {
      if (apiProcess && !apiProcess.killed) apiProcess.kill('SIGKILL');
    }, 5000).unref();
  });
}

function runNode(scriptPath, args = [], env = {}) {
  return spawnSync(process.execPath, [scriptPath, ...args], {
    cwd: appRoot,
    env: baseEnv(env),
    encoding: 'utf8',
  });
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
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
