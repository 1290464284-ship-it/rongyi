import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const serverScript = path.join(appRoot, 'dist-electron', 'server.cjs');
const legacyDb = path.join(appRoot, 'legacy', 'dental.sqlite');
const legacySchemaDir = path.join(appRoot, 'legacy', 'schema');
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'v2-permission-smoke-'));
const dataDir = path.join(tempRoot, 'data');
const backupDir = path.join(dataDir, 'backups');
const logDir = path.join(dataDir, 'logs');
const port = 43000 + Math.floor(Math.random() * 1000);
const adminPassword = 'REDACTED';

function latestSimulatedDir() {
  const dirs = fs.readdirSync(os.tmpdir())
    .filter((name) => name.startsWith('v2-sim-data-'))
    .map((name) => path.join(os.tmpdir(), name))
    .filter((dir) => fs.statSync(dir).isDirectory())
    .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
  return dirs[0];
}

const sourceSimDir = process.env.V2_SIM_DATA_DIR ? path.resolve(process.env.V2_SIM_DATA_DIR) : latestSimulatedDir();
if (!sourceSimDir || !fs.existsSync(path.join(sourceSimDir, 'v2.sqlite'))) {
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

function waitForApi(timeoutMs = 30_000) {
  const startedAt = Date.now();
  return new Promise((resolve, reject) => {
    const attempt = async () => {
      if (Date.now() - startedAt > timeoutMs) {
        reject(new Error('API did not become ready during permission smoke'));
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
      V2_JWT_SECRET: 'permission-smoke-jwt-0123456789abcdef0123456789abcdef',
      V2_BACKUP_KEY: 'permission-smoke-backup-key-0123456789abcdef',
      V2_ADMIN_PASSWORD: adminPassword,
    },
    stdio: ['ignore', 'ignore', 'pipe'],
    windowsHide: true,
  });
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

async function rawRequest(pathname, options = {}, token = null) {
  const headers = { 'content-type': 'application/json', ...(options.headers ?? {}) };
  if (token) headers.authorization = `Bearer ${token}`;
  const response = await fetch(`http://127.0.0.1:${port}/api/v2${pathname}`, { ...options, headers });
  const text = await response.text();
  let body = null;
  try {
    body = JSON.parse(text);
  } catch {
    body = null;
  }
  return { status: response.status, body };
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

try {
  startApi();
  await waitForApi();
  const bossLogin = await rawRequest('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ username: 'admin', password: adminPassword }),
  });
  assert(bossLogin.status === 200, `BOSS login failed: ${bossLogin.status}`);
  const bossToken = bossLogin.body.data.token;

  const created = await rawRequest('/admin/users', {
    method: 'POST',
    body: JSON.stringify({
      username: `doctor-perm-${Date.now()}`,
      password: 'DoctorPerm123!',
      name: 'Permission Doctor',
      role: 'DOCTOR',
      active: true,
    }),
  }, bossToken);
  assert(created.status === 201, `doctor creation failed: ${created.status} ${JSON.stringify(created.body)}`);
  const doctorUsername = created.body.data.username;

  const doctorLogin = await rawRequest('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ username: doctorUsername, password: 'DoctorPerm123!' }),
  });
  assert(doctorLogin.status === 200, `DOCTOR login failed: ${doctorLogin.status}`);
  const doctorToken = doctorLogin.body.data.token;

  const allowed = [
    '/resources/patients',
    '/resources/visits',
    '/resources/appointments',
    '/follow-ups/reminders',
  ];
  for (const endpoint of allowed) {
    const result = await rawRequest(endpoint, {}, doctorToken);
    assert(result.status === 200, `DOCTOR should access ${endpoint}, got ${result.status}`);
  }

  const denied = [
    '/resources/charges',
    '/resources/memberCards',
    '/resources/inventoryItems',
    '/backups',
    '/system/business-alerts',
    '/analytics/rfm',
  ];
  for (const endpoint of denied) {
    const result = await rawRequest(endpoint, {}, doctorToken);
    assert(result.status === 403, `DOCTOR must be denied ${endpoint}, got ${result.status}`);
  }

  const createCharge = await rawRequest('/charges', {
    method: 'POST',
    body: JSON.stringify({ patientId: 'patient-demo-001', items: [{ name: 'x', category: 'EXAM', price: 100, quantity: 1 }] }),
  }, doctorToken);
  assert(createCharge.status === 403, `DOCTOR must be denied creating charges, got ${createCharge.status}`);

  const createUser = await rawRequest('/admin/users', {
    method: 'POST',
    body: JSON.stringify({ username: 'hacker', password: 'Hacker123!', name: 'Hacker', role: 'DOCTOR' }),
  }, doctorToken);
  assert(createUser.status === 403, `DOCTOR must be denied creating users, got ${createUser.status}`);

  const doctorId = created.body.data.id;
  const grant = await rawRequest(`/user-permissions/${doctorId}`, {
    method: 'PUT',
    body: JSON.stringify({ permissions: [{ permission: 'finance', allowed: true }] }),
  }, bossToken);
  assert(grant.status === 200, `BOSS grant finance failed: ${grant.status} ${JSON.stringify(grant.body)}`);

  const navGranted = await rawRequest('/auth/navigation', {}, doctorToken);
  assert(navGranted.status === 200 && navGranted.body.data.permissions.includes('finance'),
    'finance grant must appear in navigation permissions');
  const financeGranted = await rawRequest('/charge-assistant/frequent-items', {}, doctorToken);
  assert(financeGranted.status === 200, `granted finance route must return 200, got ${financeGranted.status}`);

  const revoke = await rawRequest(`/user-permissions/${doctorId}`, {
    method: 'PUT',
    body: JSON.stringify({ permissions: [{ permission: 'finance', allowed: false }] }),
  }, bossToken);
  assert(revoke.status === 200, `BOSS revoke finance failed: ${revoke.status} ${JSON.stringify(revoke.body)}`);

  const navRevoked = await rawRequest('/auth/navigation', {}, doctorToken);
  assert(!navRevoked.body.data.permissions.includes('finance'),
    'finance revoke must disappear from navigation permissions');
  const financeRevoked = await rawRequest('/charge-assistant/frequent-items', {}, doctorToken);
  assert(financeRevoked.status === 403, `revoked finance route must return 403, got ${financeRevoked.status}`);

  console.log('permission smoke passed: DOCTOR clinical access allowed, finance/inventory/system/analytics/admin denied, grant/revoke effective');
} finally {
  await stopApi();
  fs.rmSync(tempRoot, { recursive: true, force: true });
}
