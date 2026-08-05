// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ClinicalWorkflowPage } from './ClinicalWorkflowPage';
import { apiRequest } from './api';
import type { Page } from './types';
import { ToastProvider } from './toast';

vi.mock('./api', () => ({ apiRequest: vi.fn(), downloadCsv: vi.fn() }));

const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><ToastProvider>{children}</ToastProvider></QueryClientProvider>
);

function resourceData() {
  return {
    '/resources/registrations?page=1&pageSize=100': { items: [{ id: 'r-1', status: 'REGISTERED' }], total: 1 },
    '/resources/visits?page=1&pageSize=100': { items: [{ id: 'v-1', status: 'IN_PROGRESS' }], total: 1 },
    '/resources/firstExams?page=1&pageSize=100': { items: [{ id: 'f-1', status: 'DRAFT' }], total: 1 },
    '/resources/treatments?page=1&pageSize=100': { items: [{ id: 't-1', status: 'PLANNED' }], total: 1 },
  } as Record<string, unknown>;
}

describe('ClinicalWorkflowPage', () => {
  afterEach(() => {
    cleanup();
    vi.mocked(apiRequest).mockReset();
  });

  it('renders workflow tables and transitions resources', async () => {
    vi.mocked(apiRequest).mockImplementation(async (path: string) => resourceData()[path] ?? {});

    render(<ClinicalWorkflowPage />, { wrapper });
    fireEvent.click((await screen.findAllByRole('button', { name: '已分诊' }))[0]);
    await waitFor(() => {
      expect(apiRequest).toHaveBeenCalledWith('/registrations/r-1/status', expect.objectContaining({ method: 'PATCH' }));
    });
    expect(await screen.findByText(/已更新为/)).toBeDefined();

    fireEvent.click(screen.getAllByRole('button', { name: '已完成' })[0]);
    await waitFor(() => {
      expect(apiRequest).toHaveBeenCalledWith('/visits/v-1/status', expect.objectContaining({ method: 'PATCH' }));
    });

    fireEvent.click(screen.getAllByRole('button', { name: '已提交' })[0]);
    await waitFor(() => {
      expect(apiRequest).toHaveBeenCalledWith('/first-exams/f-1/status', expect.objectContaining({ method: 'PATCH' }));
    });

    const inProgressButtons = screen.getAllByRole('button', { name: '进行中' });
    fireEvent.click(inProgressButtons[inProgressButtons.length - 1]);
    await waitFor(() => {
      expect(apiRequest).toHaveBeenCalledWith('/treatments/t-1/status', expect.objectContaining({ method: 'PATCH' }));
    });
  });

  it('reports transition failures', async () => {
    vi.mocked(apiRequest).mockImplementation(async (path: string) => {
      if (path in resourceData()) return resourceData()[path];
      throw new Error('transition failed');
    });

    render(<ClinicalWorkflowPage />, { wrapper });
    fireEvent.click((await screen.findAllByRole('button', { name: '已分诊' }))[0]);
    expect(await screen.findByText('transition failed')).toBeDefined();

    vi.mocked(apiRequest).mockImplementation(async (path: string) => {
      if (path in resourceData()) return resourceData()[path];
      throw 'boom';
    });
    fireEvent.click(screen.getAllByRole('button', { name: '已分诊' })[0]);
    expect(await screen.findByText('状态更新失败')).toBeDefined();
  });

  it('shows a loading state while workflow data loads', () => {
    vi.mocked(apiRequest).mockImplementation(() => new Promise(() => {}));
    render(<ClinicalWorkflowPage />, { wrapper });
    expect(screen.getByText('加载中...')).toBeDefined();
  });

  it('shows an error when workflow data fails to load', async () => {
    vi.mocked(apiRequest).mockImplementation(async (path: string) => {
      if (path === '/resources/registrations?page=1&pageSize=100') throw new Error('workflow failed');
      return resourceData()[path] ?? {};
    });
    render(<ClinicalWorkflowPage />, { wrapper });
    expect(await screen.findByText('workflow failed')).toBeDefined();
  });

  it('renders fallback status text for unknown values', async () => {
    vi.mocked(apiRequest).mockImplementation(async (path: string) => {
      if (path === '/resources/registrations?page=1&pageSize=100') {
        return { items: [{ id: 'r-2', status: null }, { id: 'r-3', status: 'WEIRD' }], total: 2 };
      }
      return { items: [], total: 0 };
    });
    render(<ClinicalWorkflowPage />, { wrapper });
    expect(await screen.findByText('WEIRD')).toBeDefined();
    expect(screen.getAllByText('暂无记录').length).toBeGreaterThanOrEqual(3);
  });

  it('handles null workflow query data', async () => {
    vi.mocked(apiRequest).mockResolvedValue(null as unknown as Page<Record<string, unknown>>);
    render(<ClinicalWorkflowPage />, { wrapper });
    expect(await screen.findAllByText('暂无记录')).toHaveLength(4);
  });
});
