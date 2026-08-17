import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const appRoot = path.resolve(import.meta.dirname, '..');
const serverScript = path.join(appRoot, 'dist-electron', 'server.cjs');
const legacyDb = path.join(appRoot, 'legacy', 'dental.sqlite');
const legacySchemaDir = path.join(appRoot, 'legacy', 'schema');
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'v2-large-db-concurrency-'));
const dataDir = path.join(tempRoot, 'data');
const backupDir = path.join(dataDir, 'backups');
const logDir = path.join(dataDir, 'logs');
const port = 48000 + Math.floor(Math.random() * 1000);
// simulate-clinic-data.ts 固定写入 v2-sim-admin-password（不读外层 env），
// 本 smoke 的默认口令必须与其一致；外层 V2_ADMIN_PASSWORD 可覆盖。
const adminPassword = process.env.V2_ADMIN_PASSWORD ?? 'v2-sim-admin-password';
const backupKey = 'large-db-concurrency-backup-key-0123456789abcdef';
const jwtSecret = 'large-db-concurrency-secret-0123456789abcdef0123456789abcdef';
const simulationScale = process.env.V2_SIM_SCALE ?? 'large';
const patientConcurrency = Number(process.env.V2_LARGE_DB_READ_CONCURRENCY ?? 30);
const paymentConcurrency = 20;
const settleConcurrency = 12;

if (!fs.existsSync(serverScript)) {
  console.error('dist-electron/server.cjs not found. Run electron:compile first.');
  process.exit(1);
}

for (const dir of [dataDir, backupDir, logDir]) fs.mkdirSync(dir, { recursive: true });

const serverEnv = {
  ...process.env,
  V2_PORT: String(port),
  V2_HOST: '127.0.0.1',
  NODE_ENV: 'development',
  V2_DATA_DIR: dataDir,
  V2_BACKUP_DIR: backupDir,
  V2_LOG_DIR: logDir,
  V2_DB_PATH: path.join(dataDir, 'v2.sqlite'),
  V2_LEGACY_DB_PATH: legacyDb,
  V2_LEGACY_SCHEMA_DIR: legacySchemaDir,
  V2_JWT_SECRET: jwtSecret,
  V2_BACKUP_KEY: backupKey,
  V2_ADMIN_PASSWORD: adminPassword,
};

function runCommand(args, extraEnv = {}) {
  // 跨平台启动 pnpm：Windows 经 ComSpec + '/c'，POSIX 直接 spawn（pnpm 在
  // PATH 上）。与 flaky-detect.mjs 同一模式，避免 ubuntu CI 上 ComSpec
  // undefined 崩溃。
  const result = process.platform === 'win32'
    ? spawnSync(process.env.ComSpec, ['/c', 'pnpm', ...args], {
        cwd: appRoot,
        env: { ...process.env, ...extraEnv },
        stdio: 'inherit',
      })
    : spawnSync('pnpm', args, {
        cwd: appRoot,
        env: { ...process.env, ...extraEnv },
        stdio: 'inherit',
      });
  if (result.status !== 0) {
    throw new Error(`command failed (${result.status}): pnpm ${args.join(' ')}`);
  }
}

if (process.env.V2_LARGE_DB_SKIP_SIM !== '1') {
  runCommand(
    ['--filter', '@dental/v2', 'exec', 'tsx', 'scripts/simulate-clinic-data.ts'],
    {
      V2_SIM_DATA_DIR: dataDir,
      V2_SIM_SCALE: simulationScale,
      V2_ADMIN_PASSWORD: adminPassword,
    },
  );
}

const apiProcess = spawn(process.execPath, [serverScript], {
  cwd: appRoot,
  env: serverEnv,
  stdio: ['ignore', 'ignore', 'pipe'],
  windowsHide: true,
});
const stderrChunks = [];
apiProcess.stderr.on('data', (chunk) => stderrChunks.push(String(chunk)));

