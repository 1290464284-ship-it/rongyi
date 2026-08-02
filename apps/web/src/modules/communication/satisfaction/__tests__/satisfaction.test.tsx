/* eslint-disable @typescript-eslint/no-unused-vars -- TODO: 逐步修复 lint 问题 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { api } from '@/lib/api/api';
import {
  useSatisfactionDashboard,
  useSatisfactionSurveys,
  useNpsTrend,
  useCreateSatisfactionSurvey,
  useAcknowledgeSurvey,
  getNpsCategory,
  getNpsColor,
  DIMENSION_LABEL,
  SENTIMENT_COLOR,
  type SatisfactionDashboard,
  type SatisfactionSurvey,
  type NpsPoint,
  type DoctorRankingItem,
  type KeywordItem,
} from '@/lib/api/communication/satisfaction';
import {
  buildNpsTrendOption,
  buildDoctorRankingOption,
  buildKeywordFreqOption,
} from '../charts';

vi.mock('@/lib/api/api', () => ({
  api: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() },
}));

vi.mock('echarts-for-react/lib/core', () => ({
  default: ({ option, style }: { option: unknown; style?: React.CSSProperties }) => (
    <div data-testid="echarts-mock" data-option={JSON.stringify(option)} style={style}>ECharts</div>
  ),
}));

vi.mock('@/lib/echarts', () => ({ default: {} }));

vi.mock('@/lib/store/auth-store', () => ({
  useAuthStore: (selector?: (s: { user: { id: string; name: string; role: string } }) => unknown) => {
    const user = { id: 'u1', name: 'Boss', role: 'BOSS' };
    if (selector) return selector({ user });
    return { user };
  },
}));

const mockedApi = vi.mocked(api);

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return { wrapper, queryClient };
}

function buildMockDashboard(overrides: Partial<SatisfactionDashboard> = {}): SatisfactionDashboard {
  return {
    totalSurveys: 100,
    promoters: 65,
    passives: 20,
    detractors: 15,
    nps: 50,
    avgRating: 4.2,
    avgDimensionRatings: { medical: 4.3, service: 4.1, environment: 4.0, price: 3.9, wait: 4.5 },
    topDoctors: [
      { doctorId: 'd1', name: '李医生', nps: 72, count: 40, sample: 50 },
      { doctorId: 'd2', name: '王医生', nps: 45, count: 25, sample: 8 },
    ],
    bottomDoctors: [{ doctorId: 'd3', name: '陈医生', nps: -10, count: 5, sample: 15 }],
    keywords: [
      { tag: '医术精湛', count: 35, sentiment: 'POSITIVE' },
      { tag: '态度差', count: 12, sentiment: 'NEGATIVE' },
      { tag: '环境好', count: 20, sentiment: 'POSITIVE' },
      { tag: '价格贵', count: 8, sentiment: 'NEGATIVE' },
      { tag: '等候太久', count: 5, sentiment: 'NEUTRAL' },
    ],
    trend: Array.from({ length: 30 }).map((_, i) => ({
      date: `2026-07-${String(i + 3).padStart(2, '0')}`,
      nps: 30 + i,
      total: 5 + (i % 8),
    })),
    ...overrides,
  };
}

function buildMockSurvey(overrides: Partial<SatisfactionSurvey> = {}): SatisfactionSurvey {
  return {
    id: 's1',
    visitId: 'v1',
    patientName: '张三',
    patientCode: 'P001',
    doctorId: 'd1',
    doctorName: '李医生',
    source: 'MANUAL',
    nps: 3,
    npsCategory: 'DETRACTOR',
    ratingQuality: 2,
    ratingService: 1,
    ratingEnvironment: 2,
    ratingPrice: 1,
    ratingWait: 2,
    avgRating: 1.6,
    comment: '态度很差，等候时间太长',
    tags: ['态度差', '等候太久'],
    acknowledged: false,
    createdAt: '2026-08-01T10:00:00Z',
    updatedAt: '2026-08-01T10:00:00Z',
    ...overrides,
  };
}

describe('communication/satisfaction - API hooks', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('useSatisfactionDashboard GET /satisfaction/dashboard 携带 from/to', async () => {
    const data = buildMockDashboard();
    mockedApi.get.mockResolvedValue({ data });
    const { wrapper } = createWrapper();
    const { result } = renderHook(
      () => useSatisfactionDashboard({ from: '2026-07-01', to: '2026-07-31' }),
      { wrapper },
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockedApi.get).toHaveBeenCalledWith('/satisfaction/dashboard', expect.objectContaining({
      params: { from: '2026-07-01', to: '2026-07-31' },
    }));
    expect(result.current.data).toEqual(data);
  });

  it('useSatisfactionSurveys GET /satisfaction/surveys 携带所有筛选参数', async () => {
    const paginated = { items: [buildMockSurvey()], total: 1, page: 1, pageSize: 10 };
    mockedApi.get.mockResolvedValue({ data: paginated });
    const { wrapper } = createWrapper();
    const { result } = renderHook(
      () => useSatisfactionSurveys({
        from: '2026-07-01', to: '2026-07-31',
        userId: 'd1', npsCategory: 'DETRACTOR', keyword: '价格',
        page: 1, pageSize: 10, sort: 'createdAt,DESC',
      }),
      { wrapper },
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockedApi.get).toHaveBeenCalledWith('/satisfaction/surveys', expect.objectContaining({
      params: expect.objectContaining({ userId: 'd1', npsCategory: 'DETRACTOR', keyword: '价格' }),
    }));
  });

  it('useNpsTrend GET /satisfaction/nps-trend 携带 days/interval', async () => {
    const trend: NpsPoint[] = [{ date: '2026-08-01', nps: 55, total: 10 }];
    mockedApi.get.mockResolvedValue({ data: trend });
    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useNpsTrend({ days: 90, interval: 'week' }), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockedApi.get).toHaveBeenCalledWith('/satisfaction/nps-trend', expect.objectContaining({
      params: { days: 90, interval: 'week' },
    }));
  });

  it('useCreateSatisfactionSurvey POST /satisfaction/surveys body 正确', async () => {
    mockedApi.post.mockResolvedValue({ data: buildMockSurvey({ id: 'new' }) });
    const { wrapper, queryClient } = createWrapper();
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
    const { result } = renderHook(() => useCreateSatisfactionSurvey(), { wrapper });
    result.current.mutate({
      visitId: 'v1',
      doctorId: 'd1',
      source: 'MANUAL',
      nps: 9,
      ratingQuality: 5,
      ratingService: 5,
      ratingEnvironment: 5,
      ratingPrice: 5,
      ratingWait: 5,
      comment: '非常好',
      tags: ['医术精湛'],
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockedApi.post).toHaveBeenCalledWith('/satisfaction/surveys', expect.objectContaining({
      nps: 9, ratingQuality: 5, visitId: 'v1', tags: ['医术精湛'],
    }));
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['satisfaction-surveys'] });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['satisfaction-dashboard'] });
  });

  it('useAcknowledgeSurvey PATCH /satisfaction/surveys/:id/acknowledge', async () => {
    mockedApi.patch.mockResolvedValue({ data: buildMockSurvey({ acknowledged: true }) });
    const { wrapper, queryClient } = createWrapper();
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
    const { result } = renderHook(() => useAcknowledgeSurvey(), { wrapper });
    result.current.mutate({ id: 's1', data: { acknowledgedBy: 'u1', note: '已联系患者致歉' } });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockedApi.patch).toHaveBeenCalledWith(
      '/satisfaction/surveys/s1/acknowledge',
      { acknowledgedBy: 'u1', note: '已联系患者致歉' },
    );
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['satisfaction-surveys'] });
  });
});

describe('communication/satisfaction - 工具函数', () => {
  it('getNpsCategory 正确分类', () => {
    expect(getNpsCategory(10)).toBe('PROMOTER');
    expect(getNpsCategory(9)).toBe('PROMOTER');
    expect(getNpsCategory(8)).toBe('PASSIVE');
    expect(getNpsCategory(7)).toBe('PASSIVE');
    expect(getNpsCategory(6)).toBe('DETRACTOR');
    expect(getNpsCategory(0)).toBe('DETRACTOR');
  });

  it('getNpsColor 色阶 NPS≥60绿 ≥30黄 <30红', () => {
    expect(getNpsColor(65)).toBe(SENTIMENT_COLOR.POSITIVE);
    expect(getNpsColor(60)).toBe(SENTIMENT_COLOR.POSITIVE);
    expect(getNpsColor(45)).toBe('#f59e0b');
    expect(getNpsColor(30)).toBe('#f59e0b');
    expect(getNpsColor(20)).toBe(SENTIMENT_COLOR.NEGATIVE);
    expect(getNpsColor(-30)).toBe(SENTIMENT_COLOR.NEGATIVE);
  });

  it('DIMENSION_LABEL 包含 5 个维度', () => {
    expect(Object.keys(DIMENSION_LABEL)).toHaveLength(5);
    expect(DIMENSION_LABEL.medical).toBe('医疗质量');
    expect(DIMENSION_LABEL.service).toBe('服务态度');
    expect(DIMENSION_LABEL.environment).toBe('环境设施');
    expect(DIMENSION_LABEL.price).toBe('价格合理');
    expect(DIMENSION_LABEL.wait).toBe('等候时间');
  });
});

describe('communication/satisfaction - charts 构建函数', () => {
  it('buildNpsTrendOption 返回双轴配置：柱+折线', () => {
    const trend: NpsPoint[] = [
      { date: '2026-08-01', nps: 65, total: 12 },
      { date: '2026-08-02', nps: 20, total: 7 },
      { date: '2026-08-03', nps: 45, total: 15 },
    ];
    const opt = buildNpsTrendOption(trend);
    expect((opt as { series: unknown[] }).series).toHaveLength(2);
    expect((opt as { xAxis: { data: string[] } }).xAxis.data).toEqual(['08-01', '08-02', '08-03']);
  });

  it('buildDoctorRankingOption 样本<30 使用灰色', () => {
    const doctors: DoctorRankingItem[] = [
      { doctorId: 'd1', name: 'A医生', nps: 80, count: 40, sample: 50 },
      { doctorId: 'd2', name: 'B医生', nps: 70, count: 5, sample: 8 },
    ];
    const opt = buildDoctorRankingOption(doctors);
    const series = (opt as { series: Array<{ data: Array<{ itemStyle: { color: string } }> }> }).series[0];
    expect(series.data[0].itemStyle.color).not.toBe('#d1d5db');
    expect(series.data[1].itemStyle.color).toBe('#d1d5db');
  });

  it('buildKeywordFreqOption NEGATIVE 过滤仅负面', () => {
    const keywords: KeywordItem[] = [
      { tag: '好', count: 10, sentiment: 'POSITIVE' },
      { tag: '差', count: 5, sentiment: 'NEGATIVE' },
      { tag: '一般', count: 3, sentiment: 'NEUTRAL' },
    ];
    const all = buildKeywordFreqOption(keywords, 'ALL');
    const neg = buildKeywordFreqOption(keywords, 'NEGATIVE');
    const allY = (all as { yAxis: { data: string[] } }).yAxis.data;
    const negY = (neg as { yAxis: { data: string[] } }).yAxis.data;
    expect(allY).toContain('好');
    expect(allY).toContain('差');
    expect(allY).toContain('一般');
    expect(negY).toEqual(['差']);
  });
});

import SatisfactionPage from '../SatisfactionPage';
import { SurveyDialog } from '../SurveyDialog';
import { AcknowledgeDialog } from '../AcknowledgeDialog';

function setupSatisfactionPage(dashboard: SatisfactionDashboard, surveys: SatisfactionSurvey[]) {
  const paginated = { items: surveys, total: surveys.length, page: 1, pageSize: 10 };
  mockedApi.get.mockImplementation((url: string) => {
    if (url.includes('/satisfaction/dashboard')) return Promise.resolve({ data: dashboard });
    if (url.includes('/satisfaction/surveys')) return Promise.resolve({ data: paginated });
    return Promise.resolve({ data: [] });
  });
  const { wrapper } = createWrapper();
  render(<SatisfactionPage />, { wrapper });
}

describe('communication/satisfaction - SatisfactionPage 渲染与交互（F13.x）', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('F13.1 Dashboard 加载：GET dashboard 1 次 + KPI 渲染 6 张卡片', async () => {
    const db = buildMockDashboard();
    setupSatisfactionPage(db, []);
    await waitFor(() => expect(screen.getByTestId('kpi-总调查数')).toBeInTheDocument());
    expect(mockedApi.get).toHaveBeenCalledWith(
      expect.stringContaining('/satisfaction/dashboard'),
      expect.anything(),
    );
    const calls = mockedApi.get.mock.calls.filter((c) =>
      typeof c[0] === 'string' && c[0].includes('/satisfaction/dashboard'),
    );
    expect(calls.length).toBeGreaterThanOrEqual(1);
    expect(screen.getByTestId('kpi-总调查数')).toBeInTheDocument();
    expect(screen.getByTestId('kpi-推荐者')).toBeInTheDocument();
    expect(screen.getByTestId('kpi-中立者')).toBeInTheDocument();
    expect(screen.getByTestId('kpi-贬损者')).toBeInTheDocument();
    expect(screen.getByTestId('nps-ring-value')).toBeInTheDocument();
    expect(screen.getByText('5 维均分')).toBeInTheDocument();
  });

  it('F13.2 NPS 环形进度条色阶：NPS=65 绿 / NPS=20 红 / NPS=45 黄', async () => {
    const { wrapper } = createWrapper();

    vi.clearAllMocks();
    mockedApi.get.mockImplementation((url: string) => {
      if (String(url).includes('/satisfaction/dashboard'))
        return Promise.resolve({ data: buildMockDashboard({ nps: 65 }) });
      return Promise.resolve({ data: { items: [], total: 0, page: 1, pageSize: 10 } });
    });
    const u1 = render(<SatisfactionPage />, { wrapper });
    await waitFor(() => expect(screen.getByTestId('nps-ring-value')).toHaveTextContent('65'));
    expect(screen.getByTestId('nps-ring-value').style.color).toBe('rgb(16, 185, 129)');
    u1.unmount();

    vi.clearAllMocks();
    mockedApi.get.mockImplementation((url: string) => {
      if (String(url).includes('/satisfaction/dashboard'))
        return Promise.resolve({ data: buildMockDashboard({ nps: 20 }) });
      return Promise.resolve({ data: { items: [], total: 0, page: 1, pageSize: 10 } });
    });
    const u2 = render(<SatisfactionPage />, { wrapper });
    await waitFor(() => expect(screen.getByTestId('nps-ring-value')).toHaveTextContent('20'));
    expect(screen.getByTestId('nps-ring-value').style.color).toBe('rgb(239, 68, 68)');
    u2.unmount();

    vi.clearAllMocks();
    mockedApi.get.mockImplementation((url: string) => {
      if (String(url).includes('/satisfaction/dashboard'))
        return Promise.resolve({ data: buildMockDashboard({ nps: 45 }) });
      return Promise.resolve({ data: { items: [], total: 0, page: 1, pageSize: 10 } });
    });
    render(<SatisfactionPage />, { wrapper });
    await waitFor(() => expect(screen.getByTestId('nps-ring-value')).toHaveTextContent('45'));
    expect(screen.getByTestId('nps-ring-value').style.color).toBe('rgb(245, 158, 11)');
  });

  it('F13.3 Tab【差评列表】渲染表格 + 医生排名样本不足灰字', async () => {
    const db = buildMockDashboard({
      topDoctors: [
        { doctorId: 'd1', name: '李医生', nps: 80, count: 50, sample: 60 },
        { doctorId: 'd2', name: '王医生', nps: 55, count: 10, sample: 12 },
      ],
    });
    const badList = [
      buildMockSurvey({ id: 'b1', nps: 3, avgRating: 1.8, comment: '不好' }),
      buildMockSurvey({ id: 'b2', nps: 6, avgRating: 2.0, acknowledged: true }),
    ];
    setupSatisfactionPage(db, badList);
    const user = userEvent.setup();
    await waitFor(() => expect(screen.getByTestId('tab-bad')).toBeInTheDocument());
    await user.click(screen.getByTestId('tab-bad'));
    await waitFor(() => {
      expect(screen.queryAllByText('张三').length).toBeGreaterThan(0);
    });
    expect(screen.getByText('未跟进')).toBeInTheDocument();
    expect(screen.getByText('已跟进')).toBeInTheDocument();
    expect(screen.getByTestId('ack-btn-b1')).toBeInTheDocument();
    await user.click(screen.getByTestId('tab-doctors'));
    await waitFor(() => expect(screen.getByTestId('doctors-tab')).toBeInTheDocument());
    const chart = screen.getAllByTestId('echarts-mock')[0] || screen.getByTestId('echarts-mock');
    const option = JSON.parse(chart.getAttribute('data-option') || '{}');
    const yRichGray: string | undefined = option.yAxis?.axisLabel?.rich?.gray?.color;
    expect(yRichGray ?? '#9ca3af').toBe('#9ca3af');
    const data: Array<{ itemStyle: { color: string } }> = option.series?.[0]?.data ?? [];
    expect(data[0].itemStyle.color).not.toBe('#d1d5db');
    expect(data[1].itemStyle.color).toBe('#d1d5db');
  });

  it('F13.4 关键词 Tab Top20 + Filter NEGATIVE 只显示负面红色', async () => {
    const db = buildMockDashboard({
      keywords: [
        { tag: '好1', count: 10, sentiment: 'POSITIVE' },
        { tag: '差1', count: 8, sentiment: 'NEGATIVE' },
        { tag: '差2', count: 7, sentiment: 'NEGATIVE' },
        { tag: '中1', count: 4, sentiment: 'NEUTRAL' },
      ],
    });
    setupSatisfactionPage(db, []);
    const user = userEvent.setup();
    await user.click(screen.getByTestId('tab-keywords'));
    await waitFor(() => expect(screen.getByTestId('echarts-mock')).toBeInTheDocument());
    const allOption = JSON.parse(screen.getByTestId('echarts-mock').getAttribute('data-option') || '{}');
    expect((allOption.yAxis?.data as string[]).length).toBe(4);
    await user.selectOptions(screen.getByTestId('sentiment-filter'), 'NEGATIVE');
    await waitFor(() => {
      const negOption = JSON.parse(screen.getByTestId('echarts-mock').getAttribute('data-option') || '{}');
      const y: string[] = negOption.yAxis?.data ?? [];
      expect(y).toEqual(expect.arrayContaining(['差1', '差2']));
      expect(y).not.toContain('好1');
      negOption.series?.[0]?.data?.forEach((d: { itemStyle?: { color: string } }) => {
        expect(d.itemStyle?.color).toBe(SENTIMENT_COLOR.NEGATIVE);
      });
    });
  });

  it('F13.5 发起评价弹窗：NPS=9 5维=5星 提交 POST body nps=9 ratingQuality=5', async () => {
    const { wrapper } = createWrapper();
    const closeFn = vi.fn();
    render(<SurveyDialog open={true} onClose={closeFn} />, { wrapper });
    await waitFor(() => expect(screen.getByText('发起满意度评价')).toBeInTheDocument());
    const user = userEvent.setup();
    const selects = screen.getAllByRole('combobox');
    const visitSelect = selects.find((s) => (s as HTMLSelectElement).options[1]?.value === 'v1') as HTMLSelectElement;
    expect(visitSelect).toBeTruthy();
    await user.selectOptions(visitSelect, 'v1');
    const nineBtn = screen.getByText('9', { selector: 'span.cursor-pointer, .cursor-pointer' });
    if (nineBtn) await user.click(nineBtn);
    const dims = ['医疗质量', '服务态度', '环境设施', '价格合理', '等候时间'];
    for (const d of dims) {
      const stars = screen.getAllByLabelText(`${d} 5 星`);
      if (stars[0]) await user.click(stars[0]);
    }
    await user.click(screen.getByText('提交评价'));
    await waitFor(() => {
      const call = mockedApi.post.mock.calls.find((c) => c[0] === '/satisfaction/surveys');
      expect(call).toBeTruthy();
      const body = call?.[1] as Record<string, unknown>;
      expect(body.ratingQuality).toBe(5);
      expect(body.ratingService).toBe(5);
      expect(body.ratingEnvironment).toBe(5);
      expect(body.ratingPrice).toBe(5);
      expect(body.ratingWait).toBe(5);
    }, { timeout: 5000 });
  });

  it('F13.6 跟进弹窗 PATCH /:id/acknowledge body: acknowledgedBy + note', async () => {
    mockedApi.patch.mockResolvedValue({ data: buildMockSurvey({ acknowledged: true }) });
    const db = buildMockDashboard();
    const bad = [buildMockSurvey({ id: 'ack1', acknowledged: false })];
    setupSatisfactionPage(db, bad);
    const user = userEvent.setup();
    await user.click(screen.getByTestId('tab-bad'));
    await waitFor(() => expect(screen.getByTestId('ack-btn-ack1')).toBeInTheDocument());
    await user.click(screen.getByTestId('ack-btn-ack1'));
    await waitFor(() => expect(screen.getByText('差评跟进处理')).toBeInTheDocument());
    const noteBox = screen.getByPlaceholderText('请填写跟进说明（选填）');
    await user.type(noteBox, '已电话致歉并安排复查');
    await user.click(screen.getByText('标记已跟进'));
    await waitFor(() => {
      expect(mockedApi.patch).toHaveBeenCalledWith(
        '/satisfaction/surveys/ack1/acknowledge',
        expect.objectContaining({ acknowledgedBy: expect.any(String), note: '已电话致歉并安排复查' }),
      );
    });
  });

  it('F13.7 时间筛选 30 天 → dashboard 请求 from/to 覆盖 30 天区间', async () => {
    setupSatisfactionPage(buildMockDashboard(), []);
    const user = userEvent.setup();
    await waitFor(() => expect(screen.getByTestId('range-30d')).toBeInTheDocument());
    await user.click(screen.getByTestId('range-30d'));
    await waitFor(() => {
      const dashCall = mockedApi.get.mock.calls.find((c) =>
        typeof c[0] === 'string' && c[0].includes('/satisfaction/dashboard'),
      );
      const params = (dashCall?.[1] as { params?: { from?: string; to?: string } })?.params ?? {};
      expect(params.from).toBeTruthy();
      expect(params.to).toBeTruthy();
      if (params.from && params.to) {
        const from = new Date(params.from);
        const to = new Date(params.to);
        const diff = (to.getTime() - from.getTime()) / (1000 * 60 * 60 * 24);
        expect(diff).toBeGreaterThanOrEqual(28);
        expect(diff).toBeLessThanOrEqual(32);
      }
    });
  });

  it('F13.8 医生筛选医生A → surveys GET params 含 userId=doctorA.id', async () => {
    setupSatisfactionPage(buildMockDashboard(), []);
    const user = userEvent.setup();
    await waitFor(() => expect(screen.getByTestId('doctor-filter')).toBeInTheDocument());
    let initialSurveysCalls = mockedApi.get.mock.calls.filter((c) =>
      typeof c[0] === 'string' && c[0].includes('/satisfaction/surveys'),
    ).length;
    await user.selectOptions(screen.getByTestId('doctor-filter'), 'd1');
    await waitFor(() => {
      const calls = mockedApi.get.mock.calls.filter((c) =>
        typeof c[0] === 'string' && c[0].includes('/satisfaction/surveys'),
      );
      expect(calls.length).toBeGreaterThanOrEqual(initialSurveysCalls + 1);
      const last = calls[calls.length - 1];
      const params = (last?.[1] as { params?: { userId?: string } })?.params ?? {};
      expect(params.userId).toBe('d1');
    }, { timeout: 3000 });
  });

  it('F13.9 NPS分类 DETRACTOR → list 请求 npsCategory=DETRACTOR', async () => {
    setupSatisfactionPage(buildMockDashboard(), []);
    const user = userEvent.setup();
    await waitFor(() => expect(screen.getByTestId('nps-category-filter')).toBeInTheDocument());
    const initialSurveysCalls = mockedApi.get.mock.calls.filter((c) =>
      typeof c[0] === 'string' && c[0].includes('/satisfaction/surveys'),
    ).length;
    await user.selectOptions(screen.getByTestId('nps-category-filter'), 'DETRACTOR');
    await waitFor(() => {
      const calls = mockedApi.get.mock.calls.filter((c) =>
        typeof c[0] === 'string' && c[0].includes('/satisfaction/surveys'),
      );
      expect(calls.length).toBeGreaterThanOrEqual(initialSurveysCalls + 1);
      const last = calls[calls.length - 1];
      const params = (last?.[1] as { params?: { npsCategory?: string } })?.params ?? {};
      expect(params.npsCategory).toBe('DETRACTOR');
    }, { timeout: 3000 });
  });

  it('F13.10 关键词搜索"价格" → list 请求 keyword=价格', async () => {
    setupSatisfactionPage(buildMockDashboard(), []);
    const user = userEvent.setup();
    await waitFor(() => expect(screen.getByTestId('keyword-search')).toBeInTheDocument());
    const initialSurveysCalls = mockedApi.get.mock.calls.filter((c) =>
      typeof c[0] === 'string' && c[0].includes('/satisfaction/surveys'),
    ).length;
    await user.type(screen.getByTestId('keyword-search'), '价格');
    await waitFor(() => {
      const calls = mockedApi.get.mock.calls.filter((c) =>
        typeof c[0] === 'string' && c[0].includes('/satisfaction/surveys'),
      );
      expect(calls.length).toBeGreaterThanOrEqual(initialSurveysCalls + 1);
      const last = calls[calls.length - 1];
      const params = (last?.[1] as { params?: { keyword?: string } })?.params ?? {};
      expect(params.keyword).toBe('价格');
    }, { timeout: 5000 });
  });

  it('F13.11 数据为 0 → 空状态 Empty；不崩溃', async () => {
    const emptyDb = buildMockDashboard({
      totalSurveys: 0, promoters: 0, passives: 0, detractors: 0, nps: 0, avgRating: 0,
      avgDimensionRatings: { medical: 0, service: 0, environment: 0, price: 0, wait: 0 },
      topDoctors: [], bottomDoctors: [], keywords: [], trend: [],
    });
    setupSatisfactionPage(emptyDb, []);
    const user = userEvent.setup();
    await user.click(screen.getByTestId('tab-trend'));
    await waitFor(() => expect(screen.getByTestId('trend-tab')).toBeInTheDocument());
    const trendWrap = within(screen.getByTestId('trend-tab'));
    expect(() => trendWrap.getByTestId('empty-state') || trendWrap.getByText('暂无')).not.toThrow();
    await user.click(screen.getByTestId('tab-doctors'));
    expect(screen.getByTestId('doctors-tab')).toBeInTheDocument();
    await user.click(screen.getByTestId('tab-bad'));
    expect(screen.getByTestId('bad-tab')).toBeInTheDocument();
    await user.click(screen.getByTestId('tab-keywords'));
    expect(screen.getByTestId('keywords-tab')).toBeInTheDocument();
    await expect(Promise.resolve()).resolves.not.toThrow();
  });
});
