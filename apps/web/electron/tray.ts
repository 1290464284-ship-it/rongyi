import { app, Tray, Menu, nativeImage, dialog, Notification, type NativeImage } from 'electron';
import { existsSync } from 'fs';
import { join } from 'path';
import { getMainWindow, createWindow } from './window-manager';
import { log } from './electron-core';

let trayInstance: Tray | null = null;

function resolveTrayIcon(): NativeImage {
  try {
    const iconIcoPath = join(app.getAppPath(), 'build', 'icon.ico');
    if (existsSync(iconIcoPath)) {
      const img = nativeImage.createFromPath(iconIcoPath);
      if (!img.isEmpty()) return img;
    }

    const iconPngPath = join(app.getAppPath(), 'public', 'icon.png');
    if (existsSync(iconPngPath)) {
      const img = nativeImage.createFromPath(iconPngPath);
      if (!img.isEmpty()) return img;
    }

    const iconSvgPath = join(app.getAppPath(), 'public', 'icon.svg');
    if (existsSync(iconSvgPath)) {
      try {
        const img = nativeImage.createFromPath(iconSvgPath);
        if (!img.isEmpty()) return img;
      } catch {
        // SVG conversion not supported on all platforms, ignore
      }
    }
  } catch (err) {
    log(`托盘图标加载失败: ${(err as Error).message}`);
  }
  return nativeImage.createEmpty();
}

export function showMainWindow(): void {
  let mainWindow = getMainWindow();
  if (!mainWindow) {
    createWindow();
    mainWindow = getMainWindow();
  }
  if (mainWindow) {
    if (mainWindow.isMinimized()) {
      mainWindow.restore();
    }
    if (!mainWindow.isVisible()) {
      mainWindow.show();
    }
    mainWindow.focus();
  }
}

export function hideToTray(): void {
  const mainWindow = getMainWindow();
  if (mainWindow) {
    mainWindow.hide();
    try {
      if (Notification.isSupported()) {
        new Notification({
          title: '牙科管家',
          body: '已最小化到系统托盘',
          icon: resolveTrayIcon(),
        }).show();
      }
    } catch (err) {
      log(`托盘通知失败: ${(err as Error).message}`);
    }
  }
}

export function setAutoLaunch(enable: boolean): boolean {
  try {
    const settings: { openAtLogin: boolean; path?: string; openAsHidden?: boolean } = {
      openAtLogin: enable,
    };
    if (process.platform === 'win32') {
      settings.path = process.execPath;
      settings.openAsHidden = true;
    }
    app.setLoginItemSettings(settings);
    return true;
  } catch (err) {
    log(`设置开机自启失败: ${(err as Error).message}`);
    return false;
  }
}

function getAutoLaunch(): boolean {
  try {
    return app.getLoginItemSettings().openAtLogin;
  } catch {
    return false;
  }
}

export function setupTray(): void {
  try {
    const icon = resolveTrayIcon();
    trayInstance = new Tray(icon);
    trayInstance.setToolTip('牙科管家');

    const rebuildMenu = () => {
      const autoLaunchEnabled = getAutoLaunch();
      const contextMenu = Menu.buildFromTemplate([
        {
          label: '显示主窗口',
          click: () => {
            showMainWindow();
          },
        },
        {
          label: '今日统计…',
          click: () => {
            dialog.showMessageBox({
              type: 'info',
              title: '今日统计',
              message: '统计请在主界面查看',
              detail: '详细统计信息请打开主窗口，在首页仪表盘查看。',
            });
          },
        },
        { type: 'separator' },
        {
          label: '开机自启设置',
          submenu: [
            {
              label: '启用开机自启',
              type: 'checkbox',
              checked: autoLaunchEnabled,
              click: () => {
                const next = !getAutoLaunch();
                setAutoLaunch(next);
                rebuildMenu();
              },
            },
          ],
        },
        { type: 'separator' },
        {
          label: '退出程序',
          click: () => {
            app.quit();
          },
        },
      ]);
      trayInstance?.setContextMenu(contextMenu);
    };

    rebuildMenu();

    trayInstance.on('click', () => {
      showMainWindow();
    });

    trayInstance.on('right-click', () => {
      rebuildMenu();
      trayInstance?.popUpContextMenu();
    });

    log('系统托盘初始化完成');
  } catch (err) {
    log(`系统托盘初始化失败: ${(err as Error).message}`);
    trayInstance = null;
  }
}
