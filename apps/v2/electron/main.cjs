const {
  app,
  BrowserWindow,
  clipboard,
  ipcMain,
  Menu,
  powerMonitor,
  safeStorage,
  session,
  crashReporter: nativeCrashReporter,
} = require('electron');
const { autoUpdater } = require('electron-updater');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const state = require('./state.cjs');
const { isDev, WEB_DEV_ORIGIN, ALLOWED_SECRET_KEYS, isAllowedCrashReportUrl } = require('./constants.cjs');
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
  isAllowedNavigation,
  isTrustedRendererUrl,
} = require('./window.cjs');
const { setupTray } = require('./tray.cjs');
const { startTelemetry, stopTelemetry } = require('./telemetry.cjs');

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
// 无人值守模式（A-P1.1）：发现新版自动下载、退出时自动安装，下次启动即
// 新版；V2_DISABLE_AUTO_UPDATE=1 可整体关闭（scheduleUpdateChecks 不注册）。
// 手动 IPC（desktop:download-update / desktop:install-update）保留为
// 即时重试/立即安装入口。
autoUpdater.autoDownload = true;
autoUpdater.autoInstallOnAppQuit = true;
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

// 原生级看门狗：以 ELECTRON_RUN_AS_NODE 拉起 sidecar，主进程硬崩溃/taskkill 时
// 由它重新拉起应用（V2_ENABLE_WATCHDOG=0 可关，dev 不启用）。JS 级崩溃由
// logging.cjs 的 handleFatalCrash → watchdog.cjs 处理；两者互补。
function spawnSupervisor() {
  if (isDev || process.env.V2_ENABLE_WATCHDOG === '0') return;
  try {
    const supervisorPath = path.join(__dirname, 'supervisor.cjs');
    const stopMarker = path.join(app.getPath('userData'), '.supervisor-stop');
    const child = spawn(
      process.execPath,
      [supervisorPath, process.execPath, String(process.pid), stopMarker],
      {
        detached: true,
        stdio: 'ignore',
        windowsHide: true,
        env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
      },
    );
    child.unref();
  } catch (error) {
    crashLog('supervisor-spawn-failed', error);
  }
}

// 更新检查：启动即查 + 每 24h 周期复查；失败按指数退避持续重试
// （1min/5min/30min/1h/4h/12h 封顶），无人值守下连续失败 ≥24h 才
// notify + 渲染层报错（此前 3 次失败即报错，无人维护场景下过于频繁）；
// 任一成功即重置计数。
const UPDATE_RETRY_DELAYS_MS = [60_000, 300_000, 1_800_000, 3_600_000, 14_400_000, 43_200_000];
const UPDATE_FAILURE_NOTIFY_MS = 24 * 60 * 60 * 1000;
const UPDATE_RECHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;
let updateCheckAttempts = 0;
let updateFirstFailureAt = 0;
let updateRecheckTimer = null;

function scheduleUpdateChecks() {
  const attemptCheck = () => {
    autoUpdater.checkForUpdates()
      .then(() => {
        updateCheckAttempts = 0;
        updateFirstFailureAt = 0;
      })
      .catch((error) => {
        const now = Date.now();
        if (updateCheckAttempts === 0) updateFirstFailureAt = now;
        updateCheckAttempts += 1;
        if (now - updateFirstFailureAt >= UPDATE_FAILURE_NOTIFY_MS) {
          updateCheckAttempts = 0;
          updateFirstFailureAt = 0;
          notify(
            '更新检查持续失败',
            `自动更新已连续失败超过 24 小时，请检查网络连接。${error instanceof Error ? error.message : String(error)}`,
          );
          sendUpdateEvent({
            type: 'error',
            message: `更新检查连续失败超过 24h：${error instanceof Error ? error.message : String(error)}`,
          });
          return;
        }
        const delay = UPDATE_RETRY_DELAYS_MS[Math.min(updateCheckAttempts - 1, UPDATE_RETRY_DELAYS_MS.length - 1)];
        setTimeout(attemptCheck, delay);
      });
  };
  attemptCheck();
  updateRecheckTimer = setInterval(() => {
    void attemptCheck();
  }, UPDATE_RECHECK_INTERVAL_MS);
  updateRecheckTimer.unref?.();
}

