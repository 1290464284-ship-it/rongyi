const { app } = require('electron');
const { spawn, spawnSync } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const { randomInt } = require('node:crypto');
const state = require('./state.cjs');
const {
  isDev,
  API_MAX_RESTARTS,
  API_BACKOFF_BASE_MS,
  API_BACKOFF_MAX_MS,
  RANDOM_API_PORT_MIN,
  RANDOM_API_PORT_MAX,
  API_READY_TIMEOUT_MS,
  API_READY_WINDOW_FIRST_MS,
  API_READY_WINDOW_STRICT_MS,
  API_HEARTBEAT_INTERVAL_MS,
} = require('./constants.cjs');
const API_CONSOLE_MAX_BYTES = 5 * 1024 * 1024;
const { buildApiChildEnv } = require('./api-env.cjs');
const { crashLog, notify, sendApiStatus } = require('./logging.cjs');
const { getOrCreateSecret } = require('./secrets.cjs');
const { showApiErrorWindow } = require('./window.cjs');

function apiReadinessWindowMs({ firstCheck }) {
  return firstCheck ? API_READY_WINDOW_FIRST_MS : API_READY_WINDOW_STRICT_MS;
}

function withHealthErrorContext(message) {
  if (!state.apiLastHealthError) return message;
  return `${message}（最近一次健康检查失败：${state.apiLastHealthError.message}）`;
}

function randomPort() {
  return randomInt(RANDOM_API_PORT_MIN, RANDOM_API_PORT_MAX);
}

// Round7 M6：随机端口可能落入 Windows 排除端口保留段（README 已记录 3180
// 的同类问题）或恰被其他进程占用。spawn 前先临时 bind 探测，失败换端口，
// 最多尝试 10 次，避免 API 子进程 EADDRINUSE 后走重启退避、首次启动失败。
function isPortFree(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once('error', () => resolve(false));
    server.listen({ port, host: '127.0.0.1' }, () => {
      server.close(() => resolve(true));
    });
  });
}

async function pickFreePort() {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const candidate = randomPort();
    if (await isPortFree(candidate)) return candidate;
  }
  throw new Error('无法在 30000-50000 段找到可用端口（连续 10 次探测均被占用）');
}

function waitForApi(port, timeoutMs = API_READY_TIMEOUT_MS) {
  return new Promise((resolve, reject) => {
    const startedAt = Date.now();
    let lastError = null;
    const attempt = () => {
      const request = http.get(
        { hostname: '127.0.0.1', port, path: '/api/v2/health', timeout: 500 },
        (response) => {
          response.resume();
          if (response.statusCode === 200) {
            resolve(port);
            return;
          }
          retry();
        },
      );
      request.on('error', retry);
      request.on('timeout', () => request.destroy());
    };
    const retry = (error) => {
      if (error) lastError = error;
      if (Date.now() - startedAt > timeoutMs) {
        // T2R-14: preserve the last underlying failure (ECONNREFUSED vs
        // timeout) so callers can log/present a concrete reason instead of a
        // generic one.
        reject(lastError || new Error('API did not become ready'));
        return;
      }
      setTimeout(attempt, 400);
    };
    attempt();
  });
}

function apiScript() {
  return path.join(__dirname, '..', 'dist-electron', 'server.cjs');
}

let apiStartPromise = null;

// Serializes concurrent start requests (second-instance, activate, manual
// restart) so they cannot spawn two API children for the same app instance.
async function startApi() {
  if (state.apiProcess && !state.apiProcess.killed) return state.apiPort;
  if (apiStartPromise) return apiStartPromise;
  apiStartPromise = doStartApi();
  try {
    return await apiStartPromise;
  } finally {
    apiStartPromise = null;
  }
}

