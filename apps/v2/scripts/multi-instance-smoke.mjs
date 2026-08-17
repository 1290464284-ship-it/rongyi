import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pickFreePort } from './lib/smoke-runtime.mjs';

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

// 本 smoke 是「双实例 + 共享 SQLite」场景：baseEnv/waitForApi/request/startServer
// 全部按 port 参数化，且每个进程需要独立的 stderr 缓冲（stderrBuffers），与单实例
// createDrill 的签名不匹配，故保留本地进程管理，仅复用 lib/smoke-runtime.mjs 的
// pickFreePort。
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

async function verifyConcurrentChargePayments(portA, portB, tokenA, tokenB, listA) {
  const patient = (listA.body?.data?.items ?? []).find((row) => String(row.code ?? '').startsWith('MI-A-'));
  if (!patient?.id) throw new Error('concurrent charge test needs a patient from instance A');
  const charge = await request(portA, '/charges', {
    method: 'POST',
    body: JSON.stringify({
      patientId: patient.id,
      items: [{ name: 'Concurrent Exam', category: 'EXAM', price: 10000, quantity: 1 }],
    }),
  }, tokenA);
  if (charge.status !== 201 || !charge.body?.success) {
    throw new Error(`charge create failed: ${charge.status} ${charge.bodyText}`);
  }
  const chargeId = charge.body.data.id;
  const pays = await Promise.all([
    request(portA, `/charges/${chargeId}/pay`, {
      method: 'PATCH',
      body: JSON.stringify({ amount: 6000, method: 'CASH', requestId: 'mi-pay-a' }),
    }, tokenA),
    request(portB, `/charges/${chargeId}/pay`, {
      method: 'PATCH',
      body: JSON.stringify({ amount: 6000, method: 'CASH', requestId: 'mi-pay-b' }),
    }, tokenB),
  ]);
  const ok = pays.filter((result) => result.status === 200 && result.body?.success).length;
  const rejected = pays.filter((result) => result.status === 400 || result.status === 409).length;
  const serverError = pays.filter((result) => result.status >= 500).length;
  if (ok !== 1 || rejected !== 1 || serverError !== 0) {
    throw new Error(`concurrent payment lost-update guard failed: ok=${ok} rejected=${rejected} serverError=${serverError} ${pays.map((p) => p.status).join(',')}`);
  }
  const chargeRow = await request(portA, `/resources/charges/${chargeId}`, {}, tokenA);
  if (Number(chargeRow.body?.data?.paidAmount ?? 0) !== 6000) {
    throw new Error(`concurrent payment produced wrong balance: ${JSON.stringify(chargeRow.body?.data)}`);
  }
  console.log('concurrent charge payment guard passed: exactly one success, one 400/409, no 500, final paid 6000');
}

function syncChange(recordId, prefix, index) {
  return {
    tableName: 'Patient',
    recordId,
    operation: 'INSERT',
    updatedAt: new Date().toISOString(),
    data: {
      code: `${prefix}-${index}`,
      name: `Sync ${prefix} ${index}`,
      gender: 'UNKNOWN',
      phone: `139${String(10000000 + index).padStart(8, '0')}`,
      source: 'OTHER',
      active: true,
    },
  };
}

