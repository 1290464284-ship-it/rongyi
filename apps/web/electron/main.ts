import { app, BrowserWindow, dialog } from 'electron';
import { log, logPath, setupErrorHandlers } from './electron-core';
import { startApiServer, stopApi } from './api-server';
import { createWindow, getMainWindow } from './window-manager';
import { buildAppMenu } from './app-menu';
import { setupAutoUpdater } from './auto-updater';
import { setupTray, hideToTray } from './tray';
import { setupIpc } from './ipc-channels';

const aiTrayEnabledDefault = true;

setupErrorHandlers();

const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    const mainWindow = getMainWindow();
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
      await startApiServer();
      buildAppMenu();
      setupIpc();
      createWindow();
      setupAutoUpdater();
      setupTray();

      const mainWindow = getMainWindow();
      if (mainWindow) {
        mainWindow.on('close', (event) => {
          if (aiTrayEnabledDefault && !(app as any).isQuitting) {
            event.preventDefault();
            hideToTray();
          }
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

app.on('before-quit', () => {
  (app as any).isQuitting = true;
  stopApi();
});

app.on('window-all-closed', () => {
  stopApi();
  if (process.platform !== 'darwin' && !aiTrayEnabledDefault) {
    app.quit();
  }
});
