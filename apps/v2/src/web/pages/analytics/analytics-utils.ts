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

export function today(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

export function daysAgo(days: number): string {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

export function maxValue(rows: ChartRow[], key: (row: ChartRow) => number): number {
  return Math.max(1, ...rows.map((row) => Number(key(row) || 0)));
}

export function csvCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  const text = typeof value === 'object' ? JSON.stringify(value) : String(value);
  // CWE-1236：阻止公式注入（Excel 打开时执行 =SUM(...) 等），与服务端导出保持一致。
  const guarded = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
  return `"${guarded.replaceAll('"', '""')}"`;
}

export function downloadTextFile(filename: string, content: string, mime = 'text/csv;charset=utf-8'): void {
  const blob = new Blob([`\ufeff${content}`], { type: mime });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  // 延迟释放，避免 Firefox 等在下载尚未开始时 revoke 导致空文件。
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
