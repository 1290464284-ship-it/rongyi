// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { PatientWorkflowPage } from './PatientWorkflowPage';
import { apiRequest } from './api';
import { ToastProvider } from './toast';

vi.mock('./api', () => ({ apiRequest: vi.fn(), downloadCsv: vi.fn() }));

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
    expect(await screen.findByText('risk failed')).toBeDefined();

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
});
