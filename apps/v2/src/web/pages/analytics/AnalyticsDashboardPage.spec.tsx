// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AnalyticsDashboardPage } from './AnalyticsDashboardPage';
import { apiRequest, fetchPrintHtml } from '../../lib/api';
import { ToastProvider } from '../../components/toast';

vi.mock('../../lib/api', () => ({ apiRequest: vi.fn(), fetchPrintHtml: vi.fn() }));

const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><ToastProvider>{children}</ToastProvider></QueryClientProvider>
);

function installData() {
  vi.mocked(apiRequest).mockImplementation(async (path: string) => {
    if (path.startsWith('/stats/dashboard')) {
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
    const target = { focus: vi.fn(), close: vi.fn(), location: { href: '' } };
    const open = vi.fn(() => target) as unknown as typeof window.open;
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
      expect(URL.createObjectURL).toHaveBeenCalledWith(expect.any(Blob));
      expect(target.location.href).toBe('blob:report');
      expect(target.focus).toHaveBeenCalled();
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

  it('shows empty chart states when sections have no data', async () => {
    vi.mocked(apiRequest).mockImplementation(async (path: string) => {
      if (path.startsWith('/stats/dashboard')) {
        return { patients: 0, appointments: 0, paidAmount: 0, unpaidAmount: 0, inventoryItems: 0, pendingFollowUps: 0 };
      }
      return [];
    });
    render(<AnalyticsDashboardPage />, { wrapper });

    expect(await screen.findByText('所选日期内暂无收入数据')).toBeDefined();
    expect(screen.getByText('所选日期内暂无患者增长数据')).toBeDefined();
    expect(screen.getByText('暂无库存数据')).toBeDefined();
    expect(screen.getByText('暂无满意度数据')).toBeDefined();
    expect(screen.getByText('暂无医生满意度数据')).toBeDefined();
  });

  it('applies a valid date range and degrades a failing section', async () => {
    installData();
    vi.mocked(apiRequest).mockImplementation(async (path: string) => {
      if (path.startsWith('/stats/revenue')) throw new Error('revenue failed');
      if (path.startsWith('/stats/dashboard')) {
        return { patients: 12, appointments: 8, paidAmount: 88800, unpaidAmount: 1200, inventoryItems: 5, pendingFollowUps: 3 };
      }
      return [];
    });
    render(<AnalyticsDashboardPage />, { wrapper });
    await screen.findByText('经营分析');

    const dateInputs = document.querySelectorAll('input[type="date"]') as NodeListOf<HTMLInputElement>;
    fireEvent.change(dateInputs[0], { target: { value: '2026-08-01' } });
    fireEvent.change(dateInputs[1], { target: { value: '2026-08-31' } });
    fireEvent.click(screen.getByRole('button', { name: '应用日期' }));

    expect(await screen.findByText('该区块加载失败')).toBeDefined();
    expect(screen.getAllByRole('button', { name: '重试' }).length).toBeGreaterThan(0);
    expect(screen.getByText('患者数')).toBeDefined();
  });

  it('renders charts with missing numeric fields', async () => {
    vi.mocked(apiRequest).mockImplementation(async (path: string) => {
      if (path.startsWith('/stats/dashboard')) {
        return { patients: 0, appointments: 0, paidAmount: 0, unpaidAmount: 0, inventoryItems: 0, pendingFollowUps: 0 };
      }
      if (path.startsWith('/stats/revenue')) return [{ period: '2026-08', amount: undefined, count: 0 }];
      if (path.startsWith('/stats/patient-growth')) return [{ day: undefined, count: undefined }];
      if (path === '/stats/inventory') {
        return [{ category: undefined, count: 0, totalStock: undefined, minStock: undefined }];
      }
      if (path === '/satisfaction/trend') {
        return [{ surveyDate: undefined, avgScore: undefined, count: 0 }];
      }
      if (path === '/satisfaction/doctor-rankings') {
        return [{ doctorId: 'd-1', doctorName: undefined, surveyCount: 0, avgScore: undefined }];
      }
      return [];
    });
    render(<AnalyticsDashboardPage />, { wrapper });
    expect(await screen.findByText('月度收入趋势')).toBeDefined();
    expect(screen.getByText('未分类')).toBeDefined();
    expect(screen.getByText('未分配')).toBeDefined();
  });

  it('shows an error when the print report fails', async () => {
    installData();
    vi.mocked(fetchPrintHtml).mockRejectedValue(new Error('print failed'));
    const target = { focus: vi.fn(), close: vi.fn(), location: { href: '' } };
    vi.spyOn(window, 'open').mockImplementation(() => target as unknown as Window);
    render(<AnalyticsDashboardPage />, { wrapper });
    await screen.findByText('月度收入趋势');
    fireEvent.click(screen.getByRole('button', { name: '打印/PDF' }));
    expect(await screen.findByText('操作失败，请稍后重试')).toBeDefined();
    expect(target.close).toHaveBeenCalled();
  });

  it('prints with zero fallbacks when dashboard queries fail', async () => {
    vi.mocked(apiRequest).mockImplementation(async (path: string) => {
      if (path.startsWith('/stats/dashboard')) throw new Error('dashboard failed');
      if (path.startsWith('/stats/revenue')) throw new Error('revenue failed');
      if (path.startsWith('/stats/patient-growth')) throw new Error('growth failed');
      if (path === '/stats/inventory') throw new Error('inventory failed');
      if (path === '/satisfaction/trend') throw new Error('satisfaction failed');
      if (path === '/satisfaction/doctor-rankings') throw new Error('doctors failed');
      return [];
    });
    vi.mocked(fetchPrintHtml).mockResolvedValue('<html>report</html>');
    const target = { focus: vi.fn(), close: vi.fn(), location: { href: '' } };
    vi.spyOn(window, 'open').mockImplementation(() => target as unknown as Window);
    vi.stubGlobal('URL', { ...URL, createObjectURL: vi.fn(() => 'blob:x'), revokeObjectURL: vi.fn() });
    render(<AnalyticsDashboardPage />, { wrapper });
    await screen.findByText('经营分析');
    fireEvent.click(screen.getByRole('button', { name: '打印/PDF' }));
    await waitFor(() => {
      expect(fetchPrintHtml).toHaveBeenCalledWith('/print', expect.objectContaining({
        data: expect.objectContaining({
          patients: 0,
          appointments: 0,
          paidAmount: 0,
          unpaidAmount: 0,
          revenueRows: [],
          growthRows: [],
          inventoryRows: [],
          satisfactionRows: [],
          doctorRows: [],
        }),
      }));
    });
  });

  it('exports CSV when every section query fails', async () => {
    vi.mocked(apiRequest).mockImplementation(async (path: string) => {
      if (path.startsWith('/stats/dashboard')) throw new Error('dashboard failed');
      if (path.startsWith('/stats/revenue')) throw new Error('revenue failed');
      if (path.startsWith('/stats/patient-growth')) throw new Error('growth failed');
      if (path === '/stats/inventory') throw new Error('inventory failed');
      if (path === '/satisfaction/trend') throw new Error('satisfaction failed');
      if (path === '/satisfaction/doctor-rankings') throw new Error('doctors failed');
      return [];
    });
    const click = vi.fn();
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(click);
    render(<AnalyticsDashboardPage />, { wrapper });
    await screen.findByText('经营分析');
    fireEvent.click(screen.getByRole('button', { name: '导出 CSV' }));
    expect(await screen.findByText('经营分析已导出为 CSV，可直接用 Excel 打开')).toBeDefined();
    expect(click).toHaveBeenCalled();
  });

  it('applies a cleared date range without query params', async () => {
    installData();
    render(<AnalyticsDashboardPage />, { wrapper });
    await screen.findByText('月度收入趋势');
    const inputs = document.querySelectorAll('input[type="date"]') as NodeListOf<HTMLInputElement>;
    fireEvent.change(inputs[0], { target: { value: '' } });
    fireEvent.change(inputs[1], { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: '应用日期' }));
    await waitFor(() => {
      expect(apiRequest).toHaveBeenCalledWith('/stats/dashboard');
    });
  });

  it('renders sparse revenue and doctor rows with fallback labels', async () => {
    vi.mocked(apiRequest).mockImplementation(async (path: string) => {
      if (path.startsWith('/stats/dashboard')) {
        return { patients: 1, appointments: 1, paidAmount: 100, unpaidAmount: 0, inventoryItems: 1, pendingFollowUps: 0 };
      }
      if (path.startsWith('/stats/revenue')) {
        return [{ amount: 100, count: 1 }];
      }
      if (path === '/satisfaction/doctor-rankings') {
        return [{ surveyCount: 5, avgScore: 92 }];
      }
      return [];
    });
    render(<AnalyticsDashboardPage />, { wrapper });
    expect(await screen.findByText('月度收入趋势')).toBeDefined();
    expect(await screen.findByText('未分配')).toBeDefined();
  });

  it('revokes the print blob URL after the delay', async () => {
    installData();
    vi.mocked(fetchPrintHtml).mockResolvedValue('<!doctype html><html><body>report</body></html>');
    vi.stubGlobal('URL', { ...URL, createObjectURL: vi.fn(() => 'blob:print'), revokeObjectURL: vi.fn() });
    const target = { focus: vi.fn(), close: vi.fn(), location: { href: '' } };
    const open = vi.fn(() => target) as unknown as typeof window.open;
    vi.spyOn(window, 'open').mockImplementation(open);
    render(<AnalyticsDashboardPage />, { wrapper });
    await screen.findByText('月度收入趋势');
    fireEvent.click(screen.getByRole('button', { name: '打印/PDF' }));
    await waitFor(() => {
      expect(target.location.href).toBe('blob:print');
    });
    await waitFor(() => {
      expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:print');
    }, { timeout: 2000 });
  });
});
