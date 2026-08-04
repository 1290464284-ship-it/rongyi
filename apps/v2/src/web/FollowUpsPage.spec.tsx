// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { FollowUpsPage } from './FollowUpsPage';
import { apiRequest } from './api';

vi.mock('./api', () => ({ apiRequest: vi.fn(), downloadCsv: vi.fn() }));

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

  it('renders due-state summary and groups follow-ups by date', async () => {
    const now = new Date();
    const todayKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    const yesterday = new Date(now.getTime() - 86_400_000).toISOString().slice(0, 10);
    const tomorrow = new Date(now.getTime() + 86_400_000).toISOString().slice(0, 10);
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
