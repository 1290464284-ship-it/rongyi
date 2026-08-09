import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const serverScript = path.join(appRoot, 'dist-electron', 'server.cjs');
const legacyDb = path.join(appRoot, 'legacy', 'dental.sqlite');
const legacySchemaDir = path.join(appRoot, 'legacy', 'schema');
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'v2-environment-drill-'));
const dataDir = path.join(tempRoot, 'data');
const logDir = path.join(tempRoot, 'logs');
const adminPassword = 'REDACTED';
const jwtSecret = 'environment-drill-secret-0123456789abcdef0123456789abcdef';
const backupKey = 'environment-drill-backup-key-0123456789abcdef';

function baseEnv(overrides = {}) {
  return {
    ...process.env,
    V2_HOST: '127.0.0.1',
    NODE_ENV: 'development',
    V2_DATA_DIR: dataDir,
    V2_BACKUP_DIR: path.join(dataDir, 'backups'),
    V2_LOG_DIR: logDir,
    V2_LEGACY_DB_PATH: legacyDb,
    V2_LEGACY_SCHEMA_DIR: legacySchemaDir,
    V2_JWT_SECRET: jwtSecret,
    V2_BACKUP_KEY: backupKey,
    V2_ADMIN_PASSWORD: adminPassword,
    ...overrides,
  };
}

function waitForApi(port, timeoutMs = 30_000) {
  const startedAt = Date.now();
  return new Promise((resolve, reject) => {
    const attempt = async () => {
      if (Date.now() - startedAt > timeoutMs) {
        reject(new Error('API did not become ready during environment drill'));
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

function waitForExit(child, timeoutMs = 45_000) {
  const output = [];
  child.stdout?.on('data', (chunk) => output.push(chunk.toString()));
  child.stderr?.on('data', (chunk) => output.push(chunk.toString()));
  return new Promise((resolve) => {
    if (child.exitCode !== null) {
      resolve({ code: child.exitCode, output: output.join('') });
      return;
    }
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      resolve({ code: child.exitCode ?? 1, output: output.join('') });
    };
    child.once('exit', finish);
    setTimeout(() => {
      if (!settled) {
        child.kill('SIGKILL');
        finish();
      }
    }, timeoutMs).unref();
  });
}

function startApi(env) {
  return spawn(process.execPath, [serverScript], {
    cwd: appRoot,
    env: baseEnv(env),
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
}

async function request(port, pathname, options = {}, token = null) {
  const headers = { 'content-type': 'application/json', ...(options.headers ?? {}) };
  if (token) headers.authorization = `Bearer ${token}`;
  const response = await fetch(`http://127.0.0.1:${port}/api/v2${pathname}`, { ...options, headers });
  const body = await response.json().catch(() => null);
  return { status: response.status, body };
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

try {
  fs.mkdirSync(dataDir, { recursive: true });
  fs.mkdirSync(logDir, { recursive: true });
  const port = 45000 + Math.floor(Math.random() * 1000);

  const healthy = startApi({ V2_PORT: String(port) });
  await waitForApi(port);
  const login = await request(port, '/auth/login', {
    method: 'POST',
    body: JSON.stringify({ username: 'admin', password: adminPassword }),
  });
  assert(login.status === 200, `baseline login failed: ${login.status}`);
  const token = login.body.data.token;
  const deep = await request(port, '/health/deep', {}, token);
  assert(deep.status === 200, `baseline deep health failed: ${deep.status}`);
  assert(deep.body.data.database === 'ok', 'baseline database must be healthy');
  assert(deep.body.data.backupDirectory === 'ok', 'baseline backup directory must be writable');
  healthy.kill();
  await waitForExit(healthy);
  console.log('PASS baseline environment starts and deep health is ok');

  const blockedBackupPort = port + 1;
  const blockedBackupPath = path.join(dataDir, 'backups-blocked-as-file');
  fs.writeFileSync(blockedBackupPath, 'not a directory');
  const blockedBackup = startApi({
    V2_PORT: String(blockedBackupPort),
    V2_BACKUP_DIR: blockedBackupPath,
  });
  await waitForApi(blockedBackupPort);
  const blockedLogin = await request(blockedBackupPort, '/auth/login', {
    method: 'POST',
    body: JSON.stringify({ username: 'admin', password: adminPassword }),
  });
  assert(blockedLogin.status === 200, `blocked backup login failed: ${blockedLogin.status}`);
  const blockedDeep = await request(blockedBackupPort, '/health/deep', {}, blockedLogin.body.data.token);
  assert(blockedDeep.status === 200, `blocked backup deep health failed: ${blockedDeep.status}`);
  assert(blockedDeep.body.data.backupDirectory === 'not-writable', 'blocked backup directory must be reported as not-writable');
  const failedBackup = await request(blockedBackupPort, '/backups', {
    method: 'POST',
    body: '{}',
  }, blockedLogin.body.data.token);
  assert(failedBackup.status >= 400, `backup with blocked directory must fail, got ${failedBackup.status}`);
  blockedBackup.kill();
  await waitForExit(blockedBackup);
  console.log('PASS blocked backup directory is reported and backup creation fails closed');

  const blockedDataPort = port + 2;
  const blockedDataPath = path.join(tempRoot, 'data-blocked-as-file');
  fs.writeFileSync(blockedDataPath, 'not a directory');
  fs.mkdirSync(path.join(tempRoot, 'logs-blocked-data'), { recursive: true });
  const blockedData = startApi({
    V2_PORT: String(blockedDataPort),
    V2_DATA_DIR: blockedDataPath,
    V2_BACKUP_DIR: path.join(tempRoot, 'backups'),
    V2_LOG_DIR: path.join(tempRoot, 'logs-blocked-data'),
  });
  const blockedDataResult = await waitForExit(blockedData);
  assert(blockedDataResult.code !== 0, 'API must refuse to start when the data directory cannot be created');
  assert(!fs.existsSync(path.join(blockedDataPath, 'v2.sqlite')), 'no database file may be created under a blocked data path');
  console.log('PASS blocked data directory exits non-zero and writes no database file');

  console.log('environment drill passed: baseline, blocked backup, blocked data');
} finally {
  fs.rmSync(tempRoot, { recursive: true, force: true });
}
