import { app, BrowserWindow, dialog } from 'electron';
import { existsSync, readFile } from 'fs';
import { join } from 'path';
import { createServer, type IncomingMessage, type ServerResponse } from 'http';
import * as path from 'path';
import { DEFAULT_API_PORT, DEFAULT_WEB_PORT } from '../src/config/constants';
import { log, isDev } from './electron-core';

const apiPort = DEFAULT_API_PORT;
const webPort = DEFAULT_WEB_PORT;

let mainWindow: BrowserWindow | null = null;

export const getMainWindow = (): BrowserWindow | null => mainWindow;

export const createWindow = (): void => {
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
      // P1.4: preload 通过 contextBridge 暴露只读信息（window.dentalBridge）
      preload: join(__dirname, 'preload.cjs'),
    },
  });

  // P1.4: 外链白名单 — 拒绝所有非白名单的新窗口（防止 target="_blank" 链接钓鱼）
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    try {
      const u = new URL(url);
      const allowed = ['github.com', 'gitee.com']; // 后续按需扩展
      if (allowed.some(h => u.hostname === h || u.hostname.endsWith('.' + h))) {
        return { action: 'allow' };
      }
    } catch {
      // URL 解析失败视为不安全
    }
    log(`拦截非白名单新窗口: ${url}`);
    return { action: 'deny' };
  });

  // P1.4: 导航保护 — 禁止渲染进程导航到非预期 URL（防止链接跳转离开应用）
  // 生产环境仅允许本地静态服务器与 API；开发环境额外允许 Vite dev server
  mainWindow.webContents.on('will-navigate', (event, url) => {
    try {
      const u = new URL(url);
      const allowedHosts = ['localhost', '127.0.0.1'];
      if (!allowedHosts.includes(u.hostname)) {
        event.preventDefault();
        log(`拦截非预期导航: ${url}`);
      }
    } catch {
      event.preventDefault();
    }
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
        const urlObj = new URL(req.url ?? '/', `http://localhost:${apiPort}`);
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
    server.listen(0, '127.0.0.1', () => {
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
    // 日志脱敏：过滤可能包含患者姓名/手机/身份证/密码/token 的内容
    const sanitized = message.replace(
      /(['"]?(?:password|token|secret|idCard|phone|\u5bc6\u7801|\u8eab\u4efd\u8bc1|\u624b\u673a)['"]?\s*[:=]\s*)['"]?[^\s'"}{,\]]+/gi,
      '$1[REDACTED]',
    );
    log(`[Renderer] [${level}] ${sanitized} (${sourceId}:${line})`);
  });

  mainWindow.webContents.on('dom-ready', () => {
    log('页面 DOM 加载完成');
  });

  mainWindow.webContents.on('did-fail-provisional-load', (event, errorCode, errorDescription, validatedURL) => {
    log(`资源加载失败: URL=${validatedURL}, code=${errorCode}, description=${errorDescription}`);
  });
};

export const showAboutDialog = (): void => {
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
};
