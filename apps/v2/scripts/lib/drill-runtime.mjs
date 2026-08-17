import { spawn } from 'node:child_process';
import fs from 'node:fs';

/**
 * drill/smoke 公共运行时：统一单实例 API 进程的 baseEnv / startApi /
 * stopApi / request / waitForApi / assert，消除 delivery/disaster/crash/
 * legacy-dirty/http-fuzz/permission/soak 等脚本里逐字复制的 ~8 个函数。
 *
 * 约定（与各脚本现状保持一致）：
 * - 端口由调用方用 lib/smoke-runtime.mjs 的 pickFreePort 探测（本模块不碰端口）。
 * - request 只做「成功」语义解析：`response.ok && body.success` 才返回 `body.data`，
 *   否则抛 `${method} ${pathname}: ${status} ${JSON.stringify(body)}`——该消息格式被
 *   多个脚本的断言/日志依赖，勿改。
 * - stopApi 以更稳版本为准：等 exit 事件 + 5s SIGKILL 兜底（用 exitCode/signalCode
 *   判断，而非 `child.killed`，避免 kill 后 killed=true 导致兜底失效）。
 */

/** 断言：条件不成立即抛错（保持各脚本原始语义）。 */
export function assert(condition, message) {
  if (!condition) throw new Error(message);
}

/**
 * 创建绑定到单一配置的单实例 drill 运行时。
 *
 * @param {object} config
 * @param {string} config.appRoot 进程 cwd
 * @param {string} config.serverScript dist-electron/server.cjs 绝对路径
 * @param {string} config.legacyDb V2_LEGACY_DB_PATH（legacy-dirty 传脏库副本）
 * @param {string} config.legacySchemaDir V2_LEGACY_SCHEMA_DIR
 * @param {string} config.dataDir V2_DATA_DIR
 * @param {string} config.backupDir V2_BACKUP_DIR
 * @param {string} config.logDir V2_LOG_DIR
 * @param {number} config.port V2_PORT（字符串化后注入）
 * @param {string} config.jwtSecret V2_JWT_SECRET
 * @param {string} config.backupKey V2_BACKUP_KEY
 * @param {string} config.adminPassword V2_ADMIN_PASSWORD
 * @param {string} [config.dbPath] 可选 V2_DB_PATH（delivery/http-fuzz 显式指定）
 * @param {object} [config.envExtra] 额外环境变量，合并进 baseEnv（overrides 之前）
 * @param {string[]} [config.stdio] 非捕获 stderr 时的 spawn stdio，默认 ['ignore','inherit','inherit']
 * @param {boolean} [config.captureStderr] 为 true 时 stdio 改用 ['ignore','pipe','pipe'] 并收集 stderr
 * @param {number} [config.waitTimeoutMs] waitForApi 默认超时，默认 30_000
 * @param {string} [config.readyLabel] waitForApi 超时错误消息里的场景名
 */
export function createDrill({
  appRoot,
  serverScript,
  legacyDb,
  legacySchemaDir,
  dataDir,
  backupDir,
  logDir,
  port,
  jwtSecret,
  backupKey,
  adminPassword,
  dbPath,
  envExtra = {},
  stdio = ['ignore', 'inherit', 'inherit'],
  captureStderr = false,
  waitTimeoutMs = 30_000,
  readyLabel = 'drill',
}) {
  const base = `http://127.0.0.1:${port}/api/v2`;

  const runtime = {
    /** 当前 API 子进程；spawnApi/startApi 会写入，自定义 spawn 的脚本也可直接赋值。 */
    apiProcess: null,

    /** API 基地址，供自定义 request/rawRequest 复用。 */
    base,

    baseEnv(overrides = {}) {
      return {
        ...process.env,
        V2_PORT: String(port),
        V2_HOST: '127.0.0.1',
        NODE_ENV: 'development',
        V2_DATA_DIR: dataDir,
        V2_BACKUP_DIR: backupDir,
        V2_LOG_DIR: logDir,
        V2_LEGACY_DB_PATH: legacyDb,
        V2_LEGACY_SCHEMA_DIR: legacySchemaDir,
        V2_JWT_SECRET: jwtSecret,
        V2_BACKUP_KEY: backupKey,
        V2_ADMIN_PASSWORD: adminPassword,
        ...(dbPath ? { V2_DB_PATH: dbPath } : {}),
        ...envExtra,
        ...overrides,
      };
    },

    waitForApi(timeoutMs = waitTimeoutMs) {
      const startedAt = Date.now();
      return new Promise((resolve, reject) => {
        const attempt = async () => {
          if (Date.now() - startedAt > timeoutMs) {
            reject(new Error(`API did not become ready during ${readyLabel}`));
            return;
          }
          try {
            const response = await fetch(`${base}/health`, { signal: AbortSignal.timeout(1000) });
            if (response.ok) {
              resolve();
              return;
            }
          } catch {
            // retry
          }
          setTimeout(() => void attempt(), 500);
        };
        void attempt();
      });
    },

    /** 仅 spawn（mkdir + 启动），不等待就绪；返回 stderr reader（未捕获时 undefined）。 */
    spawnApi(overrides = {}) {
      fs.mkdirSync(dataDir, { recursive: true });
      fs.mkdirSync(backupDir, { recursive: true });
      fs.mkdirSync(logDir, { recursive: true });
      runtime.apiProcess = spawn(process.execPath, [serverScript], {
        cwd: appRoot,
        env: runtime.baseEnv(overrides),
        stdio: captureStderr ? ['ignore', 'pipe', 'pipe'] : stdio,
        windowsHide: true,
      });
      let stderr = '';
      if (captureStderr) {
        runtime.apiProcess.stderr.on('data', (chunk) => {
          stderr += String(chunk);
        });
      }
      return captureStderr ? () => stderr : undefined;
    },

    /** spawn + 等待就绪；返回 stderr reader（未捕获时 undefined）。 */
    async startApi(overrides = {}) {
      const stderrReader = runtime.spawnApi(overrides);
      await runtime.waitForApi();
      return stderrReader;
    },

    stopApi() {
      return new Promise((resolve) => {
        const target = runtime.apiProcess;
        if (!target || target.exitCode !== null || target.signalCode !== null) {
          resolve();
          return;
        }
        target.once('exit', resolve);
        target.kill();
        setTimeout(() => {
          if (target.exitCode === null && target.signalCode === null) target.kill('SIGKILL');
        }, 5000).unref();
      });
    },

    async request(pathname, options = {}, token = null) {
      const headers = { 'content-type': 'application/json', ...(options.headers ?? {}) };
      if (token) headers.authorization = `Bearer ${token}`;
      const response = await fetch(`${base}${pathname}`, { ...options, headers });
      const body = await response.json().catch(() => null);
      if (!response.ok || !body?.success) {
        throw new Error(`${options.method ?? 'GET'} ${pathname}: ${response.status} ${JSON.stringify(body)}`);
      }
      return body.data;
    },

    assert,
  };

  return runtime;
}
