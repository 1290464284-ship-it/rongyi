const {
  app,
  BrowserWindow,
  Tray,
  Menu,
  nativeImage,
  ipcMain,
  safeStorage,
  Notification,
  session,
  dialog,
  crashReporter: nativeCrashReporter,
} = require('electron');
const { autoUpdater } = require('electron-updater');
const { spawn, spawnSync } = require('node:child_process');
const crypto = require('node:crypto');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const { randomInt } = require('node:crypto');
const { shell } = require('electron');

const isDev = !app.isPackaged;
let apiProcess = null;
let apiPort = null;
let _isQuitting = false;
let _shutdownStarted = false;
let tray = null;
let apiRestartCount = 0;
let apiLastCrashAt = 0;
let apiHeartbeatTimer = null;
const API_MAX_RESTARTS = 5;
const API_BACKOFF_BASE_MS = 30_000;
const API_BACKOFF_MAX_MS = 300_000;
// T2R-13 / R2-P1-09: parent-side heartbeat. Must stay well below the child's
// PARENT_HEARTBEAT_TIMEOUT_MS (10s) so a hard-killed main process stops pinging
// and the API child exits on its own instead of running as an orphan.
const API_HEARTBEAT_INTERVAL_MS = 2_000;
const DEFAULT_WINDOW_STATE = { width: 1280, height: 820 };
// T2R-14 / R2-P1-11: two-level API readiness window. The first check of a
// freshly launched API process uses the same generous window as startApi()'s
// initial wait (30s) so a slow start or an event loop busy with a long
// transaction / big import is never mistaken for a dead process. Steady-state
// checks after the process has been observed ready use a short window so a
// genuinely hung API is restarted quickly. With a 500ms per-attempt HTTP
// timeout and a 400ms retry gap, the strict window still allows 2 full
// attempts plus a third opportunity before rejecting, while a true hang is
// detected in ~2.3s.
const API_READY_WINDOW_FIRST_MS = 30_000;
const API_READY_WINDOW_STRICT_MS = 2_000;

// T2R-14: true once the current API process has been observed healthy; reset
// on every spawn so each launch/restart gets exactly one relaxed check.
let apiEverReady = false;
// T2R-14: last health-check failure, preserved for restart-failure
// presentation instead of being silently discarded.
let apiLastHealthError = null;
// T2R-14: spawn timestamp of the current API process, for uptime logging.
let apiSpawnedAt = 0;

function apiReadinessWindowMs({ firstCheck }) {
  return firstCheck ? API_READY_WINDOW_FIRST_MS : API_READY_WINDOW_STRICT_MS;
}

function withHealthErrorContext(message) {
  if (!apiLastHealthError) return message;
  return `${message}（最近一次健康检查失败：${apiLastHealthError.message}）`;
}

function crashLog(message, error) {
  const entry = {
    timestamp: new Date().toISOString(),
    message,
    stack: String(error?.stack ?? error).split('\n').slice(0, 20).join('\n'),
  };
  try {
    const logDir = path.join(app.getPath('userData'), 'logs');
    fs.mkdirSync(logDir, { recursive: true });
    // 5MB×5 轮转（与 API 侧 logger 一致），防止 desktop.log 无限追加
    const logFile = path.join(logDir, 'desktop.log');
    const MAX_LOG_BYTES = 5 * 1024 * 1024;
    if (fs.existsSync(logFile) && fs.statSync(logFile).size >= MAX_LOG_BYTES) {
      for (let i = 4; i >= 1; i -= 1) {
        const rotated = `${logFile}.${i}`;
        if (fs.existsSync(rotated)) fs.renameSync(rotated, `${logFile}.${i + 1}`);
      }
      fs.renameSync(logFile, `${logFile}.1`);
    }
    fs.appendFileSync(logFile, JSON.stringify(entry) + '\n');
  } catch {
    // best effort
  }
  const endpoint = process.env.V2_CRASH_REPORT_URL;
  if (endpoint && !endpoint.startsWith('https://')) {
    console.warn('V2_CRASH_REPORT_URL must be an HTTPS endpoint; crash report upload skipped');
  }
  if (endpoint && endpoint.startsWith('https://')) {
    try {
      const request = http.request(
        endpoint,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          timeout: 3000,
        },
        (response) => response.resume(),
      );
      request.on('error', () => {});
      request.on('timeout', () => request.destroy());
      request.end(JSON.stringify(entry));
    } catch {
      // best effort
    }
  }
}

