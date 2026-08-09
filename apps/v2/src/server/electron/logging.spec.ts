import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadElectronModule } from './load-electron';

interface LoggingModule {
  crashLog(message: string, error?: unknown): void;
  notify(title: string, body: string): void;
  sendUpdateEvent(payload: Record<string, unknown>): void;
  sendApiStatus(payload: Record<string, unknown>): void;
}

describe('electron logging', () => {
  let tempDir: string;

  afterEach(() => {
    if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it('writes crash logs to userData and rotates by size', () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'v2-logging-test-'));
    const electron = {
      app: { getPath: () => tempDir },
      BrowserWindow: { getAllWindows: () => [] },
      Notification: { isSupported: () => false },
    };
    const mod = loadElectronModule<LoggingModule>('../../../electron/logging.cjs', { electron });
    mod.crashLog('boom', new Error('failure'));
    const log = fs.readFileSync(path.join(tempDir, 'logs', 'desktop.log'), 'utf8');
    expect(log).toContain('boom');
    expect(log).toContain('failure');
  });

  it('sends events only to live windows', () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'v2-logging-test-'));
    const liveSend = vi.fn();
    const deadSend = vi.fn();
    const windows = [
      { isDestroyed: () => false, webContents: { send: liveSend } },
      { isDestroyed: () => true, webContents: { send: deadSend } },
    ];
    const electron = {
      app: { getPath: () => tempDir },
      BrowserWindow: { getAllWindows: () => windows },
      Notification: { isSupported: () => false },
    };
    const mod = loadElectronModule<LoggingModule>('../../../electron/logging.cjs', { electron });
    mod.sendUpdateEvent({ type: 'available' });
    mod.sendApiStatus({ status: 'ready' });
    expect(liveSend).toHaveBeenCalledWith('update:event', { type: 'available' });
    expect(liveSend).toHaveBeenCalledWith('api:status', { status: 'ready' });
    expect(deadSend).not.toHaveBeenCalled();
  });

  it('shows notifications when supported', () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'v2-logging-test-'));
    const shown: Array<{ title: string; body: string }> = [];
    class NotificationMock {
      constructor(input: { title: string; body: string }) {
        shown.push(input);
      }
      show(): void {}
    }
    const electron = {
      app: { getPath: () => tempDir },
      BrowserWindow: { getAllWindows: () => [] },
      Notification: Object.assign(NotificationMock, { isSupported: () => true }),
    };
    const mod = loadElectronModule<LoggingModule>('../../../electron/logging.cjs', { electron });
    mod.notify('title', 'body');
    expect(shown).toContainEqual({ title: 'title', body: 'body' });
  });
});
