import ReactECharts from 'echarts-for-react/lib/core';
import echarts from '@/lib/echarts';
import { differenceInCalendarDays } from 'date-fns';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';
import {
  LAG_RISK_LABEL,
  LAG_RISK_COLOR,
  type LagRisk,
} from '@/lib/api/clinical/treatment-progress';

// ── 进度颜色 ────────────────────────────────────────────────────────────────

const PROGRESS_COLOR = {
  GREEN: 'bg-success',
  YELLOW: 'bg-warning',
  ORANGE: 'bg-orange-500',
  RED: 'bg-destructive',
} as const;

type ProgressColor = keyof typeof PROGRESS_COLOR;

function getProgressColor(pct: number): ProgressColor {
  if (pct >= 80) return 'GREEN';
  if (pct >= 50) return 'YELLOW';
  if (pct >= 30) return 'ORANGE';
  return 'RED';
}

const PROGRESS_TEXT_CLASS: Record<ProgressColor, string> = {
  GREEN: 'text-success',
  YELLOW: 'text-warning',
  ORANGE: 'text-orange-600',
  RED: 'text-destructive',
};

export const GENDER_LABEL: Record<string, string> = {
  MALE: '男',
  FEMALE: '女',
  UNKNOWN: '未知',
};

// ── 基础 UI 组件 ────────────────────────────────────────────────────────────

export function ProgressBar({ value, showLabel = true }: { value: number; showLabel?: boolean }) {
  const clamped = Math.max(0, Math.min(100, value));
  const color = getProgressColor(clamped);
  return (
    <div className="flex items-center gap-2 w-full min-w-[140px]">
      <div className="flex-1 h-2 bg-muted rounded-full overflow-hidden">
        <div
          data-testid={`progress-bar-${color}`}
          className={cn('h-full rounded-full transition-all', PROGRESS_COLOR[color])}
          style={{ width: `${clamped}%` }}
        />
      </div>
      {showLabel && (
        <span className={cn('text-xs font-medium tabular-nums w-12 text-right', PROGRESS_TEXT_CLASS[color])}>
          {clamped.toFixed(0)}%
        </span>
      )}
    </div>
  );
}

export function RingProgress({ value, size = 72 }: { value: number; size?: number }) {
  const clamped = Math.max(0, Math.min(100, value));
  const color = getProgressColor(clamped);
  const stroke = 8;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const offset = c - (clamped / 100) * c;
  const strokeColor: Record<ProgressColor, string> = {
    GREEN: '#27AE60',
    YELLOW: '#F39C12',
    ORANGE: '#F97316',
    RED: '#E74C3C',
  };
  return (
    <div className="relative" style={{ width: size, height: size }}>
      <svg width={size} height={size}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#E8ECF0" strokeWidth={stroke} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={strokeColor[color]}
          strokeWidth={stroke}
          strokeDasharray={c}
          strokeDashoffset={offset}
          strokeLinecap="round"
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center">
        <span className={cn('text-sm font-bold tabular-nums', PROGRESS_TEXT_CLASS[color])}>
          {clamped.toFixed(0)}%
        </span>
      </div>
    </div>
  );
}

