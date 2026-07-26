/**
 * 通用业务消息文案常量
 * 集中管理跨模块复用的中文提示文案，避免硬编码散落各处导致维护困难。
 *
 * 使用原则：
 *  - 仅抽取"跨模块复用 ≥ 2 次"或"语义通用"的文案
 *  - 强业务语义（如"收费记录不存在"、"会员卡状态异常"）保留在业务模块内
 *  - 新增文案按类别归入下方命名空间，避免形成巨型单文件
 */

/** 通用错误/异常提示 */
export const ERROR_MESSAGES = {
  /** 通用请求频率超限 */
  RATE_LIMIT_EXCEEDED: '请求过于频繁，请稍后再试',
  /** 登录尝试频率超限 */
  LOGIN_RATE_LIMIT_EXCEEDED: '登录尝试次数过多，请稍后再试',
  /** 幂等性处理中 */
  PROCESSING_IN_PROGRESS: '处理中，请稍后再试',
  /** 数据库忙 */
  DATABASE_BUSY: '数据库繁忙，请稍后再试',
  /** 通用参数校验失败 */
  INVALID_PARAMETER: '参数错误',
  /** 通用字段校验 */
  INVALID_FIELD_NAME: '无效的字段名',
  /** 通用数量校验 */
  QUANTITY_MUST_BE_POSITIVE: '数量必须大于0',
  /** 通用并发冲突 */
  CONCURRENT_MODIFICATION: '并发修改，请刷新后重试',
} as const;

/** 通用成功/状态提示 */
export const SUCCESS_MESSAGES = {
  /** 通用操作成功 */
  OPERATION_SUCCESS: '操作成功',
} as const;
