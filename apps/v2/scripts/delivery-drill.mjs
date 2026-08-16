import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pickFreePort } from './lib/smoke-runtime.mjs';

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const serverScript = path.join(appRoot, 'dist-electron', 'server.cjs');
const restoreScript = path.join(appRoot, 'scripts', 'restore-backup.mjs');
const verifyScript = path.join(appRoot, 'scripts', 'verify-database.mjs');
const legacyDb = path.join(appRoot, 'legacy', 'dental.sqlite');
const legacySchemaDir = path.join(appRoot, 'legacy', 'schema');
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'v2-delivery-drill-'));
const dataDir = path.join(tempRoot, 'data');
const dbPath = path.join(dataDir, 'v2.sqlite');
const backupDir = path.join(dataDir, 'backups');
const logDir = path.join(dataDir, 'logs');
// 探测空闲端口启动，避免并行 smoke 互踩造成 EADDRINUSE 假红。
const port = await pickFreePort(33000, 34999);
const jwtSecret = 'delivery-drill-secret-0123456789abcdef0123456789abcdef';
const backupKey = 'delivery-drill-backup-key-0123456789abcdef';
const adminPassword = process.env.V2_ADMIN_PASSWORD;
if (!adminPassword) {
  console.error('V2_ADMIN_PASSWORD must be set to run the delivery drill');
  process.exit(1);
}

let apiProcess = null;

function baseEnv() {
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
    V2_BACKUP_KEY: backupKey,
    V2_ADMIN_PASSWORD: adminPassword,
  };
}

function waitForApi(timeoutMs = 30_000) {
  const startedAt = Date.now();
  return new Promise((resolve, reject) => {
    const attempt = async () => {
      if (Date.now() - startedAt > timeoutMs) {
        reject(new Error('API did not become ready during delivery drill'));
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
  const response = await fetch(`http://127.0.0.1:${port}/api/v2${pathname}`, {
    ...options,
    headers,
  });
  const body = await response.json().catch(() => null);
  if (!response.ok || !body?.success) {
    throw new Error(`${options.method ?? 'GET'} ${pathname}: ${response.status} ${JSON.stringify(body)}`);
  }
  return body.data;
}

async function startApi() {
  fs.mkdirSync(dataDir, { recursive: true });
  fs.mkdirSync(backupDir, { recursive: true });
  fs.mkdirSync(logDir, { recursive: true });
  apiProcess = spawn(process.execPath, [serverScript], {
    cwd: appRoot,
    env: baseEnv(),
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  let stderr = '';
  apiProcess.stderr.on('data', (chunk) => {
    stderr += String(chunk);
  });
  // 崩溃诊断必须保留到 catch 读取；V2_DELIVERY_DRILL_DEBUG 只控制是否打印，不控制是否保留。
  await waitForApi();
  return () => stderr;
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

function runNodeScript(scriptPath, args = []) {
  const result = spawnSync(process.execPath, [scriptPath, ...args], {
    cwd: appRoot,
    env: baseEnv(),
    encoding: 'utf8',
  });
  if (result.status !== 0) {
    throw new Error(`${path.basename(scriptPath)} failed: ${result.stderr || result.stdout}`);
  }
  return result.stdout;
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function main() {
  assert(fs.existsSync(serverScript), 'dist-electron/server.cjs not found. Run pnpm --filter @dental/v2 build && electron:compile first.');
  assert(fs.existsSync(legacyDb), 'legacy/dental.sqlite not found');
  let stderrReader = () => '';
  try {
    stderrReader = await startApi();
    const login = await request('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username: 'admin', password: adminPassword }),
    });
    const token = login.token;
    const patientCode = `DRILL-${Date.now()}`;
    const patient = await request('/resources/patients', {
      method: 'POST',
      body: JSON.stringify({
        code: patientCode,
        name: '交付演练患者',
        gender: 'MALE',
        phone: '13700000000',
        source: 'WALK_IN',
        active: true,
      }),
    }, token);

    const backup = await request('/backups', { method: 'POST', body: '{}' }, token);
    assert(typeof backup.filename === 'string', 'backup did not return a filename');
    const backupPath = path.join(backupDir, backup.filename);
    console.log(`Backup created: filename=${backup.filename} encrypted=${backup.encrypted} size=${fs.statSync(backupPath).size}`);
    const verified = await request(`/backups/${encodeURIComponent(backup.filename)}/verify`, {}, token);
    assert(verified.integrity === 'ok', 'backup verification failed');

    await stopApi();
    fs.writeFileSync(dbPath, 'DRILL-CORRUPTED-DATABASE');
    runNodeScript(restoreScript, [backupPath, dbPath]);
    const verifyOutput = runNodeScript(verifyScript);
    assert(verifyOutput.includes('integrity ok'), 'restored database integrity check failed');

    stderrReader = await startApi();
    const relogin = await request('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username: 'admin', password: adminPassword }),
    });
    const restored = await request('/resources/patients?page=1&pageSize=100', {}, relogin.token);
    const found = (restored.items ?? []).some((row) => String(row.id) === patient.id || String(row.code) === patientCode);
    assert(found, 'restored patient was not found after restart');

    console.log('Delivery drill passed: legacy import -> create data -> encrypted backup -> verify -> corrupt -> restore -> restart -> consistency check.');
    console.log(`  patient=${patient.id} backup=${backup.filename} database=${dbPath}`);
  } catch (error) {
    const details = stderrReader();
    if (details) console.error(details);
    throw error;
  } finally {
    await stopApi();
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
