// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { HrWorkflowPage } from './HrWorkflowPage';
import { apiRequest } from './api';
import { ToastProvider } from './toast';

vi.mock('./api', () => ({ apiRequest: vi.fn(), downloadCsv: vi.fn() }));

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
      if (path === '/resources/leaveRequests?page=1&pageSize=100') {
        return {
          items: [
            { id: 'l-1', userId: 'u-1', startDate: '2026-08-01', endDate: '2026-08-02', status: 'PENDING' },
            { id: 'l-2', userId: null, startDate: null, endDate: null, status: 'APPROVED' },
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
      if (path === '/resources/leaveRequests?page=1&pageSize=100') {
        return { items: [{ id: 'l-1', userId: 'u-1', startDate: '2026-08-01', endDate: '2026-08-02', status: 'PENDING' }], total: 1 };
      }
      throw new Error('approve failed');
    });

    render(<HrWorkflowPage />, { wrapper });
    fireEvent.click(await screen.findByRole('button', { name: '批准' }));
    expect(await screen.findByText('approve failed')).toBeDefined();

    vi.mocked(apiRequest).mockImplementation(async (path: string) => {
      if (path === '/resources/leaveRequests?page=1&pageSize=100') {
        return { items: [{ id: 'l-1', userId: 'u-1', startDate: '2026-08-01', endDate: '2026-08-02', status: 'PENDING' }], total: 1 };
      }
      throw 'boom';
    });
    fireEvent.click(screen.getByRole('button', { name: '驳回' }));
    expect(await screen.findByText('审批失败')).toBeDefined();
  });
});
it('renders an error state with retry when leave data is unavailable', async () => {
  vi.mocked(apiRequest).mockRejectedValueOnce(new Error('leaves failed'));
  render(<HrWorkflowPage />, { wrapper });
  expect(await screen.findByText('leaves failed')).toBeDefined();
  expect(screen.getByRole('button', { name: '重试' })).toBeDefined();
});
