/**
 * Security helpers shared by HTTP and repository adapters.
 */

/** 审计日志/响应脱敏字段（掩码用途；含业务敏感字段，如患者手机号、身份证号、会员卡号）。 */
const SENSITIVE_FIELDS = new Set([
  'passwordHash',
  'refreshToken',
  'tokenHash',
  'apiKey',
  'secret',
  'encryptionKey',
  'backupEncryptionKey',
  'password',
  'oldPassword',
  'newPassword',
  'token',
  'creditCard',
  'idCard',
  'phoneNumber',
  'email',
  'phone',
  'mobile',
  'cardNo',
  'idCardNo',
  'wechatId',
  'medicalRecordNo',
  'insuranceNo',
]);

/**
 * 通用资源写路径禁止客户端写入的系统字段（凭据/审计/金额/库存类）。
 * 刻意独立于 SENSITIVE_FIELDS：业务敏感字段（phone/idCard/cardNo 等）必须能通过
 * 通用 CRUD 写入（前端患者表单等），只在掩码层脱敏。
 */
const PROTECTED_WRITE_FIELDS = new Set([
  'passwordHash',
  'refreshToken',
  'tokenHash',
  'apiKey',
  'secret',
  'encryptionKey',
  'backupEncryptionKey',
  'password',
  'oldPassword',
  'newPassword',
  'token',
  'creditCard',
  'phoneNumber',
  'email',
  'role',
  'loginAttempts',
  'lockedUntil',
  'tokenVersion',
  'passwordNeedsRehash',
  'isTempPassword',
  'balance',
  'totalRecharge',
  'totalConsume',
  'points',
  'totalPoints',
  'stock',
  'minStock',
  'paidAmount',
  'refundedAmount',
]);

/** 递归掩码：数组逐项、对象逐键；深度 >5 时原样返回（防深层嵌套拖垮审计）。 */
export function maskSensitiveFields<T>(row: T, depth = 0): T {
  if (depth > 5) return row;
  if (Array.isArray(row)) return row.map((item) => maskSensitiveFields(item, depth + 1)) as unknown as T;
  if (row && typeof row === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(row as Record<string, unknown>)) {
      result[key] = SENSITIVE_FIELDS.has(key) ? null : maskSensitiveFields(value, depth + 1);
    }
    return result as unknown as T;
  }
  return row;
}

export function stripProtectedWriteFields(payload: Record<string, unknown>): Record<string, unknown> {
  const result = { ...payload };
  for (const field of PROTECTED_WRITE_FIELDS) {
    delete result[field];
  }
  delete result.clinicId;
  delete result.createdAt;
  delete result.updatedAt;
  delete result.deletedAt;
  return result;
}
