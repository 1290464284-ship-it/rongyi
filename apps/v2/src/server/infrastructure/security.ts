/**
 * Security helpers shared by HTTP and repository adapters.
 */

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
]);

const PROTECTED_WRITE_FIELDS = new Set([
  ...SENSITIVE_FIELDS,
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

export function maskSensitiveFields(row: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = { ...row };
  for (const field of SENSITIVE_FIELDS) {
    if (field in result) result[field] = null;
  }
  return result;
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
