import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadElectronModule } from './load-electron';

interface WatchdogModule {
  relaunchAfterCrash(stopMarkerPath: string): boolean;
}

describe('electron watchdog', () => {
  let tempDir: string;

  afterEach(() => {
    if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  function loadWatchdog(dir: string, options: { relaunchError?: boolean } = {}) {
    const relaunch = vi.fn(() => {
      if (options.relaunchError) throw new Error('no exec path');
    });
    const exit = vi.fn();
    const terminateApiSync = vi.fn();
    const mod = loadElectronModule<WatchdogModule>('../../../electron/watchdog.cjs', {
      electron: { app: { getPath: () => dir, relaunch, exit } },
      './api-process.cjs': { terminateApiSync },
    });
    return { mod, relaunch, exit, terminateApiSync };
  }

  it('relaunches after a first crash and terminates the api child first', () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'v2-watchdog-'));
    const stopMarker = path.join(tempDir, '.supervisor-stop');
    const { mod, relaunch, exit, terminateApiSync } = loadWatchdog(tempDir);

    const result = mod.relaunchAfterCrash(stopMarker);

    expect(result).toBe(true);
    expect(terminateApiSync).toHaveBeenCalledTimes(1);
    expect(relaunch).toHaveBeenCalledWith({ execPath: process.execPath });
    expect(exit).toHaveBeenCalledWith(1);
  });

  it('allows up to three relaunches inside the crash window, then writes the stop marker', () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'v2-watchdog-'));
    const stopMarker = path.join(tempDir, '.supervisor-stop');
    // 模拟连续四次崩溃（每次都是“新进程”重新读取计数文件）
    const first = loadWatchdog(tempDir);
    const second = loadWatchdog(tempDir);
    const third = loadWatchdog(tempDir);
    const fourth = loadWatchdog(tempDir);

    expect(first.mod.relaunchAfterCrash(stopMarker)).toBe(true);
    expect(second.mod.relaunchAfterCrash(stopMarker)).toBe(true);
    expect(third.mod.relaunchAfterCrash(stopMarker)).toBe(true);
    expect(fourth.mod.relaunchAfterCrash(stopMarker)).toBe(false);
    expect(fourth.relaunch).not.toHaveBeenCalled();
    expect(fs.existsSync(stopMarker)).toBe(true);
  });

  it('resets the crash counter once the window expires', () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'v2-watchdog-'));
    const stopMarker = path.join(tempDir, '.supervisor-stop');
    // 预写一个 11 分钟前开始、已到上限的窗口
    fs.writeFileSync(
      path.join(tempDir, 'crash-loop.json'),
      JSON.stringify({ count: 3, windowStart: Date.now() - 11 * 60 * 1000 }),
    );
    const { mod, relaunch } = loadWatchdog(tempDir);

    expect(mod.relaunchAfterCrash(stopMarker)).toBe(true);
    expect(relaunch).toHaveBeenCalledTimes(1);
    expect(fs.existsSync(stopMarker)).toBe(false);
  });

  it('returns false without exiting when relaunch itself fails', () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'v2-watchdog-'));
    const stopMarker = path.join(tempDir, '.supervisor-stop');
    const { mod, exit } = loadWatchdog(tempDir, { relaunchError: true });

    const result = mod.relaunchAfterCrash(stopMarker);

    expect(result).toBe(false);
    expect(exit).not.toHaveBeenCalled();
  });
});