async function verifyConcurrentSyncPushAndIdempotent(portA, portB, tokenA, tokenB, listA) {
  const patient = (listA.body?.data?.items ?? []).find((row) => String(row.code ?? '').startsWith('MI-A-'));
  if (!patient?.id) throw new Error('concurrent sync test needs a patient from instance A');

  const processing = await request(portA, '/processing-orders', {
    method: 'POST',
    body: JSON.stringify({
      patientId: patient.id,
      number: 'MI-PROC-1',
      totalFee: 100,
      items: [{ name: '加工', quantity: 1, unitPrice: 100 }],
    }),
  }, tokenA);
  if (processing.status !== 201 || !processing.body?.success) {
    throw new Error(`processing create failed: ${processing.status} ${processing.bodyText}`);
  }
  const processingId = processing.body.data.id;

  const device = await request(portA, '/sync/devices', {
    method: 'POST',
    body: JSON.stringify({ deviceId: 'mi-sync-device', name: 'Multi Instance' }),
  }, tokenA);
  if (device.status !== 201 || !device.body?.success) {
    throw new Error(`sync device register failed: ${device.status} ${device.bodyText}`);
  }
  const deviceToken = device.body.data.token;

  // 场景 1：同一设备 token 从两个 API 进程同时 push，SQLite 跨进程锁必须兜底，
  // 不能出现嵌套 BEGIN 500。
  const changesA = Array.from({ length: 50 }, (_, index) => syncChange(`mi-push-a-${index}`, 'MI-PUSH-A', index));
  const changesB = Array.from({ length: 50 }, (_, index) => syncChange(`mi-push-b-${index}`, 'MI-PUSH-B', index));
  const pushes = await Promise.all([
    request(portA, '/sync/push', {
      method: 'POST',
      headers: { 'x-device-token': deviceToken },
      body: JSON.stringify({ deviceId: 'mi-sync-device', changes: changesA }),
    }, tokenA),
    request(portB, '/sync/push', {
      method: 'POST',
      headers: { 'x-device-token': deviceToken },
      body: JSON.stringify({ deviceId: 'mi-sync-device', changes: changesB }),
    }, tokenB),
  ]);
  for (const result of pushes) {
    if (result.status >= 500) {
      throw new Error(`cross-process sync push returned 5xx: ${result.status} ${result.bodyText}`);
    }
    if (!result.body?.success || Number(result.body?.data?.accepted ?? 0) !== 50) {
      throw new Error(`cross-process sync push not fully accepted: ${result.status} ${result.bodyText}`);
    }
  }

  // 场景 2：sync push 持显式事务期间，同进程的同步幂等写入必须拿到 DB_BUSY 503
  // 或等事务结束后成功，绝不嵌套 BEGIN。
  const busyChanges = Array.from({ length: 100 }, (_, index) => syncChange(`mi-idem-sync-${index}`, 'MI-IDEM-SYNC', index));
  const [pushResult, transitionResult] = await Promise.all([
    request(portA, '/sync/push', {
      method: 'POST',
      headers: { 'x-device-token': deviceToken },
      body: JSON.stringify({ deviceId: 'mi-sync-device', changes: busyChanges }),
    }, tokenA),
    request(portB, `/processing-orders/${processingId}/status`, {
      method: 'PATCH',
      headers: { 'idempotency-key': 'mi-idem-sync-transition' },
      body: JSON.stringify({ status: 'SENT' }),
    }, tokenB),
  ]);
  if (pushResult.status !== 200 || !pushResult.body?.success) {
    throw new Error(`sync push during idempotent race failed: ${pushResult.status} ${pushResult.bodyText}`);
  }
  if (transitionResult.status >= 500) {
    throw new Error(`sync idempotent write during push returned 5xx: ${transitionResult.status} ${transitionResult.bodyText}`);
  }
  if (transitionResult.status !== 200 && transitionResult.status !== 503) {
    throw new Error(`sync idempotent write expected 200/503, got ${transitionResult.status}: ${transitionResult.bodyText}`);
  }
  console.log('cross-process sync push + idempotent write guard passed: no 5xx, no nested BEGIN');
}

async function main() {
  // 两个实例必须使用不同端口；分别探测空闲端口（相邻端口易撞）。
  const portA = await pickFreePort(35000, 35999);
  let portB = await pickFreePort(35000, 35999);
  while (portB === portA) portB = await pickFreePort(35000, 35999);
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
    await verifyConcurrentChargePayments(portA, portB, tokenA, tokenB, listA);
    await verifyConcurrentSyncPushAndIdempotent(portA, portB, tokenA, tokenB, listA);

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
