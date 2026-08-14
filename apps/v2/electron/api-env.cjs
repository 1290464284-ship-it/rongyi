const path = require('node:path');

/**
 * API 子进程环境构造。独立成模块是为了让单元测试可以直接校验环境变量，
 * 同时避免 Electron 主进程链在 knip 下产生“导出未被使用”的误报。
 */
function buildApiChildEnv({ userDataDir, legacyBase, secretFilePath, apiPort, isPackaged, appVersion }) {
  const env = {
    V2_PORT: String(apiPort),
    V2_HOST: '127.0.0.1',
    NODE_ENV: isPackaged ? 'production' : 'development',
    // P0-CORS: 打包版渲染器来源是 file:///opaque null，API 需据此放行 CORS。
    V2_ELECTRON_RENDERER: isPackaged ? '1' : '0',
    // A-P3.1: 应用版本注入 API 子进程，供 health.json / 健康快照使用。
    V2_APP_VERSION: String(appVersion ?? 'unknown'),
    V2_DATA_DIR: path.join(userDataDir, 'data'),
    V2_BACKUP_DIR: path.join(userDataDir, 'backups'),
    V2_LOG_DIR: path.join(userDataDir, 'logs'),
    V2_LEGACY_DB_PATH: path.join(legacyBase, 'dental.sqlite'),
    V2_LEGACY_SCHEMA_DIR: path.join(legacyBase, 'schema'),
    V2_SECRET_FILE: secretFilePath,
    ELECTRON_RUN_AS_NODE: '1',
  };
  // 显式白名单：只透传 API 实际需要的可选配置，避免未来新增 V2_* 时无意把
  // 密钥、路径或明文备份开关泄漏给子进程。JWT/备份密钥只经 V2_SECRET_FILE。
  // dev 态 CORS 白名单依赖 V2_WEB_DEV_PORT / V2_WEB_URL（app.ts 读取），
  // smoke:all 随机端口场景必须透传，否则渲染器来源被 CORS 拒绝。
  const optionalKeys = [
    'V2_AUTO_BACKUP_INTERVAL_MS',
    'V2_AUTO_BACKUP_KEEP',
    'V2_BACKUP_MIRROR_DIR',
    'V2_BACKUP_MIRROR_KEEP',
    'V2_SYNC_CHANGE_RETENTION_DAYS',
    'V2_CORS_ORIGIN',
    'V2_WECHAT_API_URL',
    'V2_WECHAT_APP_ID',
    'V2_WEB_DEV_PORT',
    'V2_WEB_URL',
  ];
  for (const key of optionalKeys) {
    if (process.env[key] !== undefined) env[key] = process.env[key];
  }
  // 首启引导密码只对开发态透传；打包版管理员已存在，避免明文进子进程环境。
  if (!isPackaged && process.env.V2_ADMIN_PASSWORD !== undefined) {
    env.V2_ADMIN_PASSWORD = process.env.V2_ADMIN_PASSWORD;
  }
  return env;
}

module.exports = { buildApiChildEnv };
