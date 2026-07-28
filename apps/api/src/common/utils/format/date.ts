
import { BusinessValidationException } from '@common/errors';

export function nowISO(): string {
  return new Date().toISOString();
}

export function toISOString(date: Date | string | number): string {
  return assertValidDate(date, 'toISOString').toISOString();
}

/**
 * 获取本地日期当天的开始时间（UTC ISO 字符串）
 * 使用 getFullYear/getMonth/getDate 提取本地日期组件，
 * 避免 new Date(dateStr) 将 date-only 字符串解析为 UTC 午夜导致的时区偏移问题
 */
export function getLocalStartOfDay(date: Date | string): string {
  const d = assertValidDate(date, 'getLocalStartOfDay');
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
  const d = assertValidDate(date, 'getLocalEndOfDay');
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
  const d = assertValidDate(date, 'formatDate');
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function formatDateTime(date: Date | string): string {
  const d = assertValidDate(date, 'formatDateTime');
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const hours = String(d.getHours()).padStart(2, '0');
  const minutes = String(d.getMinutes()).padStart(2, '0');
  const seconds = String(d.getSeconds()).padStart(2, '0');
  return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
}

export function parseDate(dateStr: string): Date {
  if (typeof dateStr !== 'string') {
    throw new BusinessValidationException('无效的日期格式: 输入必须是字符串');
  }
  const trimmed = dateStr.trim();
  if (!trimmed) {
    throw new BusinessValidationException('无效的日期格式: 日期字符串为空');
  }
  const date = new Date(trimmed);
  if (isNaN(date.getTime())) {
    throw new BusinessValidationException(`无效的日期格式: ${dateStr}`);
  }
  return date;
}

export function isSameDay(date1: Date | string, date2: Date | string): boolean {
  const d1 = assertValidDate(date1, 'isSameDay');
  const d2 = assertValidDate(date2, 'isSameDay');
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

export function validateDates(startDate?: string, endDate?: string): void {
  if (startDate && !isValidCalendarDate(startDate)) {
    throw new BusinessValidationException('日期格式错误: startDate 应为有效的 YYYY-MM-DD 日期');
  }
  if (endDate && !isValidCalendarDate(endDate)) {
    throw new BusinessValidationException('日期格式错误: endDate 应为有效的 YYYY-MM-DD 日期');
  }
}

/**
 * 解析并验证日期范围，返回可直接用于 SQL 查询的起止时间（UTC ISO 字符串）
 * - 校验日期格式
 * - startDate 转换为当天开始时间
 * - endDate 转换为当天结束时间
 * - 若任一参数为空则返回 null 对应的位置
 */
export function parseDateRange(startDate?: string, endDate?: string): { start: string | null; end: string | null } {
  validateDates(startDate, endDate);
  return {
    start: startDate ? startOfDay(startDate) : null,
    end: endDate ? endOfDay(endDate) : null,
  };
}

export function getLocalMonthStr(d: Date = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  return `${y}-${m}`;
}

export function addDays(dateStr: string, days: number): string {
  const d = assertValidDate(dateStr, 'addDays');
  d.setDate(d.getDate() + days);
  return formatDate(d);
}

export function isDateInPast(dateStr: string): boolean {
  const date = parseDate(dateStr);
  return date.getTime() < Date.now();
}

export function isDateInFuture(dateStr: string): boolean {
  const date = parseDate(dateStr);
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

function assertValidDate(date: Date | string | number, context?: string): Date {
  const d = new Date(date);
  if (isNaN(d.getTime())) {
    const prefix = context ? `无效的日期 (${context})` : '无效的日期';
    throw new BusinessValidationException(`${prefix}: ${String(date)}`);
  }
  return d;
}

/**
 * 严格校验 YYYY-MM-DD 格式字符串是否为真实存在的日历日期。
 * 仅通过 /\d{4}-\d{2}-\d{2}/ 的正则无法拒绝 2024-99-99 这类非法日期，
 * 因此使用 Date.UTC 构造后比对年月日是否一致来验证。
 */
function isValidCalendarDate(dateStr: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return false;
  const [year, month, day] = dateStr.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}
