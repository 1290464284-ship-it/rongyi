// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { PatientWorkflowPage } from './PatientWorkflowPage';
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

describe('PatientWorkflowPage', () => {
  afterEach(() => {
    cleanup();
    vi.mocked(apiRequest).mockReset();
  });

  it('renders patients and scores and calculates risk', async () => {
    vi.mocked(apiRequest).mockImplementation(async (path: string) => {
      if (path === '/resources/patients?page=1&pageSize=100') {
        return {
          items: [
            { id: 'p-1', name: 'Patient A' },
            { id: 'p-2', name: null },
          ],
          total: 2,
        };
      }
      if (path === '/resources/patientRiskScores?page=1&pageSize=100') {
        return {
          items: [
            { id: 's-1', patientId: 'p-1', cariesScore: 10, periodontalScore: 20, implantScore: 30 },
            { id: 's-2', patientId: null, cariesScore: null, periodontalScore: null, implantScore: null },
          ],
          total: 2,
        };
      }
      return { id: 'risk-1' };
    });

    render(<PatientWorkflowPage />, { wrapper });
    fireEvent.click((await screen.findAllByRole('button', { name: '计算风险' }))[0]);
    await waitFor(() => {
      expect(apiRequest).toHaveBeenCalledWith('/patients/p-1/risk', expect.objectContaining({ method: 'POST' }));
    });
    expect(await screen.findByText('风险评分已更新')).toBeDefined();
  });

  it('reports risk calculation failures', async () => {
    vi.mocked(apiRequest).mockImplementation(async (path: string) => {
      if (path === '/resources/patients?page=1&pageSize=100') {
        return { items: [{ id: 'p-1', name: 'Patient A' }], total: 1 };
      }
      if (path === '/resources/patientRiskScores?page=1&pageSize=100') {
        return { items: [], total: 0 };
      }
      throw new Error('risk failed');
    });

    render(<PatientWorkflowPage />, { wrapper });
    fireEvent.click(await screen.findByRole('button', { name: '计算风险' }));
    expect(await screen.findByText('操作失败，请稍后重试')).toBeDefined();

    vi.mocked(apiRequest).mockImplementation(async (path: string) => {
      if (path === '/resources/patients?page=1&pageSize=100') {
        return { items: [{ id: 'p-1', name: 'Patient A' }], total: 1 };
      }
      if (path === '/resources/patientRiskScores?page=1&pageSize=100') {
        return { items: [], total: 0 };
      }
      throw 'boom';
    });
    fireEvent.click(screen.getByRole('button', { name: '计算风险' }));
    expect(await screen.findByText('计算失败')).toBeDefined();
  });

  it('shows empty states for patients and scores', async () => {
    vi.mocked(apiRequest).mockResolvedValue({ items: [], total: 0 });
    render(<PatientWorkflowPage />, { wrapper });
    expect(await screen.findByText('暂无患者')).toBeDefined();
    expect(screen.getByText('暂无评分记录')).toBeDefined();
  });

  it('renders section errors with retry without breaking the page', async () => {
    vi.mocked(apiRequest).mockImplementation(async (path: string) => {
      if (path === '/resources/patients?page=1&pageSize=100') {
        return { items: [{ id: 'p-1', name: 'Patient A' }], total: 1 };
      }
      throw new Error('scores failed');
    });
    render(<PatientWorkflowPage />, { wrapper });

    expect(await screen.findByText('该区块加载失败')).toBeDefined();
    expect(screen.getByRole('button', { name: '重试' })).toBeDefined();
    expect(screen.getByText('Patient A')).toBeDefined();
    expect(screen.getByRole('button', { name: '计算风险' })).toBeDefined();
  });

  it('renders the loading state for both sections', () => {
    vi.mocked(apiRequest).mockImplementation(() => new Promise(() => {}));
    render(<PatientWorkflowPage />, { wrapper });
    expect(screen.getAllByText('加载中...').length).toBeGreaterThanOrEqual(2);
  });

  it('falls back to empty tables when responses omit items', async () => {
    vi.mocked(apiRequest).mockImplementation(async (path: string) => {
      if (path === '/resources/patients?page=1&pageSize=100') {
        return { total: 0, page: 1, pageSize: 100 };
      }
      if (path === '/resources/patientRiskScores?page=1&pageSize=100') {
        return { total: 0, page: 1, pageSize: 100 };
      }
      return {};
    });
    render(<PatientWorkflowPage />, { wrapper });
    expect(await screen.findByText('暂无患者')).toBeDefined();
    expect(screen.getByText('暂无评分记录')).toBeDefined();
  });
});
