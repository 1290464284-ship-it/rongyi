import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { pickFreePort } from './lib/smoke-runtime.mjs';

const require = createRequire(import.meta.url);
const Database = require(path.resolve('node_modules/better-sqlite3'));
const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const serverScript = path.join(appRoot, 'dist-electron', 'server.cjs');
const legacyDb = path.join(appRoot, 'legacy', 'dental.sqlite');
const legacySchemaDir = path.join(appRoot, 'legacy', 'schema');
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'v2-soak-smoke-'));
const dataDir = path.join(tempRoot, 'data');
const backupDir = path.join(dataDir, 'backups');
const logDir = path.join(dataDir, 'logs');
const port = await pickFreePort(47000, 47999);
const adminPassword = 'SoakSmokeAdmin123!';
const durationSeconds = Math.max(10, Number(process.env.V2_SOAK_SECONDS ?? 60));
const targetRequestsPerSecond = Math.max(1, Number(process.env.V2_SOAK_RPS ?? 5));
const p95LimitMs = Number(process.env.V2_SOAK_P95_LIMIT_MS ?? 2500);

fs.mkdirSync(dataDir, { recursive: true });
fs.mkdirSync(backupDir, { recursive: true });
fs.mkdirSync(logDir, { recursive: true });

const apiProcess = spawn(process.execPath, [serverScript], {
  cwd: appRoot,
  env: {
    ...process.env,
    V2_PORT: String(port),
    V2_HOST: '127.0.0.1',
    NODE_ENV: 'development',
    V2_DATA_DIR: dataDir,
    V2_BACKUP_DIR: backupDir,
    V2_LOG_DIR: logDir,
    V2_LEGACY_DB_PATH: legacyDb,
    V2_LEGACY_SCHEMA_DIR: legacySchemaDir,
    V2_JWT_SECRET: 'soak-smoke-secret-0123456789abcdef0123456789abcdef',
    V2_BACKUP_KEY: 'soak-smoke-backup-key-0123456789abcdef',
    V2_ADMIN_PASSWORD: adminPassword,
  },
  stdio: ['ignore', 'ignore', 'inherit'],
  windowsHide: true,
});

const base = `http://127.0.0.1:${port}/api/v2`;

function waitForApi(timeoutMs = 60_000) {
  const startedAt = Date.now();
  return new Promise((resolve, reject) => {
    const attempt = async () => {
      if (Date.now() - startedAt > timeoutMs) {
        reject(new Error('API did not become ready during soak smoke'));
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

async function request(pathname, options = {}, token = null) {
  const headers = { 'content-type': 'application/json', ...(options.headers ?? {}) };
  if (token) headers.authorization = `Bearer ${token}`;
  const startedAt = performance.now();
  const response = await fetch(`${base}${pathname}`, { ...options, headers });
  const body = await response.json().catch(() => null);
  const durationMs = performance.now() - startedAt;
  if (!response.ok || !body?.success) {
    throw new Error(`${options.method ?? 'GET'} ${pathname}: ${response.status} ${JSON.stringify(body)}`);
  }
  return { data: body.data, durationMs };
}

function stopApi() {
  return new Promise((resolve) => {
    if (!apiProcess || apiProcess.killed || apiProcess.exitCode !== null) {
      resolve();
      return;
    }
    apiProcess.once('exit', resolve);
    apiProcess.kill();
    setTimeout(() => {
      if (apiProcess && apiProcess.exitCode === null) apiProcess.kill('SIGKILL');
    }, 5000).unref();
  });
}

const samples = [];
let createdCount = 0;
let errorCount = 0;

try {
  await waitForApi();
  const login = await request('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ username: 'admin', password: adminPassword }),
  });
  const token = login.data.token;
  const deadline = Date.now() + durationSeconds * 1000;
  let sequence = 0;

  while (Date.now() < deadline) {
    const iterationStart = Date.now();
    try {
      const create = await request('/resources/patients', {
        method: 'POST',
        body: JSON.stringify({
          code: `SOAK-${Date.now()}-${sequence}`,
          name: `Soak Patient ${sequence}`,
          gender: 'UNKNOWN',
          phone: `137${String(sequence).padStart(8, '0').slice(0, 8)}`,
          source: 'OTHER',
          active: true,
        }),
      }, token);
      createdCount += 1;
      sequence += 1;
      samples.push({ operation: 'create', durationMs: create.durationMs });

      const dashboard = await request('/stats/dashboard', {}, token);
      samples.push({ operation: 'dashboard', durationMs: dashboard.durationMs });

      if (sequence % 5 === 0) {
        const deep = await request('/health/deep', {}, token);
        samples.push({ operation: 'deepHealth', durationMs: deep.durationMs });
        await request('/metrics', {}, token);
      }
    } catch (error) {
      errorCount += 1;
      if (errorCount > 10) throw error;
    }
    const elapsed = Date.now() - iterationStart;
    const waitMs = Math.max(0, Math.round(1000 / targetRequestsPerSecond) - elapsed);
    if (waitMs > 0) await new Promise((resolve) => setTimeout(resolve, waitMs));
  }

  await stopApi();

  const dbPath = path.join(dataDir, 'v2.sqlite');
  const db = new Database(dbPath, { readonly: true });
  let integrity = 'unknown';
  try {
    const rows = db.pragma('quick_check');
    integrity = rows[0]?.quick_check ?? 'unknown';
  } finally {
    db.close();
  }

  const createSamples = samples.filter((sample) => sample.operation === 'create').map((sample) => sample.durationMs).sort((a, b) => a - b);
  const dashboardSamples = samples.filter((sample) => sample.operation === 'dashboard').map((sample) => sample.durationMs).sort((a, b) => a - b);
  const p95 = (values) => values[Math.min(values.length - 1, Math.floor(values.length * 0.95))] ?? 0;
  const avg = (values) => values.reduce((sum, value) => sum + value, 0) / (values.length || 1);
  const dbSize = fs.existsSync(dbPath) ? fs.statSync(dbPath).size : 0;
  const logFiles = fs.existsSync(logDir) ? fs.readdirSync(logDir).filter((name) => name.endsWith('.log')).length : 0;
  const stability = JSON.parse(fs.readFileSync(path.join(logDir, 'stability.json'), 'utf8')).stability;

  if (integrity !== 'ok') throw new Error(`database integrity after soak: ${integrity}`);
  if (errorCount > 0) throw new Error(`soak had ${errorCount} failed requests`);
  if (p95(dashboardSamples) > p95LimitMs || p95(createSamples) > p95LimitMs) {
    throw new Error(`soak p95 exceeded ${p95LimitMs}ms (create=${p95(createSamples).toFixed(1)}, dashboard=${p95(dashboardSamples).toFixed(1)})`);
  }
  console.log('soak smoke passed', {
    durationSeconds,
    created: createdCount,
    createAvgMs: avg(createSamples).toFixed(1),
    createP95Ms: p95(createSamples).toFixed(1),
    dashboardAvgMs: avg(dashboardSamples).toFixed(1),
    dashboardP95Ms: p95(dashboardSamples).toFixed(1),
    dbSizeBytes: dbSize,
    logFiles,
    uptimeSeconds: stability.uptimeSeconds,
    integrity,
  });
} finally {
  await stopApi();
  fs.rmSync(tempRoot, { recursive: true, force: true });
}
