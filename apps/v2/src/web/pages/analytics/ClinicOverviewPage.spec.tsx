// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ClinicOverviewPage } from './ClinicOverviewPage';
import { apiRequest } from '../../lib/api';
import { ToastProvider } from '../../components/toast';

vi.mock('../../lib/api', () => ({ apiRequest: vi.fn(), downloadCsv: vi.fn() }));

const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <ToastProvider>{children}</ToastProvider>
  </QueryClientProvider>
);

describe('ClinicOverviewPage', () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.mocked(apiRequest).mockReset();
  });

  it('renders clinic metrics and totals', async () => {
    vi.mocked(apiRequest).mockResolvedValue([
      { clinicId: 'clinic-a', clinicName: 'Clinic A', patients: 3, appointments: 5, charges: 2, paidAmount: 1000, unpaidAmount: 200, inventoryItems: 7, pendingFollowUps: 1 },
      { clinicId: 'legacy', clinicName: 'Legacy', patients: 1, appointments: 0, charges: 0, paidAmount: 0, unpaidAmount: 0, inventoryItems: 0, pendingFollowUps: 0 },
    ]);

    render(<ClinicOverviewPage />, { wrapper });
    expect(await screen.findByText('Clinic A')).toBeDefined();
    expect(screen.getByText('患者：4')).toBeDefined();
    expect(screen.getByText('预约：5')).toBeDefined();
    expect(screen.getByText('已收：¥10.00')).toBeDefined();
    expect(screen.getByText('未收：¥2.00')).toBeDefined();
  });

  it('renders errors and empty states', async () => {
    vi.mocked(apiRequest).mockRejectedValueOnce(new Error('overview failed'));
    render(<ClinicOverviewPage />, { wrapper });
    expect(await screen.findByText('无法加载多门店经营概览')).toBeDefined();

    cleanup();
    vi.mocked(apiRequest).mockResolvedValueOnce([]);
    render(<ClinicOverviewPage />, { wrapper });
    expect(await screen.findByText('暂无诊所数据')).toBeDefined();

    cleanup();
    vi.mocked(apiRequest).mockResolvedValueOnce([{ clinicId: 'clinic-min' }]);
    render(<ClinicOverviewPage />, { wrapper });
    expect(await screen.findByText('clinic-min')).toBeDefined();
    expect(screen.getByText('患者：0')).toBeDefined();

    cleanup();
    vi.mocked(apiRequest).mockResolvedValueOnce(undefined);
    render(<ClinicOverviewPage />, { wrapper });
    expect(await screen.findByText('无法加载多门店经营概览')).toBeDefined();

    cleanup();
    vi.mocked(apiRequest).mockRejectedValueOnce('boom');
    render(<ClinicOverviewPage />, { wrapper });
    expect(await screen.findByText('无法加载多门店经营概览')).toBeDefined();
  });

  it('falls back to an empty name when a clinic has neither name nor id', async () => {
    vi.mocked(apiRequest).mockResolvedValue([{ patients: 1 }]);
    render(<ClinicOverviewPage />, { wrapper });
    expect(await screen.findByText('患者：1')).toBeDefined();
    const table = document.querySelector('.data-table') ?? document.body;
    expect(table.textContent).toContain('诊所');
  });

  it('renders the loading state', () => {
    vi.mocked(apiRequest).mockImplementation(() => new Promise(() => {}));
    render(<ClinicOverviewPage />, { wrapper });
    expect(screen.getByText('加载中...')).toBeDefined();
  });
});
