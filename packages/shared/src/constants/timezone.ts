/**
 * 诊所固定时区常量与跨时区工具。
 *
 * 背景：
 * - 数据库统一存储 UTC ISO 字符串（`datetime('now')` / `new Date().toISOString()`）
 * - 诊所固定在中国时区 `Asia/Shanghai`（UTC+8），无夏令时
 * - 收费编号、统计按天聚合等必须按"诊所本地日期"而非 UTC 日期，否则
 *   23:00-24:00 CST 的记录会被分到前一天
 *
 * 使用约定：
 * - SQLite 层：`date(col, '+8 hours')` 把 UTC 时间戳转换为诊所本地日期
 * - JS 层：`getLocalDateInClinicTz(date)` 返回形如 `YYYY-MM-DD` 的诊所本地日期字符串
 * - 前端：`formatClinicDate` / `formatClinicDateTime`（见 web 端 lib/utils/datetime.ts）
 */

/** 诊所固定时区 IANA 名（仅作文档与未来 Intl 使用保留） */
export const CLINIC_TIMEZONE = 'Asia/Shanghai';

/** 诊所时区相对 UTC 的固定小时偏移（UTC+8，无夏令时） */
export const CLINIC_TZ_OFFSET_HOURS = 8;

/**
 * SQLite `date()` / `datetime()` 的 modifier 字符串，用于把 UTC 列转换为诊所本地日期。
 * 例：`SELECT date(paidAt, '+8 hours') FROM Charge`
 */
export const CLINIC_TZ_SQL_MODIFIER = `+${CLINIC_TZ_OFFSET_HOURS} hours`;

/**
 * 把 Date / ISO 字符串 / 时间戳转换为诊所本地日期字符串 `YYYY-MM-DD`。
 *
 * 实现：先把输入统一为 Date（代表绝对时间点），再加 8 小时后取 UTC 分量。
 * 等价于 `Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' })` 但零依赖、
 * 兼容所有 Node 版本、可在 SQLite 同构使用。
 */
export function getLocalDateInClinicTz(input: Date | string | number): string {
  const d = input instanceof Date ? input : new Date(input);
  const t = d.getTime();
  if (Number.isNaN(t)) {
    throw new Error(`getLocalDateInClinicTz: 无效日期输入: ${String(input)}`);
  }
  const shifted = new Date(t + CLINIC_TZ_OFFSET_HOURS * 3600_000);
  const y = shifted.getUTCFullYear();
  const m = String(shifted.getUTCMonth() + 1).padStart(2, '0');
  const day = String(shifted.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
 * 把 Date / ISO 字符串 / 时间戳转换为诊所本地 `YYYY-MM-DD HH:mm:ss`。
 */
export function getLocalDateTimeInClinicTz(input: Date | string | number): string {
  const d = input instanceof Date ? input : new Date(input);
  const t = d.getTime();
  if (Number.isNaN(t)) {
    throw new Error(`getLocalDateTimeInClinicTz: 无效日期输入: ${String(input)}`);
  }
  const shifted = new Date(t + CLINIC_TZ_OFFSET_HOURS * 3600_000);
  const y = shifted.getUTCFullYear();
  const mo = String(shifted.getUTCMonth() + 1).padStart(2, '0');
  const day = String(shifted.getUTCDate()).padStart(2, '0');
  const h = String(shifted.getUTCHours()).padStart(2, '0');
  const mi = String(shifted.getUTCMinutes()).padStart(2, '0');
  const s = String(shifted.getUTCSeconds()).padStart(2, '0');
  return `${y}-${mo}-${day} ${h}:${mi}:${s}`;
}
