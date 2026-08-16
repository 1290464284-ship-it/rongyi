import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { waitForService } from './wait-for-services.mjs';
import { pickFreePort, pnpmCommand, stopProcessTree } from './lib/smoke-runtime.mjs';

// 未显式指定时动态探测空闲端口，避免并行 smoke / 残留进程 EADDRINUSE。
const apiPortEnv = Number(process.env.V2_SMOKE_API_PORT ?? 0);
const webPortEnv = Number(process.env.V2_SMOKE_WEB_PORT ?? 0);
let apiPort = apiPortEnv > 0 ? apiPortEnv : 31871;
let webPort = webPortEnv > 0 ? webPortEnv : 51871;
const adminPassword = process.env.V2_SMOKE_ADMIN_PASSWORD ?? 'SmokeAdmin123';
const concurrencyScale = Number(process.env.V2_CONCURRENCY_SCALE ?? 2);
const loadIterations = Number(process.env.V2_LOAD_ITERATIONS ?? 100);
const skipApi = process.env.V2_SMOKE_SKIP_API === '1';
const skipUi = process.env.V2_SMOKE_SKIP_UI === '1';
const skipLoad = process.env.V2_SMOKE_SKIP_LOAD === '1';

const root = path.resolve(import.meta.dirname, '..', '..', '..');
const appRoot = path.join(root, 'apps', 'v2');
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'v2-delivery-smoke-'));
const dataDir = path.join(tempRoot, 'data');
const backupDir = path.join(dataDir, 'backups');
const logDir = path.join(dataDir, 'logs');
fs.mkdirSync(dataDir, { recursive: true });
fs.mkdirSync(backupDir, { recursive: true });
fs.mkdirSync(logDir, { recursive: true });

function baseEnv() {
  return {
    ...process.env,
    V2_PORT: String(apiPort),
    V2_HOST: '127.0.0.1',
    NODE_ENV: 'development',
    V2_DATA_DIR: dataDir,
    V2_BACKUP_DIR: backupDir,
    V2_LOG_DIR: logDir,
    V2_DB_PATH: path.join(dataDir, 'v2.sqlite'),
    V2_JWT_SECRET: 'delivery-smoke-secret-0123456789abcdef0123456789abcdef',
    V2_BACKUP_KEY: 'delivery-smoke-backup-key-0123456789abcdef',
    V2_ADMIN_PASSWORD: adminPassword,
    V2_LEGACY_DB_PATH: path.join(appRoot, 'legacy', 'dental.sqlite'),
    V2_LEGACY_SCHEMA_DIR: path.join(appRoot, 'legacy', 'schema'),
    VITE_API_BASE_URL: '/api/v2',
    V2_CORS_ORIGIN: `http://localhost:${webPort}`,
    V2_BASE_URL: `http://127.0.0.1:${apiPort}/api/v2`,
    V2_WEB_URL: `http://localhost:${webPort}`,
    V2_WEB_DEV_PORT: String(webPort),
    V2_LOAD_ITERATIONS: String(loadIterations),
    V2_CONCURRENCY_SCALE: String(concurrencyScale),
  };
}

const children = [];

function start(label, args) {
  const child = label === 'api'
    ? spawn(process.execPath, [path.join(appRoot, 'dist-electron', 'server.cjs')], {
        cwd: appRoot,
        env: baseEnv(),
        stdio: 'inherit',
        windowsHide: true,
      })
    : spawn(pnpmCommand(args), {
        cwd: root,
        env: baseEnv(),
        stdio: 'inherit',
        shell: process.platform === 'win32',
        windowsHide: true,
      });
  children.push(child);
  child.on('error', (error) => console.error(`${label} failed to start`, error));
  return child;
}

function runSmoke(args) {
  const command = pnpmCommand(args);
  const result = spawnSync(command, {
    cwd: root,
    env: baseEnv(),
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });
  if (result.status !== 0) {
    throw new Error(`${args.join(' ')} failed with exit code ${result.status}`);
  }
}

function stopAll() {
  for (const child of children.splice(0)) {
    if (!child || typeof child.pid !== 'number') continue;
    stopProcessTree(child.pid);
  }
}

/** 等所有子进程退出后再返回（带 10s 兜底），保证临时目录删除时无句柄残留。 */
async function stopAllAndWait() {
  const pending = children.filter((child) => child && child.exitCode === null);
  stopAll();
  if (pending.length === 0) return;
  await Promise.race([
    Promise.all(pending.map((child) => new Promise((resolve) => {
      if (child.exitCode !== null) {
        resolve();
        return;
      }
      child.once('exit', resolve);
    }))),
    new Promise((resolve) => setTimeout(resolve, 10_000)),
  ]);
}

async function main() {
  if (apiPortEnv <= 0) apiPort = await pickFreePort(32000, 32999);
  if (webPortEnv <= 0 && !skipUi) webPort = await pickFreePort(52000, 52999);
  start('api', ['dev:api']);
  if (!skipUi) start('web', ['dev:web']);
  await waitForService({ url: `http://127.0.0.1:${apiPort}/api/v2/health`, text: '', timeoutMs: 90_000 });
  console.log('API ready');
  if (!skipUi) {
    await waitForService({ url: `http://localhost:${webPort}`, text: '<div id="root"', timeoutMs: 90_000 });
    console.log('Web ready');
  }

  if (!skipApi) runSmoke(['smoke:api']);
  if (!skipUi) runSmoke(['smoke:ui']);
  if (!skipLoad) runSmoke(['test:load']);
  await waitForService({ url: `http://127.0.0.1:${apiPort}/api/v2/health`, text: '', timeoutMs: 10_000 });
  console.log('API-alive');
  runSmoke(['smoke:state-machine-concurrency']);
  console.log('ALL_DELIVERY_SMOKES_PASSED');
}

main()
  .then(async () => {
    await stopAllAndWait();
    const resolved = path.resolve(tempRoot);
    if (resolved.startsWith(path.resolve(os.tmpdir())) && fs.existsSync(resolved)) {
      fs.rmSync(resolved, { recursive: true, force: true });
    }
  })
  .catch(async (error) => {
    console.error(error instanceof Error ? error.stack ?? error.message : error);
    for (const label of ['api', 'web']) {
      const logPath = path.join(tempRoot, `${label}.log`);
      if (!fs.existsSync(logPath)) continue;
      const lines = fs.readFileSync(logPath, 'utf8').trim().split('\n').slice(-40);
      if (lines.length > 0) {
        console.error(`--- ${label} log tail ---`);
        for (const line of lines) console.error(line);
      }
    }
    stopAll();
    await new Promise((resolve) => setTimeout(resolve, 500));
    console.error(`temp smoke dir kept for inspection: ${tempRoot}`);
    process.exit(1);
  });
