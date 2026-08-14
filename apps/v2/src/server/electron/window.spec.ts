import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadElectronModule } from './load-electron';

interface WindowModule {
  assertTrustedRenderer(event: { senderFrame?: { url?: string } }): void;
  createWindow(): void;
}

describe('electron window trust boundary', () => {
  let tempDir: string;

  afterEach(() => {
    if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
    vi.restoreAllMocks();
    delete process.env.V2_WEB_URL;
  });

  it('accepts packaged and error renderer URLs', () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'v2-window-test-'));
    const specDir = path.dirname(fileURLToPath(import.meta.url));
    const appRoot = path.resolve(specDir, '..', '..', '..');
    const indexUrl = pathToFileURL(path.join(appRoot, 'dist-web', 'index.html')).href;
    const errorUrl = pathToFileURL(path.join(appRoot, 'electron', 'error.html')).href;
    const electron = {
      app: { getPath: () => tempDir, isPackaged: false },
      BrowserWindow: class {},
      shell: { openExternal: vi.fn() },
      Notification: { isSupported: () => false },
    };
    const mod = loadElectronModule<WindowModule>('../../../electron/window.cjs', { electron });
    expect(() => mod.assertTrustedRenderer({ senderFrame: { url: `${indexUrl}#/patients` } })).not.toThrow();
    expect(() => mod.assertTrustedRenderer({ senderFrame: { url: `${errorUrl}?msg=x` } })).not.toThrow();
    expect(() => mod.assertTrustedRenderer({ senderFrame: { url: `${indexUrl}.evil` } })).toThrow('Untrusted IPC sender');
  });

  it('rejects untrusted renderer URLs', () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'v2-window-test-'));
    const electron = {
      app: { getPath: () => tempDir, isPackaged: false },
      BrowserWindow: class {},
      shell: { openExternal: vi.fn() },
      Notification: { isSupported: () => false },
    };
    const mod = loadElectronModule<WindowModule>('../../../electron/window.cjs', { electron });
    expect(() => mod.assertTrustedRenderer({ senderFrame: { url: 'https://evil.example' } })).toThrow('Untrusted IPC sender');
    expect(() => mod.assertTrustedRenderer({ senderFrame: {} })).toThrow('Untrusted IPC sender');
  });

  it('allows about:blank popups and renderer blob URLs but denies external links', async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'v2-window-popup-test-'));
    let openHandler: ((details: { url: string }) => { action: string }) | null = null;
    class BrowserWindowMock {
      loadURL = vi.fn();
      maximize = vi.fn();
      isMaximized = () => false;
      getNormalBounds = () => ({ x: 0, y: 0, width: 1280, height: 820 });
      webContents = {
        setWindowOpenHandler: vi.fn((handler: (details: { url: string }) => { action: string }) => {
          openHandler = handler;
        }),
        on: vi.fn(),
      };
      isDestroyed = () => false;
      hide = vi.fn();
      on = vi.fn();
    }
    const electron = {
      app: { getPath: () => tempDir, isPackaged: true },
      BrowserWindow: BrowserWindowMock,
      shell: { openExternal: vi.fn() },
      Notification: { isSupported: () => false },
    };
    const mod = loadElectronModule<WindowModule>('../../../electron/window.cjs', { electron });
    mod.createWindow();
    expect(openHandler).not.toBeNull();
    expect(openHandler!({ url: 'about:blank' }).action).toBe('allow');
    expect(openHandler!({ url: 'blob:http://127.0.0.1:1234/print' }).action).toBe('allow');
    expect(openHandler!({ url: 'https://evil.example' }).action).toBe('deny');
    await new Promise((resolve) => setImmediate(resolve));
    expect(electron.shell.openExternal).toHaveBeenCalledWith('https://evil.example');
  });

  it('loads the runtime HTML with an exact API port in packaged mode', () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'v2-window-runtime-test-'));
    // prepareRuntimeHtml 把 __dirname/../dist-web（打包产物）复制到 userData。
    // CI 的 Unit tests 在 Build 步骤之前运行，dist-web 尚不存在 → 复制失败
    // 回退到 asar 原路径 → 断言失败。这里按需创建最小占位（带标记以便只删
    // 自己创建的），本地已有真实构建产物时跳过。
    const specDir = path.dirname(fileURLToPath(import.meta.url));
    const appRoot = path.resolve(specDir, '..', '..', '..');
    const distWeb = path.join(appRoot, 'dist-web');
    const createdPlaceholder = !fs.existsSync(distWeb);
    if (createdPlaceholder) {
      fs.mkdirSync(distWeb, { recursive: true });
      fs.writeFileSync(path.join(distWeb, 'index.html'), '<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="connect-src http://127.0.0.1:*"></head><body>placeholder</body></html>');
      fs.writeFileSync(path.join(distWeb, '.test-created'), '1');
    }
    const loadedUrls: string[] = [];
    class BrowserWindowMock {
      loadURL = (url: string) => { loadedUrls.push(url); };
      maximize = vi.fn();
      isMaximized = () => false;
      getNormalBounds = () => ({ x: 0, y: 0, width: 1280, height: 820 });
      webContents = { setWindowOpenHandler: vi.fn(), on: vi.fn() };
      isDestroyed = () => false;
      hide = vi.fn();
      on = vi.fn();
    }
    const electron = {
      app: { getPath: () => tempDir, isPackaged: true },
      BrowserWindow: BrowserWindowMock,
      shell: { openExternal: vi.fn() },
      Notification: { isSupported: () => false },
    };
    const stateMock = { apiPort: 45678, tray: {}, isQuitting: false };
    const mod = loadElectronModule<WindowModule>('../../../electron/window.cjs', {
      electron,
      './state.cjs': stateMock,
    });

    try {
      mod.createWindow();

      const runtimeUrl = pathToFileURL(path.join(tempDir, 'cache', 'dist-web', 'index.html')).href;
      expect(loadedUrls).toHaveLength(1);
      expect(loadedUrls[0]).toBe(runtimeUrl);
      // 运行时 HTML：CSP 精确到当前端口，通配已被替换
      const html = fs.readFileSync(path.join(tempDir, 'cache', 'dist-web', 'index.html'), 'utf8');
      expect(html).toContain('http://127.0.0.1:45678');
      expect(html).not.toContain('http://127.0.0.1:*');
      // 信任边界接受运行时 URL
      expect(() => mod.assertTrustedRenderer({ senderFrame: { url: `${runtimeUrl}#/charges` } })).not.toThrow();
    } finally {
      if (createdPlaceholder) {
        fs.rmSync(distWeb, { recursive: true, force: true });
      }
    }
  });

  it('hides the window to tray instead of closing when tray exists', () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'v2-window-tray-test-'));
    const closeHandlers: Array<(event: { preventDefault: () => void }) => void> = [];
    class BrowserWindowMock {
      loadURL = vi.fn();
      maximize = vi.fn();
      isMaximized = () => false;
      getNormalBounds = () => ({ x: 0, y: 0, width: 1280, height: 820 });
      webContents = { setWindowOpenHandler: vi.fn(), on: vi.fn() };
      isDestroyed = () => false;
      hide = vi.fn();
      on(event: string, callback: (event: { preventDefault: () => void }) => void): void {
        if (event === 'close') closeHandlers.push(callback);
      }
    }
    const electron = {
      app: { getPath: () => tempDir, isPackaged: false },
      BrowserWindow: BrowserWindowMock,
      shell: { openExternal: vi.fn() },
      Notification: { isSupported: () => false },
    };
    const stateMock = { tray: {}, isQuitting: false };
    const mod = loadElectronModule<WindowModule>('../../../electron/window.cjs', {
      electron,
      './state.cjs': stateMock,
    });

    mod.createWindow();
    expect(closeHandlers).toHaveLength(1);
    const event = { preventDefault: vi.fn() };
    closeHandlers[0](event);
    expect(event.preventDefault).toHaveBeenCalled();
  });
});
