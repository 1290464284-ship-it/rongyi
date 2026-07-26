/**
 * 前端应用级配置常量
 *
 * 集中管理端口、API 地址、超时等硬编码值。
 */

// 默认端口
export const DEFAULT_API_PORT = 3001;
export const DEFAULT_WEB_PORT = 5173;

// Electron 主进程 API 管理
export const API_STARTUP_MAX_RETRIES = 30;
export const API_STARTUP_RETRY_DELAY_MS = 1000;
export const API_RESTART_DELAY_MS = 3000;
export const API_FORCE_KILL_TIMEOUT_MS = 5000;

// 日志
export const ERROR_LOG_FLUSH_INTERVAL_MS = 5000;
export const MAX_ERROR_LOGS = 100;
export const MAX_ERROR_LOG_RETRY_COUNT = 3;
export const ELECTRON_LOG_ROTATION = {
  MAX_LOG_SIZE_BYTES: 5 * 1024 * 1024, // 5MB
  MAX_LOG_FILES: 3,
} as const;

// 请求重试
export const API_MAX_RETRIES = 1;
export const API_RETRY_DELAY_MS = 1000;
export const API_REQUEST_TIMEOUT_MS = 30000;

// 认证重定向
export const LOGOUT_REDIRECT_DELAY_MS = 1000;

// UI 动画与交互
export const UI_ANIMATION_DURATION_MS = 200;
export const UI_DEBOUNCE_DELAY_MS = 200;

// 下拉选择器/对话框等一次性加载全部数据的默认分页大小
export const DROPDOWN_MAX_PAGE_SIZE = 200;