// T2R-22 遗留④：可用明文判定——长度达标且不含控制字符（NUL 会让子进程
// spawn 环境校验失败，进入错误窗循环）。旧明文密钥（safeStorage 引入前）
// 均为 ASCII 可打印串，损坏的密文 blob 几乎必然含控制字符或被 UTF-8 替换。
function isUsablePlainSecret(plain) {
  return typeof plain === 'string' && plain.length >= 32 && !/[\u0000-\u001f\u007f]/.test(plain);
}

function getOrCreateSecret(fileName = 'jwt-secret') {
  const secretsDir = path.join(app.getPath('userData'), 'secrets');
  const secretPath = path.join(secretsDir, fileName);
  fs.mkdirSync(secretsDir, { recursive: true });
  try {
    const existing = fs.readFileSync(secretPath);
    if (safeStorage.isEncryptionAvailable()) {
      try {
        const plain = safeStorage.decryptString(existing);
        if (plain.length >= 32) return plain;
      } catch {
        // 解密失败：可能是 safeStorage 引入前的旧明文文件，也可能是损坏/后端翻转的密文。
        // 仅当内容是可用明文时才视为旧明文并重新加密；否则删除重新生成——
        // 把二进制密文当明文回传会让 JWT 密钥含 NUL 字节，spawn 环境校验失败。
        const plain = existing.toString('utf8').trim();
        if (isUsablePlainSecret(plain)) {
          fs.writeFileSync(secretPath, safeStorage.encryptString(plain), { mode: 0o600 });
          return plain;
        }
        console.warn(`secret file ${fileName} is unreadable or corrupt; regenerating`);
        fs.rmSync(secretPath, { force: true });
      }
    } else {
      const plain = existing.toString('utf8').trim();
      if (isUsablePlainSecret(plain)) return plain;
      console.warn(`secret file ${fileName} is unreadable or corrupt; regenerating`);
      fs.rmSync(secretPath, { force: true });
    }
  } catch {
    // first run or unreadable secret; create a fresh one below
  }
  // R2-P1-13: 重生成 backup-key 会让既有 .enc 备份永久不可解密，须显式告知。
  if (fileName === 'backup-key') {
    const backupDir = path.join(app.getPath('userData'), 'backups');
    try {
      if (fs.existsSync(backupDir) && fs.readdirSync(backupDir).some((name) => name.endsWith('.enc'))) {
        console.warn('backup-key regenerated: existing encrypted backups cannot be decrypted with the new key');
        dialog.showMessageBoxSync({
          type: 'warning',
          title: '备份密钥已更换',
          message: '检测到备份密钥文件丢失或损坏，系统已生成新密钥。',
          detail: '此前创建的加密备份（.enc）将无法用新密钥解密。如需恢复旧备份，请从备份中还原原密钥文件，或保留旧密钥文件后重启。',
          buttons: ['我知道了'],
        });
      }
    } catch {
      // best effort: 目录不可读时静默跳过，不阻塞启动
    }
  }
  const secret = crypto.randomBytes(48).toString('hex');
  const encrypted = safeStorage.isEncryptionAvailable();
  fs.writeFileSync(secretPath, encrypted ? safeStorage.encryptString(secret) : secret, { mode: 0o600 });
  if (!encrypted) console.warn('safeStorage unavailable; secrets stored in plaintext');
  return secret;
}

function secretPath(key) {
  // T2R-22: 白名单 key 形如 'v2.token' / 'v2.refreshToken'（含点号），原字符集
  // [a-zA-Z0-9_-] 会把它们全部判为非法 → get/set/delete 静默失败，safeStorage
  // 令牌持久化形同虚设（每次启动须重登）。放行 '.' 且仍禁止 '/' '\' 等路径分隔符。
  if (!/^[a-zA-Z0-9_.-]{1,64}$/.test(key)) throw new Error('Invalid secret key');
  const secretsDir = path.join(app.getPath('userData'), 'secrets');
  return path.join(secretsDir, `${key}.enc`);
}

