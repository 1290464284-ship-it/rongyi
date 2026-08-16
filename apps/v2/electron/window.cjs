const { app, BrowserWindow, screen, shell } = require('electron');
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
  RUNTIME_INDEX_HTML_FILE_URL,
  DEV_WEB_URL_PATTERN,
} = require('./constants.cjs');
const { crashLog, notify } = require('./logging.cjs');

function windowStatePath() {
  return path.join(app.getPath('userData'), 'window-state.json');
}

function loadWindowState() {
  try {
    const state = JSON.parse(fs.readFileSync(windowStatePath(), 'utf8'));
    if (Number.isFinite(state.width) && Number.isFinite(state.height)) {
      const displays = screen.getAllDisplays();
      const bounds = displays.length
        ? displays.reduce((acc, display) => {
            const area = display.workArea;
            return {
              minX: Math.min(acc.minX, area.x),
              minY: Math.min(acc.minY, area.y),
              maxX: Math.max(acc.maxX, area.x + area.width),
              maxY: Math.max(acc.maxY, area.y + area.height),
            };
          }, { minX: 0, minY: 0, maxX: 0, maxY: 0 })
        : { minX: 0, minY: 0, maxX: 9999, maxY: 9999 };
      const width = Math.min(Math.max(900, state.width), Math.max(900, bounds.maxX - bounds.minX));
      const height = Math.min(Math.max(620, state.height), Math.max(620, bounds.maxY - bounds.minY));
      const x = Number.isFinite(state.x) ? Math.min(Math.max(state.x, bounds.minX), bounds.maxX - width) : undefined;
      const y = Number.isFinite(state.y) ? Math.min(Math.max(state.y, bounds.minY), bounds.maxY - height) : undefined;
      return {
        width,
        height,
        x,
        y,
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
  // IPC 信任边界与导航白名单同口径：精确 URL 或仅允许 #/ ? 片段后缀，
  // 避免 index.html.evil、index.html/.. 等同前缀文件被当作可信发送方。
  const trustedFileUrl = (candidate, base) => (
    candidate === base || candidate.startsWith(`${base}#`) || candidate.startsWith(`${base}?`)
  );
  if (
    trustedFileUrl(url, INDEX_HTML_FILE_URL)
    || trustedFileUrl(url, ERROR_HTML_FILE_URL)
    || trustedFileUrl(url, RUNTIME_INDEX_HTML_FILE_URL)
  ) return true;
  return DEV_WEB_URL_PATTERN.test(url);
}

function assertTrustedRenderer(event) {
  const url = event.senderFrame?.url ?? '';
  if (!isTrustedRendererUrl(url)) throw new Error('Untrusted IPC sender');
}

function isAllowedNavigation(url) {
  try {
    const parsed = new URL(url);
    if (url === INDEX_HTML_FILE_URL || url.startsWith(`${INDEX_HTML_FILE_URL}#`)) return true;
    if (url === RUNTIME_INDEX_HTML_FILE_URL || url.startsWith(`${RUNTIME_INDEX_HTML_FILE_URL}#`)) return true;
    if (url === 'about:blank') return true;
    // blob: 仅可由渲染器自身创建（打印报表场景），且新窗口沿用沙箱/隔离 prefs。
    if (parsed.protocol === 'blob:') return true;
    if (parsed.protocol === 'http:' && parsed.hostname === '127.0.0.1' && parsed.port === String(state.apiPort)) return true;
    if (isDev && url === WEB_DEV_ORIGIN) return true;
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

/**
 * 生产打包版运行时 HTML 准备：asar 内的 dist-web 只读，无法写入动态 API 端口，
 * 而 meta CSP 的 connect-src 通配（http://127.0.0.1:*）会让被攻破的渲染层可
 * 探测本机任意回环服务。这里把 dist-web 复制到 userData/cache 并把通配替换为
 * 当前 API 精确端口；复制失败时回退加载 asar 原文件（降级为通配 CSP）。
 */
function prepareRuntimeHtml() {
  if (isDev) return null;
  try {
    const src = path.join(__dirname, '..', 'dist-web');
    const dst = path.join(app.getPath('userData'), 'cache', 'dist-web');
    const portMarker = path.join(dst, '.api-port');
    const port = String(state.apiPort ?? '');
    // 端口未变时复用上次产物，避免每次开窗全量拷贝
    if (port && fs.existsSync(portMarker) && fs.readFileSync(portMarker, 'utf8') === port) {
      return path.join(dst, 'index.html');
    }
    fs.rmSync(dst, { recursive: true, force: true });
    fs.mkdirSync(dst, { recursive: true });
    for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
      const from = path.join(src, entry.name);
      const to = path.join(dst, entry.name);
      if (entry.isDirectory()) fs.cpSync(from, to, { recursive: true });
      else fs.copyFileSync(from, to);
    }
    const indexPath = path.join(dst, 'index.html');
    const html = fs
      .readFileSync(indexPath, 'utf8')
      .replaceAll('http://127.0.0.1:*', `http://127.0.0.1:${port}`);
    fs.writeFileSync(indexPath, html, 'utf8');
    fs.writeFileSync(portMarker, port, 'utf8');
    return indexPath;
  } catch (error) {
    crashLog('runtime-html-prepare-failed', error);
    return null;
  }
}

function createWindow() {
  const windowState = loadWindowState();
  const mainWindow = new BrowserWindow({
    width: windowState.width,
    height: windowState.height,
    ...(windowState.x !== undefined && windowState.y !== undefined ? { x: windowState.x, y: windowState.y } : {}),
    webPreferences: secureWindowPreferences(),
  });
  if (windowState.maximized) mainWindow.maximize();

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
  const RENDERER_CRASH_WINDOW_MS = 10 * 60 * 1000;
  const RENDERER_CRASH_MAX = 3;
  let rendererCrashCount = 0;
  let rendererCrashWindowStart = 0;
  mainWindow.webContents.on('render-process-gone', (_event, details) => {
    crashLog('render-process-gone', new Error(`reason=${details.reason} exitCode=${details.exitCode}`));
    if (state.isQuitting) return;
    const now = Date.now();
    if (now - rendererCrashWindowStart > RENDERER_CRASH_WINDOW_MS) {
      rendererCrashCount = 0;
      rendererCrashWindowStart = now;
    }
    rendererCrashCount += 1;
    if (rendererCrashCount > RENDERER_CRASH_MAX) {
      notify('界面多次崩溃', '已停止自动恢复，请通过托盘菜单退出后重启应用。');
      return;
    }
    if (mainWindow.isDestroyed()) return;
    // 被系统/用户强杀（任务管理器）稍作延迟，其余原因立即恢复
    const delay = details.reason === 'killed' ? 500 : 0;
    setTimeout(() => {
      if (!mainWindow.isDestroyed() && !state.isQuitting) mainWindow.reload();
    }, delay);
  });
  mainWindow.webContents.on('did-fail-load', (_event, errorCode, errorDescription) => {
    if (errorCode !== -3) crashLog('did-fail-load', new Error(`${errorCode} ${errorDescription}`));
  });

  const runtimeHtml = prepareRuntimeHtml();
  const url = isDev
    ? WEB_DEV_ORIGIN
    : (runtimeHtml ? pathToFileURL(runtimeHtml).toString() : INDEX_HTML_FILE_URL);
  mainWindow.loadURL(url);
  mainWindow.on('close', (event) => {
    if (!state.isQuitting && state.tray) {
      // 仅“关窗进托盘”路径在此保存；正常退出由 closed 统一保存，避免重复写盘。
      saveWindowState(mainWindow);
      event.preventDefault();
      mainWindow.hide();
    }
  });
  // destroy() 直接销毁的窗口不触发 close，closed 是唯一兜底（saveWindowState
  // 内部对已销毁窗口 no-op，不会二次写入）。
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
  isAllowedNavigation,
  isTrustedRendererUrl,
  showApiErrorWindow,
};
