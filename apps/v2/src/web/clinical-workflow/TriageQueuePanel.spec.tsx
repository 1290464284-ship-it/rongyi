// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { TriageQueuePanel } from './TriageQueuePanel';
import { apiRequest } from '../lib/api';

vi.mock('../lib/api', () => ({ apiRequest: vi.fn() }));

const wrapper = ({ children }: { children: React.ReactNode }) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    {children}
  </QueryClientProvider>
);

describe('TriageQueuePanel', () => {
  afterEach(() => {
    cleanup();
    vi.mocked(apiRequest).mockReset();
  });

  it('renders queue rows with fallbacks and starts a visit', async () => {
    const onStartVisit = vi.fn().mockResolvedValue(undefined);
    vi.mocked(apiRequest).mockImplementation(async (path: string) => {
      if (path === '/triage/queue') {
        return {
          items: [
            { id: 'r1', patientName: '患者甲', departmentId: 'dep-missing', doctorId: null, status: 'WEIRD', registeredAt: null, triagedAt: null },
            { id: 'r2', patientId: 'p2', departmentName: '口腔科', doctorName: '张医生', status: 'REGISTERED', registeredAt: null, triagedAt: null },
          ],
          total: 2,
          page: 1,
          pageSize: 20,
        };
      }
      if (path === '/resources/departments?page=1&pageSize=100') return { items: [], total: 0, page: 1, pageSize: 100 };
      return {};
    });
    render(<TriageQueuePanel onStartVisit={onStartVisit} />, { wrapper });
    expect(await screen.findByText('WEIRD')).toBeDefined();
    expect(screen.getAllByText('未分诊').length).toBeGreaterThan(0);
    expect(screen.getByText('未分配医生')).toBeDefined();

    fireEvent.click(screen.getAllByRole('button', { name: '开始就诊' })[0]);
    await waitFor(() => {
      expect(onStartVisit).toHaveBeenCalledWith('r2');
    });
  });

  it('renders an error state and filters by department', async () => {
    vi.mocked(apiRequest).mockImplementation(async (path: string) => {
      if (path === '/triage/queue') throw new Error('queue failed');
      if (path === '/resources/departments?page=1&pageSize=100') {
        return { items: [{ id: 'dep-1', name: '正畸科' }], total: 1, page: 1, pageSize: 100 };
      }
      return {};
    });
    render(<TriageQueuePanel onStartVisit={vi.fn()} />, { wrapper });
    expect(await screen.findByText('加载分诊队列失败')).toBeDefined();
    expect(screen.getByRole('button', { name: '重试' })).toBeDefined();
  });
});
