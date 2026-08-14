// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import { DashboardPage } from './DashboardPage';
import { apiRequest } from '../../lib/api';
import { ToastProvider } from '../../components/toast';

vi.mock('../../lib/api', () => ({ apiRequest: vi.fn(), downloadCsv: vi.fn() }));

const wrapper = ({ children }: { children: ReactNode }) => (
  <MemoryRouter><QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><ToastProvider>{children}</ToastProvider></QueryClientProvider></MemoryRouter>
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

  it('renders today appointments with patient and doctor names', async () => {
    vi.mocked(apiRequest).mockImplementation(async (path: string) => {
      if (path === '/stats/dashboard') {
        return {
          patients: 10,
          appointments: 20,
          paidAmount: 100,
          unpaidAmount: 200,
          inventoryItems: 30,
          pendingFollowUps: 5,
        };
      }
      if (path === '/workbench/today') {
        return {
          date: '2026-08-10',
          truncated: { appointments: true },
          appointments: [
            { id: 'a-1', patientName: '患者甲', doctorName: '张医生', startTime: '2026-08-10T09:30:00.000Z', status: 'BOOKED', type: 'REGULAR' },
            { id: 'a-2', patientName: null, doctorName: null, startTime: null, status: null, type: null },
          ],
        };
      }
      return {};
    });
    render(<DashboardPage />, { wrapper });

    expect(await screen.findByText('患者甲')).toBeDefined();
    expect(screen.getByText((content) => content.includes('张医生') && content.includes('常规预约'))).toBeDefined();
    expect(screen.getByText('09:30')).toBeDefined();
    expect(screen.getAllByText('已预约').length).toBeGreaterThan(0);
    expect(screen.getByText('未知患者')).toBeDefined();
    expect(screen.getByText((content) => content.includes('未分配医生') && content.includes('预约'))).toBeDefined();
    expect(screen.getByText('超过 100 条，仅显示前 100 条')).toBeDefined();
  });

  it('shows the workbench loading state for today appointments', async () => {
    vi.mocked(apiRequest).mockImplementation(async (path: string) => {
      if (path === '/stats/dashboard') {
        return { patients: 0, appointments: 0, paidAmount: 0, unpaidAmount: 0, inventoryItems: 0, pendingFollowUps: 0 };
      }
      if (path === '/workbench/today') return new Promise(() => {});
      return {};
    });
    render(<DashboardPage />, { wrapper });
    expect(await screen.findByText('今日预约')).toBeDefined();
    expect(screen.getByText('加载中...')).toBeDefined();
  });

  it('shows the empty and loading states for today appointments', async () => {
    vi.mocked(apiRequest).mockImplementation(async (path: string) => {
      if (path === '/stats/dashboard') {
        return {
          patients: 0,
          appointments: 0,
          paidAmount: 0,
          unpaidAmount: 0,
          inventoryItems: 0,
          pendingFollowUps: 0,
        };
      }
      if (path === '/workbench/today') {
        return { date: '2026-08-10', appointments: [] };
      }
      return {};
    });
    render(<DashboardPage />, { wrapper });
    expect(await screen.findByText('今日暂无预约')).toBeDefined();

    cleanup();
    vi.mocked(apiRequest).mockImplementation(async (path: string) => {
      if (path === '/stats/dashboard') {
        return {
          patients: 0,
          appointments: 0,
          paidAmount: 0,
          unpaidAmount: 0,
          inventoryItems: 0,
          pendingFollowUps: 0,
        };
      }
      if (path === '/workbench/today') return new Promise(() => {});
      return {};
    });
    render(<DashboardPage />, { wrapper });
    expect(await screen.findByText('加载中...')).toBeDefined();
  });
});
