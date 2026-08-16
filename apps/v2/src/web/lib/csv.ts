/**
 * CSV 客户端工具（从 pages/analytics/analytics-utils 下沉：共享组件不得依赖页面模块）。
 * 与服务端导出（src/server/shared/csv.ts / router.ts csvCell）保持同一公式注入防护口径。
 */

/** CWE-1236：阻止公式注入（Excel 打开时执行 =SUM(...) 等），与服务端导出保持一致。 */
export function csvCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  const text = typeof value === 'object' ? JSON.stringify(value) : String(value);
  const guarded = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
  return `"${guarded.replaceAll('"', '""')}"`;
}

/** 以 BOM 前缀生成 CSV/文本文件下载（Excel 打开 UTF-8 不乱码）。 */
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
