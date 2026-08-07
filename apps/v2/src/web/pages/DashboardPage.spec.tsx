// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { DashboardPage } from './DashboardPage';
import { apiRequest } from '../lib/api';
import { ToastProvider } from '../components/toast';

vi.mock('../lib/api', () => ({ apiRequest: vi.fn(), downloadCsv: vi.fn() }));

const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><ToastProvider>{children}</ToastProvider></QueryClientProvider>
);

describe('DashboardPage', () => {
  afterEach(() => {
    cleanup();
    vi.mocked(apiRequest).mockReset();
  });

  it('shows loading state', () => {
    vi.mocked(apiRequest).mockImplementation(() => new Promise(() => {}));
    render(<DashboardPage />, { wrapper });
    expect(screen.getByText('加载中...')).toBeDefined();
  });

  it('renders dashboard metrics', async () => {
    vi.mocked(apiRequest).mockResolvedValue({
      patients: 10,
      appointments: 20,
      paidAmount: 100,
      unpaidAmount: 200,
      inventoryItems: 30,
      pendingFollowUps: 5,
    });
    render(<DashboardPage />, { wrapper });
    expect(await screen.findByText('患者数')).toBeDefined();
    expect(screen.getByText('20')).toBeDefined();
    expect(screen.getByText('¥1.00')).toBeDefined();
    expect(screen.getByText('¥2.00')).toBeDefined();
    expect(screen.getByText('5')).toBeDefined();
  });

  it('renders error state', async () => {
    vi.mocked(apiRequest).mockRejectedValue(new Error('dashboard failed'));
    render(<DashboardPage />, { wrapper });
    expect(await screen.findByText('无法加载工作台数据')).toBeDefined();
  });
});
