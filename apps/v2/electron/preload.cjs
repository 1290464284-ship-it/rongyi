const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('desktop', {
  version: () => ipcRenderer.invoke('desktop:version'),
  getApiPort: () => ipcRenderer.invoke('desktop:api-port'),
  restartApi: () => ipcRenderer.invoke('desktop:restart-api'),
  setAutoLaunch: (enabled) => ipcRenderer.invoke('desktop:set-auto-launch', Boolean(enabled)),
  getAutoLaunch: () => ipcRenderer.invoke('desktop:get-auto-launch'),
  checkUpdates: () => ipcRenderer.invoke('desktop:check-updates'),
  secrets: {
    get: (key) => ipcRenderer.invoke('desktop:secret:get', key),
    set: (key, value) => ipcRenderer.invoke('desktop:secret:set', key, value),
    delete: (key) => ipcRenderer.invoke('desktop:secret:delete', key),
  },
});
