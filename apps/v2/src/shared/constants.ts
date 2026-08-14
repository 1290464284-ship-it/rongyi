// L-01/L-03：端口、URL 与备份默认值唯一来源。
//
// 消费方：
// - src/server/main.ts（API 监听端口、自动备份间隔/保留数）
// - vite.config.ts（dev 端口、API 代理端口）
// - electron/main.cjs（dev 渲染端 URL 默认值，见该文件顶部注释：纯 CJS
//   无法 import 本模块，保留数值副本并通过 V2_WEB_DEV_PORT 覆盖）
// - .env.example（文档）
//
// 默认值均可被环境变量覆盖（V2_PORT / V2_WEB_DEV_PORT / V2_WEB_URL /
// V2_AUTO_BACKUP_INTERVAL_MS / V2_AUTO_BACKUP_KEEP / V2_BACKUP_MIRROR_DIR /
// V2_BACKUP_MIRROR_KEEP）。

/** V2 API 默认监听端口（V2_PORT 可覆盖；Windows 上若被 excludedportranges 占用请改值）。 */
export const DEFAULT_API_PORT = Number(process.env.V2_PORT) || 3180;

/** Vite dev server 默认端口（V2_WEB_DEV_PORT 可覆盖；electron dev 模式与 CSP 白名单同源）。 */
export const DEFAULT_WEB_DEV_PORT = Number(process.env.V2_WEB_DEV_PORT) || 5180;

/** 自动备份默认间隔：24 小时（V2_AUTO_BACKUP_INTERVAL_MS 可覆盖，下限 60s）。 */
export const DEFAULT_AUTO_BACKUP_INTERVAL_MS = 24 * 60 * 60 * 1000;

/** 自动备份默认保留份数（V2_AUTO_BACKUP_KEEP 可覆盖，钳制 1-365）。 */
export const DEFAULT_AUTO_BACKUP_KEEP = 30;
