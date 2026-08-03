const { app, BrowserWindow, Tray, Menu, nativeImage, ipcMain } = require('electron');
const { autoUpdater } = require('electron-updater');
const { spawn } = require('node:child_process');
const crypto = require('node:crypto');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const isDev = !app.isPackaged;
let apiProcess = null;
let apiPort = null;
let quitting = false;
let tray = null;

function crashLog(message, error) {
  const entry = {
    timestamp: new Date().toISOString(),
    message,
    stack: error?.stack ?? String(error),
  };
  try {
    const logDir = path.join(app.getPath('userData'), 'logs');
    fs.mkdirSync(logDir, { recursive: true });
    fs.appendFileSync(path.join(logDir, 'desktop.log'), JSON.stringify(entry) + '\n');
  } catch {
    // best effort
  }
  const endpoint = process.env.V2_CRASH_REPORT_URL;
  if (endpoint) {
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

function getOrCreateSecret(fileName = 'jwt-secret') {
  const secretsDir = path.join(app.getPath('userData'), 'secrets');
  const secretPath = path.join(secretsDir, fileName);
  fs.mkdirSync(secretsDir, { recursive: true });
  try {
    const existing = fs.readFileSync(secretPath, 'utf8').trim();
    if (existing.length >= 32) return existing;
  } catch {
    // first run or unreadable secret; create a fresh one below
  }
  const secret = crypto.randomBytes(48).toString('hex');
  fs.writeFileSync(secretPath, secret, { mode: 0o600 });
  return secret;
}

process.on('uncaughtException', (error) => crashLog('uncaughtException', error));
process.on('unhandledRejection', (reason) => crashLog('unhandledRejection', reason));

function randomPort() {
  return 30000 + Math.floor(Math.random() * 20000);
}

function waitForApi(port, timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    const startedAt = Date.now();
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
    const retry = () => {
      if (Date.now() - startedAt > timeoutMs) {
        reject(new Error('API did not become ready'));
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
  const legacyBase = isDev
    ? path.join(__dirname, '..', 'legacy')
    : path.join(process.resourcesPath, 'legacy');
  apiProcess = spawn(process.execPath, [apiScript()], {
    env: {
      ...process.env,
      V2_PORT: String(apiPort),
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
    stdio: 'ignore',
    windowsHide: true,
  });
  apiProcess.on('exit', () => {
    apiProcess = null;
    if (!quitting) {
      setTimeout(() => {
        startApi().catch((error) => console.error('[desktop] API restart failed', error));
      }, 1000);
    }
  });
  await waitForApi(apiPort);
  return apiPort;
}

async function ensureApiServerRunning() {
  if (apiProcess && !apiProcess.killed && apiPort) {
    try {
      return await waitForApi(apiPort, 1500);
    } catch {
      // fall through and restart an unhealthy API process
    }
  }
  if (apiProcess && !apiProcess.killed) apiProcess.kill();
  apiProcess = null;
  return startApi();
}

function stopApi() {
  quitting = true;
  if (apiProcess && !apiProcess.killed) {
    apiProcess.kill();
  }
  apiProcess = null;
}

function createWindow() {
  const mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  const url = isDev
    ? process.env.V2_WEB_URL || 'http://localhost:5180'
    : pathToFileURL(path.join(__dirname, '..', 'dist-web', 'index.html')).toString();
  mainWindow.loadURL(url);
  mainWindow.on('close', (event) => {
    if (!quitting && tray) {
      event.preventDefault();
      mainWindow.hide();
    }
  });
}

function setupTray() {
  const icon = nativeImage.createFromDataURL(
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  );
  tray = new Tray(icon);
  tray.setToolTip('Dental Clinic V2');
  tray.setContextMenu(
    Menu.buildFromTemplate([
      {
        label: '\u663e\u793a\u4e3b\u7a97\u53e3',
        click: async () => {
          await ensureApiServerRunning();
          const win = BrowserWindow.getAllWindows()[0];
          if (win) {
            win.show();
            win.focus();
          } else {
            createWindow();
          }
        },
      },
      { type: 'separator' },
      {
        label: '\u9000\u51fa',
        click: () => app.quit(),
      },
    ]),
  );
}

const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  app.quit();
}

app.on('second-instance', () => {
  void ensureApiServerRunning().then(() => {
    const win = BrowserWindow.getAllWindows()[0];
    if (win) {
      if (win.isMinimized()) win.restore();
      win.show();
      win.focus();
    } else {
      createWindow();
    }
  });
});

app.whenReady().then(async () => {
  if (!gotSingleInstanceLock) return;
  setupTray();
  await startApi();
  createWindow();
  if (!isDev && process.env.V2_ENABLE_AUTO_UPDATE === '1') {
    autoUpdater.checkForUpdatesAndNotify().catch((error) => console.error('[desktop] update check failed', error));
  }
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      void ensureApiServerRunning().then(() => createWindow());
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin' && !tray) app.quit();
});

app.on('before-quit', () => {
  quitting = true;
  stopApi();
});

ipcMain.handle('desktop:version', () => app.getVersion());
ipcMain.handle('desktop:api-port', () => apiPort);
ipcMain.handle('desktop:restart-api', async () => {
  stopApi();
  quitting = false;
  return startApi();
});
ipcMain.handle('desktop:set-auto-launch', (_event, enabled) => {
  app.setLoginItemSettings({ openAtLogin: Boolean(enabled) });
  return true;
});
ipcMain.handle('desktop:get-auto-launch', () => app.getLoginItemSettings().openAtLogin);
ipcMain.handle('desktop:check-updates', async () => {
  if (isDev) return { status: 'disabled' };
  try {
    const result = await autoUpdater.checkForUpdates();
    return { status: result?.updateInfo ? 'available' : 'none', version: result?.updateInfo?.version };
  } catch (error) {
    return { status: 'error', message: error instanceof Error ? error.message : String(error) };
  }
});
