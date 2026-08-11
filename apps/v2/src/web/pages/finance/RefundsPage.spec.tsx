// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RefundsPage } from './RefundsPage';
import { apiRequest } from '../../lib/api';
import { ToastProvider } from '../../components/toast';

vi.mock('../../lib/api', () => ({ apiRequest: vi.fn() }));

const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <ToastProvider>{children}</ToastProvider>
  </QueryClientProvider>
);

const refundRows = [
  {
    id: 'r-requested',
    patientId: 'p-1',
    patientName: '患者甲',
    chargeId: 'c-1',
    chargeNumber: 'CHG-1',
    amount: 5000,
    reason: '多收费用',
    status: 'REQUESTED',
    createdAt: '2026-08-05T10:00:00.000Z',
  },
  {
    id: 'r-pending',
    patientId: 'p-1',
    patientName: '患者甲',
    chargeId: 'c-2',
    chargeNumber: 'CHG-2',
    amount: 3000,
    reason: '患者取消',
    status: 'PENDING_REFUND',
    createdAt: '2026-08-05T10:00:00.000Z',
  },
  {
    id: 'r-completed',
    patientId: 'p-1',
    patientName: '患者甲',
    chargeId: 'c-3',
    chargeNumber: 'CHG-3',
    amount: 2000,
    reason: '多收费用',
    status: 'COMPLETED',
    createdAt: '2026-08-05T10:00:00.000Z',
  },
  {
    id: 'r-rejected',
    patientId: 'p-1',
    patientName: '患者甲',
    chargeId: 'c-4',
    chargeNumber: 'CHG-4',
    amount: 1000,
    reason: '重复收费',
    status: 'REJECTED',
    createdAt: '2026-08-05T10:00:00.000Z',
  },
  {
    id: 'r-cancelled',
    patientId: 'p-1',
    patientName: '患者甲',
    chargeId: 'c-5',
    chargeNumber: 'CHG-5',
    amount: 800,
    reason: '患者撤销',
    status: 'CANCELLED',
    createdAt: '2026-08-05T10:00:00.000Z',
  },
];

function mockApi() {
  vi.mocked(apiRequest).mockImplementation(async (path: string) => {
    if (path.startsWith('/refunds')) {
        return { items: refundRows, total: refundRows.length, page: 1, pageSize: 20 };
        }
    return {};
  });
}

