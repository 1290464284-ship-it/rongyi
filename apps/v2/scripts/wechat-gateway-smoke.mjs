import { spawn } from 'node:child_process';
import fs from 'node:fs';
import https from 'node:https';
import os from 'node:os';
import path from 'node:path';

const appRoot = path.resolve(import.meta.dirname, '..');
const serverScript = path.join(appRoot, 'dist-electron', 'server.cjs');
const legacyDb = path.join(appRoot, 'legacy', 'dental.sqlite');
const legacySchemaDir = path.join(appRoot, 'legacy', 'schema');
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'v2-wechat-gateway-'));
const dataDir = path.join(tempRoot, 'data');
const backupDir = path.join(dataDir, 'backups');
const logDir = path.join(dataDir, 'logs');
const port = 36000 + Math.floor(Math.random() * 2000);
const jwtSecret = 'wechat-gateway-secret-0123456789abcdef0123456789abcdef';
const backupKey = 'wechat-gateway-backup-key-0123456789abcdef';
const adminPassword = 'WechatGatewaySmoke123!';
const base = `http://127.0.0.1:${port}/api/v2`;

if (!fs.existsSync(serverScript)) {
  console.error('dist-electron/server.cjs not found. Run electron:compile first.');
  process.exit(1);
}

let apiProcess = null;
let gateway = null;
const gatewayRequests = [];

function waitForApi(timeoutMs = 30_000) {
  const startedAt = Date.now();
  return new Promise((resolve, reject) => {
    const attempt = async () => {
      if (Date.now() - startedAt > timeoutMs) {
        reject(new Error('API did not become ready during WeChat gateway smoke'));
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

async function startGateway() {
  const pfx = fs.readFileSync(path.join(appRoot, 'certs', 'internal-signing.pfx'));
  const passphrase = fs.readFileSync(path.join(appRoot, 'certs', 'internal-signing.pfx-password.txt'), 'utf8').trim();
  gateway = https.createServer({ pfx, passphrase }, (req, res) => {
    let raw = '';
    req.on('data', (chunk) => {
      raw += String(chunk);
    });
    req.on('end', () => {
      let body = {};
      try {
        body = JSON.parse(raw || '{}');
      } catch {
        body = {};
      }
      gatewayRequests.push(body);
      const content = String(body.message?.content ?? '');
      if (content === 'gateway-500') {
        res.statusCode = 500;
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({ ok: false, result: 'http_500', detail: 'mock gateway failure' }));
        return;
      }
      res.statusCode = 200;
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ ok: true, result: 'mock_sent' }));
    });
  });
  await new Promise((resolve) => gateway.listen(0, '127.0.0.1', resolve));
  return gateway.address().port;
}

function stopGateway() {
  return new Promise((resolve) => {
    if (!gateway) {
      resolve();
      return;
    }
    gateway.close(() => resolve());
  });
}

async function startApi(gatewayPort) {
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
      V2_WECHAT_API_URL: `https://127.0.0.1:${gatewayPort}`,
      V2_WECHAT_APP_ID: 'mock-wechat-app',
      V2_WECHAT_APP_SECRET: 'mock-wechat-secret',
      NODE_TLS_REJECT_UNAUTHORIZED: '0',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
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

async function request(pathname, options = {}, token = null) {
  const headers = { 'content-type': 'application/json', ...(options.headers ?? {}) };
  if (token) headers.authorization = `Bearer ${token}`;
  const response = await fetch(`${base}${pathname}`, { ...options, headers });
  const body = await response.json().catch(() => null);
  if (!response.ok || !body?.success) {
    throw new Error(`${options.method ?? 'GET'} ${pathname}: ${response.status} ${JSON.stringify(body)}`);
  }
  return body.data;
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function main() {
  try {
    const gatewayPort = await startGateway();
    await startApi(gatewayPort);

    const login = await request('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username: 'admin', password: adminPassword }),
    });
    const token = login.token;

    const status = await request('/wechat/status', {}, token);
    assert(status.configured === true && status.provider === 'http', 'WeChat gateway should be configured');

    const created = await request('/resources/wechatMessages', {
      method: 'POST',
      body: JSON.stringify({ patientId: 'patient-demo-001', type: 'TEXT', content: 'hello mock', status: 'PENDING' }),
    }, token);
    const createdMessages = await request('/resources/wechatMessages?page=1&pageSize=100', {}, token);
    const createdRow = (createdMessages.items ?? []).find((row) => String(row.id) === String(created.id));
    assert(createdRow && String(createdRow.status) === 'PENDING', 'created WeChat message should be PENDING');

    const sent = await request(`/wechat/${created.id}/send`, {
      method: 'POST',
      body: JSON.stringify({}),
    }, token);
    assert(sent.status === 'SENT', `send should mark SENT, got ${sent.status}`);
    assert(gatewayRequests.length === 1, `gateway should receive one request, got ${gatewayRequests.length}`);
    assert(gatewayRequests[0].appId === 'mock-wechat-app', 'gateway should receive the configured appId');
    assert(gatewayRequests[0].idempotencyKey === created.id, 'gateway should receive the message id as idempotency key');

    const failed = await request('/resources/wechatMessages', {
      method: 'POST',
      body: JSON.stringify({ patientId: 'patient-demo-001', type: 'TEXT', content: 'gateway-500', status: 'PENDING' }),
    }, token);
    let sendFailed = null;
    try {
      await request(`/wechat/${failed.id}/send`, { method: 'POST', body: JSON.stringify({}) }, token);
    } catch (error) {
      sendFailed = error;
    }
    assert(sendFailed !== null, 'gateway 500 should fail the send request');
    const messages = await request('/resources/wechatMessages?page=1&pageSize=100', {}, token);
    const failedRow = (messages.items ?? []).find((row) => String(row.id) === String(failed.id));
    assert(failedRow && String(failedRow.status) === 'PENDING', 'failed gateway send should stay sendable (PENDING)');
    assert(gatewayRequests.length === 2, `gateway should receive two requests, got ${gatewayRequests.length}`);

    console.log('WeChat gateway smoke passed: configured provider -> send -> mock receipt -> SENT; gateway failure -> stays PENDING.');
  } finally {
    await stopApi();
    await stopGateway();
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

await main();
