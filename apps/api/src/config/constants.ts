/**
 * 应用级配置常量
 *
 * 集中管理端口、超时、阈值等硬编码值，避免魔法数字散落在各处。
 */

// 默认端口
export const DEFAULT_API_PORT = 3001;
export const DEFAULT_WEB_PORT = 5173;

// 默认开发环境 CORS 来源
export const DEFAULT_CORS_ORIGINS = [
  `http://localhost:${DEFAULT_WEB_PORT}`,
  `http://localhost:${DEFAULT_API_PORT}`,
] as const;

// JWT / 认证
export const JWT_EXPIRES_IN = '7d';
export const ACCESS_TOKEN_MAX_AGE_MS = 3600 * 1000; // 1 hour
export const REFRESH_TOKEN_MAX_AGE_MS = 7 * 24 * 3600 * 1000; // 7 days
export const BCRYPT_ROUNDS_DEFAULT = 10;

// 登录安全策略
export const LOGIN_MAX_ATTEMPTS = 5;
export const LOGIN_LOCK_DURATION_MS = 30 * 60 * 1000; // 30 分钟

// Token 有效期（auth.service 实际签发时使用的值）
export const ACCESS_TOKEN_EXPIRES_IN = '30m';
export const REFRESH_TOKEN_TTL_MS = 24 * 60 * 60 * 1000; // 24 小时
export const USED_REFRESH_TOKEN_RETENTION_HOURS = 25;

// 业务编码生成重试次数（会员卡号 / 加工单号 / 采购单号 等唯一编码冲突重试）
export const BUSINESS_CODE_MAX_RETRIES = 5;
// BaseService.create 在 UNIQUE 冲突时的重试次数
export const UNIQUE_CONSTRAINT_MAX_RETRIES = 3;

// 幂等键默认 TTL
export const IDEMPOTENCY_DEFAULT_TTL_MS = 24 * 60 * 60 * 1000; // 24 小时

// 幂等键时间窗口（用于请求去重的分桶间隔）
export const IDEMPOTENCY_WINDOW_MS = 5000;

// SQLite
export const SQLITE_BUSY_TIMEOUT_MS = 5000;
export const SQLITE_CACHE_SIZE = -50000;
export const SQLITE_JOURNAL_MODE = 'WAL';
export const SQLITE_SYNCHRONOUS = 'NORMAL';
export const SQLITE_TEMP_STORE = 'MEMORY';
export const SQLITE_MMAP_SIZE = 268435456;
export const SQLITE_WAL_AUTOCHECKPOINT = 1000;

// 缓存 TTL
export const DEFAULT_CACHE_TTL_MS = 5 * 60 * 1000;
export const STATS_DASHBOARD_CACHE_TTL_MS = 10 * 1000;
export const STATS_REVENUE_CACHE_TTL_MS = 30 * 1000;
export const STATS_DOCTOR_WORKLOAD_CACHE_TTL_MS = 5 * 60 * 1000;
export const STATS_APPOINTMENT_CACHE_TTL_MS = 30 * 1000;
export const STATS_CHARGE_CACHE_TTL_MS = 30 * 1000;
export const STATS_PATIENT_CACHE_TTL_MS = 30 * 1000;
export const STATS_PATIENT_GROWTH_CACHE_TTL_MS = 1 * 60 * 1000;
export const STATS_REVENUE_BY_CATEGORY_CACHE_TTL_MS = 5 * 60 * 1000;
export const STATS_REVENUE_BY_DOCTOR_CACHE_TTL_MS = 5 * 60 * 1000;
export const STATS_INVENTORY_CACHE_TTL_MS = 10 * 60 * 1000;
export const STATS_MEMBER_CACHE_TTL_MS = 5 * 60 * 1000;
export const STATS_CACHE_TTL_MS = 60 * 1000;
export const SEARCH_CACHE_TTL_MS = 30 * 1000;
export const HEALTH_CACHE_TTL_MS = 300 * 1000;
export const CLINIC_INFO_CACHE_TTL_MS = 5 * 60 * 1000;
export const CLINIC_DETAIL_CACHE_TTL_MS = 30 * 60 * 1000;
// 用户信息缓存（JwtStrategy.validate 每个请求都会调用，TTL 设短以兼顾 tokenVersion 实时性）
export const USER_INFO_CACHE_TTL_MS = 30 * 1000;
// 用户权限缓存（角色变更频率低，但涉及安全，TTL 适中）
export const USER_PERMISSIONS_CACHE_TTL_MS = 5 * 60 * 1000;
// 用户角色缓存
export const USER_ROLES_CACHE_TTL_MS = 5 * 60 * 1000;
// 字典类数据缓存（变更频率低，可用较长 TTL）
export const TREATMENT_CATALOG_CACHE_TTL_MS = 30 * 60 * 1000;
export const MEDICAL_RECORD_DICTIONARY_CACHE_TTL_MS = 30 * 60 * 1000;
// 科室缓存
export const DEPARTMENT_CACHE_TTL_MS = 30 * 60 * 1000;
// 职称缓存
export const TITLE_CACHE_TTL_MS = 30 * 60 * 1000;
// 药品目录缓存
export const DRUG_CATALOG_CACHE_TTL_MS = 30 * 60 * 1000;
// 支付方式缓存
export const PAYMENT_METHOD_CACHE_TTL_MS = 15 * 60 * 1000;
// 会员卡类型缓存
export const MEMBER_CARD_TYPE_CACHE_TTL_MS = 30 * 60 * 1000;
// 患者基本信息缓存（短 TTL，患者信息可能频繁变更）
export const PATIENT_INFO_CACHE_TTL_MS = 2 * 60 * 1000;
// 医生排班缓存
export const DOCTOR_SCHEDULE_CACHE_TTL_MS = 10 * 60 * 1000;
// 系统设置缓存
export const SYSTEM_SETTINGS_CACHE_TTL_MS = 10 * 60 * 1000;
// 诊所配置缓存
export const CLINIC_CONFIG_CACHE_TTL_MS = 5 * 60 * 1000;

