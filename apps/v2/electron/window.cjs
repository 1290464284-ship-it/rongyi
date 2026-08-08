const { app, BrowserWindow, shell } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const state = require('./state.cjs');
const {
  isDev,
  WEB_DEV_ORIGIN,
  DEFAULT_WINDOW_STATE,
  INDEX_HTML_FILE_URL,
  ERROR_HTML_FILE_URL,
  DEV_WEB_URL_PATTERN,
} = require('./constants.cjs');
const { crashLog } = require('./logging.cjs');

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

function isTrustedRendererUrl(url) {
  if (url.startsWith(INDEX_HTML_FILE_URL) || url.startsWith(ERROR_HTML_FILE_URL)) return true;
  return DEV_WEB_URL_PATTERN.test(url);
}

function assertTrustedRenderer(event) {
  const url = event.senderFrame?.url ?? '';
  if (!isTrustedRendererUrl(url)) throw new Error('Untrusted IPC sender');
}

function isAllowedNavigation(url) {
  try {
    const parsed = new URL(url);
    if (parsed.protocol === 'file:' && parsed.pathname.endsWith('/dist-web/index.html')) return true;
    if (parsed.protocol === 'blob:' && isDev) return true;
    if (parsed.protocol === 'http:' && parsed.hostname === '127.0.0.1' && parsed.port === String(state.apiPort)) return true;
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
    ? WEB_DEV_ORIGIN
    : pathToFileURL(path.join(__dirname, '..', 'dist-web', 'index.html')).toString();
  mainWindow.loadURL(url);
  mainWindow.on('close', (event) => {
    saveWindowState(mainWindow);
    if (!state.isQuitting && state.tray) {
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
    // ALLOWED-SCAN: error window payload is JSON.stringify-escaped before injection.
    win.webContents.executeJavaScript(bootErrorJs).catch(() => {});
  });
}


module.exports = {
  assertTrustedRenderer,
  createWindow,
  showApiErrorWindow,
};
