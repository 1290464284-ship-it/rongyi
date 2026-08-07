// Mutable process state shared by Electron main modules.
module.exports = {
  apiProcess: null,
  apiPort: null,
  isQuitting: false,
  shutdownStarted: false,
  tray: null,
  apiRestartCount: 0,
  apiLastCrashAt: 0,
  apiHeartbeatTimer: null,
  apiEverReady: false,
  apiLastHealthError: null,
  apiSpawnedAt: 0,
};