async function doStartApi() {
  if (state.apiProcess && !state.apiProcess.killed) return state.apiPort;
  state.apiPort = await pickFreePort();
  const userDataDir = app.getPath('userData');
  // S-L2（第七轮）：JWT/备份密钥不再经 spawn env 透传（Windows 上同用户进程
  // 可枚举子进程环境块），改为写入 os.tmpdir() 下随机名临时文件（mode 0o600，
  // 仅当前用户可读），经 V2_SECRET_FILE 传递路径；startApi 退出（成功或失败）
  // 后立即删除，密钥只短暂落在受保护文件中。
  const jwtSecret = getOrCreateSecret();
  const backupKey = getOrCreateSecret('backup-key');
  const secretFilePath = path.join(os.tmpdir(), `v2-secrets-${crypto.randomUUID()}.json`);
  // 微信 AppSecret 和首启管理密码也经 secret file 传给 API，避免出现在
  // 子进程环境块中；生产打包版不注入 V2_ADMIN_PASSWORD（管理员已存在）。
  try {
  fs.writeFileSync(secretFilePath, JSON.stringify({
    jwt: jwtSecret,
    backupKey,
    wechatAppId: process.env.V2_WECHAT_APP_ID ?? undefined,
    wechatAppSecret: process.env.V2_WECHAT_APP_SECRET ?? undefined,
    // 首次启动引导密码经 secret file 传给 API：不暴露在子进程环境块，
    // 但仍支持打包版/开发版在全新数据目录上创建初始管理员。
    adminPassword: process.env.V2_ADMIN_PASSWORD ?? undefined,
  }), { mode: 0o600 });
  // LEGACY: 旧版 Prisma 时代的 SQLite 数据库与 schema 目录。
  // 打包时需确保 resourcesPath/legacy/ 下存在 dental.sqlite 和 schema/ 目录。
  // TODO: 迁移完成后移除 legacy 环境变量与相关导入逻辑。
  const legacyBase = isDev
    ? path.join(__dirname, '..', 'legacy')
    : path.join(process.resourcesPath, 'legacy');
  state.apiProcess = spawn(process.execPath, [apiScript()], {
    env: buildApiChildEnv({
      userDataDir,
      legacyBase,
      secretFilePath,
      apiPort: state.apiPort,
      isPackaged: app.isPackaged,
    }),
    // stdout/stderr 接管道并落盘：idempotency/audit-buffer 等基础设施仍走
    // console，打包版不能把它们的诊断输出丢弃（stdio: ignore 会彻底消失）。
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    windowsHide: true,
  });
  state.apiSpawnedAt = Date.now();
  state.apiEverReady = false;
  const startedProcess = state.apiProcess;
  const apiConsolePath = path.join(userDataDir, 'logs', 'api-console.log');
  try {
    fs.mkdirSync(path.dirname(apiConsolePath), { recursive: true });
  } catch {
    // best effort: 日志目录不可写时仅丢失控制台侧输出，不阻塞启动
  }
  const appendApiConsole = (chunk) => {
    try {
      let size = 0;
      try {
        size = fs.statSync(apiConsolePath).size;
      } catch {
        // first write or missing file
      }
      if (size + chunk.length > API_CONSOLE_MAX_BYTES) {
        try {
          fs.renameSync(apiConsolePath, `${apiConsolePath}.1`);
        } catch {
          // rotation is best effort; append into the original file otherwise
        }
      }
      fs.appendFileSync(apiConsolePath, chunk);
    } catch {
      // best effort
    }
  };
  startedProcess.stdout?.on('data', appendApiConsole);
  startedProcess.stderr?.on('data', appendApiConsole);
  startedProcess.manualStop = false;
  attachApiHeartbeat(startedProcess);
  state.apiProcess.on('error', (error) => crashLog('api-spawn-error', error));
  state.apiProcess.on('exit', (code, signal) => {
    if (state.apiProcess === startedProcess) state.apiProcess = null;
    if (state.isQuitting || startedProcess.manualStop) return;
    // A health-check restart may already have spawned a replacement child;
    // a stale exit event from this older process must not null the new one.
    if (state.apiProcess && state.apiProcess !== startedProcess) return;
    state.apiLastCrashAt = Date.now();
    state.apiRestartCount += 1;
    crashLog('api-exit', new Error(`code=${code} signal=${String(signal)} lastCrashAt=${state.apiLastCrashAt}`));
    if (state.apiRestartCount >= API_MAX_RESTARTS) {
      sendApiStatus({ status: 'crashed', code });
      notify('本地服务异常', 'API 连续启动失败，请检查数据目录或联系管理员。');
      showApiErrorWindow(withHealthErrorContext(`API 连续失败 ${API_MAX_RESTARTS} 次（最近错误 code=${code}）。请检查数据目录权限或恢复备份。`));
      return;
    }
    sendApiStatus({ status: 'restarting', code });
    const backoffStep = Math.min(state.apiRestartCount - 1, 4);
    const delayMs = Math.min(API_BACKOFF_BASE_MS * Math.pow(2, backoffStep), API_BACKOFF_MAX_MS);
    setTimeout(() => {
      startApi().catch((error) => {
        crashLog('api-restart-failed', error);
        sendApiStatus({ status: 'crashed', message: error.message });
        showApiErrorWindow(withHealthErrorContext(error instanceof Error ? error.message : String(error)));
      });
    }, delayMs);
  });
  } catch (error) {
    // S-L2：即使 spawn/监听器装配抛错，也绝不让含密钥的临时文件残留在 tmpdir。
    try {
      fs.rmSync(secretFilePath, { force: true });
    } catch {
      // best effort
    }
    throw error;
  }
  try {
    await waitForApi(state.apiPort);
    state.apiEverReady = true;
    sendApiStatus({ status: 'ready', port: state.apiPort });
    return state.apiPort;
  } catch (error) {
    if (state.apiProcess && !state.apiProcess.killed) {
      state.apiProcess.manualStop = true;
      state.apiProcess.kill();
    }
    throw error;
  } finally {
    // S-L2: API 已读到密钥（health 200 即代表启动成功）或失败/超时，都删除临时密钥文件。
    try {
      fs.rmSync(secretFilePath, { force: true });
    } catch {
      // best effort: 删除失败只留下 tmpdir 中的 0o600 文件，不阻塞启动
    }
  }
}