function waitForApi(timeoutMs = 180_000) {
  const base = `http://127.0.0.1:${port}/api/v2`;
  const startedAt = Date.now();
  return new Promise((resolve, reject) => {
    const attempt = async () => {
      if (Date.now() - startedAt > timeoutMs) {
        reject(new Error('large DB API did not become ready'));
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
  const response = await fetch(`http://127.0.0.1:${port}/api/v2${pathname}`, {
    ...options,
    headers,
  });
  const bodyText = await response.text();
  let body = null;
  try {
    body = JSON.parse(bodyText);
  } catch {
    // non-JSON response
  }
  return { status: response.status, body, bodyText };
}

async function login() {
  const result = await request('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ username: 'admin', password: adminPassword }),
  });
  if (result.status !== 200 || !result.body?.success) {
    throw new Error(`login failed: ${result.status} ${result.bodyText}`);
  }
  return result.body.data.token;
}

async function stopApi() {
  if (!apiProcess || apiProcess.killed || apiProcess.exitCode !== null) return;
  await new Promise((resolve) => {
    apiProcess.once('exit', resolve);
    apiProcess.kill();
    setTimeout(() => {
      if (apiProcess && apiProcess.exitCode === null) apiProcess.kill('SIGKILL');
    }, 5000).unref();
  });
}

function assertNoFiveHundred(results, label) {
  const serverErrors = results.filter((result) => result.status >= 500);
  if (serverErrors.length > 0) {
    throw new Error(`${label} produced ${serverErrors.length} 5xx responses`);
  }
}

try {
  await waitForApi();
  const token = await login();

  const pageResults = await Promise.all(
    Array.from({ length: patientConcurrency }, (_, index) =>
      request(`/resources/patients?page=${index + 1}&pageSize=200`, {}, token)),
  );
  assertNoFiveHundred(pageResults, 'large DB paginated patient reads');
  const pageFailures = pageResults.filter((result) => result.status !== 200 || !result.body?.success).length;
  if (pageFailures > 0) {
    throw new Error(`large DB paginated patient reads had ${pageFailures} non-200 responses`);
  }

  const firstPatient = pageResults[0]?.body?.data?.items?.[0];
  if (!firstPatient?.id) throw new Error('large DB has no patient for write-path concurrency');

  const charge = await request('/charges', {
    method: 'POST',
    body: JSON.stringify({
      patientId: firstPatient.id,
      items: [{ name: 'Concurrent Exam', category: 'EXAM', price: 10000, quantity: 1 }],
    }),
  }, token);
  if (charge.status !== 201 || !charge.body?.success) {
    throw new Error(`charge create failed: ${charge.status} ${charge.bodyText}`);
  }
  const chargeId = charge.body.data.id;

  const pays = await Promise.all(
    Array.from({ length: paymentConcurrency }, (_, index) =>
      request(`/charges/${chargeId}/pay`, {
        method: 'PATCH',
        body: JSON.stringify({ amount: 6000, method: 'CASH', requestId: `large-pay-${index}` }),
      }, token)),
  );
  assertNoFiveHundred(pays, 'large DB concurrent charge pay');
  const payOk = pays.filter((result) => result.status === 200 && result.body?.success).length;
  const payRejected = pays.filter((result) => result.status === 400 || result.status === 409).length;
  if (payOk !== 1 || payRejected !== paymentConcurrency - 1) {
    throw new Error(`large DB payment guard failed: ok=${payOk} rejected=${payRejected}`);
  }
  const chargeAfter = await request(`/resources/charges/${chargeId}`, {}, token);
  if (Number(chargeAfter.body?.data?.paidAmount ?? 0) !== 6000) {
    throw new Error(`large DB payment produced wrong paidAmount: ${JSON.stringify(chargeAfter.body?.data)}`);
  }

  const processing = await request('/processing-orders', {
    method: 'POST',
    body: JSON.stringify({
      patientId: firstPatient.id,
      number: `LARGE-PROC-${Date.now()}`,
      totalFee: 10000,
      items: [{ name: 'Concurrent Processing', quantity: 1, unitPrice: 10000 }],
    }),
  }, token);
  if (processing.status !== 201 || !processing.body?.success) {
    throw new Error(`processing order create failed: ${processing.status} ${processing.bodyText}`);
  }
  const processingId = processing.body.data.id;
  for (const status of ['SENT', 'IN_PROGRESS', 'COMPLETED']) {
    const transition = await request(`/processing-orders/${processingId}/status`, {
      method: 'PATCH',
      body: JSON.stringify({ status }),
    }, token);
    if (transition.status !== 200) {
      throw new Error(`processing transition ${status} failed: ${transition.status} ${transition.bodyText}`);
    }
  }
  const settles = await Promise.all(
    Array.from({ length: settleConcurrency }, () =>
      request(`/processing-orders/${processingId}/settle`, {
        method: 'POST',
        body: JSON.stringify({ amount: 10000 }),
      }, token)),
  );
  assertNoFiveHundred(settles, 'large DB concurrent processing settle');
  const settleOk = settles.filter((result) => result.status === 200 && result.body?.success).length;
  if (settleOk !== 1) {
    throw new Error(`large DB settle guard failed: ok=${settleOk}/${settleConcurrency}`);
  }

  const device = await request('/sync/devices', {
    method: 'POST',
    body: JSON.stringify({ deviceId: 'large-db-sync-device', name: 'Large DB Concurrency' }),
  }, token);
  if (device.status !== 201 || !device.body?.success) {
    throw new Error(`sync device register failed: ${device.status} ${device.bodyText}`);
  }
  const deviceToken = device.body.data.token;
  const syncChange = (recordId, prefix, index) => ({
    tableName: 'Patient',
    recordId,
    operation: 'INSERT',
    updatedAt: new Date().toISOString(),
    data: {
      code: `${prefix}-${index}`,
      name: `Large Sync ${index}`,
      gender: 'UNKNOWN',
      phone: `139${String(10000000 + index).padStart(8, '0')}`,
      source: 'OTHER',
      active: true,
    },
  });
  const syncBatches = [
    Array.from({ length: 50 }, (_, index) => syncChange(`large-sync-a-${index}`, 'LARGE-SYNC-A', index)),
    Array.from({ length: 50 }, (_, index) => syncChange(`large-sync-b-${index}`, 'LARGE-SYNC-B', index)),
  ];
  const pushes = await Promise.all(
    syncBatches.map((changes) => request('/sync/push', {
      method: 'POST',
      headers: { 'x-device-token': deviceToken },
      body: JSON.stringify({ deviceId: 'large-db-sync-device', changes }),
    }, token)),
  );
  assertNoFiveHundred(pushes, 'large DB concurrent sync push');
  for (const result of pushes) {
    if (!result.body?.success || Number(result.body?.data?.accepted ?? 0) !== 50) {
      throw new Error(`large DB sync push not fully accepted: ${result.status} ${result.bodyText}`);
    }
  }

  const deep = await request('/health/deep', {}, token);
  if (deep.status !== 200 || deep.body?.data?.database !== 'ok') {
    throw new Error(`large DB integrity check failed after concurrency: ${deep.status} ${deep.bodyText}`);
  }

  console.log(
    `large DB concurrency smoke passed: patients=${pageResults.length} ` +
    `paymentOk=1/${paymentConcurrency} settleOk=1/${settleConcurrency} syncAccepted=100 integrity=ok`,
  );
} finally {
  await stopApi();
  const stderr = stderrChunks.join('');
  if (stderr.trim()) console.error(stderr);
  fs.rmSync(tempRoot, { recursive: true, force: true });
}
