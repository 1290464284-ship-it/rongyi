/**
 * 金额工具函数（前后端共享）
 *
 * 所有金额在数据库中存储为整数（分），避免浮点精度问题。
 * 本模块提供元 ↔ 分的双向转换及常用运算。
 */
export const MONEY_SCALE = 100;

/** 元转分，防 NaN/Infinity */
export function yuanToCents(yuan: number): number {
  if (typeof yuan !== 'number' || !Number.isFinite(yuan)) return 0;
  return Math.round(yuan * MONEY_SCALE);
}

/** 分转元，返回浮点数（保留两位小数精度），防 NaN/Infinity */
export function centsToYuan(cents: number): number {
  if (typeof cents !== 'number' || !Number.isFinite(cents)) return 0;
  return Math.round(cents) / MONEY_SCALE;
}

/** 分加法（返回分） */
export function addCents(a: number, b: number): number {
  return a + b;
}

/** 分减法（返回分） */
export function subtractCents(a: number, b: number): number {
  return a - b;
}

/** 分乘法（数量乘单价，返回分） */
export function multiplyCents(priceCents: number, qty: number): number {
  return Math.round(priceCents * qty);
}

/** 分求和（返回分） */
export function sumCents(items: number[]): number {
  return items.reduce((sum, val) => sum + val, 0);
}

/** 分比较：a > b */
export function centsGreaterThan(a: number, b: number): boolean {
  return a > b;
}

/** 分比较：a >= b */
export function centsGreaterThanOrEqual(a: number, b: number): boolean {
  return a >= b;
}

/** 分比较：a < b */
export function centsLessThan(a: number, b: number): boolean {
  return a < b;
}

/** 分比较：a <= b */
export function centsLessThanOrEqual(a: number, b: number): boolean {
  return a <= b;
}

/** 分比较：a === b */
export function centsEquals(a: number, b: number): boolean {
  return a === b;
}

/** 分格式化为元字符串 */
export function formatCents(cents: number): string {
  return (cents / MONEY_SCALE).toFixed(2);
}

/** 元格式化为带 ¥ 前缀的字符串（接受 number/string/null/undefined） */
export function formatYuan(value: number | string | null | undefined): string {
  const n = typeof value === 'string' ? Number(value) : (value ?? 0);
  return `¥${(Number.isFinite(n) ? n : 0).toFixed(2)}`;
}

/**
 * 校验金额是否为有效正数（类型谓词，不抛异常）
 * 用于入口处对金额字段的轻量校验，避免负数/NaN/Infinity 污染数据库。
 */
export function isValidMoneyAmount(amount: unknown): amount is number {
  return typeof amount === 'number' && Number.isFinite(amount) && amount > 0;
}
