import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { waitForService } from './wait-for-services.mjs';

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const root = path.resolve(appRoot, '..', '..');
const pnpm = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';
const apiUrl = process.env.V2_API_URL ?? 'http://localhost:3180/api/v2/health';
const webUrl = process.env.V2_WEB_URL ?? 'http://localhost:5180';
const timeoutMs = Number(process.env.V2_WAIT_TIMEOUT_MS ?? 90_000);
const children = [];
const logFds = [];

function requireEnv(name) {
  if (!process.env[name]) {
    console.error(`V2_ADMIN_PASSWORD and V2_BACKUP_KEY must be set before running smoke:all`);
    console.error(`missing: ${name}`);
    console.error(`example: $env:${name}='smoke-value'; pnpm --filter @dental/v2 smoke:all`);
    process.exit(1);
  }
}

// Fail fast before starting dev servers: the API/UI smoke scripts require the
// admin password, and the backup restore path requires the backup key. Without
// this preflight the suite fails later with a confusing 500 on /backups.
requireEnv('V2_ADMIN_PASSWORD');
requireEnv('V2_BACKUP_KEY');

// 默认使用全新临时数据目录：既有 data/ 里的管理员密码与当前 V2_ADMIN_PASSWORD
// 不一定一致，且残留产物会让 smoke 结果不可复现。显式设置
// V2_SMOKE_USE_EXISTING_DATA=1 可保留调用方指定的 V2_DATA_DIR。
const smokeRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'v2-smoke-all-'));
if (process.env.V2_SMOKE_USE_EXISTING_DATA !== '1') {
  process.env.V2_DATA_DIR = path.join(smokeRoot, 'data');
}
// main.ts 优先使用 V2_DB_PATH；无论是全新目录还是 existing-data 模式，smoke
// 都只认 V2_DATA_DIR，避免外层变量把请求写进非预期的真实数据库。
delete process.env.V2_DB_PATH;
process.env.V2_BACKUP_DIR = path.join(smokeRoot, 'backups');
process.env.V2_LOG_DIR = path.join(smokeRoot, 'logs');

function shellCommand(args) {
  // Windows 下 spawn 需要 shell 解析 pnpm.cmd，因此保留 shell 但参数必须
  // 是固定字面量：含空白/引号的参数直接拒绝，避免脆弱转义变成注入面。
  for (const part of args) {
    if (/[\s"'&|$`<>;()]/.test(part)) throw new Error(`unsafe smoke argument: ${part}`);
  }
  return ['pnpm', '--filter', '@dental/v2', ...args].join(' ');
}

function isPortFree(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once('error', () => resolve(false));
    server.listen({ port, host: '127.0.0.1' }, () => {
      server.close(() => resolve(true));
    });
  });
}

function startDev(label, args) {
  const isWindows = process.platform === 'win32';
  const logPath = path.join(smokeRoot, `${label}.log`);
  const logFd = fs.openSync(logPath, 'a');
  logFds.push(logFd);
  const options = {
    cwd: root,
    shell: isWindows,
    // 不共享父进程 stdio 句柄：Windows 下 detached 子进程与 spawnSync smoke
    // 子进程同时继承 stdout/stderr 会触发 libuv 的 UV_HANDLE_CLOSING 断言。
    stdio: ['ignore', logFd, logFd],
    env: process.env,
    // 分离进程树并隐藏窗口：父进程退出时不再共享子进程的 stdio 句柄；
    // POSIX 下 detached 会建立独立进程组，便于按 -pid 整组终止。
    detached: true,
    windowsHide: true,
  };
  const child = isWindows
    ? spawn(shellCommand(args), options)
    : spawn(pnpm, ['--filter', '@dental/v2', ...args], options);
  children.push(child);
  child.on('error', (error) => {
    console.error(`${label} failed to start`, error);
  });
  return child;
}

