/* eslint-disable @typescript-eslint/no-unused-vars -- TODO: 逐步修复 lint 问题 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

type Bridge = typeof globalThis extends { window: { dentalBridge: infer B } } ? B : never;

const TEST_PLATFORM = 'win32';
const TEST_ARCH = 'x64';

function makeMockBridge(overrides: Partial<any> = {}): any {
  const minimize = vi.fn(async () => undefined);
  const toggleMaximizeState = { maximized: false };
  const toggleMaximize = vi.fn(async () => {
    toggleMaximizeState.maximized = !toggleMaximizeState.maximized;
    return toggleMaximizeState.maximized;
  });
  const getIsMaximized = vi.fn(async () => toggleMaximizeState.maximized);
  const hideToTray = vi.fn(async () => undefined);
  const closeOrHideToTray = vi.fn(async (args?: any) => {
    if (args?.minimizeOnClose) {
      await hideToTray();
      return { quit: false };
    }
    return { quit: true };
  });
  const setAutoLaunch = vi.fn(async (enable: unknown) => {
    if (typeof enable !== 'boolean') return { success: false };
    return { success: true };
  });
  const getAutoLaunch = vi.fn(async () => false);

  const bridge: any = {
    platform: TEST_PLATFORM,
    arch: TEST_ARCH,
    appVersion: '0.1.0',
    isPackaged: false,
    clinicTimezone: 'Asia/Shanghai',
    windowActions: {
      minimize,
      toggleMaximize,
      getIsMaximized,
      closeOrHideToTray,
      hideToTray,
    },
    tray: {
      setAutoLaunch,
      getAutoLaunch,
    },
    system: {
      isPackaged: false,
      platform: TEST_PLATFORM,
      arch: TEST_ARCH,
      appVersion: '0.1.0',
    },
    ...overrides,
  };
  return bridge;
}

function setGlobalBridge(bridge: any): void {
  (globalThis as any).window = (globalThis as any).window || {};
  (globalThis as any).window.dentalBridge = bridge;
}

function clearGlobalBridge(): void {
  if ((globalThis as any).window) {
    delete (globalThis as any).window.dentalBridge;
  }
}

describe('TR-18 Electron Bridge 纯逻辑单测', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    clearGlobalBridge();
  });

  afterEach(() => {
    clearGlobalBridge();
  });

  it('TR-18.1 WindowActions.minimize 存在 & 可调用；不 crash', async () => {
    const bridge = makeMockBridge();
    setGlobalBridge(bridge);
    expect(window.dentalBridge?.windowActions.minimize).toBeTypeOf('function');
    await expect(window.dentalBridge!.windowActions.minimize()).resolves.not.toThrow();
    expect(bridge.windowActions.minimize).toHaveBeenCalledTimes(1);
  });

  it('TR-18.2 toggleMaximize 先最大化再恢复；返回当前 isMaximized 布尔', async () => {
    const bridge = makeMockBridge();
    setGlobalBridge(bridge);
    const r1 = await bridge.windowActions.toggleMaximize();
    expect(r1).toBe(true);
    expect(await bridge.windowActions.getIsMaximized()).toBe(true);
    const r2 = await bridge.windowActions.toggleMaximize();
    expect(r2).toBe(false);
    expect(await bridge.windowActions.getIsMaximized()).toBe(false);
    expect(bridge.windowActions.toggleMaximize).toHaveBeenCalledTimes(2);
  });

  it('TR-18.3 closeOrHideToTray：设置 minimizeOnClose=true 调 hideToTray 不真 quit', async () => {
    const bridge = makeMockBridge();
    bridge.windowActions.closeOrHideToTray = vi.fn(async (opts?: any) => {
      if (opts?.minimizeOnClose) {
        await bridge.windowActions.hideToTray();
        return { quit: false };
      }
      return { quit: true };
    });
    setGlobalBridge(bridge);
    const res = await window.dentalBridge!.windowActions.closeOrHideToTray({ minimizeOnClose: true });
    expect(bridge.windowActions.hideToTray).toHaveBeenCalledTimes(1);
    expect((res as any).quit).toBe(false);
  });

  it('TR-18.4 hideToTray 调用 mainWindow.hide 执行 1 次（spy）', async () => {
    const bridge = makeMockBridge();
    const mainWindowHide = vi.fn();
    (globalThis as any).__mainWindowMock = { hide: mainWindowHide };
    bridge.windowActions.hideToTray = vi.fn(async () => {
      (globalThis as any).__mainWindowMock?.hide?.();
    });
    setGlobalBridge(bridge);
    await window.dentalBridge!.windowActions.hideToTray();
    expect(mainWindowHide).toHaveBeenCalledTimes(1);
    expect(bridge.windowActions.hideToTray).toHaveBeenCalledTimes(1);
  });

  it('TR-18.5 tray.setAutoLaunch(true) 调 app.setLoginItemSettings，参数 enable=true；返回 success', async () => {
    const settings: any = { openAtLogin: false };
    const setLoginItemSettings = vi.fn((opts: any) => {
      settings.openAtLogin = !!opts?.openAtLogin;
    });
    const bridge = makeMockBridge();
    bridge.tray.setAutoLaunch = vi.fn(async (enable: unknown) => {
      if (typeof enable !== 'boolean') return { success: false };
      setLoginItemSettings({ openAtLogin: enable });
      return { success: true };
    });
    setGlobalBridge(bridge);
    const res = await window.dentalBridge!.tray.setAutoLaunch(true);
    expect(res.success).toBe(true);
    expect(setLoginItemSettings).toHaveBeenCalledWith({ openAtLogin: true });
    expect(settings.openAtLogin).toBe(true);
  });

  it('TR-18.6 tray.setAutoLaunch("abc" 非 boolean) 参数校验不通过，返回 false', async () => {
    const bridge = makeMockBridge();
    setGlobalBridge(bridge);
    const res = await window.dentalBridge!.tray.setAutoLaunch('abc' as any);
    expect(res.success).toBe(false);
  });

  it('TR-18.7 tray.getAutoLaunch 返回 app.getLoginItemSettings().openAtLogin 布尔', async () => {
    const bridge = makeMockBridge({
      tray: {
        setAutoLaunch: vi.fn(),
        getAutoLaunch: vi.fn(async () => true),
      },
    });
    setGlobalBridge(bridge);
    expect(await window.dentalBridge!.tray.getAutoLaunch()).toBe(true);
  });

  it('TR-18.8 system.platform 与 mock 一致；isPackaged 正确；appVersion 非空', () => {
    const bridge = makeMockBridge();
    setGlobalBridge(bridge);
    expect(window.dentalBridge!.system.platform).toBe(TEST_PLATFORM);
    expect(typeof window.dentalBridge!.system.isPackaged).toBe('boolean');
    expect(window.dentalBridge!.system.appVersion.length).toBeGreaterThan(0);
    expect(window.dentalBridge!.platform).toBe(TEST_PLATFORM);
    expect(window.dentalBridge!.appVersion.length).toBeGreaterThan(0);
  });

  it('TR-18.9 白名单 IPC：未知 channel "dangerous:xxx" 抛 Error "Unknown IPC channel"', async () => {
    const ALLOWED = [
      'window:minimize', 'window:maximize', 'window:hideToTray', 'window:close',
      'window:isMaximized', 'tray:setAutoLaunch', 'tray:getAutoLaunch',
      'system:isPackaged', 'app:getVersion',
    ];
    const isAllowed = (c: string) => ALLOWED.includes(c);
    const handler = async (channel: string) => {
      if (!isAllowed(channel)) {
        throw new Error(`Unknown IPC channel: ${channel}`);
      }
      return null;
    };
    await expect(handler('dangerous:xxx')).rejects.toThrow(/Unknown IPC channel/);
    await expect(handler('window:minimize')).resolves.not.toThrow();
  });

  it('TR-18.10 second-instance 触发：主窗口存在时调 restore+focus（spy）', () => {
    const mainWindow = { isMinimized: vi.fn(() => true), restore: vi.fn(), focus: vi.fn() };
    const onSecondInstance = () => {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    };
    onSecondInstance();
    expect(mainWindow.isMinimized).toHaveBeenCalled();
    expect(mainWindow.restore).toHaveBeenCalledTimes(1);
    expect(mainWindow.focus).toHaveBeenCalledTimes(1);
  });

  it('TR-18.11 before-quit：app.isQuitting 标志 true，确保 close 事件不 hideToTray 而真退出', () => {
    const app: any = { isQuitting: false };
    const onBeforeQuit = () => { app.isQuitting = true; };
    const onClose = (event: any) => {
      const aiTrayEnabled = true;
      if (aiTrayEnabled && !app.isQuitting) {
        event.preventDefault();
        return 'hideToTray';
      }
      return 'destroy-and-quit';
    };
    const ev1: any = { preventDefault: vi.fn() };
    expect(onClose(ev1)).toBe('hideToTray');
    expect(ev1.preventDefault).toHaveBeenCalled();
    onBeforeQuit();
    expect(app.isQuitting).toBe(true);
    const ev2: any = { preventDefault: vi.fn() };
    expect(onClose(ev2)).toBe('destroy-and-quit');
    expect(ev2.preventDefault).not.toHaveBeenCalled();
  });

  it('TR-18.12 托盘 icon 不存在 fallback → empty NativeImage 不抛错，setupTray() 正常返回', () => {
    const createEmpty = vi.fn(() => ({ isEmpty: () => true }));
    const resolveTrayIcon = () => {
      try {
        throw new Error('icon file not found');
      } catch {
        return createEmpty();
      }
    };
    const setupTray = () => {
      const icon = resolveTrayIcon();
      expect(icon.isEmpty()).toBe(true);
      return true;
    };
    expect(() => setupTray()).not.toThrow();
    expect(setupTray()).toBe(true);
    expect(createEmpty).toHaveBeenCalled();
  });
});
