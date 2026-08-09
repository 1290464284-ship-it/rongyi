const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('desktop', {
  version: () => ipcRenderer.invoke('desktop:version'),
  copyText: (text) => ipcRenderer.invoke('desktop:clipboard:write', String(text ?? '')),
  quit: () => ipcRenderer.invoke('desktop:quit'),
  getApiPort: () => ipcRenderer.invoke('desktop:api-port'),
  restartApi: () => ipcRenderer.invoke('desktop:restart-api'),
  setAutoLaunch: (enabled) => ipcRenderer.invoke('desktop:set-auto-launch', Boolean(enabled)),
  getAutoLaunch: () => ipcRenderer.invoke('desktop:get-auto-launch'),
  checkUpdates: () => ipcRenderer.invoke('desktop:check-updates'),
  // S-H1: 用户确认后显式触发更新包下载（autoDownload=false，下载不再自动开始）。
  downloadUpdate: () => ipcRenderer.invoke('desktop:download-update'),
  installUpdate: () => ipcRenderer.invoke('desktop:install-update'),
  onUpdateEvent: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('update:event', listener);
    return () => ipcRenderer.removeListener('update:event', listener);
  },
  onApiStatus: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('api:status', listener);
    return () => ipcRenderer.removeListener('api:status', listener);
  },
  secrets: {
    get: (key) => ipcRenderer.invoke('desktop:secret:get', key),
    set: (key, value) => ipcRenderer.invoke('desktop:secret:set', key, value),
    delete: (key) => ipcRenderer.invoke('desktop:secret:delete', key),
  },
});
