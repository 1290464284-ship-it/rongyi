import { app, BrowserWindow, Menu, MenuItemConstructorOptions, dialog } from 'electron';
import * as path from 'path';
import { join } from 'path';
import { spawn, ChildProcess } from 'child_process';
import { platform } from 'os';
import { writeFileSync, existsSync, mkdirSync, readFileSync, statSync, unlinkSync, renameSync, readFile } from 'fs';
import { createServer, type IncomingMessage, type ServerResponse } from 'http';
import * as crypto from 'crypto';
import { autoUpdater } from 'electron-updater';
import {
  DEFAULT_API_PORT,
  DEFAULT_WEB_PORT,
  API_STARTUP_MAX_RETRIES,
  API_STARTUP_RETRY_DELAY_MS,
  API_RESTART_DELAY_MS,
  API_FORCE_KILL_TIMEOUT_MS,
  ELECTRON_LOG_ROTATION,
} from '../src/config/constants';

const isDev = !app.isPackaged;
const apiPort = DEFAULT_API_PORT;
const webPort = DEFAULT_WEB_PORT;

let mainWindow: BrowserWindow | null = null;
let apiProcess: ChildProcess | null = null;
let isShuttingDown = false;
let isRestarting = false;

const logPath = join(app.getPath('userData'), 'app.log');

const configDir = join(app.getPath('userData'), 'config');
const secretPath = join(configDir, 'secrets.json');

function getJwtSecret(): string {
  try {
    if (!existsSync(configDir)) {
      mkdirSync(configDir, { recursive: true });
    }

    if (existsSync(secretPath)) {
      const content = readFileSync(secretPath, 'utf-8');
      const config = JSON.parse(content);
      if (config.jwtSecret && typeof config.jwtSecret === 'string') {
        return config.jwtSecret;
      }
    }

    const newSecret = crypto.randomBytes(32).toString('hex');
    writeFileSync(secretPath, JSON.stringify({ jwtSecret: newSecret }), { mode: 0o600 });
    log(`生成新的JWT密钥并保存`);
    return newSecret;
  } catch (err) {
    const msg = `获取JWT密钥失败: ${(err as Error).message}`;
    log(msg);
    dialog.showErrorBox('密钥错误', msg + '\n\n无法读取或创建JWT密钥文件，应用将退出。');
    app.quit();
    throw new Error(msg);
  }
}

function getEncryptionKey(): string {
  try {
    if (!existsSync(configDir)) {
      mkdirSync(configDir, { recursive: true });
    }

    if (existsSync(secretPath)) {
      const content = readFileSync(secretPath, 'utf-8');
      const config = JSON.parse(content);
      if (config.encryptionKey && typeof config.encryptionKey === 'string') {
        return config.encryptionKey;
      }
    }

    const newKey = crypto.randomBytes(32).toString('base64');
    let config: Record<string, unknown> = {};
    if (existsSync(secretPath)) {
      try {
        config = JSON.parse(readFileSync(secretPath, 'utf-8'));
      } catch {}
    }
    config.encryptionKey = newKey;
    writeFileSync(secretPath, JSON.stringify(config), { mode: 0o600 });
    log(`生成新的数据加密密钥并保存`);
    return newKey;
  } catch (err) {
    const msg = `获取加密密钥失败: ${(err as Error).message}`;
    log(msg);
    dialog.showErrorBox('密钥错误', msg + '\n\n无法读取或创建数据加密密钥文件，应用将退出。');
    app.quit();
    throw new Error(msg);
  }
}

const rotateLogIfNeeded = (): void => {
  try {
    if (!existsSync(logPath)) return;
    const stats = statSync(logPath);
    if (stats.size >= ELECTRON_LOG_ROTATION.MAX_LOG_SIZE_BYTES) {
      // 删除最旧的日志，重命名其他日志
      for (let i = ELECTRON_LOG_ROTATION.MAX_LOG_FILES - 1; i > 0; i--) {
        const oldPath = `${logPath}.${i}`;
        const newPath = `${logPath}.${i + 1}`;
        if (existsSync(oldPath)) {
          if (i === ELECTRON_LOG_ROTATION.MAX_LOG_FILES - 1) {
            unlinkSync(oldPath);
          } else {
            renameSync(oldPath, newPath);
          }
        }
      }
      renameSync(logPath, `${logPath}.1`);
    }
  } catch (err) {
    console.warn('日志轮转失败:', (err as Error).message);
  }
};