async function ensureApiServerRunning() {
  if (state.apiProcess && !state.apiProcess.killed && state.apiPort) {
    // T2R-14 / R2-P1-11: two-level readiness window. The first check of a
    // freshly launched process (not yet observed ready, or just restarted)
    // uses the same generous window as startApi()'s initial wait, so a slow
    // start or an event loop busy with a long transaction / big import is not
    // mistaken for a dead process. Steady-state checks after the process has
    // been observed ready use a short window so a genuinely hung API is
    // restarted quickly.
    const firstCheck = !state.apiEverReady;
    const timeoutMs = apiReadinessWindowMs({ firstCheck });
    try {
      await waitForApi(state.apiPort, timeoutMs);
      state.apiEverReady = true;
      return state.apiPort;
    } catch (error) {
      // Preserve the scene instead of silently discarding it: keep the last
      // health-check error for restart-failure presentation, and log the
      // failure with uptime / port / restart count / window level before
      // deciding to kill.
      state.apiLastHealthError = error instanceof Error ? error : new Error(String(error));
      const uptimeMs = state.apiSpawnedAt ? Date.now() - state.apiSpawnedAt : 0;
      crashLog(
        'api-health-check-failed',
        new Error(
          `port=${state.apiPort} windowMs=${timeoutMs} firstCheck=${firstCheck} ` +
            `restartCount=${state.apiRestartCount} uptimeMs=${uptimeMs} error=${state.apiLastHealthError.message}`,
        ),
      );
      // fall through and restart an unhealthy API process
    }
  }
  if (state.apiProcess && !state.apiProcess.killed) {
    state.apiProcess.manualStop = true;
    state.apiProcess.kill();
  }
  state.apiProcess = null;
  // T2R-14: keep this reset. state.apiRestartCount is only incremented by the
  // 'exit' handler for non-manual exits (manualStop is set before every kill
  // here), so resetting it never affects the API_MAX_RESTARTS cap — it just
  // gives a health-check-restarted process a fresh crash budget, matching the
  // "recovered, start over" semantics of a manual restart.
  state.apiRestartCount = 0;
  return startApi();
}

async function stopApi() {
  if (state.shutdownStarted) return;
  state.shutdownStarted = true;
  state.isQuitting = true;
  const processToStop = state.apiProcess;
  state.apiProcess = null;
  if (processToStop && !processToStop.killed) {
    processToStop.manualStop = true;
    return new Promise((resolve) => {
      let settled = false;
      const done = () => {
        if (settled) return;
        settled = true;
        resolve();
      };
      processToStop.once('exit', done);
      try {
        processToStop.send('shutdown');
      } catch {
        // fall through to hard kill
      }
      setTimeout(() => {
        if (!processToStop.killed) processToStop.kill();
        setTimeout(done, 200);
      }, 1500);
    });
  }
}

// T2R-13 / R2-P1-09: ping the API child over the existing IPC channel. When
// this main process dies abruptly (crash / SIGKILL / taskkill) the pings stop
// and the child exits via its own heartbeat timeout / disconnect detection,
// so it never keeps running and writing the database as an orphan.
function attachApiHeartbeat(proc) {
  if (state.apiHeartbeatTimer) clearInterval(state.apiHeartbeatTimer);
  const timer = setInterval(() => {
    if (proc.killed || state.apiProcess !== proc) return;
    try {
      proc.send('ping');
    } catch {
      // IPC channel is gone; the child exits itself via its heartbeat timeout
    }
  }, API_HEARTBEAT_INTERVAL_MS);
  state.apiHeartbeatTimer = timer;
  proc.once('exit', () => {
    // Only clear the timer we own: a stale exit event from a previously
    // restarted process must not stop the heartbeat of the current child.
    if (state.apiHeartbeatTimer === timer) {
      clearInterval(timer);
      state.apiHeartbeatTimer = null;
    }
  });
}

// Synchronous, safe to call from app.on('will-quit') / process.on('exit').
// Graceful shutdown is handled by stopApi(); this is the final hard stop.
function terminateApiSync() {
  if (state.apiHeartbeatTimer) {
    clearInterval(state.apiHeartbeatTimer);
    state.apiHeartbeatTimer = null;
  }
  const proc = state.apiProcess;
  if (!proc || proc.killed || proc.pid == null) return;
  let killed = false;
  try {
    killed = proc.kill();
  } catch {
    killed = false;
  }
  if (!killed && process.platform === 'win32') {
    try {
      spawnSync('taskkill', ['/pid', String(proc.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
    } catch {
      // best effort
    }
  }
}


module.exports = {
  startApi,
  ensureApiServerRunning,
  stopApi,
  terminateApiSync,
};