function notify(title, body) {
  if (Notification.isSupported()) {
    new Notification({ title, body }).show();
  }
}

function sendToRenderers(channel, payload) {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send(channel, payload);
  }
}

function sendUpdateEvent(payload) {
  sendToRenderers('update:event', payload);
}

function sendApiStatus(payload) {
  sendToRenderers('api:status', payload);
}

process.on('uncaughtException', (error) => crashLog('uncaughtException', error));
process.on('unhandledRejection', (reason) => crashLog('unhandledRejection', reason));

function randomPort() {
  return randomInt(30000, 50000);
}

function waitForApi(port, timeoutMs = 30000) {
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

async function startApi() {
  if (apiProcess && !apiProcess.killed) return apiPort;
  apiPort = randomPort();
  const userDataDir = app.getPath('userData');
  // LEGACY: 旧版 Prisma 时代的 SQLite 数据库与 schema 目录。
  // 打包时需确保 resourcesPath/legacy/ 下存在 dental.sqlite 和 schema/ 目录。
  // TODO: 迁移完成后移除 legacy 环境变量与相关导入逻辑。
  const legacyBase = isDev
    ? path.join(__dirname, '..', 'legacy')
    : path.join(process.resourcesPath, 'legacy');
  apiProcess = spawn(process.execPath, [apiScript()], {
    env: {
      ...process.env,
      V2_PORT: String(apiPort),
      V2_HOST: '127.0.0.1',
      NODE_ENV: app.isPackaged ? 'production' : 'development',
      V2_DATA_DIR: path.join(userDataDir, 'data'),
      V2_BACKUP_DIR: path.join(userDataDir, 'backups'),
      V2_LOG_DIR: path.join(userDataDir, 'logs'),
      V2_LEGACY_DB_PATH: path.join(legacyBase, 'dental.sqlite'),
      V2_LEGACY_SCHEMA_DIR: path.join(legacyBase, 'schema'),
      V2_JWT_SECRET: getOrCreateSecret(),
      V2_BACKUP_KEY: getOrCreateSecret('backup-key'),
      ELECTRON_RUN_AS_NODE: '1',
    },
    stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
    windowsHide: true,
  });
  apiSpawnedAt = Date.now();
  apiEverReady = false;
  const startedProcess = apiProcess;
  startedProcess.manualStop = false;
  attachApiHeartbeat(startedProcess);
  apiProcess.on('error', (error) => crashLog('api-spawn-error', error));
  apiProcess.on('exit', (code, signal) => {
    apiProcess = null;
    if (_isQuitting || startedProcess.manualStop) return;
    apiLastCrashAt = Date.now();
    apiRestartCount += 1;
    crashLog('api-exit', new Error(`code=${code} signal=${String(signal)} lastCrashAt=${apiLastCrashAt}`));
    if (apiRestartCount >= API_MAX_RESTARTS) {
      sendApiStatus({ status: 'crashed', code });
      notify('本地服务异常', 'API 连续启动失败，请检查数据目录或联系管理员。');
      showApiErrorWindow(withHealthErrorContext(`API 连续失败 ${API_MAX_RESTARTS} 次（最近错误 code=${code}）。请检查数据目录权限或恢复备份。`));
      return;
    }
    sendApiStatus({ status: 'restarting', code });
    const backoffStep = Math.min(apiRestartCount - 1, 4);
    const delayMs = Math.min(API_BACKOFF_BASE_MS * Math.pow(2, backoffStep), API_BACKOFF_MAX_MS);
    setTimeout(() => {
      startApi().catch((error) => {
        crashLog('api-restart-failed', error);
        sendApiStatus({ status: 'crashed', message: error.message });
        showApiErrorWindow(withHealthErrorContext(error instanceof Error ? error.message : String(error)));
      });
    }, delayMs);
  });
  try {
    await waitForApi(apiPort);
    apiEverReady = true;
    sendApiStatus({ status: 'ready', port: apiPort });
    return apiPort;
  } catch (error) {
    if (apiProcess && !apiProcess.killed) {
      apiProcess.manualStop = true;
      apiProcess.kill();
    }
    throw error;
  }
}

async function ensureApiServerRunning() {
  if (apiProcess && !apiProcess.killed && apiPort) {
    // T2R-14 / R2-P1-11: two-level readiness window. The first check of a
    // freshly launched process (not yet observed ready, or just restarted)
    // uses the same generous window as startApi()'s initial wait, so a slow
    // start or an event loop busy with a long transaction / big import is not
    // mistaken for a dead process. Steady-state checks after the process has
    // been observed ready use a short window so a genuinely hung API is
    // restarted quickly.
    const firstCheck = !apiEverReady;
    const timeoutMs = apiReadinessWindowMs({ firstCheck });
    try {
      await waitForApi(apiPort, timeoutMs);
      apiEverReady = true;
      return apiPort;
    } catch (error) {
      // Preserve the scene instead of silently discarding it: keep the last
      // health-check error for restart-failure presentation, and log the
      // failure with uptime / port / restart count / window level before
      // deciding to kill.
      apiLastHealthError = error instanceof Error ? error : new Error(String(error));
      const uptimeMs = apiSpawnedAt ? Date.now() - apiSpawnedAt : 0;
      crashLog(
        'api-health-check-failed',
        new Error(
          `port=${apiPort} windowMs=${timeoutMs} firstCheck=${firstCheck} ` +
            `restartCount=${apiRestartCount} uptimeMs=${uptimeMs} error=${apiLastHealthError.message}`,
        ),
      );
      // fall through and restart an unhealthy API process
    }
  }
  if (apiProcess && !apiProcess.killed) {
    apiProcess.manualStop = true;
    apiProcess.kill();
  }
  apiProcess = null;
  // T2R-14: keep this reset. apiRestartCount is only incremented by the
  // 'exit' handler for non-manual exits (manualStop is set before every kill
  // here), so resetting it never affects the API_MAX_RESTARTS cap — it just
  // gives a health-check-restarted process a fresh crash budget, matching the
  // "recovered, start over" semantics of a manual restart.
  apiRestartCount = 0;
  return startApi();
}

async function stopApi() {
  if (_shutdownStarted) return;
  _shutdownStarted = true;
  _isQuitting = true;
  const processToStop = apiProcess;
  apiProcess = null;
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
  if (apiHeartbeatTimer) clearInterval(apiHeartbeatTimer);
  const timer = setInterval(() => {
    if (proc.killed || apiProcess !== proc) return;
    try {
      proc.send('ping');
    } catch {
      // IPC channel is gone; the child exits itself via its heartbeat timeout
    }
  }, API_HEARTBEAT_INTERVAL_MS);
  apiHeartbeatTimer = timer;
  proc.once('exit', () => {
    // Only clear the timer we own: a stale exit event from a previously
    // restarted process must not stop the heartbeat of the current child.
    if (apiHeartbeatTimer === timer) {
      clearInterval(timer);
      apiHeartbeatTimer = null;
    }
  });
}

// Synchronous, safe to call from app.on('will-quit') / process.on('exit').
// Graceful shutdown is handled by stopApi(); this is the final hard stop.
function terminateApiSync() {
  if (apiHeartbeatTimer) {
    clearInterval(apiHeartbeatTimer);
    apiHeartbeatTimer = null;
  }
  const proc = apiProcess;
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

function windowStatePath() {
  return path.join(app.getPath('userData'), 'window-state.json');
}

function loadWindowState() {
  try {
    const state = JSON.parse(fs.readFileSync(windowStatePath(), 'utf8'));
    if (Number.isFinite(state.width) && Number.isFinite(state.height)) {
      return {
        width: Math.max(900, state.width),
        height: Math.max(620, state.height),
        x: Number.isFinite(state.x) ? state.x : undefined,
        y: Number.isFinite(state.y) ? state.y : undefined,
        maximized: Boolean(state.maximized),
      };
    }
  } catch {
    // no saved window state yet
  }
  return DEFAULT_WINDOW_STATE;
}

function saveWindowState(win) {
  if (!win || win.isDestroyed()) return;
  const bounds = win.getNormalBounds();
  const state = {
    ...bounds,
    maximized: win.isMaximized(),
  };
  try {
    fs.mkdirSync(path.dirname(windowStatePath()), { recursive: true });
    fs.writeFileSync(windowStatePath(), JSON.stringify(state), 'utf8');
  } catch {
    // window persistence is best effort
  }
}

const ALLOWED_SECRET_KEYS = new Set(['v2.token', 'v2.refreshToken']);
// T2R-22: 渲染器经 HashRouter 导航后 URL 恒带 #/... 片段（dev 下还有 ?/ # 查询），
// 错误窗经 loadFile 带 ?msg= 查询串；这些都属于同文档导航，不引入新来源，
// 因此放行 [?#] 后缀并显式放行 error.html，否则受保护 IPC 全部被误拒。
const TRUSTED_RENDERER_PATTERN = /(^file:\/\/.*dist-web[\\/]index\.html(?:[?#].*)?$)|(^file:\/\/.*error\.html(?:[?#].*)?$)|(^http:\/\/localhost:5180\/?(?:[?#].*)?$)/;

function assertTrustedRenderer(event) {
  const url = event.senderFrame?.url ?? '';
  if (!TRUSTED_RENDERER_PATTERN.test(url)) throw new Error('Untrusted IPC sender');
}

function isAllowedNavigation(url) {
  try {
    const parsed = new URL(url);
    if (parsed.protocol === 'file:' && parsed.pathname.endsWith('/dist-web/index.html')) return true;
    if (parsed.protocol === 'blob:' && isDev) return true;
    if (parsed.protocol === 'http:' && parsed.hostname === '127.0.0.1' && parsed.port === String(apiPort)) return true;
    if (isDev && parsed.protocol === 'http:' && parsed.hostname === 'localhost') return true;
    if (parsed.protocol === 'https:' || parsed.protocol === 'http:') {
      setImmediate(() => shell.openExternal(url));
      return false;
    }
    return false;
  } catch {
    return false;
  }
}

function secureWindowPreferences() {
  return {
    preload: path.join(__dirname, 'preload.cjs'),
    contextIsolation: true,
    nodeIntegration: false,
    sandbox: true,
    webSecurity: true,
    allowRunningInsecureContent: false,
    navigateOnDragDrop: false,
  };
}

function createWindow() {
  const state = loadWindowState();
  const mainWindow = new BrowserWindow({
    width: state.width,
    height: state.height,
    ...(state.x !== undefined && state.y !== undefined ? { x: state.x, y: state.y } : {}),
    webPreferences: secureWindowPreferences(),
  });
  if (state.maximized) mainWindow.maximize();

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (isAllowedNavigation(url)) {
      return {
        action: 'allow',
        overrideBrowserWindowOptions: {
          webPreferences: secureWindowPreferences(),
        },
      };
    }
    return { action: 'deny' };
  });
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (!isAllowedNavigation(url)) event.preventDefault();
  });
  mainWindow.webContents.on('render-process-gone', (_event, details) => {
    crashLog('render-process-gone', new Error(`reason=${details.reason} exitCode=${details.exitCode}`));
  });
  mainWindow.webContents.on('did-fail-load', (_event, errorCode, errorDescription) => {
    if (errorCode !== -3) crashLog('did-fail-load', new Error(`${errorCode} ${errorDescription}`));
  });

  const url = isDev
    ? process.env.V2_WEB_URL || 'http://localhost:5180'
    : pathToFileURL(path.join(__dirname, '..', 'dist-web', 'index.html')).toString();
  mainWindow.loadURL(url);
  mainWindow.on('close', (event) => {
    saveWindowState(mainWindow);
    if (!_isQuitting && tray) {
      event.preventDefault();
      mainWindow.hide();
    }
  });
  mainWindow.on('closed', () => {
    saveWindowState(mainWindow);
  });
}

function showApiErrorWindow(message) {
  if (BrowserWindow.getAllWindows().length > 0) return;
  const win = new BrowserWindow({
    ...DEFAULT_WINDOW_STATE,
    webPreferences: secureWindowPreferences(),
  });
  win.loadFile(path.join(__dirname, 'error.html'), { query: { msg: String(message) } });
  // T2R-22 BUG#4 遗留修复（第三轮审计）：electron/error.js 首行 `const { desktop } = window;`
  // 与 contextBridge exposeInMainWorld('desktop', ...) 重复声明同名绑定，必然抛
  // "SyntaxError: Identifier 'desktop' has already been declared"，导致 msg 填充
  // 与重试/退出按钮绑定全部失效（项5 实测：错误窗只显示"正在加载错误信息…"，
  // 按钮无 onclick）。error.js 已删除，error.html 不再引用它；此处由主进程在
  // 页面加载完成后填充消息并绑定按钮，作为唯一实现（主窗 React 代码仅属性访问
  // window.desktop，不受 contextBridge 绑定影响）。
  win.webContents.once('did-finish-load', () => {
    const bootErrorJs = `(() => {
      const msgEl = document.getElementById('msg');
      if (msgEl) msgEl.textContent = ${JSON.stringify(String(message))};
      const retry = document.getElementById('retry');
      if (retry) {
        retry.onclick = async () => {
          const msg = document.getElementById('msg');
          try {
            await window.desktop.restartApi();
            if (msg) msg.textContent = '本地服务已恢复。请关闭本窗口，再通过系统托盘图标打开主窗口。';
          } catch (error) {
            if (msg) msg.textContent = '重试失败：' + (error && error.message ? error.message : String(error));
          }
        };
      }
      const quit = document.getElementById('quit');
      if (quit) quit.onclick = () => window.desktop.quit();
    })();`;
    win.webContents.executeJavaScript(bootErrorJs).catch(() => {});
  });
}

function trayImage() {
  const iconPath = path.join(__dirname, '..', 'build', 'icon.ico');
  try {
    if (fs.existsSync(iconPath)) {
      const image = nativeImage.createFromPath(iconPath);
      if (!image.isEmpty()) return image.resize({ width: 20, height: 20 });
    }
  } catch {
    // fall through to a built-in placeholder
  }
  return nativeImage.createFromDataURL(
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  );
}

function setupTray() {
  tray = new Tray(trayImage());
  tray.setToolTip('口腔诊所管理系统');
  const showAndFocusWindow = () => {
    const win = BrowserWindow.getAllWindows()[0];
    if (win) {
      if (win.isMinimized()) win.restore();
      win.show();
      win.focus();
    } else {
      createWindow();
    }
  };
  tray.setContextMenu(
    Menu.buildFromTemplate([
      {
        label: '显示主窗口',
        click: () => {
          ensureApiServerRunning()
            .then(showAndFocusWindow)
            .catch((error) => {
              crashLog('tray-show-api-error', error);
              notify('服务启动失败', error instanceof Error ? error.message : String(error));
            });
        },
      },
      { type: 'separator' },
      {
        label: '退出',
        click: () => app.quit(),
      },
    ]),
  );
  tray.on('click', () => {
    ensureApiServerRunning()
      .then(showAndFocusWindow)
      .catch((error) => {
        crashLog('tray-click-api-error', error);
        notify('服务启动失败', error instanceof Error ? error.message : String(error));
      });
  });
}

const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  app.quit();
}

