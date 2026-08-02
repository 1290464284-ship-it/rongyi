/* eslint-disable @typescript-eslint/no-unused-vars -- TODO: 逐步修复 lint 问题 */
import { render, screen, within, fireEvent, waitFor, cleanup, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, it, expect, vi, afterEach, MockedFunction } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { Toaster } from 'sonner';
import type {
  TreatmentProgressPlan,
  TreatmentProgressOverview,
  TreatmentProgressDetail,
  LagRisk,
  PlanProgressStatus,
} from '@/lib/api/clinical/treatment-progress';
import TreatmentProgressPage from '../TreatmentProgressPage';

const mockApi = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  patch: vi.fn(),
  delete: vi.fn(),
}));
vi.mock('@/lib/api/api', () => ({ api: mockApi }));

vi.mock('@/lib/staff', () => ({
  useDoctors: () => ({
    data: [
      { id: 'DOC-A', name: '医生A', role: 'DOCTOR' },
      { id: 'DOC-B', name: '医生B', role: 'DOCTOR' },
    ],
    isLoading: false,
  }),
}));

vi.mock('sonner', async () => {
  const actual = (await vi.importActual('sonner')) as Record<string, unknown>;
  const actualToast = (actual.toast ?? {}) as Record<string, unknown>;
  return {
    ...actual,
    toast: {
      ...actualToast,
      success: vi.fn(),
      error: vi.fn(),
    },
  };
});

const todayStr = new Date().toISOString().slice(0, 10);
const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);

function createPlan(p: Partial<TreatmentProgressPlan> & { planId: string; patientName: string; planName: string; doctorName: string; completionPct: number; lagRisk: LagRisk; status: PlanProgressStatus }): TreatmentProgressPlan {
  return {
    patientId: `P-${p.planId}`,
    patientGender: 'MALE',
    age: 35,
    doctorId: `DOC-${p.planId}`,
    createdAt: '2026-07-01T00:00:00.000Z',
    targetDate: tomorrow,
    totalItems: 10,
    completedItems: Math.round((p.completionPct ?? 0) / 10),
    totalPrice: 20000,
    collectedPrice: 15000,
    delayDays: 0,
    ...p,
  };
}

function buildOverview(overrides: Partial<TreatmentProgressOverview> = {}): TreatmentProgressOverview {
  return {
    totalPlans: 30,
    ongoing: 10,
    completed: 20,
    avgCompletionPct: 75,
    avgDelayDays: 1.5,
    riskCounts: { NONE: 22, LOW: 3, MEDIUM: 2, HIGH: 2, CRITICAL: 1 },
    todayDueCount: 2,
    overdueCount: 1,
    lagTrend: Array.from({ length: 3 }).map((_, i) => ({
      date: `2026-07-${String(10 + i).padStart(2, '0')}`,
      riskLevelsCount: [5 - i, 2, 1, 1, i] as [number, number, number, number, number],
    })),
    planStatusDistribution: { ONGOING: 10, COMPLETED: 20, PAUSED: 0 },
    ...overrides,
  };
}

function buildPlans(): TreatmentProgressPlan[] {
  return [
    createPlan({ planId: 'PLAN001', patientName: '张三', planName: '正畸治疗', doctorName: '医生A', completionPct: 90, lagRisk: 'NONE', status: 'ONGOING' }),
    createPlan({ planId: 'PLAN002', patientName: '李四', planName: '种植修复', doctorName: '医生B', completionPct: 20, lagRisk: 'CRITICAL', status: 'ONGOING', totalPrice: 20000, collectedPrice: 15000 }),
    createPlan({ planId: 'PLAN003', patientName: '王五', planName: '根管治疗', doctorName: '医生A', completionPct: 55, lagRisk: 'MEDIUM', status: 'COMPLETED' }),
    createPlan({ planId: 'PLAN004', patientName: '赵六', planName: '牙周治疗', doctorName: '医生A', completionPct: 35, lagRisk: 'HIGH', status: 'ONGOING' }),
    createPlan({ planId: 'PLAN005', patientName: '钱七', planName: '洁牙保健', doctorName: '医生B', completionPct: 65, lagRisk: 'LOW', status: 'ONGOING' }),
  ];
}

