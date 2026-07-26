/**
 * 全局统一的敏感字段列表（小写匹配，子串匹配）。
 *
 * 三处历史实现（logger.service.ts / log.ts / modules/system/operation-logs/global-operation-log.interceptor.ts）
 * 已统一引用本常量，避免脱敏范围不一致导致敏感信息泄露。
 *
 * P2 修复（日志脱敏有三套实现，敏感字段列表不一致）。
 */
export const SENSITIVE_FIELDS: readonly string[] = [
  // 凭证类
  'password',
  'passwordhash',
  'token',
  'secret',
  'key',
  'jwtsecret',
  'refreshtoken',
  // 患者隐私类
  'idcard',
  '身份证',
  'phone',
  'email',
  'emergencyphone',
  'emergencycontact',
  'address',
  'cardno',
  'openid',
];

/**
 * 扩展关键词模式（大小写不敏感、子串匹配）。
 *
 * 在 SENSITIVE_FIELDS 基础上补充常见敏感字段命名变体，新增敏感字段时优先在此扩展，
 * 避免日志/序列化时因静态列表未同步导致敏感信息泄露。
 */
const SENSITIVE_KEYWORDS: readonly string[] = [
  ...SENSITIVE_FIELDS,
  'creditcard',
  'authorization',
  'cookie',
  'credential',
  'ssn',
  'cvv',
];

/**
 * 判断字段名是否敏感（大小写不敏感、精确全词匹配）。
 *
 * 除匹配静态 SENSITIVE_FIELDS 外，还匹配 SENSITIVE_KEYWORDS 中的动态关键词模式。
 * 使用精确匹配避免 keyword、sortKey 等非敏感字段因子串命中而被误脱敏。
 */
export function isSensitiveField(fieldName: string): boolean {
  const lower = fieldName.toLowerCase();
  return SENSITIVE_KEYWORDS.includes(lower);
}
