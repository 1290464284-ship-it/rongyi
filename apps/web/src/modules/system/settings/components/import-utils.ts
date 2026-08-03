import type React from 'react';
import { Users, Pill, Package } from 'lucide-react';
import type { BulkImportType } from '@/lib/api/system/bulk-import';

export type TabKey = BulkImportType;

export interface ParsedData {
  fileName: string;
  fileSize: number;
  header: string[];
  rows: string[][];
  objects: Record<string, string>[];
}

export const TAB_CONFIG: Record<TabKey, { label: string; icon: React.ComponentType<{ className?: string }> }> = {
  patient: { label: '患者导入', icon: Users },
  drug: { label: '药品目录导入', icon: Pill },
  inventory: { label: '库存导入', icon: Package },
};

export const STEPS = [
  { num: 1, label: '下载模板' },
  { num: 2, label: '上传文件' },
  { num: 3, label: '预览校验' },
  { num: 4, label: '确认导入' },
];

export const ACCEPTED_EXT = ['.csv', '.tsv', '.txt'];
export const REJECTED_EXT = ['.xlsx', '.xls', '.xlsm'];

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

export function buildCSVFromTemplate(columns: { key: string; example?: string }[]): string {
  const header = columns.map((c) => c.key).join(',');
  const example = columns
    .map((c) => {
      const val = c.example ?? '';
      if (val.includes(',') || val.includes('"') || val.includes('\n')) {
        return `"${val.replace(/"/g, '""')}"`;
      }
      return val;
    })
    .join(',');
  return `${header}\r\n${example}\r\n`;
}

export function triggerDownload(filename: string, content: string, mime = 'text/csv;charset=utf-8;') {
  const BOM = '\uFEFF';
  const blob = new Blob([BOM + content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
