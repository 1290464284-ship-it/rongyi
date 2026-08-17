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

// D1：固定对比调色板引用 --chart-1..10（亮/暗双主题各自取值），
// 与 styles.css 图表系列色同源；用户可配置的轮廓/折线色（COLOR_OPTIONS）保持十六进制数据值。
export const COMPARE_COLORS = [
  'var(--chart-1)',
  'var(--chart-2)',
  'var(--chart-3)',
  'var(--chart-4)',
  'var(--chart-5)',
  'var(--chart-6)',
  'var(--chart-7)',
  'var(--chart-8)',
  'var(--chart-9)',
  'var(--chart-10)',
];

export const DEFAULT_REPORT_JSON = `{
  "outline": [],
  "polylines": [],
  "outlineColor": "${DEFAULT_OUTLINE_COLOR}",
  "lineColor": "${DEFAULT_LINE_COLOR}",
  "conclusion": ""
}`;