// 清理 electron-updater 遗留的旧更新包（下载中断/替换后残留的 *.old 文件），
// 防止长期运行下 %LOCALAPPDATA%\<app>-updater 无限增长。
function cleanupUpdaterCache() {
  try {
    const localAppData = process.env.LOCALAPPDATA;
    if (!localAppData || !app.getName()) return;
    const pendingDir = path.join(localAppData, `${app.getName()}-updater`, 'pending');
    if (!fs.existsSync(pendingDir)) return;
    for (const entry of fs.readdirSync(pendingDir)) {
      if (!entry.endsWith('.old')) continue;
      try {
        fs.rmSync(path.join(pendingDir, entry), { recursive: true, force: true });
      } catch {
        // best effort：单个文件清理失败不阻塞启动
      }
    }
  } catch {
    // best effort
  }
}

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

  const crashReportUrl = process.env.V2_CRASH_REPORT_URL;
  const crashReportUploads = crashReportUrl ? isAllowedCrashReportUrl(crashReportUrl) : false;
  if (crashReportUrl && !crashReportUploads) {
    console.warn('V2_CRASH_REPORT_URL must be HTTPS and match V2_ALLOWED_CRASH_REPORT_HOSTS; crash report upload disabled');
  }
  if (crashReportUploads) {
    nativeCrashReporter.start({
      productName: 'Dental Clinic V2',
      companyName: 'Dental Clinic V2',
      submitURL: crashReportUrl,
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

  session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => {
    if (!isTrustedRendererUrl(webContents.getURL())) {
      callback(false);
      return;
    }
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
          `img-src 'self' data: blob:${apiOrigin ? ` ${apiOrigin}` : ''}; font-src 'self' data:; object-src 'none'; base-uri 'none'; ` +
          `form-action 'self'; frame-ancestors 'none'; ` +
          `connect-src 'self'${apiOrigin ? ` ${apiOrigin}` : ''}${devWs};`,
        ],
      },
    });
  });
  app.on('web-contents-created', (_event, contents) => {
    contents.on('will-attach-webview', (event) => event.preventDefault());
    contents.on('will-navigate', (event, url) => {
      if (!isAllowedNavigation(url)) event.preventDefault();
    });
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
  spawnSupervisor();
  // A-P1.2：首次运行默认开启开机自启（无人值守部署）；V2_DISABLE_AUTO_LAUNCH=1
  // 或 dev 模式不自动开启；标记文件落盘后不再重复写，用户此后可在设置页
  // 自由开关（desktop:set-auto-launch）。
  const autoLaunchInitMarker = path.join(app.getPath('userData'), '.auto-launch-initialized');
  if (!isDev && process.env.V2_DISABLE_AUTO_LAUNCH !== '1' && !fs.existsSync(autoLaunchInitMarker)) {
    try {
      app.setLoginItemSettings({ openAtLogin: true });
      fs.writeFileSync(autoLaunchInitMarker, new Date().toISOString());
    } catch (error) {
      crashLog('auto-launch-init-failed', error);
    }
  }
  createWindow();
  // opt-in 遥测：未配置 V2_TELEMETRY_URL（白名单 HTTPS）时是 no-op
  startTelemetry();
  if (!isDev && process.env.V2_DISABLE_AUTO_UPDATE !== '1') {
    scheduleUpdateChecks();
  }
  cleanupUpdaterCache();
  powerMonitor.on('resume', () => {
    // 系统休眠唤醒：通知 API 子进程做即时维护 + 强制健康检查。
    // Windows 休眠可能使 better-sqlite3 句柄失效，健康检查失败会走
    // 「杀进程 → 重启」恢复路径，重启后自动执行启动完整性检查。
    try {
      state.apiProcess?.send?.('resume');
    } catch {
      // best effort：子进程侧消息丢失时下面的健康检查仍会兜底
    }
    void ensureApiServerRunning()
      .then(() => console.log('[power-resume] api healthy after resume'))
      .catch((error) => {
        crashLog('power-resume-api-error', error);
        notify('系统唤醒后服务异常', '本地服务已自动重启，若页面异常请刷新。');
      });
  });
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
  if (updateRecheckTimer) clearInterval(updateRecheckTimer);
  stopTelemetry();
  terminateApiSync();
  // 优雅退出：写停止标记，告知 supervisor 不要拉起新实例。
  // 崩溃路径（app.relaunch + app.exit）不触发 will-quit，supervisor 才会兜底拉起。
  try {
    fs.writeFileSync(path.join(app.getPath('userData'), '.supervisor-stop'), String(Date.now()), 'utf8');
  } catch {
    // best effort
  }
});

process.on('exit', () => {
  terminateApiSync();
});
