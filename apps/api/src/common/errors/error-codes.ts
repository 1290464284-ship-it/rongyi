/**
 * 统一错误码（数字格式）
 *
 * 编码规范：
 * - 1000-1999: 通用错误
 * - 2000-2999: 认证/授权相关
 * - 3000-3999: 业务逻辑错误
 * - 4000-4999: 数据库错误
 * - 5000-5999: 患者相关
 * - 6000-6999: 收费相关
 * - 7000-7999: 库存相关
 * - 8000-8999: 会员卡相关
 * - 9000-9999: 退款相关
 */
export enum ErrorCode {
  // ==================== 通用错误 1000-1999 ====================
  UNKNOWN = 1000,
  BAD_REQUEST = 1001,
  UNAUTHORIZED = 1002,
  FORBIDDEN = 1003,
  NOT_FOUND = 1004,
  CONFLICT = 1005,
  VALIDATION_ERROR = 1006,
  INTERNAL_ERROR = 1012,

  // 通用业务错误
  BUSINESS_ERROR = 1101,
  BUSINESS_OPERATION_FAILED = 1102,
  BUSINESS_BACKUP_FAILED = 1103,
  BUSINESS_RESTORE_FAILED = 1104,
  BUSINESS_CONFIG_ERROR = 1105,
  BUSINESS_DATABASE_ERROR = 1106,

  // 请求错误
  PAYLOAD_TOO_LARGE = 1201,
  UNSUPPORTED_MEDIA_TYPE = 1203,

  // ==================== 认证/授权 2000-2999 ====================
  INVALID_CREDENTIALS = 2001,
  TOKEN_EXPIRED = 2002,
  TOKEN_INVALID = 2003,
  TOO_MANY_ATTEMPTS = 2004,
  ACCOUNT_LOCKED = 2005,

  // 扩展认证错误（映射 Legacy）
  AUTH_UNAUTHORIZED = 2101,
  AUTH_TOKEN_EXPIRED = 2102,
  AUTH_TOKEN_INVALID = 2103,
  AUTH_LOGIN_FAILED = 2104,
  AUTH_PASSWORD_INCORRECT = 2105,
  AUTH_ACCOUNT_DISABLED = 2106,
  AUTH_ACCOUNT_LOCKED = 2107,
  AUTH_INSUFFICIENT_PERMISSIONS = 2108,

  // ==================== 业务逻辑 3000-3999 ====================
  INSUFFICIENT_BALANCE = 3001,
  INVALID_STATUS_TRANSITION = 3002,
  DUPLICATE_ENTRY = 3003,
  RESOURCE_OWNERSHIP_VIOLATION = 3004,

  // 验证错误
  VALIDATION_MISSING_FIELD = 3102,
  VALIDATION_INVALID_FORMAT = 3103,

  // 查找/冲突错误
  NOT_FOUND_USER = 3205,
  NOT_FOUND_PATIENT = 3206,
  NOT_FOUND_RESOURCE = 3207,
  CONFLICT_UNIQUE_CONSTRAINT = 3309,
  CONFLICT_DUPLICATE = 3310,

  // 限流
  RATE_LIMITED = 3401,

  // ==================== 数据库错误 4000-4999 ====================
  DATA_INTEGRITY_ERROR = 4001,
  REFERENCE_NOT_FOUND = 4002,

  // 扩展数据库错误（映射 Legacy）
  DB_ERROR = 4101,
  DB_FOREIGN_KEY_CONSTRAINT = 4102,
  DB_CHECK_CONSTRAINT = 4103,
  DB_NOT_NULL_CONSTRAINT = 4104,
  DB_BUSY_TIMEOUT = 4105,
  DB_LOCKED = 4106,
  DB_CORRUPT = 4107,
  DB_READONLY = 4108,
  DB_IO_ERROR = 4109,

  // ==================== 患者相关 5000-5999 ====================
  PATIENT_NOT_FOUND = 5001,
  PATIENT_DUPLICATE = 5002,

  // ==================== 收费相关 6000-6999 ====================
  CHARGE_NOT_FOUND = 6001,
  CHARGE_ALREADY_PAID = 6002,
  CHARGE_CANCELLED = 6003,
  PAYMENT_FAILED = 6004,

  // ==================== 库存相关 7000-7999 ====================
  INSUFFICIENT_STOCK = 7001,
  ITEM_NOT_FOUND = 7002,

