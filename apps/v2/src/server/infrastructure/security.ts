/**
 * Security helpers shared by HTTP and repository adapters.
 */
import { resetSecretFileCache, secretFileValue } from './secret-file';

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
]);

// Business PII (phone/email/idCard/cardNo) is intentionally not masked here:
// authorized clinic staff need these values in lists, edit forms and
// duplicate checks. Masking them to null wiped phone numbers on edit.

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
  // 财务字段（通用 CRUD 禁止客户端直写；走专用路由/财务服务）
  'discountRate',
  'maxDiscountAmount',
  'annualDiscountLimit',
  'totalFee',
  'settleStatus',
  'settledAmount',
  'settledAt',
  // 治疗计划划价状态：仅 TreatmentPlanBillingService 经专用 SQL 写入（bill 联动），
  // 禁止客户端经通用 CRUD 伪造已划价标记/划价单引用。
  'billed',
  'billedChargeId',
]);

/**
 * 按资源追加的写保护字段（S-L7）：status/sentAt/result 等字段只在部分资源里
 * 属于"仅专用服务可写"，其他资源（appointments/treatments 等）仍允许经通用
 * CRUD 正常维护 status，因此不能进全局 PROTECTED_WRITE_FIELDS。
 * wechatMessages：发送状态仅允许 send 服务写入——通用 CRUD/sync/批量导入不得
 * 直接创建"已发送"记录（防伪造通知/随访记录）。
 */
const RESOURCE_PROTECTED_WRITE_FIELDS: Record<string, ReadonlySet<string>> = {
  wechatMessages: new Set(['status', 'sentAt', 'result']),
};

/** 递归掩码：数组逐项、对象逐键；深度 >5 时截断为占位值，避免深层嵌套泄露敏感键。 */
export function maskSensitiveFields<T>(row: T, depth = 0): T {
  if (depth > 5) return '[MaxDepth]' as unknown as T;
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

export function stripProtectedWriteFields(
  payload: Record<string, unknown>,
  exemptFields?: ReadonlySet<string>,
  resourceName?: string,
): Record<string, unknown> {
  const result = { ...payload };
  for (const field of PROTECTED_WRITE_FIELDS) {
    if (exemptFields?.has(field)) continue;
    delete result[field];
  }
  const resourceProtected = resourceName ? RESOURCE_PROTECTED_WRITE_FIELDS[resourceName] : undefined;
  if (resourceProtected) {
    for (const field of resourceProtected) {
      if (exemptFields?.has(field)) continue;
      delete result[field];
    }
  }
  delete result.clinicId;
  delete result.createdAt;
  delete result.updatedAt;
  delete result.deletedAt;
  return result;
}

/**
 * 生产环境必须配置备份密钥：加密备份、文件签名 URL、restore marker 都依赖
 * 它。缺少时在启动阶段 fail-closed，避免运行中途出现“文件已写入但签名失败”
 * 或“备份已创建但无法加密”的半提交状态。
 */
export function assertProductionBackupKeyConfigured(nodeEnv = process.env.NODE_ENV ?? 'development'): void {
  if (nodeEnv !== 'production') return;
  // 测试会临时替换 V2_SECRET_FILE；清缓存确保读取的是当前环境，而不是
  // 模块首次加载时缓存的旧文件。
  resetSecretFileCache();
  const key = process.env.V2_BACKUP_KEY ?? secretFileValue('backupKey');
  if (!key) {
    throw new Error('V2_BACKUP_KEY must be set in production for encrypted backups, signed file URLs, and restore markers');
  }
}
