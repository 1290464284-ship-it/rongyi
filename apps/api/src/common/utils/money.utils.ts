export const MONEY_SCALE = 100;

export function toCents(yuan: number): number {
  return Math.round(yuan * MONEY_SCALE);
}

export function toYuan(cents: number): number {
  return cents / MONEY_SCALE;
}

export function roundMoney(amount: number, decimals: number = 2): number {
  const factor = Math.pow(10, decimals);
  return Math.round(amount * factor) / factor;
}

export function addMoney(a: number, b: number): number {
  return roundMoney(a + b);
}

export function subtractMoney(a: number, b: number): number {
  return roundMoney(a - b);
}

export function multiplyMoney(a: number, b: number): number {
  return roundMoney(a * b);
}

export function sumMoney(items: number[]): number {
  return roundMoney(items.reduce((sum, val) => sum + val, 0));
}

export function formatMoney(amount: number): string {
  return amount.toFixed(2);
}

export function moneyEquals(a: number, b: number): boolean {
  return toCents(a) === toCents(b);
}

export function moneyGreaterThan(a: number, b: number): boolean {
  return toCents(a) > toCents(b);
}

export function moneyGreaterThanOrEqual(a: number, b: number): boolean {
  return toCents(a) >= toCents(b);
}

export function moneyLessThan(a: number, b: number): boolean {
  return toCents(a) < toCents(b);
}

export function moneyLessThanOrEqual(a: number, b: number): boolean {
  return toCents(a) <= toCents(b);
}

/**
 * 基于整数分的货币运算（避免浮点精度问题）
 * 内部使用分为单位（1元=100分），仅在展示时转换为元
 */

/** 元转分 */
export function yuanToCents(yuan: number): number {
  return Math.round(yuan * MONEY_SCALE);
}

/** 分转元 */
export function centsToYuan(cents: number): number {
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