// 健康检查
export const HEALTH_CHECK_TIMEOUT_MS = 5000;

// Electron 主进程 API 管理
export const API_STARTUP_RETRY_DELAY_MS = 1000;
export const API_STARTUP_MAX_RETRIES = 30;
export const API_RESTART_DELAY_MS = 3000;
export const API_FORCE_KILL_TIMEOUT_MS = 5000;

// 日志
export const LOG_FLUSH_INTERVAL_MS = 5000;
export const MAX_SANITIZE_DEPTH = 10;
export const MAX_LOG_FILE_SIZE = 50 * 1024 * 1024;
export const MAX_LOG_FILES_PER_DAY = 10;
export const LOG_RETENTION_DAYS = 30;
export const LOG_FLUSH_BUFFER_INTERVAL_MS = 1000;
export const MAX_LOG_BUFFER_SIZE = 100;
export const MAX_LOG_TOTAL_BUFFER_SIZE = 10000;

// 分页（单一来源在 common/constants/pagination.ts，这里 re-export 方便使用）
export { MAX_PAGE_SIZE, PAGINATION } from '../common/constants/pagination';

// 备份
export const BACKUP_AUTO_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24 hours
export const BACKUP_VERIFY_INTERVAL_MS = 12 * 60 * 60 * 1000; // 12 hours
export const BACKUP_MAX_AUTO_BACKUPS = 7;
export const BACKUP_MANUAL_RETENTION_DAYS = 30;
export const BACKUP_MAX_DIR_BYTES = 500 * 1024 * 1024; // 500MB
export const BACKUP_LARGE_DB_THRESHOLD_BYTES = 500 * 1024 * 1024; // 500MB
export const BACKUP_FULL_VACUUM_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

// 初始管理员密码复杂度策略
export const ADMIN_INITIAL_PASSWORD_MIN_LENGTH = 8;
// eslint-disable-next-line sonarjs/no-hardcoded-passwords
export const ADMIN_INITIAL_PASSWORD_ENV_KEY = 'ADMIN_INITIAL_PASSWORD';

/**
 * 生成随机密码（用于开发/测试环境首次启动时的默认账号）。
 * 生产环境禁止依赖此函数，必须通过 ADMIN_INITIAL_PASSWORD 配置强密码。
 */
export function generateRandomPassword(length: number = 10): string {
  const upper = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const lower = 'abcdefghijklmnopqrstuvwxyz';
  const digits = '0123456789';
  const specials = '!@#$%^&*';
  const all = upper + lower + digits + specials;

  // 确保每种字符类型至少出现一次
  let password = '';
  password += upper[Math.floor(Math.random() * upper.length)];
  password += lower[Math.floor(Math.random() * lower.length)];
  password += digits[Math.floor(Math.random() * digits.length)];
  password += specials[Math.floor(Math.random() * specials.length)];

  for (let i = 4; i < length; i++) {
    password += all[Math.floor(Math.random() * all.length)];
  }

  // 打乱顺序
  return password.split('').sort(() => Math.random() - 0.5).join('');
}

// 常用时间单位（毫秒）
export const ONE_SECOND_MS = 1000;
export const ONE_MINUTE_MS = 60 * ONE_SECOND_MS;
export const FIVE_MINUTES_MS = 5 * ONE_MINUTE_MS;
export const ONE_HOUR_MS = 60 * ONE_MINUTE_MS;
export const ONE_DAY_MS = 24 * ONE_HOUR_MS;

// 统计查询默认条数
export const STATS_DEFAULT_LIMIT = 20;
