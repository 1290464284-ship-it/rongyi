import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pickFreePort } from './lib/smoke-runtime.mjs';

const appRoot = path.resolve(import.meta.dirname, '..');
const serverScript = path.join(appRoot, 'dist-electron', 'server.cjs');
const legacyDb = path.join(appRoot, 'legacy', 'dental.sqlite');
const legacySchemaDir = path.join(appRoot, 'legacy', 'schema');
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'v2-http-fuzz-'));
const dataDir = path.join(tempRoot, 'data');
const backupDir = path.join(dataDir, 'backups');
const logDir = path.join(dataDir, 'logs');
const port = await pickFreePort(34000, 35999);
const jwtSecret = 'http-fuzz-secret-0123456789abcdef0123456789abcdef';
const backupKey = 'http-fuzz-backup-key-0123456789abcdef';
const adminPassword = 'FuzzSmokeAdmin123!';
const base = `http://127.0.0.1:${port}/api/v2`;

if (!fs.existsSync(serverScript)) {
  console.error('dist-electron/server.cjs not found. Run electron:compile first.');
  process.exit(1);
}

let apiProcess = null;

function waitForApi(timeoutMs = 30_000) {
  const startedAt = Date.now();
  return new Promise((resolve, reject) => {
    const attempt = async () => {
      if (Date.now() - startedAt > timeoutMs) {
        reject(new Error('API did not become ready during HTTP fuzz smoke'));
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

async function startApi() {
  fs.mkdirSync(dataDir, { recursive: true });
  fs.mkdirSync(backupDir, { recursive: true });
  fs.mkdirSync(logDir, { recursive: true });
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
      V2_DB_PATH: path.join(dataDir, 'v2.sqlite'),
      V2_JWT_SECRET: jwtSecret,
      V2_BACKUP_KEY: backupKey,
      V2_ADMIN_PASSWORD: adminPassword,
    },
    stdio: ['ignore', 'inherit', 'inherit'],
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

async function rawRequest(pathname, options = {}, token = null) {
  const headers = { 'content-type': 'application/json', ...(options.headers ?? {}) };
  if (token) headers.authorization = `Bearer ${token}`;
  try {
    const response = await fetch(`${base}${pathname}`, { ...options, headers });
    const bodyText = await response.text();
    let body = null;
    try {
      body = JSON.parse(bodyText);
    } catch {
      // non-JSON response is fine for adversarial checks
    }
    return { status: response.status, body, bodyText };
  } catch {
    return { status: 0, body: null, bodyText: 'network error' };
  }
}

const failures = [];
function expectClientError(label, result) {
  const ok = result.status >= 400 && result.status < 500;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${label}: ${result.status}`);
  if (!ok) failures.push(`${label}: expected 4xx, got ${result.status} ${result.bodyText.slice(0, 120)}`);
}

function expectNoServerError(label, result) {
  const ok = result.status >= 200 && result.status < 500;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${label}: ${result.status}`);
  if (!ok) failures.push(`${label}: expected 2xx/4xx, got ${result.status} ${result.bodyText.slice(0, 120)}`);
}

async function main() {
  try {
    await startApi();

    const login = await rawRequest('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username: 'admin', password: adminPassword }),
    });
    if (login.status !== 200 || !login.body?.success) {
      throw new Error(`fuzz setup login failed: ${login.status} ${login.bodyText}`);
    }
    const token = login.body.data.token;

    expectClientError('malformed JSON body', await rawRequest('/auth/login', {
      method: 'POST',
      body: '{"username":',
    }));
    expectClientError('empty login body', await rawRequest('/auth/login', {
      method: 'POST',
      body: '{}',
    }));
    expectClientError('negative pagination', await rawRequest('/resources/patients?page=-1&pageSize=0', {}, token));
    expectClientError('non-numeric pagination', await rawRequest('/resources/patients?page=abc&pageSize=999999999', {}, token));
    expectClientError('wrong field types', await rawRequest('/resources/patients', {
      method: 'POST',
      body: JSON.stringify({ code: 123, name: 456, gender: 'MALE', phone: '123', source: 'WALK_IN' }),
    }, token));
    expectClientError('invalid enum', await rawRequest('/resources/patients', {
      method: 'POST',
      body: JSON.stringify({ code: 'X', name: 'x', gender: 'ALIEN', phone: '123', source: 'WALK_IN' }),
    }, token));
    expectClientError('missing resource', await rawRequest('/resources/patients/no-such-id', {}, token));
    expectClientError('invalid print data', await rawRequest('/print?kind=report&data={bad', {}, token));
    expectNoServerError('prototype-like unknown key', await rawRequest('/resources/patients', {
      method: 'POST',
      body: JSON.stringify({ code: 'X', name: 'x', gender: 'MALE', phone: '123', source: 'WALK_IN', __proto__: { admin: true } }),
    }, token));
    expectClientError('oversized JSON body', await rawRequest('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username: 'admin', password: 'x'.repeat(3 * 1024 * 1024) }),
    }));
    expectClientError('untrusted CORS origin', await rawRequest('/stats/dashboard', {
      headers: { origin: 'https://evil.example' },
    }, token));

    const health = await rawRequest('/health');
    const relogin = await rawRequest('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username: 'admin', password: adminPassword }),
    });
    if (health.status !== 200 || relogin.status !== 200) {
      failures.push(`server unhealthy after fuzz: health=${health.status} relogin=${relogin.status}`);
    }

    if (failures.length > 0) {
      console.error(`HTTP fuzz smoke failed (${failures.length}):`);
      for (const failure of failures) console.error(`  - ${failure}`);
      process.exitCode = 1;
    } else {
      console.log('HTTP fuzz smoke passed: all adversarial requests returned 4xx and server stayed healthy');
    }
  } finally {
    await stopApi();
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

await main();
