// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { HrWorkflowPage } from './HrWorkflowPage';
import { apiRequest, fetchAllPages } from '../../lib/api';
import { ToastProvider } from '../../components/toast';

vi.mock('../../lib/api', () => ({ apiRequest: vi.fn(), fetchAllPages: vi.fn(), downloadCsv: vi.fn() }));

vi.mocked(fetchAllPages).mockImplementation(async (path: string) => {
  const data = await vi.mocked(apiRequest)(path) as { items?: unknown[] } | unknown[];
  return Array.isArray(data) ? data : (data as { items?: unknown[] })?.items ?? [];
});

const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><ToastProvider>{children}</ToastProvider></QueryClientProvider>
);

describe('HrWorkflowPage', () => {
  afterEach(() => {
    cleanup();
    vi.mocked(apiRequest).mockReset();
  });

  it('renders pending leaves and approves or rejects them', async () => {
    vi.mocked(apiRequest).mockImplementation(async (path: string) => {
      if (path === '/resources/leaveRequests?status=PENDING&page=1&pageSize=100') {
        return {
          items: [
            { id: 'l-1', userId: 'u-1', startDate: '2026-08-01', endDate: '2026-08-02', status: 'PENDING' },
            { id: 'l-3', userId: null, startDate: null, endDate: null, status: 'PENDING' },
          ],
          total: 2,
        };
      }
      return {};
    });

    render(<HrWorkflowPage />, { wrapper });
    expect(await screen.findByText('u-1')).toBeDefined();
    expect(screen.queryByText('l-2')).toBeNull();
    fireEvent.click(screen.getAllByRole('button', { name: '批准' })[0]);
    await waitFor(() => {
      expect(apiRequest).toHaveBeenCalledWith('/hr/leaves/l-1/approve', expect.objectContaining({ method: 'PATCH' }));
    });
    expect(await screen.findByText('已批准')).toBeDefined();

    fireEvent.click(screen.getAllByRole('button', { name: '驳回' })[0]);
    expect(await screen.findByText('已驳回')).toBeDefined();
  });

  it('reports approval failures', async () => {
    vi.mocked(apiRequest).mockImplementation(async (path: string) => {
      if (path === '/resources/leaveRequests?status=PENDING&page=1&pageSize=100') {
        return { items: [{ id: 'l-1', userId: 'u-1', startDate: '2026-08-01', endDate: '2026-08-02', status: 'PENDING' }], total: 1 };
      }
      throw new Error('approve failed');
    });

    render(<HrWorkflowPage />, { wrapper });
    fireEvent.click(await screen.findByRole('button', { name: '批准' }));
    expect(await screen.findByText('操作失败，请稍后重试')).toBeDefined();

    vi.mocked(apiRequest).mockImplementation(async (path: string) => {
      if (path === '/resources/leaveRequests?status=PENDING&page=1&pageSize=100') {
        return { items: [{ id: 'l-1', userId: 'u-1', startDate: '2026-08-01', endDate: '2026-08-02', status: 'PENDING' }], total: 1 };
      }
      throw 'boom';
    });
    fireEvent.click(screen.getByRole('button', { name: '驳回' }));
    expect(await screen.findByText('审批失败')).toBeDefined();
  });

  it('renders an error state with retry when leave data is unavailable', async () => {
    vi.mocked(apiRequest).mockRejectedValueOnce(new Error('leaves failed'));
    render(<HrWorkflowPage />, { wrapper });
    expect(await screen.findByText('操作失败，请稍后重试')).toBeDefined();
    expect(screen.getByRole('button', { name: '重试' })).toBeDefined();
  });

  it('retries the leave list after clicking retry', async () => {
    vi.mocked(apiRequest)
      .mockRejectedValueOnce(new Error('leaves failed'))
      .mockResolvedValueOnce({
        items: [{ id: 'l-1', userId: 'u-1', startDate: '2026-08-01', endDate: '2026-08-02', status: 'PENDING' }],
        total: 1,
      });
    render(<HrWorkflowPage />, { wrapper });
    fireEvent.click(await screen.findByRole('button', { name: '重试' }));
    expect(await screen.findByText('u-1')).toBeDefined();
  });

  it('shows loading and empty states', async () => {
    vi.mocked(apiRequest).mockImplementation(() => new Promise(() => {}));
    render(<HrWorkflowPage />, { wrapper });
    expect(screen.getByText('请假数据加载中...')).toBeDefined();
    cleanup();

    vi.mocked(apiRequest).mockResolvedValue({ items: [], total: 0 });
    render(<HrWorkflowPage />, { wrapper });
    expect(await screen.findByText('暂无待审批请假')).toBeDefined();
  });

  it('shows a fallback error message and renders unknown statuses', async () => {
    vi.mocked(apiRequest).mockRejectedValueOnce('boom-string');
    render(<HrWorkflowPage />, { wrapper });
    expect(await screen.findByText('操作失败，请稍后重试')).toBeDefined();
    cleanup();

    vi.mocked(apiRequest).mockResolvedValue({
      items: [{ id: 'l-x', userId: 'u-x', startDate: '2026-08-01', endDate: '2026-08-02', status: 'WEIRD' }],
      total: 1,
    });
    render(<HrWorkflowPage />, { wrapper });
    expect(await screen.findByText('WEIRD')).toBeDefined();
  });

  it('paginates through pending leaves', async () => {
    vi.mocked(apiRequest).mockImplementation(async (path: string) => {
      if (path === '/resources/leaveRequests?status=PENDING&page=1&pageSize=100') {
        return { items: [{ id: 'l-1', userId: 'u-1', startDate: '2026-08-01', endDate: '2026-08-02', status: 'PENDING' }], total: 101 };
      }
      if (path === '/resources/leaveRequests?status=PENDING&page=2&pageSize=100') {
        return { items: [{ id: 'l-2', userId: 'u-2', startDate: '2026-08-03', endDate: '2026-08-04', status: 'PENDING' }], total: 101 };
      }
      return {};
    });
    render(<HrWorkflowPage />, { wrapper });
    expect(await screen.findByText('u-1')).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: '下一页' }));
    expect(await screen.findByText('u-2')).toBeDefined();
  });
});
