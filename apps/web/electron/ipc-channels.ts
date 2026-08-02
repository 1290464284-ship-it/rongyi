import { ipcMain, app, type IpcMainInvokeEvent } from 'electron';
import { getMainWindow } from './window-manager';
import { hideToTray, setAutoLaunch } from './tray';
import { log } from './electron-core';

export const ALLOWED_CHANNELS = [
  'window:minimize',
  'window:maximize',
  'window:hideToTray',
  'window:close',
  'window:isMaximized',
  'tray:setAutoLaunch',
  'tray:getAutoLaunch',
  'system:isPackaged',
  'app:getVersion',
] as const;

export type AllowedChannel = (typeof ALLOWED_CHANNELS)[number];

function isAllowedChannel(channel: string): channel is AllowedChannel {
  return (ALLOWED_CHANNELS as readonly string[]).includes(channel);
}

function isBoolean(v: unknown): v is boolean {
  return typeof v === 'boolean';
}

function getMinimizeOnCloseFromLocalStorage(): boolean {
  try {
    const mainWindow = getMainWindow();
    if (!mainWindow) return false;
    // 同步读取 localStorage 需要在 webContents 中执行，但主进程没有 DOM，
    // 这里使用一个约定：默认 false，具体由 SettingsPage 保存到 localStorage 中，
    // 实际 close 逻辑通过 bridge 的 closeOrHideToTray 直接决定行为。
    return false;
  } catch {
    return false;
  }
}

const aiTrayEnabledDefault = true;

async function handleChannel(
  channel: AllowedChannel,
  args: unknown[],
  _event: IpcMainInvokeEvent,
): Promise<unknown> {
  switch (channel) {
    case 'window:minimize': {
      const mainWindow = getMainWindow();
      mainWindow?.minimize();
      return undefined;
    }

    case 'window:maximize': {
      const mainWindow = getMainWindow();
      if (!mainWindow) return false;
      if (mainWindow.isMaximized()) {
        mainWindow.restore();
        return false;
      } else {
        mainWindow.maximize();
        return true;
      }
    }

    case 'window:hideToTray': {
      hideToTray();
      return undefined;
    }

    case 'window:close': {
      const mainWindow = getMainWindow();
      if (!mainWindow) {
        app.quit();
        return undefined;
      }
      const minimizeOnClose = args[0] === true || getMinimizeOnCloseFromLocalStorage();
      if (aiTrayEnabledDefault && minimizeOnClose && !(app as any).isQuitting) {
        hideToTray();
      } else {
        mainWindow.destroy();
      }
      return undefined;
    }

    case 'window:isMaximized': {
      const mainWindow = getMainWindow();
      return mainWindow?.isMaximized() ?? false;
    }

    case 'tray:setAutoLaunch': {
      const [enable] = args;
      if (!isBoolean(enable)) {
        log(`IPC 参数校验失败: tray:setAutoLaunch enable=${String(enable)}`);
        return { success: false };
      }
      const ok = setAutoLaunch(enable);
      return { success: ok };
    }

    case 'tray:getAutoLaunch': {
      try {
        return app.getLoginItemSettings().openAtLogin;
      } catch {
        return false;
      }
    }

    case 'system:isPackaged': {
      return app.isPackaged;
    }

    case 'app:getVersion': {
      return app.getVersion();
    }
  }
}

export function setupIpc(): void {
  ALLOWED_CHANNELS.forEach((channel) => {
    ipcMain.handle(channel, async (event, ...args) => {
      try {
        if (!isAllowedChannel(channel)) {
          const err = new Error(`Unknown IPC channel: ${channel}`);
          log(err.message);
          throw err;
        }
        return await handleChannel(channel, args, event);
      } catch (err) {
        log(`IPC handler 错误 [${channel}]: ${(err as Error).message}`);
        throw err;
      }
    });
  });

  ipcMain.handle('__test_unknown_channel__', async () => {
    // 仅用于单测白名单校验逻辑
    if (!isAllowedChannel('dangerous:xxx' as string)) {
      throw new Error('Unknown IPC channel: dangerous:xxx');
    }
    return null;
  });
}
