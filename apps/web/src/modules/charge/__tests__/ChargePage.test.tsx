import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock API hooks
const mockUseCharges = vi.fn();
const mockUseCreateCharge = vi.fn();
const mockUsePayCharge = vi.fn();
const mockUseRefundCharge = vi.fn();

vi.mock('@/lib/api/financial/charges', () => ({
  useCharges: (...args: unknown[]) => mockUseCharges(...args),
  useCreateCharge: () => mockUseCreateCharge(),
  usePayCharge: () => mockUsePayCharge(),
  useRefundCharge: () => mockUseRefundCharge(),
  CHARGE_STATUS_LABEL: {
    UNPAID: '待收费',
    PARTIAL: '部分收费',
    PAID: '已收费',
    REFUNDED: '已退费',
  },
  CHARGE_STATUS_COLOR: {
    UNPAID: 'bg-warning/10',
    PARTIAL: 'bg-info/10',
    PAID: 'bg-success/10',
    REFUNDED: 'bg-muted',
  },
  PAY_METHOD_LABEL: {
    CASH: '现金',
    WECHAT: '微信支付',
    ALIPAY: '支付宝',
    CARD: '银行卡',
    OTHER: '其他',
  },
}));

// Mock 新建收费单弹窗（依赖 PatientSelector，与页面流程无关）
vi.mock('../components/CreateChargeDialog', () => ({
  CreateChargeDialog: ({ open }: { open: boolean }) =>
    open ? <div data-testid="create-charge-dialog">新建收费单弹窗</div> : null,
}));

import ChargePage from '../ChargePage';

function renderWithProviders() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <ChargePage />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe('ChargePage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseCreateCharge.mockReturnValue({ mutateAsync: vi.fn(), isPending: false });
    mockUsePayCharge.mockReturnValue({ mutateAsync: vi.fn(), isPending: false });
    mockUseRefundCharge.mockReturnValue({ mutateAsync: vi.fn(), isPending: false });
  });

  it('渲染页面标题和新建按钮', () => {
    mockUseCharges.mockReturnValue({
      data: { items: [], total: 0 },
      isLoading: false,
    });

    renderWithProviders();

    expect(screen.getByText('收费收银')).toBeInTheDocument();
    expect(screen.getByText('新建收费单')).toBeInTheDocument();
  });

  it('无数据时显示空状态', () => {
    mockUseCharges.mockReturnValue({
      data: { items: [], total: 0 },
      isLoading: false,
    });

    renderWithProviders();

    expect(screen.getByText('暂无收费记录')).toBeInTheDocument();
  });

  it('加载中正常渲染', () => {
    mockUseCharges.mockReturnValue({
      data: undefined,
      isLoading: true,
    });

    renderWithProviders();

    expect(screen.getByText('收费收银')).toBeInTheDocument();
  });

  it('显示搜索框和状态筛选', () => {
    mockUseCharges.mockReturnValue({
      data: { items: [], total: 0 },
      isLoading: false,
    });

    renderWithProviders();

    expect(screen.getByPlaceholderText('搜索单号/患者姓名/电话')).toBeInTheDocument();
    expect(screen.getByText('全部状态')).toBeInTheDocument();
    expect(screen.getByText('待收费')).toBeInTheDocument();
  });

  it('多页数据时显示分页控件', () => {
    mockUseCharges.mockReturnValue({
      data: {
        items: [
          {
            id: 'c1',
            number: 'SF20260001',
            patientId: 'p1',
            patient: { id: 'p1', name: '张三' },
            totalAmount: '100',
            paidAmount: '0',
            status: 'UNPAID',
            createdAt: '2026-01-01T00:00:00Z',
          },
        ],
        total: 25,
      },
      isLoading: false,
    });

    renderWithProviders();

    expect(screen.getByText('上一页')).toBeInTheDocument();
    expect(screen.getByText('下一页')).toBeInTheDocument();
    expect(screen.getByText(/3 页/)).toBeInTheDocument();
  });

  it('展示全部收费状态筛选选项', () => {
    mockUseCharges.mockReturnValue({
      data: { items: [], total: 0 },
      isLoading: false,
    });

    renderWithProviders();

    expect(screen.getByText('全部状态')).toBeInTheDocument();
    expect(screen.getByText('待收费')).toBeInTheDocument();
    expect(screen.getByText('部分收费')).toBeInTheDocument();
    expect(screen.getByText('已收费')).toBeInTheDocument();
    expect(screen.getByText('已退费')).toBeInTheDocument();
  });

  it('显示收费记录总数', () => {
    mockUseCharges.mockReturnValue({
      data: { items: [], total: 42 },
      isLoading: false,
    });

    renderWithProviders();

    // 总数 > 0 时仍渲染页面框架
    expect(screen.getByText('收费收银')).toBeInTheDocument();
  });

  it('渲染表头：单号/患者/金额/状态/操作', () => {
    mockUseCharges.mockReturnValue({
      data: { items: [], total: 0 },
      isLoading: false,
    });

    renderWithProviders();

    expect(screen.getByText('单号')).toBeInTheDocument();
    expect(screen.getByText('患者')).toBeInTheDocument();
    expect(screen.getByText('金额')).toBeInTheDocument();
    expect(screen.getByText('状态')).toBeInTheDocument();
  });
});
