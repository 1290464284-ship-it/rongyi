// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AnalyticsDashboardPage } from './AnalyticsDashboardPage';
import { apiRequest, fetchPrintHtml } from './api';
import { ToastProvider } from './toast';

vi.mock('./api', () => ({ apiRequest: vi.fn(), fetchPrintHtml: vi.fn() }));

const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><ToastProvider>{children}</ToastProvider></QueryClientProvider>
);

function installData() {
  vi.mocked(apiRequest).mockImplementation(async (path: string) => {
    if (path === '/stats/dashboard') {
      return { patients: 12, appointments: 8, paidAmount: 88800, unpaidAmount: 1200, inventoryItems: 5, pendingFollowUps: 3 };
    }
    if (path.startsWith('/stats/revenue')) {
      return [{ period: '2026-08', amount: 88800, count: 3 }];
    }
    if (path.startsWith('/stats/patient-growth')) {
      return [{ day: '2026-08-01', count: 4 }];
    }
    if (path === '/stats/inventory') {
      return [{ category: '耗材', count: 2, totalStock: 40, minStock: 5 }];
    }
    if (path === '/satisfaction/trend') {
      return [{ surveyDate: '2026-08-02', avgScore: 92, count: 5 }];
    }
    if (path === '/satisfaction/doctor-rankings') {
      return [{ doctorId: 'd-1', doctorName: '张医生', surveyCount: 5, avgScore: 92 }];
    }
    return [];
  });
}

describe('AnalyticsDashboardPage', () => {
  afterEach(() => {
    cleanup();
    vi.mocked(apiRequest).mockReset();
    vi.mocked(fetchPrintHtml).mockReset();
    vi.restoreAllMocks();
  });

  it('renders the analytics dashboard with charts and summary cards', async () => {
    installData();
    render(<AnalyticsDashboardPage />, { wrapper });
    expect(await screen.findByText('月度收入趋势')).toBeDefined();
    expect(screen.getByText('患者数')).toBeDefined();
    expect(await screen.findByText('张医生')).toBeDefined();
    expect(screen.getByText('已收金额')).toBeDefined();
  });

  it('rejects an invalid date range', async () => {
    installData();
    render(<AnalyticsDashboardPage />, { wrapper });
    await screen.findByText('月度收入趋势');
    const dateInputs = document.querySelectorAll('input[type="date"]') as NodeListOf<HTMLInputElement>;
    fireEvent.change(dateInputs[0], { target: { value: '2026-09-01' } });
    fireEvent.change(dateInputs[1], { target: { value: '2026-08-01' } });
    fireEvent.click(screen.getByRole('button', { name: '应用日期' }));
    expect(await screen.findByText('开始日期不能晚于结束日期')).toBeDefined();
  });

  it('exports CSV and opens the print report', async () => {
    installData();
    vi.mocked(fetchPrintHtml).mockResolvedValue('<!doctype html><html><body>report</body></html>');
    const click = vi.fn();
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(click);
    vi.stubGlobal('URL', { ...URL, createObjectURL: vi.fn(() => 'blob:report'), revokeObjectURL: vi.fn() });
    const printDoc = { open: vi.fn(), write: vi.fn(), close: vi.fn() };
    const open = vi.fn(() => ({ focus: vi.fn(), close: vi.fn(), document: printDoc })) as unknown as typeof window.open;
    vi.spyOn(window, 'open').mockImplementation(open);

    render(<AnalyticsDashboardPage />, { wrapper });
    await screen.findByText('月度收入趋势');
    fireEvent.click(screen.getByRole('button', { name: '导出 CSV' }));
    expect(click).toHaveBeenCalled();
    expect(await screen.findByText('经营分析已导出为 CSV，可直接用 Excel 打开')).toBeDefined();

    fireEvent.click(screen.getByRole('button', { name: '打印/PDF' }));
    await waitFor(() => {
      expect(open).toHaveBeenCalledWith('', '_blank');
      expect(fetchPrintHtml).toHaveBeenCalledWith('/print', expect.objectContaining({ kind: 'analytics' }));
      expect(printDoc.open).toHaveBeenCalled();
      expect(printDoc.write).toHaveBeenCalledWith('<!doctype html><html><body>report</body></html>');
      expect(printDoc.close).toHaveBeenCalled();
    });
  });

  it('shows a toast when the print window is blocked', async () => {
    installData();
    vi.spyOn(window, 'open').mockImplementation(() => null);
    render(<AnalyticsDashboardPage />, { wrapper });
    await screen.findByText('月度收入趋势');
    fireEvent.click(screen.getByRole('button', { name: '打印/PDF' }));
    expect(await screen.findByText('浏览器阻止了打印窗口，请允许弹窗后重试')).toBeDefined();
    expect(fetchPrintHtml).not.toHaveBeenCalled();
  });
});
