// opt-in 遥测（P3，默认关闭）：只上报聚合计数，绝不含患者/人员可识别信息。
// 沿用崩溃上报的白名单模式：V2_TELEMETRY_URL 必须 HTTPS 且匹配
// V2_ALLOWED_CRASH_REPORT_HOSTS，未配置即不启用；失败按指数退避重试有限次。
const fs = require('node:fs');
const https = require('node:https');
const path = require('node:path');
const { app } = require('electron');
const { isAllowedCrashReportUrl, CRASH_LOG_TIMEOUT_MS } = require('./constants.cjs');

const DEFAULT_INTERVAL_HOURS = 6;
const MAX_RETRIES = 2;
const RETRY_DELAYS_MS = [60_000, 600_000];

let timer = null;
let attempts = 0;

function allowedUrl() {
  const url = process.env.V2_TELEMETRY_URL;
  if (!url) return null;
  return isAllowedCrashReportUrl(url) ? url : null;
}

/** 聚合载荷：从 API 子进程落盘的 stability.json 读取体积/备份计数等指标。 */
function collectPayload() {
  let stability = {};
  try {
    const stabilityPath = path.join(app.getPath('userData'), 'logs', 'stability.json');
    const parsed = JSON.parse(fs.readFileSync(stabilityPath, 'utf8'));
    if (parsed && typeof parsed.stability === 'object') stability = parsed.stability;
  } catch {
    // 尚未生成（API 刚启动）时以空字段上报
  }
  return {
    appVersion: app.getVersion(),
    platform: process.platform,
    arch: process.arch,
    sampledAt: new Date().toISOString(),
    stability: {
      uptimeSeconds: typeof stability.uptimeSeconds === 'number' ? stability.uptimeSeconds : null,
      dbSizeBytes: typeof stability.dbSizeBytes === 'number' ? stability.dbSizeBytes : null,
      walSizeBytes: typeof stability.walSizeBytes === 'number' ? stability.walSizeBytes : null,
      backupCount: typeof stability.backupCount === 'number' ? stability.backupCount : null,
      logBytes: typeof stability.logBytes === 'number' ? stability.logBytes : null,
    },
  };
}

function upload() {
  const url = allowedUrl();
  if (!url) return;
  try {
    const request = https.request(
      url,
      { method: 'POST', headers: { 'content-type': 'application/json' }, timeout: CRASH_LOG_TIMEOUT_MS },
      (response) => {
        response.resume();
        attempts = 0;
      },
    );
    request.on('error', () => {
      attempts += 1;
      if (attempts < MAX_RETRIES) {
        setTimeout(() => upload(), RETRY_DELAYS_MS[attempts - 1]);
      }
    });
    request.on('timeout', () => request.destroy());
    request.end(JSON.stringify(collectPayload()));
  } catch {
    // best effort：遥测失败绝不影响应用
  }
}

function startTelemetry() {
  if (!allowedUrl()) return;
  if (timer) clearInterval(timer);
  const intervalHours = Number(process.env.V2_TELEMETRY_INTERVAL_HOURS) || DEFAULT_INTERVAL_HOURS;
  upload();
  timer = setInterval(upload, intervalHours * 60 * 60 * 1000);
  timer.unref?.();
}

function stopTelemetry() {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}

module.exports = { startTelemetry, stopTelemetry };