app.on('second-instance', () => {
  void ensureApiServerRunning()
    .then(() => {
      const win = BrowserWindow.getAllWindows()[0];
      if (win) {
        if (win.isMinimized()) win.restore();
        win.show();
        win.focus();
      } else {
        createWindow();
      }
    })
    .catch((error) => {
      crashLog('second-instance-api-error', error);
      notify('服务启动失败', error instanceof Error ? error.message : String(error));
    });
});

// 内部构建版本号策略（审计中危项）：内部版（scripts/build-internal-installer.ps1
// 打包，版本形如 2.2.0-internal.<UTC时间戳>）必须允许 prerelease，electron-updater
// 才会把内部 feed 的新构建视为可更新；公开版保持 allowPrerelease=false，只收正式版。
const isInternalBuild = /-internal\./.test(app.getVersion());
autoUpdater.autoDownload = true;
autoUpdater.allowPrerelease = isInternalBuild;
// T2R-22: 不要给 verifyUpdateCodeSignature 赋布尔值！NsisUpdater 把它实现为
// getter/setter（包装 windowsExecutableCodeSignatureVerifier.verifySignature），
// 赋 true 会把 _verifyUpdateCodeSignature 覆盖成布尔，下载后签名校验必然抛
// "this._verifyUpdateCodeSignature is not a function"（场景 B 实测）。
// 默认实现即启用签名校验，无需任何赋值。
autoUpdater.on('checking-for-update', () => sendUpdateEvent({ type: 'checking' }));
autoUpdater.on('update-available', (info) => sendUpdateEvent({ type: 'available', version: info?.version }));
autoUpdater.on('update-not-available', () => sendUpdateEvent({ type: 'none' }));
autoUpdater.on('download-progress', (progress) => {
  sendUpdateEvent({
    type: 'progress',
    percent: Math.round(Number(progress?.percent ?? 0)),
    transferred: Number(progress?.transferred ?? 0),
    total: Number(progress?.total ?? 0),
  });
});
autoUpdater.on('update-downloaded', (info) => {
  sendUpdateEvent({ type: 'downloaded', version: info?.version });
  notify('更新已就绪', `版本 ${info?.version ?? ''} 已下载，可重启安装。`);
});
autoUpdater.on('error', (error) => {
  sendUpdateEvent({ type: 'error', message: error instanceof Error ? error.message : String(error) });
});

