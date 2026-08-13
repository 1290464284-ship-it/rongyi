const { app } = require('electron');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const isDev = !app.isPackaged;
const API_MAX_RESTARTS = 5;
const API_BACKOFF_BASE_MS = 30_000;
const API_BACKOFF_MAX_MS = 300_000;
// L-01：端口与 URL 默认值唯一副本。main.cjs 是纯 CJS、不经 TS 编译，无法
// import src/shared/constants.ts（DEFAULT_WEB_DEV_PORT=5180），故在此保留
// 数值副本；V2_WEB_DEV_PORT / V2_WEB_URL 可覆盖，与 vite.config.ts 同源。
const V2_WEB_DEV_PORT = Number(process.env.V2_WEB_DEV_PORT) || 5180;
const WEB_DEV_ORIGIN = process.env.V2_WEB_URL || `http://localhost:${V2_WEB_DEV_PORT}`;
// L-03：魔法数字命名化。
const CRASH_LOG_TIMEOUT_MS = 3000;
const RANDOM_API_PORT_MIN = 30000;
const RANDOM_API_PORT_MAX = 50000;
const API_READY_TIMEOUT_MS = 30000;
// T2R-13 / R2-P1-09: parent-side heartbeat. Must stay well below the child's
// PARENT_HEARTBEAT_TIMEOUT_MS (10s) so a hard-killed main process stops pinging
// and the API child exits on its own instead of running as an orphan.
const API_HEARTBEAT_INTERVAL_MS = 2_000;
const DEFAULT_WINDOW_STATE = { width: 1280, height: 820 };
// T2R-14 / R2-P1-11: two-level API readiness window. The first check of a
// freshly launched API process uses the same generous window as startApi()'s
// initial wait (30s) so a slow start or an event loop busy with a long
// transaction / big import is never mistaken for a dead process. Steady-state
// checks after the process has been observed ready use a short window so a
// genuinely hung API is restarted quickly. With a 500ms per-attempt HTTP
// timeout and a 400ms retry gap, the strict window still allows 2 full
// attempts plus a third opportunity before rejecting, while a true hang is
// detected in ~2.3s.
const API_READY_WINDOW_FIRST_MS = 30_000;
const API_READY_WINDOW_STRICT_MS = 2_000;
const ALLOWED_SECRET_KEYS = new Set(['v2.token', 'v2.refreshToken']);
// T2R-22: 渲染器经 HashRouter 导航后 URL 恒带 #/... 片段（dev 下还有 ?/ # 查询），
// 错误窗经 loadFile 带 ?msg= 查询串；这些都属于同文档导航，不引入新来源，
// 因此放行 [?#] 后缀并显式放行 error.html，否则受保护 IPC 全部被误拒。
// S-L1（第七轮）：不再用 `^file:\/\/.*dist-web[\\/]index\.html` 的 `.*` 前缀通配
// （任意路径下的同名文件都会被当作可信渲染器），改为按打包/开发实际加载路径
// 生成的精确 file:// URL 前缀匹配：生产 index.html 与错误窗 error.html 均以
// __dirname 为基准计算（与 createWindow/showApiErrorWindow 的加载路径同源），
// dev 保留 localhost:5180（V2_WEB_URL 覆盖时亦沿用历史行为）。
const INDEX_HTML_FILE_URL = pathToFileURL(path.join(__dirname, '..', 'dist-web', 'index.html')).href;
const ERROR_HTML_FILE_URL = pathToFileURL(path.join(__dirname, 'error.html')).href;
// 生产打包版运行时加载的 HTML：window.cjs 会把 dist-web 复制到 userData 并
// 把 meta CSP 的 http://127.0.0.1:* 替换为当前 API 精确端口（asar 只读无法改写），
// 因此该 URL 也属于可信渲染器/导航白名单。
const RUNTIME_INDEX_HTML_FILE_URL = pathToFileURL(
  path.join(app.getPath('userData'), 'cache', 'dist-web', 'index.html'),
).href;
// Round8 fix: derive the trusted dev renderer URL from WEB_DEV_ORIGIN so
// V2_WEB_DEV_PORT / V2_WEB_URL overrides keep IPC handlers working.
// V2_WEB_URL 可带路径（如 http://localhost:5180/app）；按 origin + pathname
// 精确匹配，避免只信任根路径导致配置了子路径的开发源被误拒。
const devUrl = new URL(WEB_DEV_ORIGIN);
const devBase = `${devUrl.origin}${devUrl.pathname === '/' ? '' : devUrl.pathname}`;
const DEV_WEB_URL_PATTERN = new RegExp(
  `^${devBase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:[/?#].*)?$`,
);

function isAllowedCrashReportUrl(url) {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:') return false;
    const allowed = String(process.env.V2_ALLOWED_CRASH_REPORT_HOSTS ?? '')
      .split(',')
      .map((host) => host.trim())
      .filter(Boolean);
    // 未配置允许名单时 fail-closed：崩溃报告可能包含栈与本地路径，绝不默认外发。
    return allowed.includes(parsed.hostname);
  } catch {
    return false;
  }
}


module.exports = {
  isDev,
  WEB_DEV_ORIGIN,
  CRASH_LOG_TIMEOUT_MS,
  API_MAX_RESTARTS,
  API_BACKOFF_BASE_MS,
  API_BACKOFF_MAX_MS,
  RANDOM_API_PORT_MIN,
  RANDOM_API_PORT_MAX,
  API_READY_TIMEOUT_MS,
  API_HEARTBEAT_INTERVAL_MS,
  DEFAULT_WINDOW_STATE,
  API_READY_WINDOW_FIRST_MS,
  API_READY_WINDOW_STRICT_MS,
  ALLOWED_SECRET_KEYS,
  INDEX_HTML_FILE_URL,
  ERROR_HTML_FILE_URL,
  RUNTIME_INDEX_HTML_FILE_URL,
  DEV_WEB_URL_PATTERN,
  isAllowedCrashReportUrl,
};