function stopDev() {
  for (const child of children.splice(0)) {
    if (!child || typeof child.pid !== 'number') continue;
    if (process.platform === 'win32') {
      spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
    } else {
      try {
        process.kill(-child.pid, 'SIGTERM');
      } catch {
        try {
          child.kill('SIGTERM');
        } catch {
          // process already exited
        }
      }
    }
  }
}

function runSmoke(args) {
  const isWindows = process.platform === 'win32';
  const options = {
    cwd: root,
    shell: isWindows,
    stdio: 'inherit',
    env: process.env,
  };
  const result = isWindows
    ? spawnSync(shellCommand(args), options)
    : spawnSync(pnpm, ['--filter', '@dental/v2', ...args], options);
  if (result.status !== 0) {
    throw new Error(`${args.join(' ')} failed with exit code ${result.status}`);
  }
}

async function main() {
  const apiPort = Number(process.env.V2_PORT ?? 3180);
  const webPort = Number(process.env.V2_WEB_DEV_PORT ?? 5180);
  for (const [label, port] of [['API', apiPort], ['web', webPort]]) {
    if (!(await isPortFree(port))) {
      throw new Error(
        `Port ${port} (${label}) is already in use; set V2_PORT/V2_WEB_DEV_PORT to free ports before running smoke:all`,
      );
    }
  }
  startDev('api', ['dev:api']);
  startDev('web', ['dev:web']);

  await waitForService({ url: apiUrl, text: '', timeoutMs });
  console.log('api ready');
  await waitForService({ url: webUrl, text: '<div id="root"', timeoutMs });
  console.log('web ready');

  runSmoke(['run', 'smoke:api']);
  runSmoke(['run', 'smoke:ui']);
  process.env.V2_SKIP_WEB_START = '1';
  runSmoke(['run', 'smoke:electron']);
  delete process.env.V2_SKIP_WEB_START;
  runSmoke(['run', 'test:load']);
  runSmoke(['run', 'smoke:multi-instance']);
  runSmoke(['run', 'smoke:state-machine-concurrency']);
  runSmoke(['run', 'smoke:wechat-gateway']);
  runSmoke(['run', 'smoke:http-fuzz']);
  runSmoke(['run', 'smoke:permissions']);
  console.log('full smoke passed');
}

function cleanupSmokeEnvironment() {
  stopDev();
  for (const fd of logFds.splice(0)) {
    try {
      fs.closeSync(fd);
    } catch {
      // best effort
    }
  }
  fs.rmSync(smokeRoot, { recursive: true, force: true });
}

let signalCleanupInstalled = false;
function installSignalCleanup() {
  if (signalCleanupInstalled) return;
  signalCleanupInstalled = true;
  const onSignal = () => {
    try {
      stopDev();
    } catch {
      // best effort
    }
    try {
      fs.rmSync(smokeRoot, { recursive: true, force: true });
    } catch {
      // best effort
    }
    process.exit(130);
  };
  process.once('SIGINT', onSignal);
  process.once('SIGTERM', onSignal);
}
installSignalCleanup();

function showLogs() {
  for (const label of ['api', 'web']) {
    const logPath = path.join(smokeRoot, `${label}.log`);
    if (!fs.existsSync(logPath)) continue;
    const lines = fs.readFileSync(logPath, 'utf8').trim().split('\n').slice(-40);
    if (lines.length > 0) {
      console.error(`--- ${label} dev log (tail) ---`);
      for (const line of lines) console.error(line);
    }
  }
}

main()
  .then(() => {
    try {
      cleanupSmokeEnvironment();
    } catch (cleanupError) {
      console.error('smoke cleanup failed after success', cleanupError);
    }
  })
  .catch(async (error) => {
    console.error(error instanceof Error ? error.stack ?? error.message : error);
    stopDev();
    showLogs();
    try {
      cleanupSmokeEnvironment();
    } catch (cleanupError) {
      console.error('smoke cleanup failed after failure', cleanupError);
    }
    // 显式退出，避免 Windows 下残留的 detached 子进程句柄触发 libuv 断言崩溃。
    await new Promise((resolve) => setTimeout(resolve, 250));
    process.exit(1);
  });
