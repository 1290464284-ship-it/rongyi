const { app, Tray, Menu, nativeImage, BrowserWindow } = require('electron');
const path = require('node:path');
const state = require('./state.cjs');
const { ensureApiServerRunning } = require('./api-process.cjs');
const { crashLog, notify } = require('./logging.cjs');
const { createWindow } = require('./window.cjs');

function trayImage() {
  const iconPath = path.join(__dirname, '..', 'build', 'icon.ico');
  try {
    if (fs.existsSync(iconPath)) {
      const image = nativeImage.createFromPath(iconPath);
      if (!image.isEmpty()) return image.resize({ width: 20, height: 20 });
    }
  } catch {
    // fall through to a built-in placeholder
  }
  return nativeImage.createFromDataURL(
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  );
}

function setupTray() {
  state.tray = new Tray(trayImage());
  state.tray.setToolTip('口腔诊所管理系统');
  const showAndFocusWindow = () => {
    const win = BrowserWindow.getAllWindows()[0];
    if (win) {
      if (win.isMinimized()) win.restore();
      win.show();
      win.focus();
    } else {
      createWindow();
    }
  };
  state.tray.setContextMenu(
    Menu.buildFromTemplate([
      {
        label: '显示主窗口',
        click: () => {
          ensureApiServerRunning()
            .then(showAndFocusWindow)
            .catch((error) => {
              crashLog('state.tray-show-api-error', error);
              notify('服务启动失败', error instanceof Error ? error.message : String(error));
            });
        },
      },
      { type: 'separator' },
      {
        label: '退出',
        click: () => app.quit(),
      },
    ]),
  );
  state.tray.on('click', () => {
    ensureApiServerRunning()
      .then(showAndFocusWindow)
      .catch((error) => {
        crashLog('state.tray-click-api-error', error);
        notify('服务启动失败', error instanceof Error ? error.message : String(error));
      });
  });
}


module.exports = { setupTray };