app.whenReady().then(async () => {
  if (!gotSingleInstanceLock) return;

  if (process.env.V2_CRASH_REPORT_URL) {
    nativeCrashReporter.start({
      productName: 'Dental Clinic V2',
      companyName: 'Dental Clinic V2',
      submitURL: process.env.V2_CRASH_REPORT_URL,
      uploadToServer: true,
      compress: true,
    });
  } else {
    nativeCrashReporter.start({
      productName: 'Dental Clinic V2',
      companyName: 'Dental Clinic V2',
      uploadToServer: false,
      compress: true,
    });
  }

  session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    // 审计 L3：CSP 端口收紧。API 端口运行时随机（startApi 后 apiPort 已确定），
    // 只放行精确的 http://127.0.0.1:<apiPort>，不再使用 http://127.0.0.1:* 通配；
    // WebSocket 仅 dev 下放行 vite HMR 的 ws://localhost:<devPort>。
    const apiOrigin = apiPort ? `http://127.0.0.1:${apiPort}` : '';
    const devWs = isDev ? ` ws://localhost:${new URL(process.env.V2_WEB_URL || 'http://localhost:5180').port}` : '';
    const csp = `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:${apiOrigin ? ` ${apiOrigin}` : ''}; connect-src 'self'${apiOrigin ? ` ${apiOrigin}` : ''}${devWs}; font-src 'self' data:; media-src 'self' blob: data:; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self';`;
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'X-Content-Type-Options': ['nosniff'],
        'X-Frame-Options': ['DENY'],
        'Content-Security-Policy': [csp],
      },
    });
  });
  app.on('web-contents-created', (_event, contents) => {
    contents.on('will-attach-webview', (event) => event.preventDefault());
  });

  ipcMain.handle('desktop:secret:get', (_event, key) => {
    assertTrustedRenderer(_event);
    if (!ALLOWED_SECRET_KEYS.has(String(key))) return null;
    if (!safeStorage.isEncryptionAvailable()) return null;
    try {
      return safeStorage.decryptString(fs.readFileSync(secretPath(key)));
    } catch {
      return null;
    }
  });
  ipcMain.handle('desktop:secret:set', (_event, key, value) => {
    assertTrustedRenderer(_event);
    if (!ALLOWED_SECRET_KEYS.has(String(key))) return false;
    if (!safeStorage.isEncryptionAvailable()) return false;
    try {
      fs.mkdirSync(path.dirname(secretPath(key)), { recursive: true });
      fs.writeFileSync(secretPath(key), safeStorage.encryptString(String(value)), { mode: 0o600 });
      return true;
    } catch {
      return false;
    }
  });
  ipcMain.handle('desktop:secret:delete', (_event, key) => {
    assertTrustedRenderer(_event);
    if (!ALLOWED_SECRET_KEYS.has(String(key))) return false;
    try {
      fs.rmSync(secretPath(key), { force: true });
      return true;
    } catch {
      return false;
    }
  });
  ipcMain.handle('desktop:version', () => app.getVersion());
  ipcMain.handle('desktop:quit', () => app.quit());
  ipcMain.handle('desktop:api-port', () => apiPort);
  ipcMain.handle('desktop:restart-api', async (_event) => {
    assertTrustedRenderer(_event);
    apiRestartCount = 0;
    _shutdownStarted = false;
    _isQuitting = false;
    await stopApi();
    _shutdownStarted = false;
    _isQuitting = false;
    await new Promise((resolve) => setTimeout(resolve, 150));
    return startApi();
  });
  ipcMain.handle('desktop:set-auto-launch', (_event, enabled) => {
    assertTrustedRenderer(_event);
    app.setLoginItemSettings({ openAtLogin: Boolean(enabled) });
    return true;
  });
  ipcMain.handle('desktop:get-auto-launch', () => app.getLoginItemSettings().openAtLogin);
  ipcMain.handle('desktop:check-updates', async (_event) => {
    assertTrustedRenderer(_event);
    if (isDev) return { status: 'disabled' };
    try {
      const result = await autoUpdater.checkForUpdates();
      return { status: result?.updateInfo ? 'available' : 'none', version: result?.updateInfo?.version };
    } catch (error) {
      return { status: 'error', message: error instanceof Error ? error.message : String(error) };
    }
  });
  ipcMain.handle('desktop:install-update', (_event) => {
    assertTrustedRenderer(_event);
    autoUpdater.quitAndInstall(false, true);
    return true;
  });

  setupTray();
  try {
    await startApi();
  } catch (error) {
    crashLog('api-initial-start-failed', error);
    showApiErrorWindow(error instanceof Error ? error.message : String(error));
    return;
  }
  createWindow();
  if (!isDev && process.env.V2_DISABLE_AUTO_UPDATE !== '1') {
    autoUpdater.checkForUpdates().catch((error) => {
      sendUpdateEvent({ type: 'error', message: error instanceof Error ? error.message : String(error) });
    });
  }
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      void ensureApiServerRunning()
        .then(() => createWindow())
        .catch((error) => {
          crashLog('activate-api-error', error);
          notify('服务启动失败', error instanceof Error ? error.message : String(error));
        });
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin' && !tray) app.quit();
});

