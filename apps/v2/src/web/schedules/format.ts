import { WEEKDAY_LABELS } from './constants';

/** 解析模板工作日（优先 workDaysJson 数组，兼容行内已展开的 workDays）。 */
export function parseWorkDays(template: { workDaysJson: string | null; workDays?: number[] }): number[] {
  const raw = template.workDaysJson ?? template.workDays;
  if (Array.isArray(raw)) return raw.map(Number).filter((day) => day >= 1 && day <= 7).sort((a, b) => a - b);
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed.map(Number).filter((day) => day >= 1 && day <= 7).sort((a, b) => a - b);
    } catch {
      // fall through
    }
  }
  return [1, 2, 3, 4, 5];
}

/** workDays（1=周一 … 7=周日）显示为「周一~周五」等可读形式。 */
export function formatWorkDays(workDays: number[]): string {
  const days = [...workDays].sort((a, b) => a - b);
  if (days.length === 0) return '未设置';
  const parts: string[] = [];
  let start = days[0];
  let prev = days[0];
  for (let index = 1; index <= days.length; index += 1) {
    const current = days[index];
    if (current === undefined || current !== prev + 1) {
      parts.push(start === prev ? WEEKDAY_LABELS[start - 1] : `${WEEKDAY_LABELS[start - 1]}~${WEEKDAY_LABELS[prev - 1]}`);
      if (current !== undefined) start = current;
    }
    prev = current ?? prev;
  }
  return parts.join('、');
}

export function formatWeekRange(weekStart: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(weekStart);
  if (!match) return weekStart;
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]) + 6);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${weekStart} ~ ${year}-${month}-${day}`;
}

export function mondayOf(date: Date): string {
  const day = date.getDay();
  const offset = day === 0 ? -6 : 1 - day;
  const monday = new Date(date.getFullYear(), date.getMonth(), date.getDate() + offset);
  const year = monday.getFullYear();
  const month = String(monday.getMonth() + 1).padStart(2, '0');
  const dayOfMonth = String(monday.getDate()).padStart(2, '0');
  return `${year}-${month}-${dayOfMonth}`;
}
