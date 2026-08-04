// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { FollowUpsPage } from './FollowUpsPage';
import { apiRequest, downloadCsvPath } from './api';

vi.mock('./api', () => ({ apiRequest: vi.fn(), downloadCsv: vi.fn(), downloadCsvPath: vi.fn() }));

const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    {children}
  </QueryClientProvider>
);

describe('FollowUpsPage', () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.mocked(apiRequest).mockReset();
    vi.mocked(downloadCsvPath).mockReset();
  });

  it('completes a pending follow-up from the reminders table', async () => {
    vi.mocked(apiRequest).mockImplementation(async (path: string) => {
      if (path === '/follow-ups/reminders') {
        return [{ id: 'fu-1', patientName: 'Demo Patient', planDate: '2026-08-04', status: 'PENDING', content: 'Call patient' }];
      }
      if (path === '/follow-ups/reminders/summary') {
        return { total: 1, overdue: 0, today: 1, upcoming: 0 };
      }
      return {};
    });
    vi.spyOn(window, 'prompt').mockReturnValue('done');

    render(<FollowUpsPage />, { wrapper });
    fireEvent.click(await screen.findByRole('button', { name: 'Complete' }));

    await waitFor(() => {
      expect(apiRequest).toHaveBeenCalledWith('/follow-ups/fu-1/complete', expect.objectContaining({ method: 'PATCH' }));
    });
    expect(apiRequest).toHaveBeenCalledWith('/follow-ups/fu-1/complete', expect.objectContaining({
      body: JSON.stringify({ result: 'done' }),
    }));
    expect(await screen.findByText('Follow-up completed')).toBeDefined();
  });

  it('generates follow-ups in batch and reports failures', async () => {
    vi.mocked(apiRequest).mockImplementation(async (path: string) => {
      if (path === '/follow-ups/reminders') return [];
      if (path === '/follow-ups/reminders/summary') return { total: 0, overdue: 0, today: 0, upcoming: 0 };
      if (path === '/follow-ups/batch-generate') throw new Error('batch failed');
      return {};
    });

    render(<FollowUpsPage />, { wrapper });
    fireEvent.click(await screen.findByRole('button', { name: 'Batch generate' }));
    expect(await screen.findByText('batch failed')).toBeDefined();

    vi.mocked(apiRequest).mockImplementation(async (path: string) => {
      if (path === '/follow-ups/reminders') return [];
      if (path === '/follow-ups/reminders/summary') return { total: 0, overdue: 0, today: 0, upcoming: 0 };
      return {};
    });
    fireEvent.click(screen.getByRole('button', { name: 'Batch generate' }));
    expect(await screen.findByText('Batch generation completed')).toBeDefined();
  });

  it('reports follow-up completion failures', async () => {
    vi.mocked(apiRequest).mockImplementation(async (path: string) => {
      if (path === '/follow-ups/reminders') return [{ id: 'fu-2', status: 'PENDING' }];
      if (path === '/follow-ups/reminders/summary') return { total: 1, overdue: 1, today: 0, upcoming: 0 };
      if (path === '/follow-ups/fu-2/complete') throw new Error('complete failed');
      return {};
    });
    vi.spyOn(window, 'prompt').mockReturnValue('done');

    render(<FollowUpsPage />, { wrapper });
    fireEvent.click(await screen.findByRole('button', { name: 'Complete' }));
    expect(await screen.findByText('complete failed')).toBeDefined();
  });

  it('uses generic fallback messages for non-error failures', async () => {
    vi.mocked(apiRequest).mockImplementation(async (path: string) => {
      if (path === '/follow-ups/reminders') return [{ id: 'fu-3', status: 'PENDING' }];
      if (path === '/follow-ups/reminders/summary') return { total: 1, overdue: 0, today: 0, upcoming: 1 };
      throw 'boom';
    });
    vi.spyOn(window, 'prompt').mockReturnValue('done');

    render(<FollowUpsPage />, { wrapper });
    fireEvent.click(await screen.findByRole('button', { name: 'Batch generate' }));
    expect(await screen.findByText('Batch generation failed')).toBeDefined();

    fireEvent.click(screen.getByRole('button', { name: 'Complete' }));
    expect(await screen.findByText('Follow-up completion failed')).toBeDefined();
  });

  it('batch completes selected follow-ups and exports overdue reminders', async () => {
    vi.mocked(apiRequest).mockImplementation(async (path: string) => {
      if (path === '/follow-ups/reminders') {
        return [
          { id: 'fu-batch-1', patientName: 'Batch One', planDate: '2026-08-01', status: 'PENDING' },
          { id: 'fu-batch-2', patientName: 'Batch Two', planDate: '2026-08-01', status: 'PENDING' },
        ];
      }
      if (path === '/follow-ups/reminders/summary') return { total: 2, overdue: 2, today: 0, upcoming: 0 };
      if (path === '/follow-ups/batch-complete') return { completed: 2, skipped: 0, errors: [] };
      return {};
    });
    vi.spyOn(window, 'prompt').mockReturnValue('done');
    vi.mocked(downloadCsvPath).mockResolvedValue(undefined);

    render(<FollowUpsPage />, { wrapper });
    const checkboxes = await screen.findAllByRole('checkbox');
    fireEvent.click(checkboxes[0]);
    fireEvent.click(checkboxes[1]);
    fireEvent.click(screen.getByRole('button', { name: 'Complete selected' }));

    await waitFor(() => {
      expect(apiRequest).toHaveBeenCalledWith('/follow-ups/batch-complete', expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ ids: ['fu-batch-1', 'fu-batch-2'], result: 'done' }),
      }));
    });
    expect(await screen.findByText('Completed 2, skipped 0')).toBeDefined();

    fireEvent.click(screen.getByRole('button', { name: 'Export overdue' }));
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
    vi.spyOn(window, 'prompt').mockReturnValue('done');
    vi.mocked(downloadCsvPath).mockRejectedValueOnce(new Error('export failed'));

    render(<FollowUpsPage />, { wrapper });
    fireEvent.click(await screen.findByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: 'Complete selected' }));
    expect(await screen.findByText('batch complete failed')).toBeDefined();

    fireEvent.click(screen.getByRole('button', { name: 'Export overdue' }));
    expect(await screen.findByText('export failed')).toBeDefined();
  });

  it('completes with an empty prompt and covers null status rendering', async () => {
    const now = new Date();
    const todayKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    vi.mocked(apiRequest).mockImplementation(async (path: string) => {
      if (path === '/follow-ups/reminders') {
        return [{ id: 'fu-empty', patientName: 'Empty Result', planDate: todayKey, status: null }];
      }
      if (path === '/follow-ups/reminders/summary') return { total: 1, overdue: 0, today: 1, upcoming: 0 };
      if (path === '/follow-ups/batch-complete') return { completed: 1, skipped: 0, errors: [] };
      if (path === '/follow-ups/fu-empty/complete') return {};
      return {};
    });
    vi.spyOn(window, 'prompt').mockImplementation(() => null);

    render(<FollowUpsPage />, { wrapper });
    const checkbox = await screen.findByRole('checkbox');
    fireEvent.click(checkbox);
    fireEvent.click(checkbox);
    fireEvent.click(checkbox);
    fireEvent.click(screen.getByRole('button', { name: 'Complete selected' }));

    await waitFor(() => {
      expect(apiRequest).toHaveBeenCalledWith('/follow-ups/batch-complete', expect.objectContaining({
        body: JSON.stringify({ ids: ['fu-empty'] }),
      }));
    });
    expect(await screen.findByText('Completed 1, skipped 0')).toBeDefined();

    fireEvent.click(screen.getByRole('button', { name: 'Complete' }));
    await waitFor(() => {
      expect(apiRequest).toHaveBeenCalledWith('/follow-ups/fu-empty/complete', expect.objectContaining({
        body: JSON.stringify({}),
      }));
    });
  });

  it('covers missing summary data and non-error batch/export fallbacks', async () => {
    vi.mocked(apiRequest).mockImplementation(async (path: string) => {
      if (path === '/follow-ups/reminders') return [{ id: 'fu-edge', planDate: '2026-08-01', status: 'PENDING' }];
      if (path === '/follow-ups/reminders/summary') return undefined;
      if (path === '/follow-ups/batch-complete') throw 'boom';
      return {};
    });
    vi.spyOn(window, 'prompt').mockReturnValue('');
    vi.mocked(downloadCsvPath).mockRejectedValue('boom');

    render(<FollowUpsPage />, { wrapper });
    fireEvent.click(await screen.findByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: 'Complete selected' }));
    expect(await screen.findByText('Batch completion failed')).toBeDefined();

    fireEvent.click(screen.getByRole('button', { name: 'Export overdue' }));
    expect(await screen.findByText('Export failed')).toBeDefined();

    fireEvent.click(screen.getByRole('button', { name: 'Complete' }));
    await waitFor(() => {
      expect(apiRequest).toHaveBeenCalledWith('/follow-ups/fu-edge/complete', expect.objectContaining({
        body: JSON.stringify({}),
      }));
    });
  });

  it('renders due-state summary and groups follow-ups by date', async () => {
    const now = new Date();
    const todayKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    const dateKey = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
    const yesterday = dateKey(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1));
    const tomorrow = dateKey(new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1));
    vi.mocked(apiRequest).mockImplementation(async (path: string) => {
      if (path === '/follow-ups/reminders') {
        return [
          { id: 'fu-overdue', patientName: 'Overdue Patient', planDate: yesterday, status: 'PENDING' },
          { id: 'fu-today', patientName: 'Today Patient', planDate: todayKey, status: 'PENDING' },
          { id: 'fu-upcoming', patientName: 'Upcoming Patient', planDate: tomorrow, status: 'PENDING' },
        ];
      }
      return { total: 3, overdue: 1, today: 1, upcoming: 1 };
    });

    render(<FollowUpsPage />, { wrapper });
    expect(await screen.findByText('Total: 3')).toBeDefined();
    expect(screen.getByText('Overdue: 1')).toBeDefined();
    expect(screen.getByText('Today: 1')).toBeDefined();
    expect(screen.getByText('Upcoming: 1')).toBeDefined();
    expect(await screen.findByText(/\u5df2\u903e\u671f \(1\)/)).toBeDefined();
    expect(screen.getByText(/\u4eca\u65e5\u5f85\u968f\u8bbf \(1\)/)).toBeDefined();
    expect(screen.getByText(/\u540e\u7eed\u5f85\u968f\u8bbf \(1\)/)).toBeDefined();
    expect(screen.getByText('Overdue Patient')).toBeDefined();
    expect(screen.getByText('Upcoming Patient')).toBeDefined();
  });
});
