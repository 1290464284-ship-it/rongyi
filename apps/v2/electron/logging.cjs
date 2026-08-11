const { app, BrowserWindow, Notification } = require('electron');
const fs = require('node:fs');
const https = require('node:https');
const path = require('node:path');
const { CRASH_LOG_TIMEOUT_MS } = require('./constants.cjs');

function crashLog(message, error) {
  const entry = {
    timestamp: new Date().toISOString(),
    message,
    stack: String(error?.stack ?? error).split('\n').slice(0, 20).join('\n'),
  };
  try {
    const logDir = path.join(app.getPath('userData'), 'logs');
    fs.mkdirSync(logDir, { recursive: true });
    // 5MB×5 轮转（与 API 侧 logger 一致），防止 desktop.log 无限追加
    const logFile = path.join(logDir, 'desktop.log');
    const MAX_LOG_BYTES = 5 * 1024 * 1024;
    if (fs.existsSync(logFile) && fs.statSync(logFile).size >= MAX_LOG_BYTES) {
      for (let i = 4; i >= 1; i -= 1) {
        const rotated = `${logFile}.${i}`;
        if (fs.existsSync(rotated)) fs.renameSync(rotated, `${logFile}.${i + 1}`);
      }
      fs.renameSync(logFile, `${logFile}.1`);
    }
    fs.appendFileSync(logFile, JSON.stringify(entry) + '\n');
  } catch {
    // best effort
  }
  const endpoint = process.env.V2_CRASH_REPORT_URL;
  if (endpoint && !endpoint.startsWith('https://')) {
    console.warn('V2_CRASH_REPORT_URL must be an HTTPS endpoint; crash report upload skipped');
  }
  if (endpoint && endpoint.startsWith('https://')) {
    try {
      const request = https.request(
        endpoint,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          timeout: CRASH_LOG_TIMEOUT_MS,
        },
        (response) => response.resume(),
      );
      request.on('error', () => {});
      request.on('timeout', () => request.destroy());
      request.end(JSON.stringify(entry));
    } catch {
      // best effort
    }
  }
}

// T2R-22 遗留④：可用明文判定——长度达标且不含控制字符（NUL 会让子进程
// spawn 环境校验失败，进入错误窗循环）。旧明文密钥（safeStorage 引入前）
// 均为 ASCII 可打印串，损坏的密文 blob 几乎必然含控制字符或被 UTF-8 替换。
function notify(title, body) {
  if (Notification.isSupported()) {
    new Notification({ title, body }).show();
  }
}

function sendToRenderers(channel, payload) {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send(channel, payload);
  }
}

function sendUpdateEvent(payload) {
  sendToRenderers('update:event', payload);
}

function sendApiStatus(payload) {
  sendToRenderers('api:status', payload);
}

process.on('uncaughtException', (error) => {
  crashLog('uncaughtException', error);
  // 未捕获异常后进程状态不可信，记完日志必须退出，避免带病继续运行。
  try {
    app.exit(1);
  } catch {
    process.exit(1);
  }
});
process.on('unhandledRejection', (reason) => crashLog('unhandledRejection', reason));


module.exports = { crashLog, notify, sendUpdateEvent, sendApiStatus };
