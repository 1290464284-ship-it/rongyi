/* eslint-disable @typescript-eslint/no-unused-vars -- TODO: 逐步修复 lint 问题 */
import { useState, useMemo, useCallback } from 'react';
import {
  ClipboardList,
  CheckCircle2,
  AlertTriangle,
  AlertCircle,
  TrendingDown,
  Clock,
  DollarSign,
  Smile,
  User,
  Search,
  Filter,
  RefreshCw,
  Printer,
  ChevronRight,
  X,
  BarChart3,
  CalendarDays,
  ChevronDown,
} from 'lucide-react';
import ReactECharts from 'echarts-for-react/lib/core';
import echarts from '@/lib/echarts';
import { format, differenceInDays, differenceInCalendarDays } from 'date-fns';
import { zhCN } from 'date-fns/locale';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { DataTableWrapper, type DataTableColumn } from '@/components/ui/data-table-wrapper';
import { TableLoading, EmptyState, Spinner } from '@/components/ui/loading';
import { QueryErrorAlert } from '@/components/QueryErrorAlert';
import { useDoctors } from '@/lib/staff';
import { cn } from '@/lib/utils';
import {
  useTreatmentProgressPlans,
  useTreatmentProgressOverview,
  useTreatmentProgressDetail,
  useRefreshTreatmentProgress,
  LAG_RISK,
  LAG_RISK_LABEL,
  LAG_RISK_BADGE_CLASS,
  LAG_RISK_COLOR,
  PLAN_STATUS,
  PLAN_STATUS_LABEL,
  PLAN_STATUS_COLOR,
  ITEM_STATUS_LABEL,
  ITEM_STATUS_BADGE_CLASS,
  TIMELINE_KIND_LABEL,
  type TreatmentProgressPlan,
  type TreatmentProgressItem,
  type LagRisk,
  type PlanProgressStatus,
  type PlanListQuery,
} from '@/lib/api/clinical/treatment-progress';

type TabKey = 'overview' | 'board' | 'today';

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

const GENDER_LABEL: Record<string, string> = {
  MALE: '男',
  FEMALE: '女',
  UNKNOWN: '未知',
};

