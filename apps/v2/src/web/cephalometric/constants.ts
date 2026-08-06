export const REPORT_STATUS_LABELS: Record<string, string> = {
  DRAFT: '草稿',
  COMPLETED: '已完成',
  FINAL: '最终',
};

export const COLOR_OPTIONS = [
  { value: '#2563eb', label: '蓝色' },
  { value: '#16a34a', label: '绿色' },
  { value: '#dc2626', label: '红色' },
  { value: '#9333ea', label: '紫色' },
  { value: '#d97706', label: '橙色' },
];

export const COMPARE_COLORS = [
  '#2563eb',
  '#dc2626',
  '#16a34a',
  '#9333ea',
  '#d97706',
  '#0f766e',
  '#db2777',
  '#4f46e5',
  '#65a30d',
  '#b45309',
];

export const DEFAULT_REPORT_JSON = `{
  "outline": [],
  "polylines": [],
  "outlineColor": "#2563eb",
  "lineColor": "#dc2626",
  "conclusion": ""
}`;