export function KpiCard({
  label,
  value,
  icon: Icon,
  color,
  extra,
}: {
  label: string;
  value: React.ReactNode;
  icon: React.ComponentType<{ className?: string }>;
  color: string;
  extra?: React.ReactNode;
}) {
  const bgMap: Record<string, string> = {
    'text-primary': 'bg-primary/5',
    'text-success': 'bg-success/5',
    'text-destructive': 'bg-destructive/5',
    'text-warning': 'bg-warning/5',
    'text-info': 'bg-info/5',
    'text-muted-foreground': 'bg-muted',
  };
  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-center justify-between">
          <div className="flex-1">
            <div className="text-sm text-muted-foreground">{label}</div>
            <div className={cn('text-2xl font-bold mt-1 tabular-nums', color)}>{value}</div>
            {extra}
          </div>
          <div className={cn('p-3 rounded-lg', bgMap[color] ?? 'bg-muted')}>
            <Icon className={cn('w-6 h-6', color)} />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export function PatientAvatar({ name, gender }: { name: string; gender: string }) {
  const initial = name.charAt(0);
  const isFemale = gender === 'FEMALE';
  return (
    <div className={cn('w-8 h-8 rounded-full flex items-center justify-center text-xs font-medium text-white', isFemale ? 'bg-pink-400' : 'bg-blue-400')}>
      {initial}
    </div>
  );
}

export function DateFilter({ from, to, onChange }: { from?: string; to?: string; onChange: (from: string, to: string) => void }) {
  return (
    <div className="flex items-center gap-1.5">
      <Label className="text-xs whitespace-nowrap">日期</Label>
      <Input
        type="date"
        value={from ?? ''}
        onChange={(e) => onChange(e.target.value, to ?? '')}
        className="h-8 text-xs w-36"
        data-testid="date-from"
      />
      <span className="text-xs text-muted-foreground">至</span>
      <Input
        type="date"
        value={to ?? ''}
        onChange={(e) => onChange(from ?? '', e.target.value)}
        className="h-8 text-xs w-36"
        data-testid="date-to"
      />
    </div>
  );
}

// ── 图表组件 ────────────────────────────────────────────────────────────────

export function RiskPieChart({ riskCounts }: { riskCounts: Record<LagRisk, number> }) {
  const data = (Object.entries(riskCounts) as [LagRisk, number][])
    .filter(([, v]) => v > 0)
    .map(([k, v]) => ({ name: LAG_RISK_LABEL[k], value: v, itemStyle: { color: LAG_RISK_COLOR[k] } }));
  if (data.length === 0) return <div className="text-center text-muted-foreground py-6 text-sm">暂无风险数据</div>;
  return (
    <ReactECharts
      echarts={echarts}
      style={{ height: 220 }}
      option={{
        tooltip: { trigger: 'item', formatter: '{b}: {c} ({d}%)' },
        series: [{ type: 'pie', radius: ['40%', '70%'], data, label: { fontSize: 11 } }],
      }}
    />
  );
}

export function LagTrendChart({ trend }: { trend: Array<{ date: string; riskLevelsCount: [number, number, number, number, number] }> }) {
  if (!trend || trend.length === 0) return <div className="text-center text-muted-foreground py-6 text-sm">暂无趋势数据</div>;
  const dates = trend.map(t => t.date);
  const riskLabels: LagRisk[] = ['NONE', 'LOW', 'MEDIUM', 'HIGH', 'CRITICAL'];
  return (
    <ReactECharts
      echarts={echarts}
      style={{ height: 220 }}
      option={{
        tooltip: { trigger: 'axis' },
        legend: { data: riskLabels.map(r => LAG_RISK_LABEL[r]), bottom: 0, textStyle: { fontSize: 10 } },
        grid: { top: 10, right: 10, bottom: 40, left: 30 },
        xAxis: { type: 'category', data: dates, axisLabel: { fontSize: 10, rotate: 30 } },
        yAxis: { type: 'value', axisLabel: { fontSize: 10 } },
        series: riskLabels.map((r, i) => ({
          name: LAG_RISK_LABEL[r],
          type: 'line',
          stack: 'total',
          areaStyle: { opacity: 0.3 },
          lineStyle: { width: 1 },
          itemStyle: { color: LAG_RISK_COLOR[r] },
          data: trend.map(t => t.riskLevelsCount[i]),
        })),
      }}
    />
  );
}

export function PlanStatusPieChart({ dist }: { dist: { ONGOING: number; COMPLETED: number; PAUSED: number } }) {
  const data = [
    { name: '进行中', value: dist.ONGOING, itemStyle: { color: '#3B82F6' } },
    { name: '已完成', value: dist.COMPLETED, itemStyle: { color: '#27AE60' } },
    { name: '已暂停', value: dist.PAUSED, itemStyle: { color: '#F39C12' } },
  ].filter(d => d.value > 0);
  if (data.length === 0) return <div className="text-center text-muted-foreground py-6 text-sm">暂无计划数据</div>;
  return (
    <ReactECharts
      echarts={echarts}
      style={{ height: 220 }}
      option={{
        tooltip: { trigger: 'item', formatter: '{b}: {c} ({d}%)' },
        series: [{ type: 'pie', radius: ['40%', '70%'], data, label: { fontSize: 11 } }],
      }}
    />
  );
}

export function CompletionStackedBar({ plans }: { plans: Array<{ planName: string; patientName: string; completionPct: number }> }) {
  const slice = plans.slice(0, 15);
  if (slice.length === 0) return <div className="text-center text-muted-foreground py-6 text-sm">暂无数据</div>;
  return (
    <ReactECharts
      echarts={echarts}
      style={{ height: Math.max(200, slice.length * 28) }}
      option={{
        tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
        grid: { top: 10, right: 20, bottom: 10, left: 120 },
        xAxis: { type: 'value', max: 100, axisLabel: { formatter: '{value}%', fontSize: 10 } },
        yAxis: { type: 'category', data: slice.map(p => `${p.patientName} - ${p.planName}`), axisLabel: { fontSize: 10, width: 100, overflow: 'truncate' }, inverse: true },
        series: [{
          type: 'bar',
          data: slice.map(p => ({
            value: p.completionPct,
            itemStyle: { color: p.completionPct >= 80 ? '#27AE60' : p.completionPct >= 50 ? '#F39C12' : '#E74C3C' },
          })),
          barMaxWidth: 16,
          label: { show: true, position: 'right', formatter: '{c}%', fontSize: 10 },
        }],
      }}
    />
  );
}

export function SnapshotsLineChart({ snapshots }: { snapshots: Array<{ snapshotDate: string; completionPct: number }> }) {
  if (!snapshots || snapshots.length === 0) return <div className="text-center text-muted-foreground py-6 text-sm">暂无趋势数据</div>;
  return (
    <ReactECharts
      echarts={echarts}
      style={{ height: 220 }}
      option={{
        tooltip: { trigger: 'axis' },
        grid: { top: 10, right: 10, bottom: 30, left: 40 },
        xAxis: { type: 'category', data: snapshots.map(s => s.snapshotDate), axisLabel: { fontSize: 10, rotate: 30 } },
        yAxis: { type: 'value', max: 100, axisLabel: { formatter: '{value}%', fontSize: 10 } },
        series: [{
          type: 'line',
          data: snapshots.map(s => s.completionPct),
          smooth: true,
          areaStyle: { opacity: 0.15 },
          lineStyle: { width: 2, color: '#3B82F6' },
          itemStyle: { color: '#3B82F6' },
        }],
      }}
    />
  );
}

// ── 工具函数 ────────────────────────────────────────────────────────────────

export function daysUntil(target: string): number {
  return differenceInCalendarDays(new Date(target), new Date());
}
