import { dialog } from 'electron';
import { autoUpdater } from 'electron-updater';
import { log, isDev } from './electron-core';

export const setupAutoUpdater = (): void => {
  if (isDev) return;

  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.checkForUpdates().catch((err) => {
    log('自动更新检查失败: ' + (err as Error).message);
  });

  autoUpdater.on('update-available', (info) => {
    log(`发现新版本: ${info.version}`);
    dialog.showMessageBox({
      type: 'info',
      title: '发现新版本',
      message: `牙科管家 v${info.version} 已发布，正在下载更新...`,
      buttons: ['好的'],
    });
    autoUpdater.downloadUpdate();
  });

  autoUpdater.on('update-not-available', (info) => {
    log(`当前已是最新版本: ${info.version}`);
  });

  autoUpdater.on('update-downloaded', (info) => {
    log(`新版本已下载: ${info.version}`);
    dialog.showMessageBox({
      type: 'info',
      title: '更新就绪',
      message: `牙科管家 v${info.version} 已准备就绪，重启后生效。`,
      buttons: ['立即重启', '稍后重启'],
    }).then(({ response }) => {
      if (response === 0) {
        autoUpdater.quitAndInstall();
      }
    });
  });

  autoUpdater.on('error', (err) => {
    log('自动更新错误: ' + err.message);
  });
};
