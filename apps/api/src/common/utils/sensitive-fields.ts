/**
 * 全局统一的敏感字段列表（小写匹配，子串匹配）。
 *
 * 三处历史实现（logger.service.ts / log.ts / global-operation-log.interceptor.ts）
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
  'phone',
  'emergencyphone',
  'emergencycontact',
  'address',
  'cardno',
  'openid',
];

/**
 * 判断字段名是否敏感（大小写不敏感、子串匹配）。
 */
export function isSensitiveField(fieldName: string): boolean {
  const lower = fieldName.toLowerCase();
  return SENSITIVE_FIELDS.some((f) => lower.includes(f));
}
