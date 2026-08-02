/* eslint-disable @typescript-eslint/no-unused-vars -- TODO: 逐步修复 lint 问题 */
import { useState, useEffect, useMemo } from 'react';
import ReactECharts from 'echarts-for-react/lib/core';
import echarts from '@/lib/echarts';
import {
  Smile,
  Frown,
  TrendingUp,
  TrendingDown,
  Star,
  MessageSquare,
  Tag,
  QrCode,
  ThumbsUp,
  ThumbsDown,
  BarChart3,
  Users,
  Calendar,
  Search,
  Filter,
  RefreshCw,
  ClipboardList,
  Medal,
  ChevronUp,
  ChevronDown,
  Inbox,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { DataTableWrapper, type DataTableColumn } from '@/components/ui/data-table-wrapper';
import { PermissionButton } from '@/components/ui/permission';
import { SurveyDialog } from './SurveyDialog';
import { AcknowledgeDialog } from './AcknowledgeDialog';
import { buildNpsTrendOption, buildDoctorRankingOption, buildKeywordFreqOption } from './charts';
import {
  useSatisfactionDashboard,
  useSatisfactionSurveys,
  NPS_CATEGORY_LABEL,
  NPS_CATEGORY_COLOR,
  SENTIMENT_COLOR,
  DIMENSION_LABEL,
  getNpsColor,
  type SatisfactionSurvey,
  type NpsCategory,
  type KeywordSentiment,
} from '@/lib/api/communication/satisfaction';
import { formatClinicDate } from '@/lib/utils/datetime';

function formatDate(d: Date): string {
  return formatClinicDate(d);
}

function startOfDaysAgo(n: number): Date {
  const d = new Date();
  d.setDate(d.getDate() - n);
  d.setHours(0, 0, 0, 0);
  return d;
}

type TabType = 'trend' | 'doctors' | 'bad' | 'keywords';
type DateRange = '7d' | '30d' | '90d' | 'custom';

const TABS: { key: TabType; label: string; icon: typeof TrendingUp }[] = [
  { key: 'trend', label: '趋势分析', icon: TrendingUp },
  { key: 'doctors', label: '医生排名', icon: Medal },
  { key: 'bad', label: '差评列表', icon: ThumbsDown },
  { key: 'keywords', label: '关键词分析', icon: Tag },
];

const DOCTOR_OPTIONS = [
  { id: '', name: '全部医生' },
  { id: 'd1', name: '李医生' },
  { id: 'd2', name: '王医生' },
  { id: 'd3', name: '陈医生' },
];

const NPS_CATEGORY_OPTIONS: { value: NpsCategory | ''; label: string }[] = [
  { value: '', label: '全部 NPS' },
  { value: 'PROMOTER', label: '推荐者 (9-10)' },
  { value: 'PASSIVE', label: '中立者 (7-8)' },
  { value: 'DETRACTOR', label: '贬损者 (0-6)' },
];

const SENTIMENT_OPTIONS: { value: KeywordSentiment | 'ALL'; label: string }[] = [
  { value: 'ALL', label: '全部' },
  { value: 'POSITIVE', label: '正面' },
  { value: 'NEGATIVE', label: '负面' },
  { value: 'NEUTRAL', label: '中性' },
];

function RingProgress({ value, size = 140 }: { value: number; size?: number }) {
  const color = getNpsColor(value);
  const pct = Math.max(0, Math.min(100, (value + 100) / 2));
  const radius = (size - 16) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference * (1 - pct / 100);
  return (
    <div className="relative inline-flex items-center justify-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={radius} stroke="#e5e7eb" strokeWidth={12} fill="none" />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke={color}
          strokeWidth={12}
          fill="none"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          style={{ transition: 'stroke-dashoffset 0.6s ease' }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-3xl font-bold" style={{ color }} data-testid="nps-ring-value">{value}</span>
        <span className="text-xs text-muted-foreground">NPS %</span>
      </div>
    </div>
  );
}

function DimensionBar({ label, value }: { label: string; value: number }) {
  const pct = (value / 5) * 100;
  return (
    <div className="space-y-1">
      <div className="flex justify-between text-xs">
        <span className="text-muted-foreground">{label}</span>
        <span className="font-medium">{value.toFixed(1)}</span>
      </div>
      <div className="h-2 bg-muted rounded-full overflow-hidden">
        <div
          className="h-full bg-gradient-to-r from-primary to-secondary rounded-full transition-all"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

function KpiCard({
  icon: Icon,
  label,
  value,
  subValue,
  tone,
}: {
  icon: typeof Smile;
  label: string;
  value: string | number;
  subValue?: string;
  tone?: 'success' | 'warning' | 'danger' | 'info' | 'default';
}) {
  const toneClass =
    tone === 'success' ? 'bg-success/10 text-success' :
    tone === 'warning' ? 'bg-warning/10 text-warning' :
    tone === 'danger' ? 'bg-destructive/10 text-destructive' :
    tone === 'info' ? 'bg-info/10 text-info' : 'bg-muted text-muted-foreground';
  return (
    <Card data-testid={`kpi-${label}`}>
      <CardContent className="p-5 flex items-center gap-4">
        <div className={`w-11 h-11 rounded-lg flex items-center justify-center ${toneClass}`}>
          <Icon className="w-5 h-5" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-xs text-muted-foreground truncate">{label}</p>
          <p className="text-2xl font-bold tracking-tight mt-0.5">{value}</p>
          {subValue && <p className="text-xs text-muted-foreground mt-0.5">{subValue}</p>}
        </div>
      </CardContent>
    </Card>
  );
}

function EmptyState({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-12 text-center" data-testid="empty-state">
      <div className="w-14 h-14 rounded-full bg-muted flex items-center justify-center mb-3">
        <Inbox className="w-7 h-7 text-muted-foreground/50" />
      </div>
      <p className="text-sm font-medium text-foreground mb-1">{title}</p>
      {subtitle && <p className="text-xs text-muted-foreground">{subtitle}</p>}
    </div>
  );
}

function AutoScrollList({ items, interval = 5000 }: { items: SatisfactionSurvey[]; interval?: number }) {
  const [idx, setIdx] = useState(0);
  useEffect(() => {
    if (items.length <= 3) return;
    const t = setInterval(() => setIdx((i) => (i + 1) % items.length), interval);
    return () => clearInterval(t);
  }, [items.length, interval]);
  if (items.length === 0) {
    return <EmptyState title="暂无最新评价" />;
  }
  return (
    <div className="space-y-2 max-h-[420px] overflow-hidden relative">
      <div className="space-y-2" style={{ transform: `translateY(-${idx * 92}px)`, transition: 'transform 0.5s ease' }}>
        {items.map((s) => (
          <div key={s.id} className="p-3 rounded-lg border border-border bg-white hover:bg-muted/30 transition-colors">
            <div className="flex items-center justify-between mb-1">
              <span className="font-medium text-sm truncate">{s.patientName ?? '匿名'}</span>
              <Badge className={`${NPS_CATEGORY_COLOR[s.npsCategory]} border border-border`}>
                {NPS_CATEGORY_LABEL[s.npsCategory]} {s.nps}
              </Badge>
            </div>
            <div className="flex items-center gap-1 mb-1">
              {[1, 2, 3, 4, 5].map((i) => (
                <Star
                  key={i}
                  className={`w-3 h-3 ${i <= Math.round(s.avgRating) ? 'fill-warning text-warning' : 'text-muted-foreground/20'}`}
                />
              ))}
              <span className="text-xs text-muted-foreground ml-1">
                {s.doctorName ? `· ${s.doctorName}` : ''}
              </span>
            </div>
            {s.comment && (
              <p className="text-xs text-muted-foreground line-clamp-2">{s.comment}</p>
            )}
            <p className="text-[10px] text-muted-foreground/60 mt-1">{s.createdAt?.slice(5, 16) ?? ''}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

function getDateRange(range: DateRange, customFrom?: string, customTo?: string) {
  const today = new Date();
  if (range === '7d') {
    return { from: formatDate(startOfDaysAgo(6)), to: formatDate(today) };
  }
  if (range === '30d') {
    return { from: formatDate(startOfDaysAgo(29)), to: formatDate(today) };
  }
  if (range === '90d') {
    return { from: formatDate(startOfDaysAgo(89)), to: formatDate(today) };
  }
  return { from: customFrom, to: customTo };
}

export default function SatisfactionPage() {
  const [activeTab, setActiveTab] = useState<TabType>('trend');
  const [range, setRange] = useState<DateRange>('30d');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');
  const [doctorFilter, setDoctorFilter] = useState('');
  const [npsCategoryFilter, setNpsCategoryFilter] = useState<NpsCategory | ''>('');
  const [keywordSearch, setKeywordSearch] = useState('');
  const [sentimentFilter, setSentimentFilter] = useState<KeywordSentiment | 'ALL'>('ALL');
  const [surveyPage, setSurveyPage] = useState(1);
  const [surveyDialogOpen, setSurveyDialogOpen] = useState(false);
  const [ackDialogOpen, setAckDialogOpen] = useState(false);
  const [selectedSurvey, setSelectedSurvey] = useState<SatisfactionSurvey | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  const dateRange = useMemo(() => getDateRange(range, customFrom, customTo), [range, customFrom, customTo]);

  const { data: dashboard, isLoading: dashLoading } = useSatisfactionDashboard({
    from: dateRange.from,
    to: dateRange.to,
    ...(refreshKey ? { _k: String(refreshKey) } : {}),
  });

  const { data: surveysResult, isLoading: surveysLoading } = useSatisfactionSurveys({
    from: dateRange.from,
    to: dateRange.to,
    userId: doctorFilter || undefined,
    npsCategory: npsCategoryFilter || undefined,
    keyword: keywordSearch || undefined,
    page: surveyPage,
    pageSize: 10,
    sort: 'createdAt,DESC',
    ...(refreshKey ? { _k: String(refreshKey) } : {}),
  });

  const badSurveys = useMemo(() => {
    const list = surveysResult?.items ?? [];
    return list.filter((s) => s.nps <= 6 || s.avgRating <= 2);
  }, [surveysResult]);

  const latestReviews = useMemo(() => {
    const list = surveysResult?.items ?? [];
    return list.slice(0, 20);
  }, [surveysResult]);

  const trendOption = useMemo(
    () => buildNpsTrendOption(dashboard?.trend ?? []),
    [dashboard?.trend]
  );

  const doctorRankingOption = useMemo(
    () => buildDoctorRankingOption(dashboard?.topDoctors ?? []),
    [dashboard?.topDoctors]
  );

  const keywordFreqOption = useMemo(
    () => buildKeywordFreqOption(dashboard?.keywords ?? [], sentimentFilter),
    [dashboard?.keywords, sentimentFilter]
  );

  const badSurveyColumns: DataTableColumn<SatisfactionSurvey>[] = [
    {
      key: 'time',
      header: '时间',
      cell: (r) => <span className="text-xs">{r.createdAt?.slice(5, 16) ?? '-'}</span>,
    },
    {
      key: 'patient',
      header: '患者',
      cell: (r) => <span className="font-medium text-sm">{r.patientName ?? '匿名'}</span>,
    },
    {
      key: 'doctor',
      header: '医生',
      cell: (r) => <span className="text-sm">{r.doctorName ?? '-'}</span>,
    },
    {
      key: 'nps',
      header: 'NPS',
      cell: (r) => (
        <Badge className={NPS_CATEGORY_COLOR[r.npsCategory]}>
          {r.nps}
        </Badge>
      ),
    },
    {
      key: 'rating',
      header: '星级均分',
      cell: (r) => (
        <div className="flex items-center gap-1">
          <Star className="w-4 h-4 fill-warning text-warning" />
          <span className="font-medium text-sm">{r.avgRating.toFixed(1)}</span>
        </div>
      ),
    },
    {
      key: 'tags',
      header: '负面标签',
      cell: (r) => {
        const tags = r.tags?.filter((t) => {
          const neg = ['态度差', '等候太久', '价格贵', '环境差', '设备陈旧', '解释不清', '流程复杂', '医术一般', '不专业', '体验差'];
          return neg.includes(t);
        }) ?? [];
        return (
          <div className="flex flex-wrap gap-0.5">
            {tags.length === 0 && <span className="text-xs text-muted-foreground/60">-</span>}
            {tags.slice(0, 3).map((t) => (
              <Badge key={t} className="bg-destructive/10 text-destructive text-[10px] px-1.5 py-0">
                {t}
              </Badge>
            ))}
            {tags.length > 3 && <Badge key={`more-${r.id}`} className="text-[10px] px-1.5 py-0">+{tags.length - 3}</Badge>}
          </div>
        );
      },
    },
    {
      key: 'comment',
      header: '评论摘要',
      cell: (r) => (
        <p className="text-xs text-muted-foreground line-clamp-2 max-w-[220px]">
          {r.comment ?? '-'}
        </p>
      ),
    },
    {
      key: 'status',
      header: '状态',
      cell: (r) => r.acknowledged ? (
        <Badge className="bg-success/10 text-success">已跟进</Badge>
      ) : (
        <Badge className="bg-warning/10 text-warning">未跟进</Badge>
      ),
    },
    {
      key: 'action',
      header: '操作',
      cell: (r) => (
        <Button
          size="sm"
          variant={r.acknowledged ? 'ghost' : 'outline'}
          disabled={r.acknowledged}
          onClick={() => { setSelectedSurvey(r); setAckDialogOpen(true); }}
          data-testid={`ack-btn-${r.id}`}
        >
          {r.acknowledged ? '已查看' : '跟进'}
        </Button>
      ),
    },
  ];

  return (
    <div className="p-6 space-y-4">
      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-2">
            <Smile className="w-6 h-6 text-primary" />
            <h1 className="text-2xl font-bold">患者满意度</h1>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <div className="flex items-center gap-1" role="group" aria-label="时间范围">
              {(['7d', '30d', '90d', 'custom'] as DateRange[]).map((r) => (
                <Button
                  key={r}
                  size="sm"
                  variant={range === r ? 'default' : 'outline'}
                  onClick={() => setRange(r)}
                  data-testid={`range-${r}`}
                >
                  {r === '7d' ? '7 天' : r === '30d' ? '30 天' : r === '90d' ? '90 天' : '自定义'}
                </Button>
              ))}
            </div>
            {range === 'custom' && (
              <div className="flex items-center gap-2">
                <Input type="date" value={customFrom} onChange={(e) => setCustomFrom(e.target.value)} className="w-auto h-8" />
                <span className="text-muted-foreground">至</span>
                <Input type="date" value={customTo} onChange={(e) => setCustomTo(e.target.value)} className="w-auto h-8" />
              </div>
            )}
            <Select
              value={doctorFilter}
              onChange={(e) => setDoctorFilter(e.target.value)}
              className="w-auto"
              data-testid="doctor-filter"
            >
              {DOCTOR_OPTIONS.map((d) => (
                <option key={d.id || 'all'} value={d.id}>{d.name}</option>
              ))}
            </Select>
            <Select
              value={npsCategoryFilter}
              onChange={(e) => setNpsCategoryFilter((e.target.value || '') as NpsCategory | '')}
              className="w-auto"
              data-testid="nps-category-filter"
            >
              {NPS_CATEGORY_OPTIONS.map((o) => (
                <option key={o.value || 'all'} value={o.value}>{o.label}</option>
              ))}
            </Select>
            <div className="relative">
              <Search className="w-4 h-4 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="关键词搜索"
                value={keywordSearch}
                onChange={(e) => setKeywordSearch(e.target.value)}
                className="pl-8 w-40"
                data-testid="keyword-search"
              />
            </div>
            <Button
              variant="outline"
              size="icon"
              onClick={() => setRefreshKey((k) => k + 1)}
              aria-label="刷新"
              data-testid="refresh-btn"
            >
              <RefreshCw className="w-4 h-4" />
            </Button>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-[1fr_360px] gap-4">
        <div className="space-y-4">
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
            <KpiCard
              icon={ClipboardList}
              label="总调查数"
              value={dashboard?.totalSurveys ?? 0}
              tone="info"
            />
            <KpiCard
              icon={ThumbsUp}
              label="推荐者"
              value={dashboard?.promoters ?? 0}
              subValue={dashboard?.totalSurveys ? `${((dashboard.promoters / dashboard.totalSurveys) * 100).toFixed(0)}%` : undefined}
              tone="success"
            />
            <KpiCard
              icon={Smile}
              label="中立者"
              value={dashboard?.passives ?? 0}
              subValue={dashboard?.totalSurveys ? `${((dashboard.passives / dashboard.totalSurveys) * 100).toFixed(0)}%` : undefined}
              tone="warning"
            />
            <KpiCard
              icon={ThumbsDown}
              label="贬损者"
              value={dashboard?.detractors ?? 0}
              subValue={dashboard?.totalSurveys ? `${((dashboard.detractors / dashboard.totalSurveys) * 100).toFixed(0)}%` : undefined}
              tone="danger"
            />
            <Card>
              <CardContent className="p-4 flex items-center justify-center">
                <RingProgress value={dashboard?.nps ?? 0} />
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4 space-y-2.5">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium">5 维均分</span>
                  <span className="text-lg font-bold">{dashboard?.avgRating?.toFixed(2) ?? '0.00'}</span>
                </div>
                {Object.entries(DIMENSION_LABEL).map(([k, lbl]) => (
                  <DimensionBar
                    key={k}
                    label={lbl}
                    value={dashboard?.avgDimensionRatings?.[k as keyof typeof DIMENSION_LABEL] ?? 0}
                  />
                ))}
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader className="pb-0">
              <div className="flex gap-1 border-b border-border -mx-6 px-6">
                {TABS.map((tab) => {
                  const Icon = tab.icon;
                  return (
                    <button
                      key={tab.key}
                      onClick={() => setActiveTab(tab.key)}
                      data-testid={`tab-${tab.key}`}
                      className={`flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 -mb-px transition-colors ${
                        activeTab === tab.key
                          ? 'border-primary text-primary'
                          : 'border-transparent text-muted-foreground hover:text-foreground'
                      }`}
                    >
                      <Icon className="w-4 h-4" />
                      {tab.label}
                    </button>
                  );
                })}
              </div>
            </CardHeader>
            <CardContent className="pt-4">
              {activeTab === 'trend' && (
                <div data-testid="trend-tab">
                  {dashLoading ? (
                    <div className="h-[360px] flex items-center justify-center text-muted-foreground">加载中...</div>
                  ) : !dashboard?.trend?.length ? (
                    <EmptyState title="暂无趋势数据" subtitle="尝试调整时间范围" />
                  ) : (
                    <ReactECharts echarts={echarts} option={trendOption} style={{ height: '360px' }} />
                  )}
                </div>
              )}

              {activeTab === 'doctors' && (
                <div data-testid="doctors-tab">
                  {dashLoading ? (
                    <div className="h-[360px] flex items-center justify-center text-muted-foreground">加载中...</div>
                  ) : !dashboard?.topDoctors?.length ? (
                    <EmptyState title="暂无医生排名" subtitle="样本量不足或无数据" />
                  ) : (
                    <ReactECharts echarts={echarts} option={doctorRankingOption} style={{ height: '360px' }} />
                  )}
                  {dashboard?.topDoctors?.length ? (
                    <p className="text-xs text-muted-foreground mt-2">
                      <span className="inline-block w-3 h-3 rounded bg-gray-300 mr-1 align-middle" />
                      灰色表示样本量＜30，数据参考性有限
                    </p>
                  ) : null}
                </div>
              )}

              {activeTab === 'bad' && (
                <div data-testid="bad-tab">
                  <DataTableWrapper
                    columns={badSurveyColumns as unknown as DataTableColumn[]}
                    data={badSurveys as unknown as Record<string, unknown>[]}
                    loading={surveysLoading}
                    isEmpty={!surveysLoading && badSurveys.length === 0}
                    emptyText="暂无差评记录"
                    emptySubtitle="说明患者反馈良好"
                    showPagination={false}
                    rowKey={(r) => String((r as unknown as SatisfactionSurvey).id)}
                  />
                </div>
              )}

              {activeTab === 'keywords' && (
                <div data-testid="keywords-tab">
                  <div className="flex items-center justify-between mb-3">
                    <p className="text-sm text-muted-foreground">关键词词频 Top 20</p>
                    <div className="flex items-center gap-2">
                      <Filter className="w-4 h-4 text-muted-foreground" />
                      <Select
                        value={sentimentFilter}
                        onChange={(e) => setSentimentFilter(e.target.value as KeywordSentiment | 'ALL')}
                        className="w-auto"
                        data-testid="sentiment-filter"
                      >
                        {SENTIMENT_OPTIONS.map((o) => (
                          <option key={o.value} value={o.value}>{o.label}</option>
                        ))}
                      </Select>
                    </div>
                  </div>
                  {dashLoading ? (
                    <div className="h-[360px] flex items-center justify-center text-muted-foreground">加载中...</div>
                  ) : !dashboard?.keywords?.length ? (
                    <EmptyState title="暂无关键词数据" />
                  ) : (
                    <ReactECharts echarts={echarts} option={keywordFreqOption} style={{ height: '360px' }} />
                  )}
                  <div className="flex items-center gap-4 mt-3 text-xs text-muted-foreground">
                    <span className="flex items-center gap-1">
                      <span className="w-3 h-3 rounded" style={{ backgroundColor: SENTIMENT_COLOR.POSITIVE }} /> 正面
                    </span>
                    <span className="flex items-center gap-1">
                      <span className="w-3 h-3 rounded" style={{ backgroundColor: SENTIMENT_COLOR.NEGATIVE }} /> 负面
                    </span>
                    <span className="flex items-center gap-1">
                      <span className="w-3 h-3 rounded" style={{ backgroundColor: SENTIMENT_COLOR.NEUTRAL }} /> 中性
                    </span>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        <div className="space-y-4">
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-base flex items-center gap-2">
                  <MessageSquare className="w-4 h-4" />
                  最新评价
                </CardTitle>
                <Badge className="bg-muted text-muted-foreground">{latestReviews.length} 条</Badge>
              </div>
            </CardHeader>
            <CardContent className="pt-0">
              <AutoScrollList items={latestReviews} interval={5000} />
            </CardContent>
          </Card>

          <PermissionButton roles={['BOSS', 'RECEPTIONIST']}>
            <Card className="bg-gradient-to-br from-primary/5 via-secondary/5 to-primary/10 border-primary/20">
              <CardContent className="p-5">
                <div className="flex items-start gap-4">
                  <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-primary to-secondary text-primary-foreground flex items-center justify-center shadow-sm">
                    <QrCode className="w-6 h-6" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <h3 className="font-semibold text-lg">发起满意度评价</h3>
                    <p className="text-xs text-muted-foreground mt-1">
                      可为指定就诊手动录入评价，或生成二维码/短信链接邀请患者填写
                    </p>
                    <Button
                      className="mt-3 w-full"
                      size="lg"
                      onClick={() => setSurveyDialogOpen(true)}
                      data-testid="open-survey-btn"
                    >
                      + 发起评价
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          </PermissionButton>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <BarChart3 className="w-4 h-4" />
                快捷指标
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-0 space-y-3">
              <div className="flex items-center justify-between text-sm">
                <span className="flex items-center gap-2 text-muted-foreground">
                  <Users className="w-4 h-4" /> 医生覆盖
                </span>
                <span className="font-medium">
                  {dashboard?.topDoctors?.length ?? 0} 位
                </span>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="flex items-center gap-2 text-muted-foreground">
                  <ChevronUp className="w-4 h-4 text-success" /> 最佳医生 NPS
                </span>
                <span className="font-medium text-success">
                  {dashboard?.topDoctors?.[0] ? `${dashboard.topDoctors[0].nps}%` : '-'}
                </span>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="flex items-center gap-2 text-muted-foreground">
                  <ChevronDown className="w-4 h-4 text-destructive" /> 最差医生 NPS
                </span>
                <span className="font-medium text-destructive">
                  {dashboard?.bottomDoctors?.[0] ? `${dashboard.bottomDoctors[0].nps}%` : '-'}
                </span>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="flex items-center gap-2 text-muted-foreground">
                  <Calendar className="w-4 h-4" /> 统计区间
                </span>
                <span className="font-medium text-xs">
                  {dateRange.from ?? '-'} ~ {dateRange.to ?? '-'}
                </span>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      <SurveyDialog open={surveyDialogOpen} onClose={() => setSurveyDialogOpen(false)} />
      <AcknowledgeDialog
        open={ackDialogOpen}
        onClose={() => { setAckDialogOpen(false); setSelectedSurvey(null); }}
        survey={selectedSurvey}
      />
    </div>
  );
}
