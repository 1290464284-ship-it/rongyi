import { app, dialog, Menu, type MenuItemConstructorOptions } from 'electron';
import { autoUpdater } from 'electron-updater';
import { log, isDev } from './electron-core';
import { getMainWindow, showAboutDialog } from './window-manager';

export const buildAppMenu = (): void => {
  const mainWindow = getMainWindow();

  const menuTemplate: MenuItemConstructorOptions[] = [
    {
      label: '文件',
      submenu: [
        {
          label: '退出',
          accelerator: 'Ctrl+Q',
          click: () => app.quit(),
        },
      ],
    },
    {
      label: '编辑',
      submenu: [
        { label: '撤销', accelerator: 'Ctrl+Z', role: 'undo' },
        { label: '重做', accelerator: 'Ctrl+Y', role: 'redo' },
        { type: 'separator' },
        { label: '剪切', accelerator: 'Ctrl+X', role: 'cut' },
        { label: '复制', accelerator: 'Ctrl+C', role: 'copy' },
        { label: '粘贴', accelerator: 'Ctrl+V', role: 'paste' },
        { label: '全选', accelerator: 'Ctrl+A', role: 'selectAll' },
      ],
    },
    {
      label: '视图',
      submenu: [
        {
          label: '刷新',
          accelerator: 'Ctrl+R',
          click: () => mainWindow?.webContents.reload(),
        },
        ...(isDev ? [
          {
            label: '开发者工具',
            accelerator: 'F12',
            click: () => mainWindow?.webContents.openDevTools(),
          },
        ] : []),
        { type: 'separator' },
        { label: '切换全屏', accelerator: 'F11', role: 'togglefullscreen' },
      ],
    },
    {
      label: '帮助',
      submenu: [
        {
          label: '检查更新',
          click: () => {
            if (isDev) {
              dialog.showMessageBox({
                type: 'info',
                title: '检查更新',
                message: '开发模式不支持自动更新，请使用安装包部署后测试。',
              });
              return;
            }
            autoUpdater.checkForUpdates().then((result) => {
              if (!result) {
                dialog.showMessageBox({
                  type: 'info',
                  title: '检查更新',
                  message: '未检测到更新。',
                });
              }
            }).catch((err) => {
              dialog.showMessageBox({
                type: 'warning',
                title: '检查更新',
                message: '检查更新失败，请检查网络连接。\n\n' + (err as Error).message,
              });
            });
          },
        },
        { type: 'separator' },
        {
          label: '关于',
          click: () => showAboutDialog(),
        },
      ],
    },
  ];

  const menu = Menu.buildFromTemplate(menuTemplate);
  Menu.setApplicationMenu(menu);
};
