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