function ProgressBar({ value, showLabel = true }: { value: number; showLabel?: boolean }) {
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

function RingProgress({ value, size = 72 }: { value: number; size?: number }) {
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

function KpiCard({
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

function PatientAvatar({ name, gender }: { name: string; gender: string }) {
  const bg = gender === 'FEMALE' ? 'bg-pink-500/10 text-pink-600' : 'bg-primary/10 text-primary';
  return (
    <div className={cn('w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium', bg)}>
      {name[0] ?? '?'}
    </div>
  );
}

function DateFilter({ from, to, onChange }: { from?: string; to?: string; onChange: (from: string, to: string) => void }) {
  return (
    <div className="flex items-center gap-2">
      <CalendarDays className="w-4 h-4 text-muted-foreground" />
      <Input
        type="date"
        value={from ?? ''}
        onChange={(e) => onChange(e.target.value, to ?? '')}
        className="w-36 h-8 text-xs"
      />
      <span className="text-muted-foreground text-xs">至</span>
      <Input
        type="date"
        value={to ?? ''}
        onChange={(e) => onChange(from ?? '', e.target.value)}
        className="w-36 h-8 text-xs"
      />
    </div>
  );
}

function RiskPieChart({ riskCounts }: { riskCounts: Record<LagRisk, number> }) {
  const option = useMemo(() => ({
    tooltip: { trigger: 'item', formatter: '{b}: {c} ({d}%)' },
    legend: { bottom: 0, icon: 'circle', itemWidth: 8, itemHeight: 8, textStyle: { fontSize: 11, color: '#6B7C93' } },
    series: [{
      type: 'pie',
      radius: ['50%', '72%'],
      center: ['50%', '42%'],
      avoidLabelOverlap: true,
      itemStyle: { borderColor: '#fff', borderWidth: 2 },
      label: { show: false },
      emphasis: { label: { show: true, fontSize: 12, fontWeight: 'bold' } },
      data: [
        { name: LAG_RISK_LABEL.NONE, value: riskCounts.NONE ?? 0, itemStyle: { color: LAG_RISK_COLOR.NONE } },
        { name: LAG_RISK_LABEL.LOW, value: riskCounts.LOW ?? 0, itemStyle: { color: LAG_RISK_COLOR.LOW } },
        { name: LAG_RISK_LABEL.MEDIUM, value: riskCounts.MEDIUM ?? 0, itemStyle: { color: LAG_RISK_COLOR.MEDIUM } },
        { name: LAG_RISK_LABEL.HIGH, value: riskCounts.HIGH ?? 0, itemStyle: { color: LAG_RISK_COLOR.HIGH } },
        { name: LAG_RISK_LABEL.CRITICAL, value: riskCounts.CRITICAL ?? 0, itemStyle: { color: LAG_RISK_COLOR.CRITICAL } },
      ],
    }],
  }), [riskCounts]);

  const total = Object.values(riskCounts).reduce((a, b) => a + b, 0);
  if (total === 0) return <div className="text-center text-muted-foreground py-8 text-sm">暂无数据</div>;
  return <ReactECharts echarts={echarts} option={option} style={{ height: '240px' }} />;
}

function LagTrendChart({ trend }: { trend: Array<{ date: string; riskLevelsCount: [number, number, number, number, number] }> }) {
  const option = useMemo(() => {
    const dates = trend.map((t) => t.date.slice(5));
    const stack = 'risk';
    return {
      tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
      legend: { bottom: 0, icon: 'roundRect', itemWidth: 10, itemHeight: 8, textStyle: { fontSize: 11, color: '#6B7C93' }, data: [LAG_RISK_LABEL.NONE, LAG_RISK_LABEL.LOW, LAG_RISK_LABEL.MEDIUM, LAG_RISK_LABEL.HIGH, LAG_RISK_LABEL.CRITICAL] },
      grid: { left: 40, right: 16, top: 24, bottom: 44 },
      xAxis: { type: 'category', boundaryGap: false, data: dates, axisLabel: { color: '#6B7C93', fontSize: 10 }, axisLine: { lineStyle: { color: '#DCE2E8' } } },
      yAxis: { type: 'value', axisLabel: { color: '#6B7C93', fontSize: 10 }, axisLine: { show: false }, splitLine: { lineStyle: { color: '#E8ECF0', type: 'dashed' } } },
      series: ([
        { key: 0, name: LAG_RISK_LABEL.NONE, color: LAG_RISK_COLOR.NONE },
        { key: 1, name: LAG_RISK_LABEL.LOW, color: LAG_RISK_COLOR.LOW },
        { key: 2, name: LAG_RISK_LABEL.MEDIUM, color: LAG_RISK_COLOR.MEDIUM },
        { key: 3, name: LAG_RISK_LABEL.HIGH, color: LAG_RISK_COLOR.HIGH },
        { key: 4, name: LAG_RISK_LABEL.CRITICAL, color: LAG_RISK_COLOR.CRITICAL },
      ] as const).map((s) => ({
        name: s.name,
        type: 'line',
        stack,
        smooth: true,
        showSymbol: false,
        areaStyle: { color: s.color, opacity: 0.35 },
        lineStyle: { color: s.color, width: 1.5 },
        itemStyle: { color: s.color },
        data: trend.map((t) => t.riskLevelsCount[s.key] ?? 0),
      })),
    };
  }, [trend]);

  if (!trend.length) return <div className="text-center text-muted-foreground py-8 text-sm">暂无数据</div>;
  return <ReactECharts echarts={echarts} option={option} style={{ height: '260px' }} />;
}

function PlanStatusPieChart({ dist }: { dist: { ONGOING: number; COMPLETED: number; PAUSED: number } }) {
  const option = useMemo(() => ({
    tooltip: { trigger: 'item', formatter: '{b}: {c} ({d}%)' },
    legend: { bottom: 0, icon: 'circle', itemWidth: 8, itemHeight: 8, textStyle: { fontSize: 11, color: '#6B7C93' } },
    series: [{
      type: 'pie',
      radius: ['42%', '70%'],
      center: ['50%', '42%'],
      itemStyle: { borderColor: '#fff', borderWidth: 2 },
      label: { show: true, formatter: '{b}\n{c}', fontSize: 11 },
      data: [
        { name: PLAN_STATUS_LABEL.ONGOING, value: dist.ONGOING, itemStyle: { color: PLAN_STATUS_COLOR.ONGOING } },
        { name: PLAN_STATUS_LABEL.COMPLETED, value: dist.COMPLETED, itemStyle: { color: PLAN_STATUS_COLOR.COMPLETED } },
        { name: PLAN_STATUS_LABEL.PAUSED, value: dist.PAUSED, itemStyle: { color: PLAN_STATUS_COLOR.PAUSED } },
      ],
    }],
  }), [dist]);

  const total = dist.ONGOING + dist.COMPLETED + dist.PAUSED;
  if (total === 0) return <div className="text-center text-muted-foreground py-8 text-sm">暂无数据</div>;
  return <ReactECharts echarts={echarts} option={option} style={{ height: '240px' }} />;
}

function CompletionStackedBar({ plans }: { plans: TreatmentProgressPlan[] }) {
  const option = useMemo(() => {
    const items = plans.slice(0, 15);
    return {
      tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' }, formatter: (params: unknown) => {
        const arr = Array.isArray(params) ? params : [];
        if (!arr.length) return '';
        const p = arr[0] as { axisValueLabel: string; value: number };
        return `${p.axisValueLabel}<br/>已完成：${p.value}%`;
      } },
      grid: { left: 120, right: 30, top: 10, bottom: 20 },
      xAxis: { type: 'value', max: 100, axisLabel: { formatter: '{value}%', color: '#6B7C93', fontSize: 10 }, splitLine: { lineStyle: { color: '#E8ECF0', type: 'dashed' } } },
      yAxis: { type: 'category', data: items.map((p) => `${p.patientName} - ${p.planName}`), axisLabel: { color: '#2C3E50', fontSize: 10, width: 110, overflow: 'truncate' }, axisLine: { show: false }, axisTick: { show: false } },
      series: [
        {
          name: '已完成',
          type: 'bar',
          stack: 'total',
          data: items.map((p) => p.completionPct),
          itemStyle: { color: (p: { dataIndex: number }) => {
            const plan = items[p.dataIndex];
            return PLAN_STATUS_COLOR[plan.status] ?? '#1E5AA8';
          }, borderRadius: [0, 4, 4, 0] },
          barWidth: 12,
        },
        {
          name: '未完成',
          type: 'bar',
          stack: 'total',
          data: items.map((p) => Math.max(0, 100 - p.completionPct)),
          itemStyle: { color: '#E8ECF0', borderRadius: [4, 0, 0, 4] },
          barWidth: 12,
        },
      ],
    };
  }, [plans]);

  if (!plans.length) return <div className="text-center text-muted-foreground py-8 text-sm">暂无数据</div>;
  return <ReactECharts echarts={echarts} option={option} style={{ height: `${Math.max(320, plans.length * 32)}px` }} />;
}

function SnapshotsLineChart({ snapshots }: { snapshots: Array<{ snapshotDate: string; completionPct: number }> }) {
  const option = useMemo(() => ({
    tooltip: { trigger: 'axis' },
    grid: { left: 40, right: 20, top: 20, bottom: 36 },
    xAxis: { type: 'category', boundaryGap: false, data: snapshots.map((s) => s.snapshotDate.slice(5)), axisLabel: { color: '#6B7C93', fontSize: 10 }, axisLine: { lineStyle: { color: '#DCE2E8' } } },
    yAxis: { type: 'value', max: 100, axisLabel: { formatter: '{value}%', color: '#6B7C93', fontSize: 10 }, splitLine: { lineStyle: { color: '#E8ECF0', type: 'dashed' } } },
    series: [{
      name: '完成度',
      type: 'line',
      smooth: true,
      symbol: 'circle',
      symbolSize: 5,
      data: snapshots.map((s) => s.completionPct),
      itemStyle: { color: '#1E5AA8' },
      lineStyle: { width: 2, color: '#1E5AA8' },
      areaStyle: { color: { type: 'linear', x: 0, y: 0, x2: 0, y2: 1, colorStops: [{ offset: 0, color: 'rgba(30, 90, 168, 0.2)' }, { offset: 1, color: 'rgba(30, 90, 168, 0.01)' }] } },
    }],
  }), [snapshots]);

  if (!snapshots.length) return <div className="text-center text-muted-foreground py-6 text-sm">暂无快照数据</div>;
  return <ReactECharts echarts={echarts} option={option} style={{ height: '220px' }} />;
}

function PlanDetailDialog({
  open,
  planId,
  onClose,
  onRefresh,
  onPrint,
}: {
  open: boolean;
  planId: string | undefined;
  onClose: () => void;
  onRefresh: (planId: string) => void;
  onPrint: (planId: string) => void;
}) {
  const { data, isLoading, isError, refetch } = useTreatmentProgressDetail(planId, { enabled: open });
  if (!open) return null;

  return (
    <Dialog open={open} onClose={onClose} className="max-w-6xl">
      <DialogHeader>
        <div className="flex items-center justify-between flex-wrap gap-2">
          <DialogTitle>
            <div className="flex items-center gap-2">
              <ClipboardList className="w-5 h-5 text-primary" />
              <span>疗程进度详情</span>
              {data?.plan && PLAN_STATUS_COLOR[data.plan.status] && (
                <span
                  className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium"
                  style={{ backgroundColor: `${PLAN_STATUS_COLOR[data.plan.status]}22`, color: PLAN_STATUS_COLOR[data.plan.status] }}
                >
                  {PLAN_STATUS_LABEL[data.plan.status]}
                </span>
              )}
              {data?.plan && !PLAN_STATUS_COLOR[data.plan.status] && (
                <Badge className="bg-muted">{PLAN_STATUS_LABEL[data.plan.status]}</Badge>
              )}
            </div>
          </DialogTitle>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => planId && onRefresh(planId)}>
              <RefreshCw className="w-4 h-4 mr-1" /> 重算进度
            </Button>
            <Button size="sm" onClick={() => planId && onPrint(planId)}>
              <Printer className="w-4 h-4 mr-1" /> 打印计划
            </Button>
          </div>
        </div>
      </DialogHeader>
      <DialogContent className="space-y-5">
        {isError && <QueryErrorAlert onRetry={refetch} />}
        {isLoading && <div className="text-center py-8"><Spinner /> <span className="ml-2 text-muted-foreground text-sm">加载中…</span></div>}

        {data && (
          <>
            <Card>
              <CardContent className="p-4 grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                <div>
                  <div className="text-xs text-muted-foreground mb-1">患者</div>
                  <div className="flex items-center gap-2 font-medium">
                    <PatientAvatar name={data.plan.patientName} gender={data.plan.patientGender} />
                    <span>{data.plan.patientName}</span>
                    <span className="text-xs text-muted-foreground">
                      {GENDER_LABEL[data.plan.patientGender] ?? '未知'} · {data.plan.age}岁
                    </span>
                  </div>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground mb-1">主治医生</div>
                  <div className="font-medium flex items-center gap-1">
                    <User className="w-3.5 h-3.5 text-muted-foreground" /> {data.plan.doctorName}
                  </div>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground mb-1">目标日期</div>
                  <div className="font-medium">
                    {format(new Date(data.plan.targetDate), 'yyyy-MM-dd', { locale: zhCN })}
                    {data.plan.delayDays > 0 && <span className="ml-2 text-xs text-destructive">滞后 {data.plan.delayDays} 天</span>}
                  </div>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground mb-1">完成进度</div>
                  <div className="flex items-center gap-3">
                    <RingProgress value={data.plan.completionPct} size={56} />
                    <div className="text-xs text-muted-foreground">
                      <div>已完 {data.plan.completedItems} / 共 {data.plan.totalItems} 项</div>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>

            <div>
              <h4 className="text-sm font-semibold mb-3 flex items-center gap-1">
                <CheckCircle2 className="w-4 h-4 text-success" /> 治疗项明细
              </h4>
              <Card>
                <CardContent className="p-0">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>牙位</TableHead>
                        <TableHead>治疗项</TableHead>
                        <TableHead>编码</TableHead>
                        <TableHead>价格</TableHead>
                        <TableHead>状态</TableHead>
                        <TableHead>预计天数</TableHead>
                        <TableHead>完成日期</TableHead>
                        <TableHead className="text-right">滞后天数</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {data.items.length === 0 ? (
                        <EmptyState colSpan={8} text="暂无治疗项" />
                      ) : data.items.map((item: TreatmentProgressItem) => (
                        <TableRow key={item.id}>
                          <TableCell>
                            {item.tooth ? (
                              <Badge className="bg-primary/10 text-primary inline-flex items-center gap-1">
                                <Smile className="w-3 h-3" /> {item.tooth}
                              </Badge>
                            ) : <span className="text-muted-foreground text-xs">—</span>}
                          </TableCell>
                          <TableCell className="font-medium">{item.treatmentName}</TableCell>
                          <TableCell className="font-mono text-xs text-muted-foreground">{item.treatmentCode}</TableCell>
                          <TableCell className="tabular-nums">¥{Number(item.price).toFixed(2)}</TableCell>
                          <TableCell>
                            <Badge className={ITEM_STATUS_BADGE_CLASS[item.status]}>{ITEM_STATUS_LABEL[item.status]}</Badge>
                          </TableCell>
                          <TableCell className="tabular-nums">D{item.expectedDay}</TableCell>
                          <TableCell className="text-xs">
                            {item.completedAt
                              ? format(new Date(item.completedAt), 'yyyy-MM-dd', { locale: zhCN })
                              : <span className="text-muted-foreground">预计 D{item.expectedDay}</span>}
                          </TableCell>
                          <TableCell className={cn('tabular-nums text-right', item.daysLag > 0 ? 'text-destructive font-medium' : 'text-muted-foreground')}>
                            {item.daysLag > 0 ? `+${item.daysLag}` : item.daysLag === 0 ? '0' : item.daysLag}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm flex items-center gap-1">
                    <TrendingDown className="w-4 h-4 text-primary" /> 30 日完成度趋势
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <SnapshotsLineChart snapshots={data.snapshots} />
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm flex items-center gap-1">
                    <Clock className="w-4 h-4 text-warning" /> 时间轴
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  {data.timeline.length === 0 ? (
                    <div className="text-center text-muted-foreground py-6 text-sm">暂无事件</div>
                  ) : (
                    <ol className="relative border-l border-border ml-2 space-y-4 max-h-[240px] overflow-auto pr-2">
                      {data.timeline.map((evt, idx) => (
                        <li key={idx} className="ml-4">
                          <span className="absolute -left-[7px] mt-1.5 w-3 h-3 rounded-full bg-primary ring-4 ring-white" />
                          <div className="flex items-center justify-between gap-2">
                            <Badge className="bg-primary/10 text-primary text-[10px]">
                              {TIMELINE_KIND_LABEL[evt.kind] ?? evt.kind}
                            </Badge>
                            <span className="text-[11px] text-muted-foreground tabular-nums">
                              {format(new Date(evt.createdAt), 'MM-dd HH:mm', { locale: zhCN })}
                            </span>
                          </div>
                          <p className="text-sm mt-1 text-foreground">{evt.content}</p>
                        </li>
                      ))}
                    </ol>
                  )}
                </CardContent>
              </Card>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

export default function TreatmentProgressPage() {
  const [tab, setTab] = useState<TabKey>('board');
  const [statusFilter, setStatusFilter] = useState<PlanProgressStatus | 'ALL'>('ALL');
  const [doctorId, setDoctorId] = useState<string>('');
  const [risks, setRisks] = useState<LagRisk[]>([]);
  const [from, setFrom] = useState<string>('');
  const [to, setTo] = useState<string>('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const pageSize = 20;

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [detailOpen, setDetailOpen] = useState(false);
  const [detailPlanId, setDetailPlanId] = useState<string | undefined>(undefined);

  const { data: doctors } = useDoctors();

  const query: PlanListQuery = useMemo(() => ({
    status: statusFilter === 'ALL' ? undefined : statusFilter,
    from: from || undefined,
    to: to || undefined,
    doctorId: doctorId || undefined,
    risk: risks.length === 0 ? undefined : risks,
    search: search || undefined,
    page,
    pageSize,
  }), [statusFilter, from, to, doctorId, risks, search, page, pageSize]);

  const overview = useTreatmentProgressOverview({ from: from || undefined, to: to || undefined });
  const plans = useTreatmentProgressPlans(query);
  const refreshMutation = useRefreshTreatmentProgress();

  const today = new Date();
  const todayDateStr = format(today, 'yyyy-MM-dd');

  const todayDuePlans = useMemo(() => {
    const arr = plans.data?.items ?? [];
    return arr.filter((p) => format(new Date(p.targetDate), 'yyyy-MM-dd') === todayDateStr);
  }, [plans.data, todayDateStr]);

  const displayPlans = tab === 'today' ? todayDuePlans : plans.data?.items ?? [];
  const displayTotal = tab === 'today' ? todayDuePlans.length : plans.data?.total ?? 0;

  const toggleSelected = useCallback((planId: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(planId)) next.delete(planId);
      else next.add(planId);
      return next;
    });
  }, []);

  const toggleExpand = useCallback((planId: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(planId)) next.delete(planId);
      else next.add(planId);
      return next;
    });
  }, []);

  const handlePrint = useCallback((planId: string) => {
    window.open(`#/print-preview?type=treatment&id=${planId}`, '_blank', 'noopener,noreferrer');
  }, []);

  const handleBatchPrint = useCallback(() => {
    if (selected.size === 0) return;
    if (selected.size === 1) {
      handlePrint(Array.from(selected)[0]);
      return;
    }
    if (typeof window !== 'undefined' && window.confirm && !window.confirm(`将为 ${selected.size} 个计划在新标签组中打开打印页面，是否继续？`)) return;
    Array.from(selected).forEach((id, i) => {
      setTimeout(() => handlePrint(id), i * 150);
    });
  }, [selected, handlePrint]);

  const handleRefresh = useCallback((planId: string) => {
    refreshMutation.mutate(planId);
  }, [refreshMutation]);

  const openDetail = useCallback((planId: string) => {
    setDetailPlanId(planId);
    setDetailOpen(true);
  }, []);

  const riskOptions: LagRisk[] = ['NONE', 'LOW', 'MEDIUM', 'HIGH', 'CRITICAL'];
  const toggleRisk = (r: LagRisk) => setRisks((prev) => prev.includes(r) ? prev.filter((x) => x !== r) : [...prev, r]);

  function daysUntil(target: string): number {
    return differenceInCalendarDays(new Date(target), today);
  }

  const kpi = overview.data;
  const criticalHighCount = (kpi?.riskCounts?.CRITICAL ?? 0) + (kpi?.riskCounts?.HIGH ?? 0);

  const columns: DataTableColumn<TreatmentProgressPlan>[] = [
    {
      key: 'select',
      header: (
        <div className="flex items-center gap-2">
          <input
            type="checkbox"
            aria-label="全选"
            data-testid="select-all"
            checked={displayPlans.length > 0 && displayPlans.every((p) => selected.has(p.planId))}
            onChange={(e) => {
              if (e.target.checked) setSelected(new Set(displayPlans.map((p) => p.planId)));
              else setSelected(new Set());
            }}
            className="h-4 w-4 rounded border-border text-primary focus:ring-primary cursor-pointer"
          />
        </div>
      ),
      width: '48px',
      cell: (row) => (
        <input
          type="checkbox"
          aria-label={`选择 ${row.patientName}`}
          data-testid={`row-select-${row.planId}`}
          checked={selected.has(row.planId)}
          onChange={() => toggleSelected(row.planId)}
          className="h-4 w-4 rounded border-border text-primary focus:ring-primary cursor-pointer"
        />
      ),
    },
    {
      key: 'expand',
      header: '',
      width: '36px',
      cell: (row) => (
        <button
          aria-label={expanded.has(row.planId) ? '收起' : '展开'}
          onClick={() => toggleExpand(row.planId)}
          className="p-1 rounded hover:bg-muted transition-colors"
        >
          <ChevronDown className={cn('w-4 h-4 text-muted-foreground transition-transform', expanded.has(row.planId) && 'rotate-180')} />
        </button>
      ),
    },
    {
      key: 'patient',
      header: '患者',
      cell: (row) => (
        <div className="flex items-center gap-2 min-w-[160px]">
          <PatientAvatar name={row.patientName} gender={row.patientGender} />
          <div>
            <div className="font-medium text-sm">{row.patientName}</div>
            <div className="text-xs text-muted-foreground">
              {GENDER_LABEL[row.patientGender] ?? '未知'} · {row.age}岁
            </div>
          </div>
        </div>
      ),
    },
    { key: 'planName', header: '计划名称', accessorKey: 'planName', className: 'font-medium min-w-[140px]' },
    {
      key: 'doctor',
      header: '主治医生',
      cell: (row) => (
        <div className="flex items-center gap-1 text-sm">
          <User className="w-3.5 h-3.5 text-muted-foreground" />
          <span>{row.doctorName}</span>
        </div>
      ),
    },
    {
      key: 'dateRange',
      header: '创建日 → 目标日',
      cell: (row) => {
        const d = daysUntil(row.targetDate);
        return (
          <div className="text-xs min-w-[170px]">
            <div className="text-muted-foreground">
              {format(new Date(row.createdAt), 'MM-dd', { locale: zhCN })} →{' '}
              <span className="font-medium text-foreground">
                {format(new Date(row.targetDate), 'MM-dd', { locale: zhCN })}
              </span>
            </div>
            <div className={cn('mt-0.5 tabular-nums', d < 0 ? 'text-destructive' : d <= 3 ? 'text-warning' : 'text-muted-foreground')}>
              {d < 0 ? `已逾期 ${-d} 天` : d === 0 ? '今日到期' : `剩余 ${d} 天`}
            </div>
          </div>
        );
      },
    },
    {
      key: 'progress',
      header: '完成进度',
      width: '200px',
      cell: (row) => <ProgressBar value={row.completionPct} />,
    },
    {
      key: 'price',
      header: '应收 / 已收',
      cell: (row) => {
        const remain = Math.max(0, row.totalPrice - row.collectedPrice);
        return (
          <div className="text-xs tabular-nums min-w-[150px]">
            <div className="font-medium text-foreground">¥{Number(row.totalPrice).toFixed(2)}</div>
            <div className={cn('mt-0.5 flex items-center gap-1', remain === 0 ? 'text-success' : 'text-muted-foreground')}>
              已收 ¥{Number(row.collectedPrice).toFixed(2)}
              {remain === 0 ? <CheckCircle2 className="w-3 h-3" /> : <span className="text-destructive font-semibold">未收 ¥{remain.toFixed(2)}</span>}
            </div>
          </div>
        );
      },
    },
    {
      key: 'lagRisk',
      header: '滞后预警',
      cell: (row) => (
        <Badge data-testid={`lag-risk-${row.lagRisk}`} className={LAG_RISK_BADGE_CLASS[row.lagRisk]}>
          {row.lagRisk === 'NONE' && <span />}
          {row.lagRisk === 'LOW' && <AlertCircle className="w-3 h-3 mr-1" />}
          {(row.lagRisk === 'MEDIUM' || row.lagRisk === 'HIGH') && <AlertTriangle className="w-3 h-3 mr-1" />}
          {row.lagRisk === 'CRITICAL' && <AlertCircle className="w-3 h-3 mr-1" />}
          {LAG_RISK_LABEL[row.lagRisk]}
        </Badge>
      ),
    },
    {
      key: 'actions',
      header: '操作',
      className: 'text-right',
      cell: (row) => (
        <div className="flex items-center justify-end gap-1">
          <Button size="sm" variant="outline" onClick={() => openDetail(row.planId)}>
            <ChevronRight className="w-3 h-3" /> 详情
          </Button>
          <Button size="sm" variant="ghost" onClick={() => handleRefresh(row.planId)} disabled={refreshMutation.isPending}>
            <RefreshCw className={cn('w-3.5 h-3.5', refreshMutation.isPending && 'animate-spin')} />
          </Button>
          <Button size="sm" variant="ghost" onClick={() => handlePrint(row.planId)}>
            <Printer className="w-3.5 h-3.5" />
          </Button>
        </div>
      ),
    },
  ];

  return (
    <div className="p-6 space-y-5">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <ClipboardList className="w-7 h-7 text-primary" />
          <div>
            <h1 className="text-2xl font-bold">治疗进度</h1>
            <p className="text-xs text-muted-foreground mt-0.5">疗程进度看板 · 滞后预警 · 进度明细钻取</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => { overview.refetch(); plans.refetch(); }}>
            <RefreshCw className="w-4 h-4 mr-1" /> 刷新
          </Button>
          <Button
            size="sm"
            onClick={handleBatchPrint}
            disabled={selected.size === 0}
            data-testid="batch-print-btn"
          >
            <Printer className="w-4 h-4 mr-1" />
            批量打印 {selected.size > 0 && `(${selected.size})`}
          </Button>
        </div>
      </div>

      <Card>
        <CardContent className="p-4">
          <div className="flex items-center gap-3 flex-wrap">
            <div className="flex items-center gap-2">
              <Filter className="w-4 h-4 text-muted-foreground" />
              <Label className="text-xs whitespace-nowrap">状态</Label>
              <Select
                value={statusFilter}
                onChange={(e) => { setStatusFilter(e.target.value as PlanProgressStatus | 'ALL'); setPage(1); }}
                className="w-32 h-8 text-xs"
              >
                <option value="ALL">全部</option>
                <option value="ONGOING">进行中</option>
                <option value="COMPLETED">已完成</option>
                <option value="PAUSED">已暂停</option>
              </Select>
            </div>

            <div className="flex items-center gap-2">
              <Label className="text-xs whitespace-nowrap">医生</Label>
              <Select
                value={doctorId}
                onChange={(e) => { setDoctorId(e.target.value); setPage(1); }}
                className="w-36 h-8 text-xs"
                data-testid="doctor-select"
              >
                <option value="">全部医生</option>
                {doctors?.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
              </Select>
            </div>

            <div className="flex items-center gap-1.5">
              <Label className="text-xs whitespace-nowrap">风险</Label>
              <div className="flex items-center gap-1 flex-wrap">
                {riskOptions.map((r) => (
                  <button
                    key={r}
                    type="button"
                    onClick={() => toggleRisk(r)}
                    data-testid={`risk-filter-${r}`}
                    className={cn(
                      'h-7 px-2 rounded-md text-xs border transition-colors',
                      risks.includes(r)
                        ? 'border-transparent font-medium'
                        : 'border-border text-muted-foreground hover:bg-muted'
                    )}
                    style={risks.includes(r) ? { backgroundColor: `${LAG_RISK_COLOR[r]}22`, color: LAG_RISK_COLOR[r] } : undefined}
                  >
                    {LAG_RISK_LABEL[r]}
                  </button>
                ))}
              </div>
            </div>

            <DateFilter from={from} to={to} onChange={(f, t) => { setFrom(f); setTo(t); setPage(1); }} />

            <div className="flex-1 max-w-sm ml-auto">
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input
                  placeholder="搜索患者名 / 计划名"
                  value={search}
                  onChange={(e) => { setSearch(e.target.value); setPage(1); }}
                  className="pl-9 h-8 text-xs"
                  data-testid="search-input"
                />
                {search && (
                  <button
                    aria-label="清除搜索"
                    onClick={() => { setSearch(''); setPage(1); }}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        <KpiCard label="进行中计划" value={kpi?.ongoing ?? '-'} icon={ClipboardList} color="text-primary" />
        <KpiCard label="已完成计划" value={kpi?.completed ?? '-'} icon={CheckCircle2} color="text-success" />
        <KpiCard
          label="平均完成度"
          value={kpi !== undefined ? '' : '-'}
          icon={BarChart3}
          color="text-primary"
          extra={kpi !== undefined ? <div className="mt-2"><RingProgress value={kpi?.avgCompletionPct ?? 0} size={56} /></div> : undefined}
        />
        <KpiCard
          label="平均滞后天数"
          value={kpi ? (
            <span className={cn(kpi.avgDelayDays > 3 ? 'text-destructive' : kpi.avgDelayDays > 0 ? 'text-warning' : 'text-success')}>
              {kpi.avgDelayDays.toFixed(1)} 天
            </span>
          ) : '-'}
          icon={TrendingDown}
          color={kpi ? (kpi.avgDelayDays > 3 ? 'text-destructive' : kpi.avgDelayDays > 0 ? 'text-warning' : 'text-muted-foreground') : 'text-muted-foreground'}
        />
        <KpiCard
          label="高/严重预警"
          value={criticalHighCount}
          icon={AlertTriangle}
          color={criticalHighCount > 0 ? 'text-destructive' : 'text-muted-foreground'}
          extra={kpi ? (
            <div className="mt-1 text-[11px] text-muted-foreground">
              严重 {(kpi.riskCounts?.CRITICAL ?? 0)} · 高 {(kpi.riskCounts?.HIGH ?? 0)}
            </div>
          ) : undefined}
        />
        <KpiCard
          label="今日到期计划"
          value={kpi?.todayDueCount ?? '-'}
          icon={Clock}
          color={(kpi?.todayDueCount ?? 0) > 0 ? 'text-warning' : 'text-muted-foreground'}
          extra={kpi && kpi.overdueCount > 0 ? (
            <div className="mt-1 text-[11px] text-destructive">
              已逾期 {kpi.overdueCount}
            </div>
          ) : undefined}
        />
      </div>

      <Card>
        <CardHeader className="pb-2 pt-4">
          <div className="flex items-center justify-between">
            <div className="flex bg-muted rounded-md p-0.5">
              {(
                [
                  { k: 'overview', label: '总览', icon: BarChart3 },
                  { k: 'board', label: '进度看板', icon: ClipboardList },
                  { k: 'today', label: '今日到期', icon: Clock },
                ] as { k: TabKey; label: string; icon: React.ComponentType<{ className?: string }> }[]
              ).map((t) => (
                <button
                  key={t.k}
                  type="button"
                  onClick={() => setTab(t.k)}
                  data-testid={`tab-${t.k}`}
                  className={cn(
                    'px-4 py-1.5 text-xs font-medium rounded flex items-center gap-1.5 transition-colors',
                    tab === t.k ? 'bg-white shadow-sm text-primary' : 'text-muted-foreground hover:text-foreground'
                  )}
                >
                  <t.icon className="w-3.5 h-3.5" />
                  {t.label}
                  {t.k === 'today' && (kpi?.todayDueCount ?? 0) > 0 && (
                    <Badge className="bg-warning text-warning-foreground text-[10px] px-1.5 py-0 ml-0.5">
                      {kpi?.todayDueCount}
                    </Badge>
                  )}
                </button>
              ))}
            </div>
          </div>
        </CardHeader>
        <CardContent className="pt-2">
          {tab === 'overview' && (
            <div className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <Card>
                  <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-1"><AlertTriangle className="w-4 h-4 text-warning" /> 风险分布</CardTitle></CardHeader>
                  <CardContent>{kpi && <RiskPieChart riskCounts={kpi.riskCounts} />}</CardContent>
                </Card>
                <Card>
                  <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-1"><TrendingDown className="w-4 h-4 text-primary" /> 近 30 天滞后趋势</CardTitle></CardHeader>
                  <CardContent>{kpi && <LagTrendChart trend={kpi.lagTrend} />}</CardContent>
                </Card>
                <Card>
                  <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-1"><ClipboardList className="w-4 h-4 text-success" /> 计划状态分布</CardTitle></CardHeader>
                  <CardContent>{kpi && <PlanStatusPieChart dist={kpi.planStatusDistribution} />}</CardContent>
                </Card>
              </div>
              <Card>
                <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-1"><BarChart3 className="w-4 h-4 text-primary" /> 疗程完成进度条形图（前 15 条）</CardTitle></CardHeader>
                <CardContent>
                  <CompletionStackedBar plans={plans.data?.items ?? []} />
                </CardContent>
              </Card>
            </div>
          )}

          {(tab === 'board' || tab === 'today') && (
            <>
              {plans.isError && <QueryErrorAlert onRetry={plans.refetch} />}
              {plans.isLoading ? (
                <Table>
                  <TableHeader>
                    <TableRow>
                      {columns.map((c) => <TableHead key={c.key} className={c.className} style={c.width ? { width: c.width } : undefined}>{c.header}</TableHead>)}
                    </TableRow>
                  </TableHeader>
                  <TableBody><TableLoading colSpan={columns.length} /></TableBody>
                </Table>
              ) : (
                <>
                  {tab === 'today' && displayPlans.length === 0 && !plans.isLoading ? (
                    <EmptyState text="今日无到期计划" subtitle="完成度良好，继续保持！" icon={CheckCircle2} />
                  ) : (
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- DataTable 泛型与动态列适配
                    <DataTableWrapper<any>
                      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- DataTable 泛型与动态列适配
                      columns={columns as any}
                      data={displayPlans}
                      loading={plans.isLoading}
                      isEmpty={displayPlans.length === 0}
                      emptyText={tab === 'today' ? '今日无到期计划' : '暂无计划数据'}
                      emptySubtitle={tab === 'today' ? undefined : '请调整筛选条件后重试'}
                      rowKey={(row: TreatmentProgressPlan) => row.planId}
                      page={page}
                      pageSize={pageSize}
                      total={displayTotal}
                      onPageChange={setPage}
                      showPagination={tab !== 'today' && displayTotal > pageSize}
                      data-testid="progress-table"
                    />
                  )}
                </>
              )}

              {!plans.isLoading && expanded.size > 0 && (
                <div className="mt-3 space-y-2">
                  {Array.from(expanded).map((planId) => {
                    const plan = displayPlans.find((p) => p.planId === planId);
                    if (!plan) return null;
                    return (
                      <Card key={`expand-${planId}`}>
                        <CardHeader className="pb-2 pt-3">
                          <CardTitle className="text-xs text-muted-foreground flex items-center gap-1.5">
                            <Smile className="w-3.5 h-3.5" />
                            {plan.patientName} - {plan.planName} · 治疗项明细
                          </CardTitle>
                        </CardHeader>
                        <CardContent className="p-0">
                          <Table>
                            <TableHeader>
                              <TableRow>
                                <TableHead>牙位</TableHead>
                                <TableHead>治疗项</TableHead>
                                <TableHead>编码</TableHead>
                                <TableHead>价格</TableHead>
                                <TableHead>状态</TableHead>
                                <TableHead>完成日期 / 预计日</TableHead>
                              </TableRow>
                            </TableHeader>
                            <TableBody>
                              <TableRow>
                                <TableCell colSpan={6} className="text-xs text-muted-foreground py-2">
                                  展开明细请点击「详情」按钮查看完整内容，或在详情弹窗中浏览。
                                </TableCell>
                              </TableRow>
                            </TableBody>
                          </Table>
                        </CardContent>
                      </Card>
                    );
                  })}
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>

      <PlanDetailDialog
        open={detailOpen}
        planId={detailPlanId}
        onClose={() => setDetailOpen(false)}
        onRefresh={handleRefresh}
        onPrint={handlePrint}
      />
    </div>
  );
}
