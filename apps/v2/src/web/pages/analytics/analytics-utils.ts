export interface ChartRow extends Record<string, unknown> {
  period?: string | null;
  day?: string | null;
  surveyDate?: string | null;
  category?: string | null;
  amount?: number | null;
  count?: number | null;
  avgScore?: number | null;
  totalStock?: number | null;
  minStock?: number | null;
  doctorName?: string | null;
  surveyCount?: number | null;
  name?: string | null;
  frequency?: number | null;
  monetary?: number | null;
}

export function daysAgo(days: number): string {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

export function maxValue(rows: ChartRow[], key: (row: ChartRow) => number): number {
  return Math.max(1, ...rows.map((row) => Number(key(row) || 0)));
}

export { csvCell } from '../../lib/csv';
export { todayLocalDate as today } from '../../lib/format';
