import { app, BrowserWindow, dialog } from 'electron';
import { log, logPath, setupErrorHandlers } from './electron-core';
import { startApiServer, stopApi } from './api-server';
import { createWindow, getMainWindow } from './window-manager';
import { buildAppMenu } from './app-menu';
import { setupAutoUpdater } from './auto-updater';

// 全局错误处理（尽早注册）
setupErrorHandlers();

// 单实例锁，防止多实例同时运行
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    // 有人试图运行第二个实例，我们应该聚焦到我们的窗口
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
      createWindow();
      setupAutoUpdater();

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

app.on('window-all-closed', () => {
  stopApi();
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', () => {
  stopApi();
});
