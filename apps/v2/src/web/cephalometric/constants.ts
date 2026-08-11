// label 字典统一集中在 ../labels.ts（M-03），此处 re-export 保持旧导入路径不变。
export { REPORT_STATUS_LABELS } from '../lib/labels';

export const COLOR_OPTIONS = [
  { value: '#2563eb', label: '蓝色' },
  { value: '#16a34a', label: '绿色' },
  { value: '#dc2626', label: '红色' },
  { value: '#9333ea', label: '紫色' },
  { value: '#d97706', label: '橙色' },
];

export const DEFAULT_OUTLINE_COLOR = COLOR_OPTIONS[0].value;
export const DEFAULT_LINE_COLOR = COLOR_OPTIONS[2].value;

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
  "outlineColor": "${DEFAULT_OUTLINE_COLOR}",
  "lineColor": "${DEFAULT_LINE_COLOR}",
  "conclusion": ""
}`;
