import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { pickFreePort } from './lib/smoke-runtime.mjs';
import { createDrill } from './lib/drill-runtime.mjs';

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

const drill = createDrill({
  appRoot,
  serverScript,
  legacyDb,
  legacySchemaDir,
  dataDir,
  backupDir,
  logDir,
  port,
  jwtSecret: 'soak-smoke-secret-0123456789abcdef0123456789abcdef',
  backupKey: 'soak-smoke-backup-key-0123456789abcdef',
  adminPassword,
  stdio: ['ignore', 'ignore', 'inherit'],
  waitTimeoutMs: 60_000,
  readyLabel: 'soak smoke',
});

const { spawnApi, stopApi, waitForApi } = drill;

async function request(pathname, options = {}, token = null) {
  const headers = { 'content-type': 'application/json', ...(options.headers ?? {}) };
  if (token) headers.authorization = `Bearer ${token}`;
  const startedAt = performance.now();
  const response = await fetch(`${drill.base}${pathname}`, { ...options, headers });
  const body = await response.json().catch(() => null);
  const durationMs = performance.now() - startedAt;
  if (!response.ok || !body?.success) {
    throw new Error(`${options.method ?? 'GET'} ${pathname}: ${response.status} ${JSON.stringify(body)}`);
  }
  return { data: body.data, durationMs };
}

const samples = [];
let createdCount = 0;
let errorCount = 0;

// B-3.3：soak 期间记录内存/句柄增长趋势。首个成功请求后取基线，
// 此后每 V2_SOAK_SAMPLE_MS 采样一次；结束后对比首末样本，任一指标
// 增长超过上限即判失败（长时间运行的内存泄漏/句柄泄漏看门狗）。
const growthSamples = [];
const growthSampleIntervalMs = Math.max(1000, Math.min(60_000, Number(process.env.V2_SOAK_SAMPLE_MS ?? 30_000)));
const maxHeapGrowthBytes = Math.max(1, Number(process.env.V2_SOAK_MAX_HEAP_GROWTH_BYTES ?? 64 * 1024 * 1024));
const maxRssGrowthBytes = Math.max(1, Number(process.env.V2_SOAK_MAX_RSS_GROWTH_BYTES ?? 128 * 1024 * 1024));
const maxResourceGrowth = Math.max(1, Number(process.env.V2_SOAK_MAX_RESOURCE_GROWTH ?? 20));
let nextGrowthSampleAt = 0;

function sampleGrowth() {
  const memory = process.memoryUsage();
  growthSamples.push({
    sampledAt: new Date().toISOString(),
    rssBytes: memory.rss,
    heapUsedBytes: memory.heapUsed,
    externalBytes: memory.external,
    activeResources: process.getActiveResourcesInfo().length,
  });
}

try {
  spawnApi();
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
      if (growthSamples.length === 0) sampleGrowth();

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
    if (Date.now() >= nextGrowthSampleAt) {
      sampleGrowth();
      nextGrowthSampleAt = Date.now() + growthSampleIntervalMs;
    }
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

  // B-3.3：对比首末增长样本。首样本在第一次成功请求后采集，排除启动期
  // 一次性分配；末样本在结束前采集。任一指标超限即把 soak 判失败。
  const firstGrowth = growthSamples[0];
  const lastGrowth = growthSamples[growthSamples.length - 1];
  const heapGrowthBytes = lastGrowth.heapUsedBytes - firstGrowth.heapUsedBytes;
  const rssGrowthBytes = lastGrowth.rssBytes - firstGrowth.rssBytes;
  const resourceGrowth = lastGrowth.activeResources - firstGrowth.activeResources;
  if (heapGrowthBytes > maxHeapGrowthBytes) {
    throw new Error(`heap grew ${heapGrowthBytes} bytes during soak (limit ${maxHeapGrowthBytes})`);
  }
  if (rssGrowthBytes > maxRssGrowthBytes) {
    throw new Error(`rss grew ${rssGrowthBytes} bytes during soak (limit ${maxRssGrowthBytes})`);
  }
  if (resourceGrowth > maxResourceGrowth) {
    throw new Error(`active resources grew by ${resourceGrowth} during soak (limit ${maxResourceGrowth})`);
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
    growth: {
      samples: growthSamples.length,
      heapGrowthBytes,
      rssGrowthBytes,
      activeResourceGrowth: resourceGrowth,
    },
  });
} finally {
  await stopApi();
  fs.rmSync(tempRoot, { recursive: true, force: true });
}
