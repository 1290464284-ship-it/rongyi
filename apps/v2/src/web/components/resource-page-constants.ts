export const PROTECTED_UI_FIELDS = new Set([
  'passwordHash',
  'refreshToken',
  'tokenHash',
  'role',
  'loginAttempts',
  'lockedUntil',
  'tokenVersion',
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

export const TABLE_COLUMN_LIMIT = 10;

export const MONEY_COLUMNS = new Set([
  'revenue', 'amount', 'totalAmount', 'paidAmount', 'unpaidAmount', 'monetary',
  'price', 'unitPrice', 'subtotal', 'totalFee', 'totalBalance', 'totalCharged',
  'totalCommission', 'totalBytes', 'settledAmount', 'amountTotal', 'balance',
  'cost', 'profit', 'refundAmount', 'discount', 'grandTotal', 'commission',
]);
export const DATETIME_COLUMNS = new Set([
  'createdAt', 'updatedAt', 'paidAt', 'completedAt', 'sentAt', 'receivedAt',
  'deliveredAt', 'issuedAt', 'startTime', 'endTime', 'processedAt', 'approvedAt',
  'refundedAt', 'lockedAt', 'signedAt', 'reviewedAt', 'calculatedAt', 'nextFollowUpAt',
  'takenAt',
]);
export const DATE_COLUMNS = new Set([
  'birthDate', 'planDate', 'expireDate', 'workDate', 'startDate', 'endDate',
  'purchaseDate', 'examDate', 'surveyDate', 'recordDate',
]);
