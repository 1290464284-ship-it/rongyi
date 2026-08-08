import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const appRoot = path.resolve(import.meta.dirname, '..');
const serverScript = path.join(appRoot, 'dist-electron', 'server.cjs');
const legacyDb = path.join(appRoot, 'legacy', 'dental.sqlite');
const legacySchemaDir = path.join(appRoot, 'legacy', 'schema');
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'v2-multi-instance-'));
const dataDir = path.join(tempRoot, 'data');
const backupDir = path.join(dataDir, 'backups');
const logDir = path.join(dataDir, 'logs');
const jwtSecret = 'multi-instance-secret-0123456789abcdef0123456789abcdef';
const backupKey = 'multi-instance-backup-key-0123456789abcdef';
const adminPassword = 'MultiInstanceSmoke123!';

if (!fs.existsSync(serverScript)) {
  console.error('dist-electron/server.cjs not found. Run electron:compile first.');
  process.exit(1);
}

const processes = [];
const stderrBuffers = new Map();

function baseEnv(port) {
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
    V2_DB_PATH: path.join(dataDir, 'v2.sqlite'),
    V2_JWT_SECRET: jwtSecret,
    V2_BACKUP_KEY: backupKey,
    V2_ADMIN_PASSWORD: adminPassword,
  };
}

function waitForApi(port, timeoutMs = 30_000) {
  const base = `http://127.0.0.1:${port}/api/v2`;
  const startedAt = Date.now();
  return new Promise((resolve, reject) => {
    const attempt = async () => {
      if (Date.now() - startedAt > timeoutMs) {
        reject(new Error(`API ${port} did not become ready`));
        return;
      }
      try {
        const response = await fetch(`${base}/health`, { signal: AbortSignal.timeout(1000) });
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

function startServer(port) {
  fs.mkdirSync(dataDir, { recursive: true });
  fs.mkdirSync(backupDir, { recursive: true });
  fs.mkdirSync(logDir, { recursive: true });
  const proc = spawn(process.execPath, [serverScript], {
    cwd: appRoot,
    env: baseEnv(port),
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  processes.push(proc);
  const stderrChunks = [];
  proc.stderr.on('data', (chunk) => stderrChunks.push(String(chunk)));
  stderrBuffers.set(port, stderrChunks);
  return waitForApi(port);
}

function stopAll() {
  return Promise.all(processes.map((proc) => new Promise((resolve) => {
    if (!proc || proc.exitCode !== null || proc.signalCode !== null) {
      resolve();
      return;
    }
    proc.once('exit', resolve);
    proc.kill();
    setTimeout(() => {
      if (proc && !proc.killed) proc.kill('SIGKILL');
    }, 5000).unref();
  })));
}

async function request(port, pathname, options = {}, token = null) {
  const headers = { 'content-type': 'application/json', ...(options.headers ?? {}) };
  if (token) headers.authorization = `Bearer ${token}`;
  const response = await fetch(`http://127.0.0.1:${port}/api/v2${pathname}`, { ...options, headers });
  const bodyText = await response.text();
  let body = null;
  try {
    body = JSON.parse(bodyText);
  } catch {
    // non-JSON response
  }
  return { status: response.status, body, bodyText };
}

async function login(port) {
  const result = await request(port, '/auth/login', {
    method: 'POST',
    body: JSON.stringify({ username: 'admin', password: adminPassword }),
  });
  if (result.status !== 200 || !result.body?.success) {
    throw new Error(`login on ${port} failed: ${result.status} ${result.bodyText}`);
  }
  return result.body.data.token;
}

async function createPatients(port, token, prefix, count) {
  const tasks = [];
  for (let index = 0; index < count; index += 1) {
    const code = `${prefix}-${index}`;
    tasks.push(request(port, '/resources/patients', {
      method: 'POST',
      body: JSON.stringify({
        code,
        name: `Multi ${prefix} ${index}`,
        gender: 'MALE',
        phone: `138${String(10000000 + index).padStart(8, '0')}`,
        source: 'WALK_IN',
        active: true,
      }),
    }, token));
  }
  const results = await Promise.all(tasks);
  const failed = results.filter((result) => result.status < 200 || result.status >= 300 || !result.body?.success);
  if (failed.length > 0) {
    throw new Error(`${prefix} created ${results.length - failed.length}/${results.length}; first failure ${failed[0]?.status} ${failed[0]?.bodyText}`);
  }
}

async function main() {
  const portA = 35000 + Math.floor(Math.random() * 1000);
  const portB = portA + 1;
  try {
    await Promise.all([startServer(portA), startServer(portB)]);
    const tokenA = await login(portA);
    const tokenB = await login(portB);

    await Promise.all([
      createPatients(portA, tokenA, 'MI-A', 50),
      createPatients(portB, tokenB, 'MI-B', 50),
    ]);

    const listA = await request(portA, '/resources/patients?page=1&pageSize=200', {}, tokenA);
    const listB = await request(portB, '/resources/patients?page=1&pageSize=200', {}, tokenB);
    if (listA.status !== 200 || listB.status !== 200) {
      throw new Error(`list failed: A=${listA.status} B=${listB.status}`);
    }
    const countA = (listA.body?.data?.items ?? []).filter((row) => String(row.code ?? '').startsWith('MI-')).length;
    const countB = (listB.body?.data?.items ?? []).filter((row) => String(row.code ?? '').startsWith('MI-')).length;
    if (countA < 100 || countA !== countB) {
      throw new Error(`cross-instance visibility failed: A=${countA} B=${countB}`);
    }

    console.log(`multi-instance smoke passed: A=${countA} B=${countB} shared sqlite`);
  } finally {
    await stopAll();
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

await main().catch((error) => {
  const details = [...stderrBuffers.entries()]
    .map(([port, chunks]) => `[port ${port}]\n${chunks.join('')}`)
    .filter((text) => text.trim().length > 0)
    .join('\n');
  if (details) console.error(details);
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