const log = (msg: string): void => {
  const timestamp = new Date().toISOString();
  const line = `[${timestamp}] ${msg}\n`;
  try {
    rotateLogIfNeeded();
    writeFileSync(logPath, line, { flag: 'a' });
  } catch {
    console.log(line);
  }
};


// ===== 错误处理 =====
process.on('uncaughtException', (err) => {
    log('UNCAUGHT EXCEPTION: ' + err.message + '\n' + (err.stack || ''));
    dialog.showErrorBox('错误', '应用程序发生未处理的错误:\n\n' + err.message + '\n\n日志文件路径: ' + logPath);
});

process.on('unhandledRejection', (reason) => {
    const msg = reason instanceof Error ? reason.message : String(reason);
    log('UNHANDLED REJECTION: ' + msg);
    console.error('Unhandled rejection:', reason);
});

app.on('render-process-gone', (_event, _webContents, details) => {
    log('RENDER PROCESS GONE: reason=' + details.reason + ' exitCode=' + details.exitCode);
});

app.on('child-process-gone', (_event, details) => {
    log('CHILD PROCESS GONE: type=' + details.type + ' reason=' + details.reason + ' exitCode=' + details.exitCode);
});

const waitForApi = async (): Promise<void> => {
  const maxRetries = API_STARTUP_MAX_RETRIES;
  const delay = API_STARTUP_RETRY_DELAY_MS;

  for (let i = 0; i < maxRetries; i++) {
    try {
      const response = await fetch(`http://localhost:${apiPort}/api/v1/health`);
      const data = await response.json() as { status?: string; message?: string };
      if (data.status === 'ok') {
        log('API 服务启动成功，数据库已连接');
        return;
      } else {
        log(`API 服务未就绪: ${data.message ?? data.status}`);
      }
    } catch {
      // 服务尚未启动
    }
    await new Promise((resolve) => setTimeout(resolve, delay));
  }

  throw new Error(`API 服务启动超时，端口 ${apiPort}`);
};

const startApi = (): Promise<void> => {
  return new Promise((resolve, reject) => {
    let apiPath: string;
    let args: string[];
    let cwd: string;

    let enginePath = '';
    let resourcesPath = '';

    // 诊所数据永远写在 userData，避免安装目录升级覆盖
    const dataDir = join(app.getPath('userData'), 'data');
    if (!existsSync(dataDir)) {
      mkdirSync(dataDir, { recursive: true });
      log(`创建数据目录: ${dataDir}`);
    }

    if (isDev) {
      const pnpmPath = platform() === 'win32' ? 'pnpm.cmd' : 'pnpm';
      apiPath = pnpmPath;
      args = ['--filter', '@dental/api', 'dev'];
      cwd = join(__dirname, '../../..');
    } else {
      resourcesPath = process.resourcesPath;
      
      apiPath = process.execPath;
      args = [join(resourcesPath, 'api', 'bundle', 'index.js')];
      cwd = join(resourcesPath, 'api');
      log(`API 路径: ${args[0]}`);
      log(`API 工作目录: ${cwd}`);
      log(`Node 路径: ${apiPath}`);
    }

    const dbFile = join(dataDir, 'dental.sqlite');
    log(`数据库路径: ${dbFile}`);
    log(`数据库文件存在: ${existsSync(dbFile)}`);
    log(`启动 API: ${apiPath} ${args.join(' ')}`);
    
    const jwtSecret = getJwtSecret();
    const encryptionKey = getEncryptionKey();
    const legacyDbPath = !isDev
      ? join(process.resourcesPath, 'api', 'data', 'dental.sqlite')
      : '';

    const env: NodeJS.ProcessEnv = {
      ...process.env,
      PORT: apiPort.toString(),
      ELECTRON_RUN_AS_NODE: '1',
      NODE_ENV: isDev ? 'development' : 'production',
      JWT_SECRET: jwtSecret,
      JWT_EXPIRES_IN: '7d',
      ENCRYPTION_KEY: encryptionKey,
      DATA_DIR: dataDir,
      DB_PATH: dbFile,
      ENV_PATH: join(dataDir, '.env'),
      RESOURCES_PATH: resourcesPath || process.resourcesPath || '',
      LEGACY_DB_PATH: legacyDbPath,
      BETTER_SQLITE3_BINDINGS_PATH: join(
        resourcesPath || process.resourcesPath || '',
        'api',
        'bundle',
        'build',
        'Release',
        'better_sqlite3.node',
      ),
    };
    
    apiProcess = spawn(apiPath, args, {
      cwd,
      stdio: 'pipe',
      env
    });

    apiProcess.stdout?.on('data', (data) => {
      const output = data.toString().trim();
      log(`[API] ${output}`);
    });

    apiProcess.stderr?.on('data', (data) => {
      const output = data.toString().trim();
      log(`[API ERROR] ${output}`);
      console.error(`[API ERROR] ${output}`);
    });

    apiProcess.on('error', (err) => {
      const nodeErr = err as NodeJS.ErrnoException;
      const errorMsg = `启动 API 服务失败: ${err.message}, code: ${nodeErr.code}, path: ${nodeErr.path}`;
      log(errorMsg);
      reject(new Error(errorMsg));
    });

    apiProcess.on('close', (code) => {
      log(`API 服务退出，代码: ${code}`);
      if (code !== 0 && code !== null) {
        console.error(`API 服务异常退出，代码: ${code}`);
        // 自动重启API服务（防止竞态）
        if (!isShuttingDown && !isRestarting) {
          isRestarting = true;
          log('API 服务异常退出，3秒后自动重启...');
          setTimeout(async () => {
            if (!isShuttingDown) {
              try {
                await startApiInternal();
                log('API 服务重启成功');
              } catch (err) {
                log(`API 服务重启失败: ${(err as Error).message}`);
              }
            }
            isRestarting = false;
          }, API_RESTART_DELAY_MS);
        }
      }
    });

    waitForApi().then(resolve).catch(reject);
  });
};

