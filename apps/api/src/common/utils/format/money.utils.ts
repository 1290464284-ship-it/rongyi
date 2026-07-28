/**
 * 金额工具函数 — 统一从 @dental/shared 导出，禁止本地重复实现。
 *
 * P0 修复：消除与 packages/shared/src/validators/money.ts 的完全重复，
 * 确保修改一处全局生效。
 */
export {
  MONEY_SCALE,
  yuanToCents,
  centsToYuan,
  addCents,
  subtractCents,
  multiplyCents,
  sumCents,
  centsGreaterThan,
  centsGreaterThanOrEqual,
  centsLessThan,
  centsLessThanOrEqual,
  centsEquals,
  formatCents,
  isValidMoneyAmount,
} from '@dental/shared';
