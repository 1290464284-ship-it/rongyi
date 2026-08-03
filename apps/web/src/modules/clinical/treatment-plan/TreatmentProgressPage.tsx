import { useState, useMemo, useCallback } from 'react';
import {
  ClipboardList,
  CheckCircle2,
  AlertTriangle,
  AlertCircle,
  TrendingDown,
  Clock,
  User,
  Search,
  Filter,
  RefreshCw,
  Printer,
  ChevronRight,
  X,
  BarChart3,
  ChevronDown,
} from 'lucide-react';
import { format } from 'date-fns';
import { zhCN } from 'date-fns/locale';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import {
  Table,
  TableBody,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { DataTableWrapper, type DataTableColumn } from '@/components/ui/data-table-wrapper';
import { TableLoading, EmptyState } from '@/components/ui/loading';
import { QueryErrorAlert } from '@/components/QueryErrorAlert';
import { useDoctors } from '@/lib/staff';
import { cn } from '@/lib/utils';
import {
  useTreatmentProgressPlans,
  useTreatmentProgressOverview,
  useRefreshTreatmentProgress,
  LAG_RISK_LABEL,
  LAG_RISK_BADGE_CLASS,
  LAG_RISK_COLOR,
  type TreatmentProgressPlan,
  type LagRisk,
  type PlanProgressStatus,
  type PlanListQuery,
} from '@/lib/api/clinical/treatment-progress';
import {
  ProgressBar,
  RingProgress,
  KpiCard,
  PatientAvatar,
  DateFilter,
  RiskPieChart,
  LagTrendChart,
  PlanStatusPieChart,
  CompletionStackedBar,
  GENDER_LABEL,
  daysUntil,
} from './components/progress-charts';
import PlanDetailDialog from './components/PlanDetailDialog';

type TabKey = 'overview' | 'board' | 'today';

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
                            治疗项明细 — {plan.patientName} · {plan.planName}
                          </CardTitle>
                        </CardHeader>
                        <CardContent className="p-0">
                          <div className="px-4 py-3 text-xs text-muted-foreground">
                            展开明细请点击「详情」按钮查看完整内容，或在详情弹窗中浏览。
                          </div>
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
