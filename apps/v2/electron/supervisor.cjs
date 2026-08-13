// 由 main.cjs 以 ELECTRON_RUN_AS_NODE=1 启动：
// argv = [appExe, parentPid, stopMarker, relaunchArgsJson?]
// relaunchArgsJson 为可选 JSON 数组（生产不传 → 空数组；smoke 用它传脚本路径）。
const fs = require('node:fs');
const { spawn } = require('node:child_process');

const [appExe, parentPidStr, stopMarker, relaunchArgsJson] = process.argv.slice(2);
// 常驻诊断（生产以 stdio: 'ignore' 启动，无输出；调试时可见）
console.error('[supervisor] argv:', JSON.stringify(process.argv.slice(2)));
const parentPid = Number(parentPidStr);
if (!appExe || !Number.isFinite(parentPid)) process.exit(0);

let relaunchArgs = [];
if (relaunchArgsJson) {
  try {
    const parsed = JSON.parse(relaunchArgsJson);
    if (Array.isArray(parsed)) relaunchArgs = parsed.map(String);
  } catch {
    relaunchArgs = [];
  }
}

const POLL_MS = 2000;
const BACKOFF_MS = [1000, 5000, 15000];
const MAX_CONSECUTIVE = 3;
let consecutive = 0;

const DEBUG = process.env.V2_SUPERVISOR_DEBUG === '1';
function debug(...args) {
  if (DEBUG) console.log('[supervisor]', ...args);
}

function parentAlive() {
  try {
    process.kill(parentPid, 0);
    return true;
  } catch {
    return false;
  }
}

setInterval(() => {
  // 注意：绝不能 unref 轮询定时器——它是 supervisor 唯一的事件循环引用，
  // unref 后进程会在首次 tick 前立即退出，看门狗形同虚设。
  try {
    if (fs.existsSync(stopMarker)) {
      debug('stop marker found; exiting');
      try {
        fs.rmSync(stopMarker, { force: true });
      } catch {
        // best effort
      }
      process.exit(0);
    }
  } catch {
    // userData 不可读时继续按父进程存活判断
  }
  if (parentAlive()) {
    consecutive = 0;
    debug('parent alive; resetting counter');
    return;
  }
  consecutive += 1;
  debug('parent dead; consecutive =', consecutive);
  if (consecutive > MAX_CONSECUTIVE) {
    // 连续拉起失败：放弃，等待用户干预（避免重启风暴）
    process.exit(2);
  }
  const delay = BACKOFF_MS[Math.min(consecutive - 1, BACKOFF_MS.length - 1)];
  setTimeout(() => {
    try {
      const env = { ...process.env, V2_SUPERVISED: '1' };
      delete env.ELECTRON_RUN_AS_NODE;
      const child = spawn(appExe, relaunchArgs, { detached: true, stdio: 'ignore', env, windowsHide: true });
      child.unref();
      debug('relaunched', appExe, relaunchArgs);
    } catch (error) {
      debug('relaunch spawn failed', error);
      // best effort
    }
    process.exit(0);
  }, delay);
}, POLL_MS);
// 注意：绝不能 unref 轮询定时器——它是 supervisor 唯一的事件循环引用，
// unref 后进程会在首次 tick 前立即退出，看门狗形同虚设。