  // ==================== 会员卡相关 8000-8999 ====================
  CARD_NOT_FOUND = 8001,
  CARD_INSUFFICIENT_BALANCE = 8002,
  CARD_DISABLED = 8003,

  // ==================== 退款相关 9000-9999 ====================
  REFUND_EXCEEDS_PAID = 9001,
  REFUND_ALREADY_PROCESSED = 9002,
}

/**
 * 旧版字符串错误码（仅保留用于兼容历史数据/外部回调）
 * @deprecated 已完全弃用。新代码禁止使用，请直接使用 ErrorCode 数字错误码；后续版本将移除。
 */
export enum LegacyErrorCode {
  AUTH_UNAUTHORIZED = 'AUTH_001',
  AUTH_TOKEN_EXPIRED = 'AUTH_002',
  AUTH_TOKEN_INVALID = 'AUTH_003',
  AUTH_LOGIN_FAILED = 'AUTH_004',
  AUTH_PASSWORD_INCORRECT = 'AUTH_005',
  AUTH_ACCOUNT_DISABLED = 'AUTH_006',
  AUTH_ACCOUNT_LOCKED = 'AUTH_007',
  AUTH_INSUFFICIENT_PERMISSIONS = 'AUTH_008',

  VALIDATION_ERROR = 'GEN_001',
  VALIDATION_MISSING_FIELD = 'GEN_002',
  VALIDATION_INVALID_FORMAT = 'GEN_003',

  NOT_FOUND = 'GEN_004',
  NOT_FOUND_USER = 'GEN_005',
  NOT_FOUND_PATIENT = 'GEN_006',
  NOT_FOUND_RESOURCE = 'GEN_007',

  CONFLICT = 'GEN_008',
  CONFLICT_UNIQUE_CONSTRAINT = 'GEN_009',
  CONFLICT_DUPLICATE = 'GEN_010',
  DUPLICATE_ENTRY = 'GEN_011',

  PATIENT_NOT_FOUND = 'PATIENT_001',
  PATIENT_DUPLICATE = 'PATIENT_002',

  CHARGE_NOT_FOUND = 'CHARGE_001',
  CHARGE_ALREADY_PAID = 'CHARGE_002',
  CHARGE_CANCELLED = 'CHARGE_003',
  PAYMENT_FAILED = 'CHARGE_004',

  INSUFFICIENT_STOCK = 'INVENTORY_001',
  ITEM_NOT_FOUND = 'INVENTORY_002',

  CARD_NOT_FOUND = 'CARD_001',
  CARD_INSUFFICIENT_BALANCE = 'CARD_002',
  CARD_DISABLED = 'CARD_003',

  REFUND_EXCEEDS_PAID = 'REFUND_001',
  REFUND_ALREADY_PROCESSED = 'REFUND_002',

  BUSINESS_ERROR = 'BIZ_001',
  BUSINESS_OPERATION_FAILED = 'BIZ_002',
  BUSINESS_BACKUP_FAILED = 'BIZ_003',
  BUSINESS_RESTORE_FAILED = 'BIZ_004',
  BUSINESS_CONFIG_ERROR = 'BIZ_005',
  BUSINESS_DATABASE_ERROR = 'BIZ_006',

  INTERNAL_ERROR = 'GEN_012',

  DB_ERROR = 'DB_001',
  DB_FOREIGN_KEY_CONSTRAINT = 'DB_002',
  DB_CHECK_CONSTRAINT = 'DB_003',
  DB_NOT_NULL_CONSTRAINT = 'DB_004',
  DB_BUSY_TIMEOUT = 'DB_005',
  DB_LOCKED = 'DB_006',
  DB_CORRUPT = 'DB_007',
  DB_READONLY = 'DB_008',
  DB_IO_ERROR = 'DB_009',

  PAYLOAD_TOO_LARGE = 'REQ_001',
  BAD_REQUEST_LEGACY = 'REQ_002',
  UNSUPPORTED_MEDIA_TYPE = 'REQ_003',

  RATE_LIMITED = 'RATE_001',
}

