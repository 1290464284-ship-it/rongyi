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

// 原生级看门狗：以 ELECTRON_RUN_AS_NODE 拉起 sidecar，主进程硬崩溃/taskkill 时
// 由它重新拉起应用（V2_ENABLE_WATCHDOG=0 可关，dev 不启用）。JS 级崩溃由
// logging.cjs 的 handleFatalCrash → watchdog.cjs 处理；两者互补。
function spawnSupervisor() {
  if (isDev || process.env.V2_ENABLE_WATCHDOG === '0') return;
  try {
    const supervisorPath = path.join(__dirname, 'supervisor.cjs');
    const stopMarker = path.join(app.getPath('userData'), '.supervisor-stop');
    // H3：启动时清除可能残留的停止标记——will-quit 每次优雅退出都会写入，
    // 若上次退出时 supervisor 已不在（如启动早期失败路径），标记残留会使
    // 本次看门狗一启动就静默退出。与 will-quit 的写入成对。
    try {
      fs.rmSync(stopMarker, { force: true });
    } catch {
      // best effort
    }
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

// 更新检查：启动即查 + 每 24h 周期复查；失败按 1min/5min/30min 退避重试，
// 连续 3 次失败才向渲染层报错（此前只有 UI 提示、靠用户手动重试）。
const UPDATE_RETRY_DELAYS_MS = [60_000, 300_000, 1_800_000];
const UPDATE_RECHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;
let updateCheckAttempts = 0;
let updateRecheckTimer = null;
let updateRetryTimer = null;

function scheduleUpdateChecks() {
  const attemptCheck = () => {
    autoUpdater.checkForUpdates()
      .then(() => {
        updateCheckAttempts = 0;
      })
      .catch((error) => {
        updateCheckAttempts += 1;
        if (updateCheckAttempts >= 3) {
          updateCheckAttempts = 0;
          sendUpdateEvent({ type: 'error', message: `更新检查连续失败：${error instanceof Error ? error.message : String(error)}` });
          return;
        }
        // 退避重试句柄随 will-quit 清理，避免退出瞬间再触发一次检查。
        updateRetryTimer = setTimeout(attemptCheck, UPDATE_RETRY_DELAYS_MS[updateCheckAttempts - 1]);
        updateRetryTimer.unref?.();
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
    // 说明（与 index.html meta CSP 的双轨关系）：生产页面经 file:// 加载，
    // Electron webRequest 不拦截 file://，因此这里的 header CSP 仅对 dev
    // （http://localhost:518x）生效；生产唯一生效来源是 index.html 的 meta
    // CSP + window.cjs prepareRuntimeHtml 的精确端口重写。两者字段应保持
    // 意图一致（生产 meta 另含 nonce 与 media-src），修改任一处需同步评估。
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
    await stopApi();
    // M6：stopApi 内部已置 shutdownStarted/isQuitting，这里只做重启后的复位
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
  if (updateRetryTimer) clearTimeout(updateRetryTimer);
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
