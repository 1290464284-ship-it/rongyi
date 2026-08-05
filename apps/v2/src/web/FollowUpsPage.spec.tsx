// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { FollowUpsPage } from './FollowUpsPage';
import { apiRequest, downloadCsvPath } from './api';
import { ToastProvider } from './toast';

vi.mock('./api', () => ({ apiRequest: vi.fn(), downloadCsv: vi.fn(), downloadCsvPath: vi.fn() }));

const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <ToastProvider>{children}</ToastProvider>
  </QueryClientProvider>
);

function dateKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

async function submitDialog(value = 'done') {
  const input = await screen.findByPlaceholderText('例如：已电话回访，患者情况正常');
  fireEvent.change(input, { target: { value } });
  fireEvent.click(screen.getByRole('button', { name: '确认完成' }));
}

describe('FollowUpsPage', () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.mocked(apiRequest).mockReset();
    vi.mocked(downloadCsvPath).mockReset();
  });

  it('completes a pending follow-up through the dialog', async () => {
    vi.mocked(apiRequest).mockImplementation(async (path: string) => {
      if (path === '/follow-ups/reminders') {
        return [{ id: 'fu-1', patientName: '示例患者', planDate: dateKey(new Date()), status: 'PENDING', content: '回访' }];
      }
      if (path === '/follow-ups/reminders/summary') return { total: 1, overdue: 0, today: 1, upcoming: 0 };
      return {};
    });

    render(<FollowUpsPage />, { wrapper });
    fireEvent.click(await screen.findByRole('button', { name: '完成随访' }));
    await submitDialog('done');
    await waitFor(() => {
      expect(apiRequest).toHaveBeenCalledWith('/follow-ups/fu-1/complete', expect.objectContaining({
        method: 'PATCH',
        body: JSON.stringify({ result: 'done' }),
      }));
    });
    expect(await screen.findByText('随访已完成')).toBeDefined();
  });

  it('generates follow-ups in batch and reports failures', async () => {
    vi.mocked(apiRequest).mockImplementation(async (path: string) => {
      if (path === '/follow-ups/reminders') return [];
      if (path === '/follow-ups/reminders/summary') return { total: 0, overdue: 0, today: 0, upcoming: 0 };
      if (path === '/follow-ups/batch-generate') throw new Error('batch failed');
      return {};
    });

    render(<FollowUpsPage />, { wrapper });
    fireEvent.click(await screen.findByRole('button', { name: '批量生成随访' }));
    expect(await screen.findByText('batch failed')).toBeDefined();

    vi.mocked(apiRequest).mockImplementation(async (path: string) => {
      if (path === '/follow-ups/reminders') return [];
      if (path === '/follow-ups/reminders/summary') return { total: 0, overdue: 0, today: 0, upcoming: 0 };
      return {};
    });
    fireEvent.click(screen.getByRole('button', { name: '批量生成随访' }));
    expect(await screen.findByText('批量生成完成')).toBeDefined();
  });

  it('reports follow-up completion failures', async () => {
    vi.mocked(apiRequest).mockImplementation(async (path: string) => {
      if (path === '/follow-ups/reminders') return [{ id: 'fu-2', status: 'PENDING' }];
      if (path === '/follow-ups/reminders/summary') return { total: 1, overdue: 1, today: 0, upcoming: 0 };
      if (path === '/follow-ups/fu-2/complete') throw new Error('complete failed');
      return {};
    });

    render(<FollowUpsPage />, { wrapper });
    fireEvent.click(await screen.findByRole('button', { name: '完成随访' }));
    await submitDialog();
    expect(await screen.findByText('complete failed')).toBeDefined();
  });

  it('uses generic fallback messages for non-error failures', async () => {
    vi.mocked(apiRequest).mockImplementation(async (path: string) => {
      if (path === '/follow-ups/reminders') return [{ id: 'fu-3', status: 'PENDING' }];
      if (path === '/follow-ups/reminders/summary') return { total: 1, overdue: 0, today: 0, upcoming: 1 };
      throw 'boom';
    });

    render(<FollowUpsPage />, { wrapper });
    fireEvent.click(await screen.findByRole('button', { name: '批量生成随访' }));
    expect(await screen.findByText('批量生成失败')).toBeDefined();

    fireEvent.click(screen.getByRole('button', { name: '完成随访' }));
    await submitDialog();
    expect(await screen.findByText('随访完成操作失败')).toBeDefined();
  });

  it('batch completes selected follow-ups and exports overdue reminders', async () => {
    vi.mocked(apiRequest).mockImplementation(async (path: string) => {
      if (path === '/follow-ups/reminders') {
        return [
          { id: 'fu-batch-1', patientName: '批量一', planDate: '2026-08-01', status: 'PENDING' },
          { id: 'fu-batch-2', patientName: '批量二', planDate: '2026-08-01', status: 'PENDING' },
        ];
      }
      if (path === '/follow-ups/reminders/summary') return { total: 2, overdue: 2, today: 0, upcoming: 0 };
      if (path === '/follow-ups/batch-complete') return { completed: 2, skipped: 0, errors: [] };
      return {};
    });
    vi.mocked(downloadCsvPath).mockResolvedValue(undefined);

    render(<FollowUpsPage />, { wrapper });
    const checkboxes = await screen.findAllByRole('checkbox');
    fireEvent.click(checkboxes[0]);
    fireEvent.click(checkboxes[1]);
    fireEvent.click(screen.getByRole('button', { name: '批量完成' }));
    await submitDialog();

    await waitFor(() => {
      expect(apiRequest).toHaveBeenCalledWith('/follow-ups/batch-complete', expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ ids: ['fu-batch-1', 'fu-batch-2'], result: 'done' }),
      }));
    });
    expect(await screen.findByText('完成 2 条，跳过 0 条')).toBeDefined();

    fireEvent.click(screen.getByRole('button', { name: '导出逾期' }));
    await waitFor(() => {
      expect(downloadCsvPath).toHaveBeenCalledWith('/follow-ups/reminders/export?scope=overdue', 'overdue-follow-ups.csv');
    });
  });

  it('reports batch completion and export failures', async () => {
    vi.mocked(apiRequest).mockImplementation(async (path: string) => {
      if (path === '/follow-ups/reminders') return [{ id: 'fu-batch-fail', planDate: '2026-08-01', status: 'PENDING' }];
      if (path === '/follow-ups/reminders/summary') return { total: 1, overdue: 1, today: 0, upcoming: 0 };
      if (path === '/follow-ups/batch-complete') throw new Error('batch complete failed');
      return {};
    });
    vi.mocked(downloadCsvPath).mockRejectedValueOnce(new Error('export failed'));

    render(<FollowUpsPage />, { wrapper });
    fireEvent.click(await screen.findByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: '批量完成' }));
    await submitDialog();
    expect(await screen.findByText('batch complete failed')).toBeDefined();

    fireEvent.click(screen.getByRole('button', { name: '导出逾期' }));
    expect(await screen.findByText('export failed')).toBeDefined();
  });

  it('completes with an empty result and covers missing summary data', async () => {
    const now = new Date();
    const todayKey = dateKey(now);
    vi.mocked(apiRequest).mockImplementation(async (path: string) => {
      if (path === '/follow-ups/reminders') {
        return [{ id: 'fu-empty', patientName: '空结果', planDate: todayKey, status: null }];
      }
      if (path === '/follow-ups/reminders/summary') return undefined;
      if (path === '/follow-ups/fu-empty/complete') return {};
      if (path === '/follow-ups/batch-complete') return { completed: 1, skipped: 0, errors: [] };
      return {};
    });

    render(<FollowUpsPage />, { wrapper });
    const checkbox = await screen.findByRole('checkbox');
    fireEvent.click(checkbox);
    fireEvent.click(checkbox);
    fireEvent.click(checkbox);
    fireEvent.click(screen.getByRole('button', { name: '批量完成' }));
    await submitDialog('');
    await waitFor(() => {
      expect(apiRequest).toHaveBeenCalledWith('/follow-ups/batch-complete', expect.objectContaining({
        body: JSON.stringify({ ids: ['fu-empty'] }),
      }));
    });
    expect(await screen.findByText('完成 1 条，跳过 0 条')).toBeDefined();

    fireEvent.click(screen.getByRole('button', { name: '完成随访' }));
    await submitDialog('');
    await waitFor(() => {
      expect(apiRequest).toHaveBeenCalledWith('/follow-ups/fu-empty/complete', expect.objectContaining({
        body: JSON.stringify({}),
      }));
    });
  });

  it('renders due-state summary and groups follow-ups by date', async () => {
    const now = new Date();
    const todayKey = dateKey(now);
    const yesterday = dateKey(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1));
    const tomorrow = dateKey(new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1));
    vi.mocked(apiRequest).mockImplementation(async (path: string) => {
      if (path === '/follow-ups/reminders') {
        return [
          { id: 'fu-overdue', patientName: '逾期患者', planDate: yesterday, status: 'PENDING' },
          { id: 'fu-today', patientName: '今日患者', planDate: todayKey, status: 'PENDING' },
          { id: 'fu-upcoming', patientName: '后续患者', planDate: tomorrow, status: 'PENDING' },
        ];
      }
      return { total: 3, overdue: 1, today: 1, upcoming: 1 };
    });

    render(<FollowUpsPage />, { wrapper });
    expect(await screen.findByText('总计：3')).toBeDefined();
    expect(screen.getByText('已逾期：1')).toBeDefined();
    expect(screen.getByText('今日：1')).toBeDefined();
    expect(screen.getByText('后续：1')).toBeDefined();
    expect(await screen.findByText(`已逾期 (1)`)).toBeDefined();
    expect(screen.getByText('今日待随访 (1)')).toBeDefined();
    expect(screen.getByText('后续待随访 (1)')).toBeDefined();
    expect(screen.getByText('逾期患者')).toBeDefined();
    expect(screen.getByText('后续患者')).toBeDefined();
  });

  it('cancels the completion dialog without changing state', async () => {
    vi.mocked(apiRequest).mockImplementation(async (path: string) => {
      if (path === '/follow-ups/reminders') return [{ id: 'fu-cancel', planDate: dateKey(new Date()), status: 'PENDING' }];
      return { total: 1, overdue: 0, today: 1, upcoming: 0 };
    });
    render(<FollowUpsPage />, { wrapper });
    fireEvent.click(await screen.findByRole('button', { name: '完成随访' }));
    expect(screen.getByRole('dialog')).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: '取消' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });
});
