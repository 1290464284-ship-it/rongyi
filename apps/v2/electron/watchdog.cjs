const fs = require('node:fs');
const path = require('node:path');
const { app } = require('electron');
// 顶层 require（非延迟）：api-process → logging 无环依赖，且让单测能在
// loadElectronModule 的 mock 窗口内注入终止函数。
const { terminateApiSync } = require('./api-process.cjs');

const WATCHDOG_WINDOW_MS = 10 * 60 * 1000; // 10 分钟崩溃环窗口
const WATCHDOG_MAX_RESTARTS = 3;           // 窗口内最多自动重启 3 次

function crashLoopPath() {
  return path.join(app.getPath('userData'), 'crash-loop.json');
}

function readCrashLoop() {
  try {
    const parsed = JSON.parse(fs.readFileSync(crashLoopPath(), 'utf8'));
    return { count: Number(parsed.count) || 0, windowStart: Number(parsed.windowStart) || 0 };
  } catch {
    return { count: 0, windowStart: 0 };
  }
}

function writeCrashLoop(state) {
  try {
    fs.writeFileSync(crashLoopPath(), JSON.stringify(state), 'utf8');
  } catch {
    // best effort：计数文件写失败只影响重启上限，不阻塞退出/重启主流程
  }
}

/**
 * 崩溃后是否允许自动重启。窗口内计数，超过上限则写停止标记（同时让外部
 * supervisor 放弃拉起），避免崩溃→重启的无限循环。
 */
function shouldRelaunch(stopMarkerPath) {
  const now = Date.now();
  const current = readCrashLoop();
  if (now - current.windowStart > WATCHDOG_WINDOW_MS) {
    writeCrashLoop({ count: 1, windowStart: now });
    return true;
  }
  const count = current.count + 1;
  if (count > WATCHDOG_MAX_RESTARTS) {
    try {
      fs.writeFileSync(stopMarkerPath, String(now), 'utf8');
    } catch {
      // best effort
    }
    return false;
  }
  writeCrashLoop({ count, windowStart: current.windowStart });
  return true;
}

/**
 * 崩溃路径：尽力同步终止 API 子进程，然后 relaunch。
 * 返回 false 表示达到崩溃环上限（调用方应以 app.exit 兜底）。
 */
function relaunchAfterCrash(stopMarkerPath) {
  if (!shouldRelaunch(stopMarkerPath)) return false;
  try {
    // relaunch 前先硬停 API 子进程，让新实例通过孤儿防护/单实例锁接管，
    // 不留旧进程写库。
    terminateApiSync();
  } catch {
    // best effort：relaunch 后新实例仍会按孤儿防护处理旧进程
  }
  try {
    app.relaunch({ execPath: process.execPath });
  } catch {
    return false;
  }
  app.exit(1);
  return true;
}

module.exports = { relaunchAfterCrash };
