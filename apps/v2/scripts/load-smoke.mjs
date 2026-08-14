process.on('unhandledRejection', (reason) => {
  console.error(reason instanceof Error ? reason.stack ?? reason.message : reason);
  setTimeout(() => process.exit(1), 250);
});
process.on('uncaughtException', (error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : error);
  setTimeout(() => process.exit(1), 250);
});

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const base = process.env.V2_BASE_URL ?? 'http://localhost:3180/api/v2';
const adminPassword = process.env.V2_ADMIN_PASSWORD;
if (!adminPassword) {
  console.error('V2_ADMIN_PASSWORD must be set to run load smoke');
  process.exit(1);
}
const iterations = Number(process.env.V2_LOAD_ITERATIONS ?? 100);
const concurrency = Number(process.env.V2_LOAD_CONCURRENCY ?? 8);
const maxErrorRate = Number(process.env.V2_LOAD_ERROR_RATE ?? 0.01);
const reportPath = process.env.V2_LOAD_REPORT ?? path.join(appRoot, 'reports', 'load-smoke.json');

// 混合读负载：dashboard 为主（p95 门禁对象），其余为典型列表/汇总查询。
const ENDPOINTS = [
  { path: '/stats/dashboard', label: 'dashboard', weight: 40 },
  { path: '/resources/patients?pageSize=20', label: 'patients-list', weight: 20 },
  { path: '/resources/appointments?pageSize=20', label: 'appointments-list', weight: 20 },
  { path: '/follow-ups/reminders/summary', label: 'followup-summary', weight: 10 },
  { path: '/stats/revenue', label: 'revenue', weight: 10 },
];
const TOTAL_WEIGHT = ENDPOINTS.reduce((sum, endpoint) => sum + endpoint.weight, 0);

function pickEndpoint(index) {
  let bucket = index % TOTAL_WEIGHT;
  for (const endpoint of ENDPOINTS) {
    if (bucket < endpoint.weight) return endpoint;
    bucket -= endpoint.weight;
  }
  return ENDPOINTS[0];
}

async function request(pathname, options = {}) {
  const response = await fetch(`${base}${pathname}`, {
    ...options,
    headers: { 'content-type': 'application/json', ...(options.headers ?? {}) },
  });
  const body = await response.json().catch(() => null);
  if (!response.ok || !body?.success) throw new Error(`${pathname}: ${JSON.stringify(body)}`);
  return body.data;
}

const login = await request('/auth/login', {
  method: 'POST',
  body: JSON.stringify({ username: 'admin', password: adminPassword }),
});
const headers = { authorization: `Bearer ${login.token}` };

const dashboardSamples = [];
const perEndpoint = {};
let total = 0;
let errors = 0;
let nextIndex = 0;

function record(endpoint, ok, durationMs, message) {
  total += 1;
  const bucket = perEndpoint[endpoint.label] ?? { ok: 0, fail: 0, totalMs: 0, lastError: null };
  if (ok) {
    bucket.ok += 1;
    bucket.totalMs += durationMs;
  } else {
    bucket.fail += 1;
    bucket.lastError = message;
    errors += 1;
  }
  perEndpoint[endpoint.label] = bucket;
}

async function worker() {
  while (true) {
    const index = nextIndex;
    nextIndex += 1;
    if (index >= iterations) return;
    const endpoint = pickEndpoint(index);
    const startedAt = performance.now();
    try {
      await request(endpoint.path, { headers });
      const durationMs = performance.now() - startedAt;
      if (endpoint.label === 'dashboard') dashboardSamples.push(durationMs);
      record(endpoint, true, durationMs, null);
    } catch (error) {
      record(endpoint, false, performance.now() - startedAt, error instanceof Error ? error.message : String(error));
    }
  }
}

await Promise.all(Array.from({ length: concurrency }, () => worker()));

dashboardSamples.sort((a, b) => a - b);
const dashboardAvg = dashboardSamples.length
  ? dashboardSamples.reduce((sum, value) => sum + value, 0) / dashboardSamples.length
  : 0;
const dashboardP95 = dashboardSamples.length
  ? dashboardSamples[Math.min(dashboardSamples.length - 1, Math.floor(dashboardSamples.length * 0.95))]
  : 0;
const errorRate = total > 0 ? errors / total : 0;

const report = {
  generatedAt: new Date().toISOString(),
  config: { iterations, concurrency, maxErrorRate, base },
  summary: {
    total,
    errors,
    errorRate: Number(errorRate.toFixed(4)),
    dashboard: {
      samples: dashboardSamples.length,
      avgMs: Number(dashboardAvg.toFixed(1)),
      p95Ms: Number(dashboardP95.toFixed(1)),
    },
    perEndpoint: Object.fromEntries(
      Object.entries(perEndpoint).map(([label, bucket]) => [
        label,
        {
          ...bucket,
          avgMs: bucket.ok > 0 ? Number((bucket.totalMs / bucket.ok).toFixed(1)) : null,
        },
      ]),
    ),
  },
};

fs.mkdirSync(path.dirname(reportPath), { recursive: true });
fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
console.log(`load smoke report: ${reportPath}`);

const failures = [];
if (dashboardP95 > 2000) failures.push(`dashboard p95 too high: ${dashboardP95.toFixed(1)}ms (limit 2000ms)`);
if (errorRate > maxErrorRate) failures.push(`error rate too high: ${(errorRate * 100).toFixed(2)}% (limit ${(maxErrorRate * 100).toFixed(2)}%)`);
if (dashboardSamples.length === 0) failures.push('no dashboard samples collected');

if (failures.length > 0) {
  console.error('load smoke failed:');
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exit(1);
}
console.log(
  `load smoke passed dashboardAvg=${dashboardAvg.toFixed(1)}ms dashboardP95=${dashboardP95.toFixed(1)}ms ` +
    `errors=${errors}/${total} (${(errorRate * 100).toFixed(2)}%)`,
);