describe('RefundsPage', () => {
  afterEach(() => {
    cleanup();
    vi.mocked(apiRequest).mockReset();
  });

  it('renders refund rows with formatted money and status labels', async () => {
    mockApi();
    render(<RefundsPage />, { wrapper });
    expect(await screen.findByText('CHG-1')).toBeDefined();
    expect(screen.getAllByText('患者甲')).toHaveLength(5);
    expect(screen.getByText('¥50.00')).toBeDefined();
    expect(screen.getByText('¥30.00')).toBeDefined();
    expect(screen.getAllByText('多收费用')).toHaveLength(2);
    expect(screen.getByText('待审核')).toBeDefined();
    expect(screen.getByText('待退款')).toBeDefined();
    expect(screen.getByText('已完成')).toBeDefined();
    expect(screen.getByText('已驳回')).toBeDefined();
    expect(screen.getByText('已取消')).toBeDefined();
    expect(screen.getAllByText(/2026/).length).toBeGreaterThan(0);
    expect(screen.getByLabelText('退款状态汇总')).toBeDefined();
    expect(screen.getByText('待审核 1')).toBeDefined();
    expect(screen.getByText('待退款 1')).toBeDefined();
  });

  it('shows row actions by status: REQUESTED and PENDING_REFUND only', async () => {
    mockApi();
    render(<RefundsPage />, { wrapper });
    await screen.findByText('CHG-1');

    expect(screen.getByText('通过审批')).toBeDefined();
    expect(screen.getByText('驳回')).toBeDefined();
    expect(screen.getByText('取消')).toBeDefined();
    expect(screen.getByText('确认退款')).toBeDefined();
    // 已完成/已驳回/已取消行不渲染操作按钮：4 个操作按钮 + 分页 2 个按钮
    expect(screen.getAllByRole('button')).toHaveLength(6);
  });

  it('approves a REQUESTED refund and reloads the list', async () => {
    mockApi();
    render(<RefundsPage />, { wrapper });
    await screen.findByText('CHG-1');

    fireEvent.click(screen.getByText('通过审批'));
    await waitFor(() => {
      expect(apiRequest).toHaveBeenCalledWith('/refunds/r-requested/approve', expect.objectContaining({ method: 'POST' }));
    });
    expect(await screen.findByText('退款已通过审批')).toBeDefined();
    await waitFor(() => {
      expect(vi.mocked(apiRequest).mock.calls.filter(([path]) => path.startsWith('/refunds')).length).toBeGreaterThanOrEqual(2);
    });
  });

  it('rejects and cancels a REQUESTED refund', async () => {
    mockApi();
    render(<RefundsPage />, { wrapper });
    await screen.findByText('CHG-1');

    fireEvent.click(screen.getByText('驳回'));
    await waitFor(() => {
      expect(apiRequest).toHaveBeenCalledWith('/refunds/r-requested/reject', expect.objectContaining({ method: 'POST' }));
    });
    expect(await screen.findByText('退款已驳回')).toBeDefined();

    fireEvent.click(screen.getByText('取消'));
    await waitFor(() => {
      expect(apiRequest).toHaveBeenCalledWith('/refunds/r-requested/cancel', expect.objectContaining({ method: 'POST' }));
    });
    expect(await screen.findByText('退款已取消')).toBeDefined();
  });

  it('processes a PENDING_REFUND refund', async () => {
    mockApi();
    render(<RefundsPage />, { wrapper });
    await screen.findByText('CHG-1');

    fireEvent.click(screen.getByText('确认退款'));
    await waitFor(() => {
      expect(apiRequest).toHaveBeenCalledWith('/refunds/r-pending/process', expect.objectContaining({ method: 'POST' }));
    });
    expect(await screen.findByText('退款已完成')).toBeDefined();
  });

  it('shows an error toast when the action fails', async () => {
    vi.mocked(apiRequest).mockImplementation(async (path: string, init?: RequestInit) => {
      if (path.startsWith('/refunds') && (!init || init.method === undefined || init.method === 'GET')) {
        return { items: refundRows, total: refundRows.length, page: 1, pageSize: 20 };
      }
      throw new Error('Request failed (409)');
    });
    render(<RefundsPage />, { wrapper });
    await screen.findByText('CHG-1');

    fireEvent.click(screen.getByText('通过审批'));
    expect(await screen.findByText('请求失败，请稍后重试')).toBeDefined();
  });

  it('renders an empty state when there are no refunds', async () => {
    vi.mocked(apiRequest).mockResolvedValue([]);
    render(<RefundsPage />, { wrapper });
    expect(await screen.findByText('暂无退款记录')).toBeDefined();
  });

  it('navigates between refund pages', async () => {
    vi.mocked(apiRequest).mockImplementation(async (path: string) => {
      if (path.startsWith('/refunds?page=2')) {
        return { items: refundRows, total: refundRows.length + 20, page: 2, pageSize: 20 };
      }
      return { items: refundRows, total: refundRows.length + 20, page: 1, pageSize: 20 };
    });
    render(<RefundsPage />, { wrapper });
    await screen.findByText('CHG-1');

    fireEvent.click(screen.getByRole('button', { name: '下一页' }));
    expect(await screen.findByText('第 2 页')).toBeDefined();
    expect((screen.getByRole('button', { name: '上一页' }) as HTMLButtonElement).disabled).toBe(false);

    fireEvent.click(screen.getByRole('button', { name: '上一页' }));
    expect(await screen.findByText('第 1 页')).toBeDefined();
    expect((screen.getByRole('button', { name: '上一页' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('shows loading and error states with retry', async () => {
    vi.mocked(apiRequest).mockImplementation(() => new Promise(() => {}));
    render(<RefundsPage />, { wrapper });
    expect(screen.getByText('退款记录加载中...')).toBeDefined();
    cleanup();

    vi.mocked(apiRequest).mockRejectedValue(new Error('refunds failed'));
    render(<RefundsPage />, { wrapper });
    expect(await screen.findByText('操作失败，请稍后重试')).toBeDefined();
    expect(screen.getByRole('button', { name: '重试' })).toBeDefined();
  });

  it('renders fallback values for missing refund fields and zero-count status chips', async () => {
    vi.mocked(apiRequest).mockImplementation(async (path: string) => {
      if (path.startsWith('/refunds')) {
        return {
          items: [
            { id: 'r-null', patientId: 'p-9', amount: null, reason: null, status: null, createdAt: null },
            { id: 'r-unknown', patientName: '乙', chargeNumber: 'X-1', amount: 100, reason: '其它', status: 'UNKNOWN_STATUS', createdAt: '2026-08-05T10:00:00.000Z' },
          ],
          total: 2,
          page: 1,
          pageSize: 20,
        };
      }
      return {};
    });
    render(<RefundsPage />, { wrapper });
    expect(await screen.findByText('p-9')).toBeDefined();
    expect(screen.getByText('UNKNOWN_STATUS')).toBeDefined();
    expect(screen.getByText('待审核 0')).toBeDefined();
    expect(screen.getByText('待退款 0')).toBeDefined();
  });

  it('clicks retry after a load error and handles non-Error failures', async () => {
    let fail = true;
    vi.mocked(apiRequest).mockImplementation(async (path: string) => {
      if (path.startsWith('/refunds')) {
        if (fail) throw 'boom';
        return { items: refundRows, total: refundRows.length, page: 1, pageSize: 20 };
      }
      return {};
    });
    render(<RefundsPage />, { wrapper });
    expect(await screen.findByText('操作失败，请稍后重试')).toBeDefined();
    fail = false;
    fireEvent.click(screen.getByRole('button', { name: '重试' }));
    expect(await screen.findByText('CHG-1')).toBeDefined();
  });
});
