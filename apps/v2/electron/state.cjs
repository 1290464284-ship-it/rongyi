// Mutable process state shared by Electron main modules.
module.exports = {
  apiProcess: null,
  // E-1：停止中的 API 进程引用。stopApi 置空 apiProcess 后、子进程真正退出前，
  // terminateApiSync 仍可据此强杀（关闭宽限窗口内的孤儿兜底）。
  stoppingProcess: null,
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

