import { contextBridge, app, ipcRenderer } from 'electron';
import { platform, arch } from 'os';
import { CLINIC_TIMEZONE } from '@dental/shared';

const windowActions = {
  minimize: () => ipcRenderer.invoke('window:minimize'),
  toggleMaximize: () => ipcRenderer.invoke('window:maximize'),
  getIsMaximized: (): Promise<boolean> => ipcRenderer.invoke('window:isMaximized'),
  closeOrHideToTray: (opts?: { minimizeOnClose?: boolean }) => {
    try {
      const flagFromOpts = opts && typeof opts.minimizeOnClose === 'boolean';
      const minimizeOnClose = flagFromOpts
        ? opts!.minimizeOnClose!
        : localStorage.getItem('dental.desktop.minimizeOnClose') === 'true';
      return ipcRenderer.invoke('window:close', minimizeOnClose);
    } catch {
      return ipcRenderer.invoke('window:close', false);
    }
  },
  hideToTray: () => ipcRenderer.invoke('window:hideToTray'),
};

const tray = {
  setAutoLaunch: (enable: boolean): Promise<{ success: boolean }> =>
    ipcRenderer.invoke('tray:setAutoLaunch', enable),
  getAutoLaunch: (): Promise<boolean> => ipcRenderer.invoke('tray:getAutoLaunch'),
};

const system = {
  get isPackaged(): boolean {
    return app.isPackaged;
  },
  platform: platform(),
  arch: arch(),
  get appVersion(): string {
    return app.getVersion();
  },
};

const bridge = {
  platform: platform(),
  arch: arch(),
  get appVersion(): string {
    return app.getVersion();
  },
  get isPackaged(): boolean {
    return app.isPackaged;
  },
  clinicTimezone: CLINIC_TIMEZONE,
  windowActions,
  tray,
  system,
} as const;

try {
  contextBridge.exposeInMainWorld('dentalBridge', bridge);
} catch (err) {
  console.error('[preload] contextBridge 暴露失败:', (err as Error).message);
}