export const errorMessages: Record<ErrorCode, string> = {
  // 通用错误
  [ErrorCode.UNKNOWN]: '服务器内部错误',
  [ErrorCode.BAD_REQUEST]: '请求参数错误',
  [ErrorCode.UNAUTHORIZED]: '未授权访问',
  [ErrorCode.FORBIDDEN]: '权限不足',
  [ErrorCode.NOT_FOUND]: '资源不存在',
  [ErrorCode.CONFLICT]: '资源冲突',
  [ErrorCode.VALIDATION_ERROR]: '参数校验失败',
  [ErrorCode.INTERNAL_ERROR]: '服务器内部错误',

  // 通用业务错误
  [ErrorCode.BUSINESS_ERROR]: '业务处理失败',
  [ErrorCode.BUSINESS_OPERATION_FAILED]: '业务操作失败',
  [ErrorCode.BUSINESS_BACKUP_FAILED]: '备份失败',
  [ErrorCode.BUSINESS_RESTORE_FAILED]: '恢复失败',
  [ErrorCode.BUSINESS_CONFIG_ERROR]: '配置错误',
  [ErrorCode.BUSINESS_DATABASE_ERROR]: '数据库错误',

  // 请求错误
  [ErrorCode.PAYLOAD_TOO_LARGE]: '请求体过大',
  [ErrorCode.UNSUPPORTED_MEDIA_TYPE]: '不支持的媒体类型',

  // 认证错误
  [ErrorCode.INVALID_CREDENTIALS]: '用户名或密码错误',
  [ErrorCode.TOKEN_EXPIRED]: '令牌已过期',
  [ErrorCode.TOKEN_INVALID]: '令牌无效',
  [ErrorCode.TOO_MANY_ATTEMPTS]: '尝试次数过多',
  [ErrorCode.ACCOUNT_LOCKED]: '账户已锁定',
  [ErrorCode.AUTH_UNAUTHORIZED]: '未授权访问',
  [ErrorCode.AUTH_TOKEN_EXPIRED]: '令牌已过期',
  [ErrorCode.AUTH_TOKEN_INVALID]: '令牌无效',
  [ErrorCode.AUTH_LOGIN_FAILED]: '登录失败',
  [ErrorCode.AUTH_PASSWORD_INCORRECT]: '密码错误',
  [ErrorCode.AUTH_ACCOUNT_DISABLED]: '账户已禁用',
  [ErrorCode.AUTH_ACCOUNT_LOCKED]: '账户已锁定',
  [ErrorCode.AUTH_INSUFFICIENT_PERMISSIONS]: '权限不足',

  // 业务逻辑错误
  [ErrorCode.INSUFFICIENT_BALANCE]: '余额不足',
  [ErrorCode.INVALID_STATUS_TRANSITION]: '无效的状态转换',
  [ErrorCode.DUPLICATE_ENTRY]: '重复条目',
  [ErrorCode.RESOURCE_OWNERSHIP_VIOLATION]: '资源所有权违规',
  [ErrorCode.VALIDATION_MISSING_FIELD]: '缺少必填字段',
  [ErrorCode.VALIDATION_INVALID_FORMAT]: '格式错误',
  [ErrorCode.NOT_FOUND_USER]: '用户不存在',
  [ErrorCode.NOT_FOUND_PATIENT]: '患者不存在',
  [ErrorCode.NOT_FOUND_RESOURCE]: '资源不存在',
  [ErrorCode.CONFLICT_UNIQUE_CONSTRAINT]: '唯一约束冲突',
  [ErrorCode.CONFLICT_DUPLICATE]: '数据重复',
  [ErrorCode.RATE_LIMITED]: '请求过于频繁',

  // 数据库错误
  [ErrorCode.DATA_INTEGRITY_ERROR]: '数据完整性错误',
  [ErrorCode.REFERENCE_NOT_FOUND]: '引用不存在',
  [ErrorCode.DB_ERROR]: '数据库错误',
  [ErrorCode.DB_FOREIGN_KEY_CONSTRAINT]: '外键约束错误',
  [ErrorCode.DB_CHECK_CONSTRAINT]: '检查约束错误',
  [ErrorCode.DB_NOT_NULL_CONSTRAINT]: '非空约束错误',
  [ErrorCode.DB_BUSY_TIMEOUT]: '数据库繁忙',
  [ErrorCode.DB_LOCKED]: '数据库锁定',
  [ErrorCode.DB_CORRUPT]: '数据库损坏',
  [ErrorCode.DB_READONLY]: '数据库只读',
  [ErrorCode.DB_IO_ERROR]: '数据库IO错误',

  // 患者相关
  [ErrorCode.PATIENT_NOT_FOUND]: '患者不存在',
  [ErrorCode.PATIENT_DUPLICATE]: '患者已存在',

  // 收费相关
  [ErrorCode.CHARGE_NOT_FOUND]: '收费单不存在',
  [ErrorCode.CHARGE_ALREADY_PAID]: '收费单已支付',
  [ErrorCode.CHARGE_CANCELLED]: '收费单已取消',
  [ErrorCode.PAYMENT_FAILED]: '支付失败',

  // 库存相关
  [ErrorCode.INSUFFICIENT_STOCK]: '库存不足',
  [ErrorCode.ITEM_NOT_FOUND]: '物品不存在',

  // 会员卡相关
  [ErrorCode.CARD_NOT_FOUND]: '会员卡不存在',
  [ErrorCode.CARD_INSUFFICIENT_BALANCE]: '会员卡余额不足',
  [ErrorCode.CARD_DISABLED]: '会员卡已禁用',

  // 退款相关
  [ErrorCode.REFUND_EXCEEDS_PAID]: '退款金额超过已支付金额',
  [ErrorCode.REFUND_ALREADY_PROCESSED]: '退款已处理',
};

