// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { FollowUpReportPage } from './FollowUpReportPage';
import { apiRequest } from './api';
import { ToastProvider } from './toast';

vi.mock('./api', () => ({ apiRequest: vi.fn(), downloadCsv: vi.fn() }));

const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <ToastProvider>{children}</ToastProvider>
  </QueryClientProvider>
);

describe('FollowUpReportPage', () => {
  afterEach(() => {
    cleanup();
    vi.mocked(apiRequest).mockReset();
  });

  it('renders follow-up adherence summary', async () => {
    vi.mocked(apiRequest).mockResolvedValue({ total: 20, onTime: 16, rate: 80 });
    render(<FollowUpReportPage />, { wrapper });
    expect(await screen.findByText('随访到诊率')).toBeDefined();
    expect(screen.getByText('20')).toBeDefined();
    expect(screen.getByText('16')).toBeDefined();
    expect(screen.getByText('80%')).toBeDefined();
  });

  it('renders errors and falls back to zero totals', async () => {
    vi.mocked(apiRequest).mockRejectedValueOnce(new Error('report failed'));
    render(<FollowUpReportPage />, { wrapper });
    expect(await screen.findByText('无法加载随访到诊率')).toBeDefined();

    cleanup();
    vi.mocked(apiRequest).mockResolvedValueOnce(null as never);
    render(<FollowUpReportPage />, { wrapper });
    expect(await screen.findByText('0%')).toBeDefined();
    expect(screen.getAllByText('0').length).toBeGreaterThanOrEqual(2);
  });
});
