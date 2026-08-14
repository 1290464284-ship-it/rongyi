// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SyncConflictsPage } from './SyncConflictsPage';
import { apiRequest } from '../../lib/api';
import { ToastProvider } from '../../components/toast';

vi.mock('../../lib/api', () => ({ apiRequest: vi.fn() }));

const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <ToastProvider>{children}</ToastProvider>
  </QueryClientProvider>
);

const conflictRow = {
  id: 'conflict-1',
  tableName: 'Patient',
  recordId: 'patient-1',
  deviceId: 'device-a',
  localUpdatedAt: '2026-08-09T12:00:00.000Z',
  remoteUpdatedAt: '2026-08-09T11:00:00.000Z',
};

describe('SyncConflictsPage', () => {
  afterEach(() => {
    cleanup();
    vi.mocked(apiRequest).mockReset();
  });

  it('lists pending conflicts and resolves with KEEP_LOCAL', async () => {
    vi.mocked(apiRequest).mockImplementation(async (path: string) => {
      if (path === '/sync/conflicts') return [conflictRow];
      return {};
    });
    render(<SyncConflictsPage />, { wrapper });
    expect(await screen.findByText('Patient')).toBeDefined();
    fireEvent.click(screen.getByText('保留本地'));
    await waitFor(() => expect(vi.mocked(apiRequest)).toHaveBeenCalledWith(
      '/sync/conflicts/conflict-1/resolve',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ resolution: 'KEEP_LOCAL' }),
      }),
    ));
    expect(await screen.findByText('已保留本地版本')).toBeDefined();
  });

  it('resolves with KEEP_REMOTE and refreshes the list', async () => {
    vi.mocked(apiRequest).mockImplementation(async (path: string) => {
      if (path === '/sync/conflicts') return [conflictRow];
      return {};
    });
    render(<SyncConflictsPage />, { wrapper });
    expect(await screen.findByText('Patient')).toBeDefined();

    fireEvent.click(screen.getByText('采用远端'));
    await waitFor(() => {
      expect(vi.mocked(apiRequest)).toHaveBeenCalledWith(
        '/sync/conflicts/conflict-1/resolve',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ resolution: 'KEEP_REMOTE' }),
        }),
      );
    });
    expect(await screen.findByText('已采用远端版本')).toBeDefined();
  });

  it('reports resolution failures and keeps the row actionable', async () => {
    vi.mocked(apiRequest).mockImplementation(async (path: string) => {
      if (path === '/sync/conflicts') return [conflictRow];
      if (path === '/sync/conflicts/conflict-1/resolve') throw new Error('resolve failed');
      return {};
    });
    render(<SyncConflictsPage />, { wrapper });
    expect(await screen.findByText('Patient')).toBeDefined();

    fireEvent.click(screen.getByText('保留本地'));
    expect(await screen.findByText('操作失败，请稍后重试')).toBeDefined();
    expect(screen.getByText('采用远端')).toBeDefined();
  });

  it('shows loading, error, and empty states', async () => {
    vi.mocked(apiRequest).mockImplementation(() => new Promise(() => {}));
    render(<SyncConflictsPage />, { wrapper });
    expect(screen.getByText('加载中...')).toBeDefined();
    cleanup();

    vi.mocked(apiRequest).mockRejectedValue(new Error('conflicts failed'));
    render(<SyncConflictsPage />, { wrapper });
    expect(await screen.findByText('操作失败，请稍后重试')).toBeDefined();
    cleanup();

    vi.mocked(apiRequest).mockResolvedValue([]);
    render(<SyncConflictsPage />, { wrapper });
    expect(await screen.findByText('暂无待处理冲突')).toBeDefined();
  });

  it('renders conflicts with missing timestamps and refreshes from the header', async () => {
    vi.mocked(apiRequest).mockImplementation(async (path: string) => {
      if (path === '/sync/conflicts') {
        return [
          { id: 'conflict-2', tableName: 'Charge', recordId: 'charge-1', deviceId: 'device-b', localUpdatedAt: null, remoteUpdatedAt: undefined },
        ];
      }
      return {};
    });
    render(<SyncConflictsPage />, { wrapper });
    expect(await screen.findByText('Charge')).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: '刷新' }));
    await waitFor(() => {
      expect(vi.mocked(apiRequest).mock.calls.filter(([path]) => path === '/sync/conflicts').length).toBeGreaterThanOrEqual(2);
    });
  });

  it('treats a null conflict list as empty', async () => {
    vi.mocked(apiRequest).mockResolvedValue(null);
    render(<SyncConflictsPage />, { wrapper });
    expect(await screen.findByText('暂无待处理冲突')).toBeDefined();
  });

  it('ignores a duplicate resolve request while one is pending', async () => {
    let resolveResolve: ((value: unknown) => void) | undefined;
    vi.mocked(apiRequest).mockImplementation(async (path: string) => {
      if (path === '/sync/conflicts') return [conflictRow];
      if (path === '/sync/conflicts/conflict-1/resolve') {
        return await new Promise((resolve) => { resolveResolve = resolve; });
      }
      return {};
    });
    render(<SyncConflictsPage />, { wrapper });
    const keepLocal = await screen.findByText('保留本地');
    fireEvent.click(keepLocal);
    fireEvent.click(keepLocal);
    expect(vi.mocked(apiRequest).mock.calls.filter(([path]) => path === '/sync/conflicts/conflict-1/resolve')).toHaveLength(1);
    resolveResolve?.({ ok: true });
  });
});