/**
 * LegacyErrorCode 到 ErrorCode 的映射表
 *
 * 用途：将旧的字符串错误码转换为统一的数字错误码
 * @deprecated 仅用于兼容历史字符串错误码，新代码直接使用 ErrorCode
 */
/* eslint-disable sonarjs/deprecation */
export const legacyToErrorCodeMap: ReadonlyMap<LegacyErrorCode, ErrorCode> = new Map([
  // 认证相关
  [LegacyErrorCode.AUTH_UNAUTHORIZED, ErrorCode.AUTH_UNAUTHORIZED],
  [LegacyErrorCode.AUTH_TOKEN_EXPIRED, ErrorCode.AUTH_TOKEN_EXPIRED],
  [LegacyErrorCode.AUTH_TOKEN_INVALID, ErrorCode.AUTH_TOKEN_INVALID],
  [LegacyErrorCode.AUTH_LOGIN_FAILED, ErrorCode.AUTH_LOGIN_FAILED],
  [LegacyErrorCode.AUTH_PASSWORD_INCORRECT, ErrorCode.AUTH_PASSWORD_INCORRECT],
  [LegacyErrorCode.AUTH_ACCOUNT_DISABLED, ErrorCode.AUTH_ACCOUNT_DISABLED],
  [LegacyErrorCode.AUTH_ACCOUNT_LOCKED, ErrorCode.AUTH_ACCOUNT_LOCKED],
  [LegacyErrorCode.AUTH_INSUFFICIENT_PERMISSIONS, ErrorCode.AUTH_INSUFFICIENT_PERMISSIONS],

  // 通用验证
  [LegacyErrorCode.VALIDATION_ERROR, ErrorCode.VALIDATION_ERROR],
  [LegacyErrorCode.VALIDATION_MISSING_FIELD, ErrorCode.VALIDATION_MISSING_FIELD],
  [LegacyErrorCode.VALIDATION_INVALID_FORMAT, ErrorCode.VALIDATION_INVALID_FORMAT],

  // 查找/冲突
  [LegacyErrorCode.NOT_FOUND, ErrorCode.NOT_FOUND],
  [LegacyErrorCode.NOT_FOUND_USER, ErrorCode.NOT_FOUND_USER],
  [LegacyErrorCode.NOT_FOUND_PATIENT, ErrorCode.NOT_FOUND_PATIENT],
  [LegacyErrorCode.NOT_FOUND_RESOURCE, ErrorCode.NOT_FOUND_RESOURCE],
  [LegacyErrorCode.CONFLICT, ErrorCode.CONFLICT],
  [LegacyErrorCode.CONFLICT_UNIQUE_CONSTRAINT, ErrorCode.CONFLICT_UNIQUE_CONSTRAINT],
  [LegacyErrorCode.CONFLICT_DUPLICATE, ErrorCode.CONFLICT_DUPLICATE],
  [LegacyErrorCode.DUPLICATE_ENTRY, ErrorCode.DUPLICATE_ENTRY],

  // 患者
  [LegacyErrorCode.PATIENT_NOT_FOUND, ErrorCode.PATIENT_NOT_FOUND],
  [LegacyErrorCode.PATIENT_DUPLICATE, ErrorCode.PATIENT_DUPLICATE],

  // 收费
  [LegacyErrorCode.CHARGE_NOT_FOUND, ErrorCode.CHARGE_NOT_FOUND],
  [LegacyErrorCode.CHARGE_ALREADY_PAID, ErrorCode.CHARGE_ALREADY_PAID],
  [LegacyErrorCode.CHARGE_CANCELLED, ErrorCode.CHARGE_CANCELLED],
  [LegacyErrorCode.PAYMENT_FAILED, ErrorCode.PAYMENT_FAILED],

  // 库存
  [LegacyErrorCode.INSUFFICIENT_STOCK, ErrorCode.INSUFFICIENT_STOCK],
  [LegacyErrorCode.ITEM_NOT_FOUND, ErrorCode.ITEM_NOT_FOUND],

  // 会员卡
  [LegacyErrorCode.CARD_NOT_FOUND, ErrorCode.CARD_NOT_FOUND],
  [LegacyErrorCode.CARD_INSUFFICIENT_BALANCE, ErrorCode.CARD_INSUFFICIENT_BALANCE],
  [LegacyErrorCode.CARD_DISABLED, ErrorCode.CARD_DISABLED],

  // 退款
  [LegacyErrorCode.REFUND_EXCEEDS_PAID, ErrorCode.REFUND_EXCEEDS_PAID],
  [LegacyErrorCode.REFUND_ALREADY_PROCESSED, ErrorCode.REFUND_ALREADY_PROCESSED],

  // 业务错误
  [LegacyErrorCode.BUSINESS_ERROR, ErrorCode.BUSINESS_ERROR],
  [LegacyErrorCode.BUSINESS_OPERATION_FAILED, ErrorCode.BUSINESS_OPERATION_FAILED],
  [LegacyErrorCode.BUSINESS_BACKUP_FAILED, ErrorCode.BUSINESS_BACKUP_FAILED],
  [LegacyErrorCode.BUSINESS_RESTORE_FAILED, ErrorCode.BUSINESS_RESTORE_FAILED],
  [LegacyErrorCode.BUSINESS_CONFIG_ERROR, ErrorCode.BUSINESS_CONFIG_ERROR],
  [LegacyErrorCode.BUSINESS_DATABASE_ERROR, ErrorCode.BUSINESS_DATABASE_ERROR],
  [LegacyErrorCode.INTERNAL_ERROR, ErrorCode.INTERNAL_ERROR],

  // 数据库错误
  [LegacyErrorCode.DB_ERROR, ErrorCode.DB_ERROR],
  [LegacyErrorCode.DB_FOREIGN_KEY_CONSTRAINT, ErrorCode.DB_FOREIGN_KEY_CONSTRAINT],
  [LegacyErrorCode.DB_CHECK_CONSTRAINT, ErrorCode.DB_CHECK_CONSTRAINT],
  [LegacyErrorCode.DB_NOT_NULL_CONSTRAINT, ErrorCode.DB_NOT_NULL_CONSTRAINT],
  [LegacyErrorCode.DB_BUSY_TIMEOUT, ErrorCode.DB_BUSY_TIMEOUT],
  [LegacyErrorCode.DB_LOCKED, ErrorCode.DB_LOCKED],
  [LegacyErrorCode.DB_CORRUPT, ErrorCode.DB_CORRUPT],
  [LegacyErrorCode.DB_READONLY, ErrorCode.DB_READONLY],
  [LegacyErrorCode.DB_IO_ERROR, ErrorCode.DB_IO_ERROR],

  // 请求错误
  [LegacyErrorCode.PAYLOAD_TOO_LARGE, ErrorCode.PAYLOAD_TOO_LARGE],
  [LegacyErrorCode.BAD_REQUEST_LEGACY, ErrorCode.BAD_REQUEST],
  [LegacyErrorCode.UNSUPPORTED_MEDIA_TYPE, ErrorCode.UNSUPPORTED_MEDIA_TYPE],

  // 限流
  [LegacyErrorCode.RATE_LIMITED, ErrorCode.RATE_LIMITED],
]);

/**
 * 将 LegacyErrorCode 转换为 ErrorCode
 * @param legacy 旧的字符串错误码
 * @returns 数字格式的错误码，未知错误码返回 UNKNOWN
 */
export function mapLegacyToErrorCode(legacy: LegacyErrorCode | string): ErrorCode {
  return legacyToErrorCodeMap.get(legacy as LegacyErrorCode) ?? ErrorCode.UNKNOWN;
}
/* eslint-enable sonarjs/deprecation */
