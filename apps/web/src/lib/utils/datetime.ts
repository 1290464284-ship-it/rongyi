/**
 * 前端统一日期格式化工具。
 *
 * 背景：
 * - 后端返回的 createdAt/updatedAt/paidAt 等均为 UTC ISO 字符串
 * - 诊所固定 Asia/Shanghai (UTC+8)，前端显示需转换为诊所本地时间
 * - 过去各模块分散使用 date-fns format，时区处理不一致
 *
 * 设计要点：
 * - 不依赖运行环境系统时区（date-fns format 会受系统 TZ 影响），所有输出通过
 *   "加 8 小时后取 UTC 分量" 的方式计算，保证在任何机器上结果一致
 * - 不引入 date-fns-tz，零新增依赖
 */
import { CLINIC_TZ_OFFSET_HOURS } from '@dental/shared';

const MS_PER_HOUR = 3600_000;

/**
 * 把 UTC ISO 字符串 / Date / 时间戳转换为诊所本地 (Asia/Shanghai) 的年月日时分秒分量。
 * 实现：把输入时间点加 8 小时后取 UTC 分量，等价于 `Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' })`
 * 但零依赖、兼容所有 Node/浏览器版本、可在同构环境使用。
 */
function toClinicParts(input: string | Date | number): {
  year: number; month: string; day: string;
  hour: string; minute: string; second: string;
  weekday: number;
} {
  const d = input instanceof Date
    ? input
    : typeof input === 'number'
      ? new Date(input)
      : new Date(input);
  const t = d.getTime();
  if (Number.isNaN(t)) {
    throw new Error(`日期格式化失败: 无效输入 ${String(input)}`);
  }
  const shifted = new Date(t + CLINIC_TZ_OFFSET_HOURS * MS_PER_HOUR);
  const year = shifted.getUTCFullYear();
  const month = String(shifted.getUTCMonth() + 1).padStart(2, '0');
  const day = String(shifted.getUTCDate()).padStart(2, '0');
  const hour = String(shifted.getUTCHours()).padStart(2, '0');
  const minute = String(shifted.getUTCMinutes()).padStart(2, '0');
  const second = String(shifted.getUTCSeconds()).padStart(2, '0');
  const weekday = shifted.getUTCDay();
  return { year, month, day, hour, minute, second, weekday };
}

const WEEKDAY_ZH = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'];

/**
 * 格式化为诊所本地日期 `YYYY-MM-DD`。
 * 例：`2026-07-30T16:00:00Z` → `2026-07-31`（UTC+8 跨日）
 */
export function formatClinicDate(input: string | Date | number): string {
  const { year, month, day } = toClinicParts(input);
  return `${year}-${month}-${day}`;
}

/**
 * 格式化为诊所本地日期时间 `YYYY-MM-DD HH:mm:ss`。
 */
export function formatClinicDateTime(input: string | Date | number): string {
  const { year, month, day, hour, minute, second } = toClinicParts(input);
  return `${year}-${month}-${day} ${hour}:${minute}:${second}`;
}

/**
 * 格式化为诊所本地简短日期时间 `MM-DD HH:mm`（列表/表格紧凑显示）。
 */
export function formatClinicDateTimeShort(input: string | Date | number): string {
  const { month, day, hour, minute } = toClinicParts(input);
  return `${month}-${day} ${hour}:${minute}`;
}

/**
 * 格式化为诊所本地"月-日"（如 `07-30`）。
 */
export function formatClinicMonthDay(input: string | Date | number): string {
  const { month, day } = toClinicParts(input);
  return `${month}-${day}`;
}

/**
 * 带中文本地化的完整格式（如 `2026年07月30日 星期四`）。
 */
export function formatClinicDateZh(input: string | Date | number): string {
  const { year, month, day, weekday } = toClinicParts(input);
  return `${year}年${month}月${day}日 ${WEEKDAY_ZH[weekday]}`;
}

/**
 * 判断输入是否是"今天"（诊所本地日期）。
 */
export function isClinicToday(input: string | Date | number): boolean {
  const nowParts = toClinicParts(new Date());
  const inputParts = toClinicParts(input);
  return (
    nowParts.year === inputParts.year &&
    nowParts.month === inputParts.month &&
    nowParts.day === inputParts.day
  );
}
