export function nowISO(): string {
  return new Date().toISOString();
}

export function toISOString(date: Date | string | number): string {
  return new Date(date).toISOString();
}

/**
 * 获取本地日期当天的开始时间（UTC ISO 字符串）
 * 使用 getFullYear/getMonth/getDate 提取本地日期组件，
 * 避免 new Date(dateStr) 将 date-only 字符串解析为 UTC 午夜导致的时区偏移问题
 */
export function getLocalStartOfDay(date: Date | string): string {
  const d = new Date(date);
  const year = d.getFullYear();
  const month = d.getMonth();
  const day = d.getDate();
  const localStart = new Date(year, month, day, 0, 0, 0, 0);
  return localStart.toISOString();
}

/**
 * 获取本地日期当天的结束时间（UTC ISO 字符串）
 */
export function getLocalEndOfDay(date: Date | string): string {
  const d = new Date(date);
  const year = d.getFullYear();
  const month = d.getMonth();
  const day = d.getDate();
  const localEnd = new Date(year, month, day, 23, 59, 59, 999);
  return localEnd.toISOString();
}

export function getLocalDateRange(startDate: string, endDate: string): { start: string; end: string } {
  return {
    start: getLocalStartOfDay(startDate),
    end: getLocalEndOfDay(endDate),
  };
}

export function formatDate(date: Date | string): string {
  const d = new Date(date);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function formatDateTime(date: Date | string): string {
  const d = new Date(date);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const hours = String(d.getHours()).padStart(2, '0');
  const minutes = String(d.getMinutes()).padStart(2, '0');
  const seconds = String(d.getSeconds()).padStart(2, '0');
  return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
}

export function parseDate(dateStr: string): Date | null {
  const date = new Date(dateStr);
  return isNaN(date.getTime()) ? null : date;
}

export function isSameDay(date1: Date | string, date2: Date | string): boolean {
  const d1 = new Date(date1);
  const d2 = new Date(date2);
  return (
    d1.getFullYear() === d2.getFullYear() &&
    d1.getMonth() === d2.getMonth() &&
    d1.getDate() === d2.getDate()
  );
}

export function daysAgo(days: number): string {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return getLocalStartOfDay(date);
}

export function startOfMonth(date?: Date): string {
  const d = date || new Date();
  const start = new Date(d.getFullYear(), d.getMonth(), 1);
  return getLocalStartOfDay(start);
}

export function endOfMonth(date?: Date): string {
  const d = date || new Date();
  const end = new Date(d.getFullYear(), d.getMonth() + 1, 0);
  return getLocalEndOfDay(end);
}

const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

export function validateDates(startDate?: string, endDate?: string): void {
  if (startDate && !DATE_REGEX.test(startDate)) throw new Error('日期格式错误: startDate');
  if (endDate && !DATE_REGEX.test(endDate)) throw new Error('日期格式错误: endDate');
}

export function getLocalMonthStr(d: Date = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  return `${y}-${m}`;
}

export function addDays(dateStr: string, days: number): string {
  const d = new Date(dateStr);
  d.setDate(d.getDate() + days);
  return formatDate(d);
}

export function isDateInPast(dateStr: string): boolean {
  const date = new Date(dateStr);
  if (isNaN(date.getTime())) return true;
  return date.getTime() < Date.now();
}

export function isDateInFuture(dateStr: string): boolean {
  const date = new Date(dateStr);
  if (isNaN(date.getTime())) return false;
  return date.getTime() > Date.now();
}

export function isDateValid(dateStr: string): boolean {
  const date = new Date(dateStr);
  return !isNaN(date.getTime());
}

export function endOfDay(dateStr: string): string {
  return getLocalEndOfDay(dateStr);
}

export function startOfDay(dateStr: string): string {
  return getLocalStartOfDay(dateStr);
}

export function getLocalDateStr(d: Date = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