function buildDetail(): TreatmentProgressDetail {
  const plan = createPlan({ planId: 'PLAN001', patientName: '张三', planName: '正畸治疗', doctorName: '医生A', completionPct: 90, lagRisk: 'NONE', status: 'ONGOING' });
  return {
    plan,
    items: [
      {
        id: 'IT-1',
        treatmentName: '牙面清洁',
        treatmentCode: 'TX-001',
        price: 500,
        tooth: '16',
        status: 'COMPLETED',
        createdAt: '2026-07-01T00:00:00.000Z',
        completedAt: '2026-07-02T00:00:00.000Z',
        expectedDay: 1,
        actualDay: 1,
        daysLag: 0,
      },
      {
        id: 'IT-2',
        treatmentName: '托槽粘结',
        treatmentCode: 'TX-002',
        price: 3000,
        tooth: '全口',
        status: 'IN_PROGRESS',
        createdAt: '2026-07-01T00:00:00.000Z',
        expectedDay: 3,
        daysLag: 2,
      },
    ],
    snapshots: Array.from({ length: 10 }).map((_, i) => ({
      snapshotDate: `2026-07-${String(10 + i).padStart(2, '0')}`,
      completionPct: 10 * (i + 1),
      completedCount: i + 1,
      totalCount: 10,
      dailyCompleted: 1,
      remainingDays: 30 - i,
    })),
    timeline: [
      { createdAt: '2026-07-01T09:00:00.000Z', kind: 'PLAN_START', content: '正畸治疗计划启动' },
      { createdAt: '2026-07-02T10:00:00.000Z', kind: 'TREATMENT_UPDATE', content: '完成牙面清洁（16）' },
      { createdAt: '2026-07-03T14:00:00.000Z', kind: 'COLLECTED', content: '收取首期费用 ¥15,000' },
    ],
  };
}

function renderPage() {
  const qc = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
  return {
    qc,
    user: userEvent.setup(),
    ...render(
      <QueryClientProvider client={qc}>
        <MemoryRouter>
          <TreatmentProgressPage />
          <Toaster />
        </MemoryRouter>
      </QueryClientProvider>,
    ),
  };
}

beforeEach(() => {
  cleanup();
  vi.clearAllMocks();

  mockApi.get.mockImplementation(async (url: string, ctx?: { params?: Record<string, unknown> }) => {
    if (url === '/treatment-progress/overview') return { data: buildOverview() };
    if (url.startsWith('/treatment-progress/plans') && url.endsWith('/progress')) {
      return { data: buildDetail() };
    }
    if (url === '/treatment-progress/plans') {
      const items = buildPlans();
      return { data: { items, total: items.length, page: 1, pageSize: 20 } };
    }
    return { data: null };
  });
  mockApi.post.mockImplementation(async (url: string) => {
    if (url.endsWith('/refresh')) {
      return { data: buildPlans()[0] };
    }
    return { data: null };
  });
});

afterEach(() => {
  cleanup();
});

