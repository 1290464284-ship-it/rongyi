const {
  app,
  BrowserWindow,
  clipboard,
  ipcMain,
  Menu,
  safeStorage,
  session,
  crashReporter: nativeCrashReporter,
} = require('electron');
const { autoUpdater } = require('electron-updater');
const fs = require('node:fs');
const path = require('node:path');

const state = require('./state.cjs');
const { isDev, WEB_DEV_ORIGIN, ALLOWED_SECRET_KEYS } = require('./constants.cjs');
const { crashLog, notify, sendUpdateEvent } = require('./logging.cjs');
const { secretPath } = require('./secrets.cjs');
const { ensureInternalCertTrusted } = require('./cert-trust.cjs');
const {
  startApi,
  stopApi,
  ensureApiServerRunning,
  terminateApiSync,
} = require('./api-process.cjs');
const {
  createWindow,
  showApiErrorWindow,
  assertTrustedRenderer,
} = require('./window.cjs');
const { setupTray } = require('./tray.cjs');

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

const isInternalBuild = /-internal\./.test(app.getVersion());
autoUpdater.autoDownload = false;
autoUpdater.autoInstallOnAppQuit = false;
autoUpdater.allowPrerelease = isInternalBuild;
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

  // 仅 internal 构建自动信任自签名证书；公开构建不修改系统证书存储，
  // V2_DISABLE_CERT_TRUST=1 可在受控环境显式关闭。
  if (isInternalBuild) {
    try {
      const trustResult = ensureInternalCertTrusted();
      if (trustResult.ok) {
        console.log('[cert-trust] internal signing certificate is trusted');
      }
    } catch (error) {
      crashLog('internal-cert-trust-failed', error);
    }
  }

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

  session.defaultSession.setPermissionRequestHandler((_webContents, permission, callback) => {
    callback(permission === 'clipboard-sanitized-write' || permission === 'clipboard-read');
  });
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    {
      label: '编辑',
      submenu: [
        { role: 'undo', label: '撤销' },
        { role: 'redo', label: '重做' },
        { type: 'separator' },
        { role: 'cut', label: '剪切' },
        { role: 'copy', label: '复制' },
        { role: 'paste', label: '粘贴' },
        { role: 'selectAll', label: '全选' },
      ],
    },
  ]));
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    const apiOrigin = state.apiPort ? `http://127.0.0.1:${state.apiPort}` : '';
    const devWs = isDev ? ` ws://localhost:${new URL(WEB_DEV_ORIGIN).port}` : '';
    // Vite dev 的 react-refresh 会注入内联模块脚本；生产构建没有内联脚本，
    // 保持严格 script-src 'self'，避免 XSS 加载远程脚本。
    const scriptSrc = isDev ? `script-src 'self' 'unsafe-inline'` : `script-src 'self'`;
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'X-Content-Type-Options': ['nosniff'],
        'X-Frame-Options': ['DENY'],
        'Content-Security-Policy': [
          `default-src 'self'; ${scriptSrc}; style-src 'self' 'unsafe-inline'; ` +
          `img-src 'self' data: blob:; font-src 'self' data:; object-src 'none'; base-uri 'none'; ` +
          `form-action 'self'; frame-ancestors 'none'; ` +
          `connect-src 'self'${apiOrigin ? ` ${apiOrigin}` : ''}${devWs};`,
        ],
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
  ipcMain.handle('desktop:version', (_event) => {
    assertTrustedRenderer(_event);
    return app.getVersion();
  });
  ipcMain.handle('desktop:clipboard:write', (_event, text) => {
    assertTrustedRenderer(_event);
    clipboard.writeText(String(text ?? ''));
    return true;
  });
  ipcMain.handle('desktop:quit', (_event) => {
    assertTrustedRenderer(_event);
    app.quit();
  });
  ipcMain.handle('desktop:api-port', (_event) => {
    assertTrustedRenderer(_event);
    return state.apiPort;
  });
  ipcMain.handle('desktop:restart-api', async (_event) => {
    assertTrustedRenderer(_event);
    state.apiRestartCount = 0;
    state.shutdownStarted = false;
    state.isQuitting = false;
    await stopApi();
    state.shutdownStarted = false;
    state.isQuitting = false;
    await new Promise((resolve) => setTimeout(resolve, 150));
    return startApi();
  });
  ipcMain.handle('desktop:set-auto-launch', (_event, enabled) => {
    assertTrustedRenderer(_event);
    app.setLoginItemSettings({ openAtLogin: Boolean(enabled) });
    return true;
  });
  ipcMain.handle('desktop:get-auto-launch', (_event) => {
    assertTrustedRenderer(_event);
    return app.getLoginItemSettings().openAtLogin;
  });
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
  ipcMain.handle('desktop:download-update', async (_event) => {
    assertTrustedRenderer(_event);
    if (isDev) return { status: 'disabled' };
    try {
      await autoUpdater.downloadUpdate();
      return { status: 'done' };
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
  if (process.platform !== 'darwin' && !state.tray) app.quit();
});

app.on('before-quit', (event) => {
  if (state.isQuitting) return;
  event.preventDefault();
  state.isQuitting = true;
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
  if (state.shutdownStarted) return;
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
  if (state.shutdownStarted) return;
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

app.on('will-quit', () => {
  terminateApiSync();
});

process.on('exit', () => {
  terminateApiSync();
});