// 内部启动方法，用于重启
const startApiInternal = (): Promise<void> => {
  return startApi();
};

const stopApi = (): void => {
  isShuttingDown = true;
  if (apiProcess) {
    log('正在停止 API 服务...');
    apiProcess.kill('SIGTERM');

    const forceKillTimer = setTimeout(() => {
      if (apiProcess) {
        log('API 服务未在5秒内退出，强制杀死');
        apiProcess.kill('SIGKILL');
        apiProcess = null;
      }
    }, API_FORCE_KILL_TIMEOUT_MS);

    apiProcess.on('exit', () => {
      clearTimeout(forceKillTimer);
      apiProcess = null;
      log('API 服务已停止');
    });
  }
};

const createWindow = () => {
  mainWindow = new BrowserWindow({
    title: '牙科管家',
    width: 1400,
    height: 900,
    minWidth: 1024,
    minHeight: 768,
    center: true,
    show: false,
    frame: true,
    backgroundColor: '#F5F7FA',
    webPreferences: {
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      devTools: isDev,
      webSecurity: true,
    },
  });

  if (isDev) {
    mainWindow.loadURL(`http://localhost:${webPort}`);
    mainWindow.webContents.openDevTools();
  } else {
    // Electron 打包后 process.resourcesPath 指向 asar 资源目录
    const resourcesPath = (process as unknown as { resourcesPath: string }).resourcesPath;
    let distPath = join(resourcesPath, 'dist-web');
    if (!existsSync(distPath)) {
      distPath = join(resourcesPath, 'app.asar.unpacked', 'dist-web');
    }
    log(`distPath: ${distPath}`);
    log(`distPath exists: ${existsSync(distPath)}`);
    const server = createServer((req: IncomingMessage, res: ServerResponse) => {
      try {
        // 解析URL，防止路径遍历攻击
        const urlObj = new URL(req.url, `http://localhost:${apiPort}`);
        const pathname = decodeURIComponent(urlObj.pathname);

        // 规范化路径，防止 ../ 路径遍历
        let filePath = path.normalize(path.join(distPath, pathname === '/' ? 'index.html' : pathname));

        // 验证解析后的路径在distPath目录内
        const resolvedDistPath = path.resolve(distPath);
        const resolvedFilePath = path.resolve(filePath);
        if (!resolvedFilePath.startsWith(resolvedDistPath)) {
          res.writeHead(403);
          res.end('Forbidden');
          return;
        }

        const extname = path.extname(filePath);
        const contentTypes: Record<string, string> = {
          '.html': 'text/html; charset=utf-8',
          '.js': 'text/javascript; charset=utf-8',
          '.css': 'text/css; charset=utf-8',
          '.json': 'application/json; charset=utf-8',
          '.png': 'image/png',
          '.jpg': 'image/jpeg',
          '.jpeg': 'image/jpeg',
          '.gif': 'image/gif',
          '.svg': 'image/svg+xml',
          '.ico': 'image/x-icon',
          '.woff': 'font/woff',
          '.woff2': 'font/woff2',
          '.ttf': 'font/ttf',
          '.eot': 'application/vnd.ms-fontobject',
          '.map': 'application/json',
        };
        const contentType = contentTypes[extname] || 'application/octet-stream';

        readFile(filePath, (err: NodeJS.ErrnoException | null, content: Buffer) => {
          if (err) {
            // SPA路由：对非静态资源请求返回index.html
            if (err.code === 'ENOENT' && !extname) {
              const indexPath = join(distPath, 'index.html');
              readFile(indexPath, (indexErr: NodeJS.ErrnoException | null, indexContent: Buffer) => {
                if (indexErr) {
                  res.writeHead(500);
                  res.end('Internal Server Error');
                } else {
                  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
                  res.end(indexContent, 'utf-8');
                }
              });
              return;
            }
            res.writeHead(404);
            res.end('File not found');
          } else {
            // 为静态资源添加缓存控制
            const headers: Record<string, string> = { 'Content-Type': contentType };
            if (extname !== '.html') {
              headers['Cache-Control'] = 'public, max-age=86400';
            } else {
              headers['Cache-Control'] = 'no-cache';
              // P2-18: HTML 响应添加 CSP 头，提供纵深防御
              headers['Content-Security-Policy'] = `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self' http://localhost:${apiPort}`;
            }
            res.writeHead(200, headers);
            res.end(content);
          }
        });
      } catch (error) {
        res.writeHead(500);
        res.end('Internal Server Error');
      }
    });
    server.listen(0, () => {
      const addr = server.address();
      const port = typeof addr === 'object' && addr !== null ? addr.port : 0;
      log(`启动本地静态服务器: http://localhost:${port}`);
      if (mainWindow) {
        mainWindow.loadURL(`http://localhost:${port}/index.html`);
      }
    });
  }

  mainWindow.on('ready-to-show', () => {
    mainWindow?.show();
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  mainWindow.webContents.on('render-process-gone', () => {
    app.quit();
  });

  mainWindow.webContents.on('did-fail-load', (event, errorCode, errorDescription) => {
    log(`页面加载失败: code=${errorCode}, description=${errorDescription}`);
    dialog.showErrorBox('页面加载失败', `错误代码: ${errorCode}\n描述: ${errorDescription}`);
  });

  mainWindow.webContents.on('console-message', (event, level, message, line, sourceId) => {
    log(`[Renderer] [${level}] ${message} (${sourceId}:${line})`);
  });

  mainWindow.webContents.on('dom-ready', () => {
    log('页面 DOM 加载完成');
  });

  mainWindow.webContents.on('did-fail-provisional-load', (event, errorCode, errorDescription, validatedURL) => {
    log(`资源加载失败: URL=${validatedURL}, code=${errorCode}, description=${errorDescription}`);
  });
};

const menuTemplate: MenuItemConstructorOptions[] = [
  {
    label: '文件',
    submenu: [
      {
        label: '退出',
        accelerator: 'Ctrl+Q',
        click: () => app.quit(),
      },
    ],
  },
  {
    label: '编辑',
    submenu: [
      { label: '撤销', accelerator: 'Ctrl+Z', role: 'undo' },
      { label: '重做', accelerator: 'Ctrl+Y', role: 'redo' },
      { type: 'separator' },
      { label: '剪切', accelerator: 'Ctrl+X', role: 'cut' },
      { label: '复制', accelerator: 'Ctrl+C', role: 'copy' },
      { label: '粘贴', accelerator: 'Ctrl+V', role: 'paste' },
      { label: '全选', accelerator: 'Ctrl+A', role: 'selectAll' },
    ],
  },
  {
    label: '视图',
    submenu: [
      {
        label: '刷新',
        accelerator: 'Ctrl+R',
        click: () => mainWindow?.webContents.reload(),
      },
      ...(isDev ? [
        {
          label: '开发者工具',
          accelerator: 'F12',
          click: () => mainWindow?.webContents.openDevTools(),
        },
      ] : []),
      { type: 'separator' },
      { label: '切换全屏', accelerator: 'F11', role: 'togglefullscreen' },
    ],
  },
  {
    label: '帮助',
    submenu: [
      {
        label: '关于',
        click: () => {
          const aboutWindow = new BrowserWindow({
            width: 400,
            height: 300,
            modal: true,
            parent: mainWindow || undefined,
            frame: true,
            resizable: false,
            // P2-16: 加固 About 窗口安全（data: URL 内容为静态，无注入风险，但补全安全开关）
            webPreferences: {
              contextIsolation: true,
              nodeIntegration: false,
              webSecurity: true,
              sandbox: true,
            },
          });
          aboutWindow.loadURL(`data:text/html;charset=utf-8,
            <!DOCTYPE html>
            <html>
            <head>
              <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline';">
              <style>
                body { margin: 0; padding: 30px; font-family: Microsoft YaHei, sans-serif; text-align: center; background: #F5F7FA; }
                h1 { color: #1E5AA8; margin-bottom: 20px; }
                p { color: #6B7C93; line-height: 1.8; }
                .version { font-size: 14px; margin-top: 15px; color: #9EABB9; }
                .close-btn { margin-top: 20px; padding: 8px 24px; background: #1E5AA8; color: white; border: none; border-radius: 4px; cursor: pointer; font-size: 14px; }
                .close-btn:hover { background: #154480; }
              </style>
            </head>
            <body>
              <h1>牙科管家</h1>
              <p>专业牙科管理系统</p>
              <p>版本：1.0.0</p>
              <button class="close-btn" onclick="window.close()">关闭</button>
            </body>
            </html>
          `);
        },
      },
    ],
  },
];

// 单实例锁，防止多实例同时运行
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    // 有人试图运行第二个实例，我们应该聚焦到我们的窗口
    if (mainWindow) {
      if (mainWindow.isMinimized()) {
        mainWindow.restore();
      }
      mainWindow.focus();
    }
  });

  app.whenReady().then(async () => {
    log('应用启动');
    try {
      await startApi();
      const menu = Menu.buildFromTemplate(menuTemplate);
      Menu.setApplicationMenu(menu);
      createWindow();

      // 自动更新检查（仅生产环境）
      if (!isDev) {
        autoUpdater.autoDownload = false;
        autoUpdater.autoInstallOnAppQuit = true;
        autoUpdater.checkForUpdates().catch((err) => {
          log('自动更新检查失败: ' + (err as Error).message);
        });
        autoUpdater.on('update-available', (info) => {
          log(`发现新版本: ${info.version}`);
          dialog.showMessageBox({
            type: 'info',
            title: '发现新版本',
            message: `牙科管家 v${info.version} 已发布，正在下载更新...`,
            buttons: ['好的'],
          });
          autoUpdater.downloadUpdate();
        });
        autoUpdater.on('update-downloaded', (info) => {
          log(`新版本已下载: ${info.version}`);
          dialog.showMessageBox({
            type: 'info',
            title: '更新就绪',
            message: `牙科管家 v${info.version} 已准备就绪，重启后生效。`,
            buttons: ['立即重启', '稍后重启'],
          }).then(({ response }) => {
            if (response === 0) {
              autoUpdater.quitAndInstall();
            }
          });
        });
        autoUpdater.on('error', (err) => {
          log('自动更新错误: ' + err.message);
        });
      }

      app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) {
          createWindow();
        }
      });
    } catch (err) {
      const errorMsg = (err as Error).message;
      log(`启动失败: ${errorMsg}`);
      dialog.showErrorBox('启动失败', errorMsg + '\n\n请查看日志文件: ' + logPath);
      app.quit();
    }
  });
}

app.on('window-all-closed', () => {
  stopApi();
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', () => {
  stopApi();
});