describe('TreatmentProgressPage', () => {
  it('F12.1 页面加载：GET /overview + GET /plans?pageSize=20 两次请求', async () => {
    renderPage();
    await waitFor(() => {
      expect(mockApi.get).toHaveBeenCalled();
    });
    const calls = (mockApi.get as MockedFunction<typeof mockApi.get>).mock.calls;
    const overviewCall = calls.find((c) => c[0] === '/treatment-progress/overview');
    const plansCall = calls.find((c) => c[0] === '/treatment-progress/plans');
    expect(overviewCall).toBeDefined();
    expect(plansCall).toBeDefined();
    const plansParams = plansCall?.[1]?.params as Record<string, unknown> | undefined;
    expect(plansParams?.pageSize).toBe(20);
  });

  it('F12.2 6 KPI 渲染（ongoing=10 / completed=20 / avg=75% / delay=1.5 / criticalHigh=3 / todayDue=2）正确', async () => {
    renderPage();
    const cardByLabel = (label: string) => screen.getAllByText(label).map((el) => el.closest('div.rounded-lg.border.border-border'))[0];
    await waitFor(() => {
      const ongoingCard = cardByLabel('进行中计划');
      expect(within(ongoingCard as HTMLElement).getByText('10')).toBeInTheDocument();
    });
    const ongoingCard = cardByLabel('进行中计划');
    const completedCard = cardByLabel('已完成计划');
    const delayCard = cardByLabel('平均滞后天数');
    const chCard = cardByLabel('高/严重预警');
    const todayCard = cardByLabel('今日到期计划');
    expect(within(ongoingCard as HTMLElement).getByText('10')).toBeInTheDocument();
    expect(within(completedCard as HTMLElement).getByText('20')).toBeInTheDocument();
    expect(within(delayCard as HTMLElement).getByText('1.5 天')).toBeInTheDocument();
    expect(within(chCard as HTMLElement).getByText('3')).toBeInTheDocument();
    expect(within(todayCard as HTMLElement).getByText('2')).toBeInTheDocument();

    const avgCard = cardByLabel('平均完成度');
    expect(within(avgCard as HTMLElement).getByText('75%')).toBeInTheDocument();
  });

  it('F12.3 进度条 completion=90 → GREEN；completion=20 → RED；completion=55 → YELLOW', async () => {
    renderPage();
    await waitFor(() => expect(document.querySelector('[data-testid="progress-bar-GREEN"]')).toBeInTheDocument());
    expect(document.querySelector('[data-testid="progress-bar-GREEN"]')).toBeTruthy();
    expect(document.querySelector('[data-testid="progress-bar-RED"]')).toBeTruthy();
    expect(document.querySelector('[data-testid="progress-bar-YELLOW"]')).toBeTruthy();
  });

  it('F12.4 滞后预警 CRITICAL 红 Badge；HIGH 橙；MEDIUM 黄；LOW 蓝；NONE 灰', async () => {
    renderPage();
    await waitFor(() => expect(screen.getByTestId('lag-risk-NONE')).toBeInTheDocument());
    const check = (risk: LagRisk, clsSub: string) => {
      const el = screen.getByTestId(`lag-risk-${risk}`);
      expect(el.className).toContain(clsSub);
    };
    check('NONE', 'bg-muted');
    check('LOW', 'bg-info/10');
    check('MEDIUM', 'bg-warning/10');
    check('HIGH', 'text-orange-600');
    check('CRITICAL', 'text-destructive');
  });

  it('F12.5 应收¥20000 已收¥15000 → 显示 应收¥20000 已收¥15000 未收¥5000（红色差额）', async () => {
    renderPage();
    await waitFor(() => expect(screen.getAllByText('未收 ¥5000.00').length).toBeGreaterThan(0));
    const uncollected = screen.getAllByText('未收 ¥5000.00')[0];
    expect(uncollected.className).toContain('text-destructive');
    expect(screen.getAllByText('¥20000.00').length).toBeGreaterThan(0);
    expect(screen.getAllByText('已收 ¥15000.00').length).toBeGreaterThan(0);
  });

  it('F12.6 搜索"张三" → GET /plans?search=张三；params 正确', async () => {
    const { user } = renderPage();
    mockApi.get.mockClear();
    mockApi.get.mockImplementation(async (url: string, ctx?: { params?: Record<string, unknown> }) => {
      if (url === '/treatment-progress/overview') return { data: buildOverview() };
      if (url === '/treatment-progress/plans') {
        return { data: { items: buildPlans().filter((p) => ctx?.params?.search ? p.patientName.includes(String(ctx.params.search)) : true), total: 1, page: 1, pageSize: 20 } };
      }
      return { data: null };
    });
    const search = screen.getByTestId('search-input') as HTMLInputElement;
    await user.type(search, '张三');
    await waitFor(() => {
      const plansCalls = (mockApi.get as MockedFunction<typeof mockApi.get>).mock.calls.filter((c) => c[0] === '/treatment-progress/plans');
      const last = plansCalls[plansCalls.length - 1];
      const p = last?.[1]?.params as Record<string, unknown> | undefined;
      expect(p?.search).toBe('张三');
    });
  });

  it('F12.7 筛选医生A → doctorId=DOC-A', async () => {
    const { user } = renderPage();
    mockApi.get.mockClear();
    mockApi.get.mockImplementation(async (url: string, ctx?: { params?: Record<string, unknown> }) => {
      if (url === '/treatment-progress/overview') return { data: buildOverview() };
      if (url === '/treatment-progress/plans') {
        return { data: { items: buildPlans(), total: 5, page: 1, pageSize: 20 } };
      }
      return { data: null };
    });
    const doctorSel = screen.getByTestId('doctor-select') as HTMLSelectElement;
    await user.selectOptions(doctorSel, 'DOC-A');
    await waitFor(() => {
      const plansCalls = (mockApi.get as MockedFunction<typeof mockApi.get>).mock.calls.filter((c) => c[0] === '/treatment-progress/plans');
      const last = plansCalls[plansCalls.length - 1];
      const p = last?.[1]?.params as Record<string, unknown> | undefined;
      expect(p?.doctorId).toBe('DOC-A');
    });
  });

  it('F12.8 筛选 risk=HIGH,CRITICAL → 请求参数中包含数组', async () => {
    const { user } = renderPage();
    mockApi.get.mockClear();
    mockApi.get.mockImplementation(async (url: string, ctx?: { params?: Record<string, unknown> }) => {
      if (url === '/treatment-progress/overview') return { data: buildOverview() };
      if (url === '/treatment-progress/plans') return { data: { items: buildPlans(), total: 5, page: 1, pageSize: 20 } };
      return { data: null };
    });
    await waitFor(() => expect(screen.getByTestId('risk-filter-HIGH')).toBeInTheDocument());
    const hBtn = screen.getByTestId('risk-filter-HIGH');
    const cBtn = screen.getByTestId('risk-filter-CRITICAL');
    await user.click(hBtn);
    await user.click(cBtn);
    await waitFor(() => {
      const plansCalls = (mockApi.get as MockedFunction<typeof mockApi.get>).mock.calls.filter((c) => c[0] === '/treatment-progress/plans');
      const last = plansCalls[plansCalls.length - 1];
      const p = last?.[1]?.params as Record<string, unknown> | undefined;
      expect(p?.risk).toBeDefined();
      const riskArr = Array.isArray(p?.risk) ? (p?.risk as unknown[]) : [p?.risk];
      expect(riskArr).toContain('HIGH');
      expect(riskArr).toContain('CRITICAL');
    });
  });

  it('F12.9 详情弹窗渲染：items 表格 + snapshots 折线图 + timeline 3 条事件', async () => {
    const { user } = renderPage();
    await waitFor(() => expect(screen.getAllByText('详情').length).toBeGreaterThan(0));
    const detailBtns = screen.getAllByText('详情');
    await user.click(detailBtns[0]);
    await waitFor(() => expect(screen.getByText('治疗项明细')).toBeInTheDocument());
    expect(screen.getByText('牙面清洁')).toBeInTheDocument();
    expect(screen.getByText('托槽粘结')).toBeInTheDocument();
    expect(screen.getByText('30 日完成度趋势')).toBeInTheDocument();
    expect(screen.getByText('时间轴')).toBeInTheDocument();
    expect(screen.getByText('正畸治疗计划启动')).toBeInTheDocument();
    expect(screen.getByText('完成牙面清洁（16）')).toBeInTheDocument();
    expect(screen.getByText('收取首期费用 ¥15,000')).toBeInTheDocument();
  });

  it('F12.10 刷新按钮 → POST /:id/refresh；toast "进度已重算"', async () => {
    const { toast } = await import('sonner');
    const successSpy = toast.success as MockedFunction<typeof toast.success>;
    renderPage();
    mockApi.post.mockClear();
    await waitFor(() => expect(document.querySelector('button[aria-label="展开"]')).toBeInTheDocument());
    const allButtons = screen.getAllByRole('button');
    const refreshButtons = allButtons.filter((b) => {
      const svg = b.querySelector('svg');
      if (!svg) return false;
      const cls = svg.getAttribute('class') ?? '';
      const hasRefreshSvg = cls.includes('refresh-cw') || svg.innerHTML.includes('M3 12a9 9 0 0 1 9-9');
      return hasRefreshSvg && b.textContent?.trim() === '';
    });
    expect(refreshButtons.length).toBeGreaterThan(0);
    fireEvent.click(refreshButtons[0]);
    await waitFor(() => {
      const postCalls = (mockApi.post as MockedFunction<typeof mockApi.post>).mock.calls;
      const refreshCall = postCalls.find((c) => typeof c[0] === 'string' && (c[0] as string).endsWith('/refresh'));
      expect(refreshCall).toBeDefined();
      expect(successSpy).toHaveBeenCalledTimes(1);
      const firstArg = successSpy.mock.calls[0][0];
      expect(firstArg).toBe('进度已重算');
    });
  });

  it('F12.11 打印按钮 → window.open("#/print-preview?type=treatment&id=PLAN001")（spy）', async () => {
    const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null);
    renderPage();
    await waitFor(() => expect(document.querySelector('button[aria-label="展开"]')).toBeInTheDocument());
    const plan001Row = screen.getByText('张三').closest('tr') as HTMLElement;
    expect(plan001Row).toBeTruthy();
    const rowButtons = within(plan001Row).getAllByRole('button');
    const printerBtns = rowButtons.filter((b) => {
      const svg = b.querySelector('svg');
      if (!svg) return false;
      return (svg.getAttribute('class') ?? '').includes('printer');
    });
    expect(printerBtns.length).toBeGreaterThan(0);
    fireEvent.click(printerBtns[0]);
    await waitFor(() => {
      expect(openSpy).toHaveBeenCalledWith(
        expect.stringContaining('#/print-preview?type=treatment&id='),
        '_blank',
        'noopener,noreferrer',
      );
    });
    openSpy.mockRestore();
  });

  it('F12.12 空数据 → Empty 组件；表格不崩溃', async () => {
    mockApi.get.mockImplementation(async (url: string) => {
      if (url === '/treatment-progress/overview') return { data: buildOverview() };
      if (url === '/treatment-progress/plans') return { data: { items: [], total: 0, page: 1, pageSize: 20 } };
      return { data: null };
    });
    renderPage();
    await waitFor(() => expect(screen.getByText('暂无计划数据')).toBeInTheDocument());
    expect(() => screen.getByText('暂无计划数据')).not.toThrow();
  });
});
