// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BackupsPage } from './BackupsPage';
import { apiRequest } from '../../lib/api';
import { ToastProvider } from '../../components/toast';

vi.mock('../../lib/api', () => ({ apiRequest: vi.fn(), downloadCsv: vi.fn() }));

const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <ToastProvider>{children}</ToastProvider>
  </QueryClientProvider>
);

describe('BackupsPage', () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.mocked(apiRequest).mockReset();
  });

  it('shows backup and current database summaries after staging a restore', async () => {
    vi.mocked(apiRequest)
      .mockResolvedValueOnce([{ filename: 'backup-1.sqlite', encrypted: false, fileSize: 100, createdAt: '2026-08-04' }])
      .mockResolvedValueOnce({
        message: 'Backup verified and staged',
        backupSummary: { Patient: 1, Charge: 2, lastPaidAt: '2026-08-04T00:00:00.000Z' },
        currentSummary: { Patient: 3, Charge: 4 },
      });

    render(<BackupsPage />, { wrapper });
    fireEvent.click(await screen.findByRole('button', { name: '暂存恢复' }));
    // L6：统一 ConfirmDialog，确认后才发起请求
    fireEvent.click(screen.getByRole('button', { name: '确认' }));

    await waitFor(() => {
      expect(apiRequest).toHaveBeenCalledWith('/backups/backup-1.sqlite/restore', expect.objectContaining({ method: 'POST' }));
    });
    expect(await screen.findByText('备份数据摘要')).toBeDefined();
    expect(screen.getByText('当前数据摘要')).toBeDefined();
    expect(screen.getByText('1')).toBeDefined();
    expect(screen.getByText('4')).toBeDefined();
  });

  it('covers create, verify, cleanup, and failure paths', async () => {
    const row = { filename: 'backup-1.sqlite', encrypted: false, fileSize: 100, createdAt: '2026-08-04' };
    vi.mocked(apiRequest)
      .mockResolvedValueOnce([row])
      .mockResolvedValueOnce({ filename: 'backup-1.sqlite', encrypted: true })
      .mockResolvedValueOnce([row])
      .mockResolvedValueOnce({ integrity: 'ok' })
      .mockRejectedValueOnce(new Error('restore failed'))
      .mockResolvedValueOnce({ kept: 1, deleted: [{}] })
      .mockResolvedValueOnce([row])
      .mockRejectedValueOnce(new Error('cleanup failed'))
      .mockResolvedValueOnce({ message: 'staged', backupSummary: undefined, currentSummary: undefined })
      .mockRejectedValueOnce(new Error('create failed'))
      .mockRejectedValueOnce(new Error('verify failed'));

    render(<BackupsPage />, { wrapper });
    fireEvent.click(await screen.findByRole('button', { name: '创建备份' }));
    expect(await screen.findByText('备份已创建：backup-1.sqlite（已加密）')).toBeDefined();

    fireEvent.click(screen.getByRole('button', { name: '校验' }));
    expect(await screen.findByText('备份完整性校验通过')).toBeDefined();

    fireEvent.click(screen.getByRole('button', { name: '暂存恢复' }));
    fireEvent.click(screen.getByRole('button', { name: '确认' }));
    expect(await screen.findByText('操作失败，请稍后重试')).toBeDefined();

    fireEvent.click(screen.getByRole('button', { name: '清理备份（保留 30 个）' }));
    fireEvent.click(screen.getByRole('button', { name: '确认' }));
    expect(await screen.findByText('保留 1 个，清理 1 个')).toBeDefined();

    fireEvent.click(screen.getByRole('button', { name: '清理备份（保留 30 个）' }));
    fireEvent.click(screen.getByRole('button', { name: '确认' }));
    expect(await screen.findByText('操作失败，请稍后重试')).toBeDefined();

    fireEvent.click(screen.getByRole('button', { name: '暂存恢复' }));
    fireEvent.click(screen.getByRole('button', { name: '确认' }));
    expect(await screen.findAllByText('暂无摘要')).toHaveLength(2);

    fireEvent.click(screen.getByRole('button', { name: '创建备份' }));
    expect((await screen.findAllByText('操作失败，请稍后重试')).length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole('button', { name: '校验' }));
    expect((await screen.findAllByText('操作失败，请稍后重试')).length).toBeGreaterThan(0);
  });

  it('falls back to generic messages for non-error failures', async () => {
    vi.mocked(apiRequest).mockImplementation(async (path: string, options?: RequestInit) => {
      if (path === '/backups' && options?.method !== 'POST') {
        return [{ filename: 'backup-1.sqlite', encrypted: false, fileSize: 100, createdAt: '2026-08-04' }];
      }
      throw 'boom';
    });

    render(<BackupsPage />, { wrapper });
    fireEvent.click(await screen.findByRole('button', { name: '创建备份' }));
    expect(await screen.findByText('创建备份失败')).toBeDefined();

    fireEvent.click(screen.getByRole('button', { name: '校验' }));
    expect(await screen.findByText('校验备份失败')).toBeDefined();

    fireEvent.click(screen.getByRole('button', { name: '暂存恢复' }));
    fireEvent.click(screen.getByRole('button', { name: '确认' }));
    expect(await screen.findByText('暂存恢复失败')).toBeDefined();

    fireEvent.click(screen.getByRole('button', { name: '清理备份（保留 30 个）' }));
    fireEvent.click(screen.getByRole('button', { name: '确认' }));
    expect(await screen.findByText('清理备份失败')).toBeDefined();
  });

  it('does not stage restore or clean up when the confirm dialog is cancelled', async () => {
    vi.mocked(apiRequest).mockResolvedValueOnce([{ filename: 'backup-1.sqlite', encrypted: false, fileSize: 100, createdAt: '2026-08-04' }]);

    render(<BackupsPage />, { wrapper });
    fireEvent.click(await screen.findByRole('button', { name: '暂存恢复' }));
    fireEvent.click(screen.getByRole('button', { name: '取消' }));
    fireEvent.click(screen.getByRole('button', { name: '清理备份（保留 30 个）' }));
    fireEvent.click(screen.getByRole('button', { name: '取消' }));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(apiRequest).not.toHaveBeenCalledWith('/backups/backup-1.sqlite/restore', expect.anything());
    expect(apiRequest).not.toHaveBeenCalledWith('/backups/cleanup', expect.anything());
  });

  it('shows the loading state', () => {
    vi.mocked(apiRequest).mockImplementation(() => new Promise(() => {}));
    render(<BackupsPage />, { wrapper });
    expect(screen.getByText('备份数据加载中...')).toBeDefined();
  });

  it('shows the error state with retry', async () => {
    vi.mocked(apiRequest).mockRejectedValue(new Error('backups failed'));
    render(<BackupsPage />, { wrapper });
    expect(await screen.findByText('操作失败，请稍后重试')).toBeDefined();
    expect(screen.getByRole('button', { name: '重试' })).toBeDefined();
  });

  it('clicks retry after a load error and guards duplicate create/verify clicks', async () => {
    let resolveCreate: ((value: unknown) => void) | undefined;
    let resolveVerify: ((value: unknown) => void) | undefined;
    let fail = true;
    vi.mocked(apiRequest).mockImplementation(async (path: string, options?: RequestInit) => {
      const method = String(options?.method ?? 'GET').toUpperCase();
      if (path === '/backups' && method === 'GET') {
        if (fail) throw new Error('backups failed');
        return [{ filename: 'backup-1.sqlite', encrypted: false, fileSize: 100, createdAt: '2026-08-04' }];
      }
      if (path === '/backups' && method === 'POST') {
        return await new Promise((resolve) => { resolveCreate = resolve; });
      }
      if (path === '/backups/backup-1.sqlite/verify') {
        return await new Promise((resolve) => { resolveVerify = resolve; });
      }
      return {};
    });
    render(<BackupsPage />, { wrapper });
    expect(await screen.findByText('操作失败，请稍后重试')).toBeDefined();
    fail = false;
    fireEvent.click(screen.getByRole('button', { name: '重试' }));
    fireEvent.click(await screen.findByRole('button', { name: '创建备份' }));
    fireEvent.click(screen.getByRole('button', { name: '创建备份' }));

    const createCalls = vi.mocked(apiRequest).mock.calls.filter(
      ([path, options]) => path === '/backups' && (options as RequestInit)?.method === 'POST',
    );
    expect(createCalls).toHaveLength(1);
    resolveCreate?.({ filename: 'backup-1.sqlite', encrypted: false });
    expect(await screen.findByText('备份已创建：backup-1.sqlite')).toBeDefined();

    fireEvent.click(screen.getByRole('button', { name: '校验' }));
    fireEvent.click(screen.getByRole('button', { name: '校验' }));
    const verifyCalls = vi.mocked(apiRequest).mock.calls.filter(([path]) => path === '/backups/backup-1.sqlite/verify');
    expect(verifyCalls).toHaveLength(1);
    resolveVerify?.({ integrity: 'corrupt' });
    expect(await screen.findByText('备份完整性校验结果：corrupt')).toBeDefined();
  });

  it('shows staged restore fallback messages and unknown summary keys', async () => {
    vi.mocked(apiRequest)
      .mockResolvedValueOnce([{ filename: 'backup-1.sqlite', encrypted: false, fileSize: 100, createdAt: '2026-08-04' }])
      .mockResolvedValueOnce({
        message: '需要人工确认',
        backupSummary: { Patient: 1, CustomKey: 7 },
        currentSummary: { Patient: 3 },
      });
    render(<BackupsPage />, { wrapper });
    fireEvent.click(await screen.findByRole('button', { name: '暂存恢复' }));
    fireEvent.click(screen.getByRole('button', { name: '确认' }));
    expect(await screen.findByText('需要人工确认')).toBeDefined();
    expect(screen.getByText('CustomKey')).toBeDefined();
    expect(screen.getByText('7')).toBeDefined();
  });

  it('shows the staged restore success message when staged is true', async () => {
    vi.mocked(apiRequest)
      .mockResolvedValueOnce([{ filename: 'backup-1.sqlite', encrypted: false, fileSize: 100, createdAt: '2026-08-04' }])
      .mockResolvedValueOnce({ staged: true, message: 'ignored', backupSummary: { Patient: 1 }, currentSummary: { Patient: 3 } });
    render(<BackupsPage />, { wrapper });
    fireEvent.click(await screen.findByRole('button', { name: '暂存恢复' }));
    fireEvent.click(screen.getByRole('button', { name: '确认' }));
    expect(await screen.findByText('恢复已暂存，重启应用后生效')).toBeDefined();
  });

  it('shows the error page for non-Error list failures', async () => {
    vi.mocked(apiRequest).mockImplementation(async (path: string) => {
      if (path === '/backups') throw 'boom';
      return {};
    });
    render(<BackupsPage />, { wrapper });
    expect(await screen.findByText('操作失败，请稍后重试')).toBeDefined();
  });
});