app.on('before-quit', (event) => {
  if (_isQuitting) return;
  event.preventDefault();
  _isQuitting = true;
  void (async () => {
    try {
      await Promise.race([
        stopApi(),
        new Promise((resolve) => setTimeout(resolve, 3000)),
      ]);
    } catch (error) {
      crashLog('before-quit-stopApi-error', error);
    } finally {
      app.quit();
    }
  })();
});

process.on('SIGTERM', () => {
  if (_shutdownStarted) return;
  void (async () => {
    try {
      await Promise.race([
        stopApi(),
        new Promise((resolve) => setTimeout(resolve, 3000)),
      ]);
    } catch (error) {
      crashLog('sigterm-stopApi-error', error);
    } finally {
      app.quit();
    }
  })();
});

process.on('SIGINT', () => {
  if (_shutdownStarted) return;
  void (async () => {
    try {
      await Promise.race([
        stopApi(),
        new Promise((resolve) => setTimeout(resolve, 3000)),
      ]);
    } catch (error) {
      crashLog('sigint-stopApi-error', error);
    } finally {
      app.quit();
    }
  })();
});

// T2R-13 / R2-P1-09: final hard-stop fallbacks for every graceful exit path
// (before-quit / SIGTERM / SIGINT / autoUpdater.quitAndInstall). The API child
// itself must never outlive the main process; a hard-killed main process is
// covered by the child-side heartbeat instead.
app.on('will-quit', () => {
  terminateApiSync();
});

process.on('exit', () => {
  terminateApiSync();
});
