// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BackupsPage } from './BackupsPage';
import { apiRequest } from './api';
import { ToastProvider } from './toast';

vi.mock('./api', () => ({ apiRequest: vi.fn(), downloadCsv: vi.fn() }));

const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={new QueryClient()}><ToastProvider>{children}</ToastProvider></QueryClientProvider>
);

describe('BackupsPage', () => {
  beforeEach(() => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
  });

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
    expect(await screen.findByText('restore failed')).toBeDefined();

    fireEvent.click(screen.getByRole('button', { name: '清理备份（保留 30 个）' }));
    expect(await screen.findByText('保留 1 个，清理 1 个')).toBeDefined();

    fireEvent.click(screen.getByRole('button', { name: '清理备份（保留 30 个）' }));
    expect(await screen.findByText('cleanup failed')).toBeDefined();

    fireEvent.click(screen.getByRole('button', { name: '暂存恢复' }));
    expect(await screen.findAllByText('暂无摘要')).toHaveLength(2);

    fireEvent.click(screen.getByRole('button', { name: '创建备份' }));
    expect(await screen.findByText('create failed')).toBeDefined();

    fireEvent.click(screen.getByRole('button', { name: '校验' }));
    expect(await screen.findByText('verify failed')).toBeDefined();
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
    expect(await screen.findByText('暂存恢复失败')).toBeDefined();

    fireEvent.click(screen.getByRole('button', { name: '清理备份（保留 30 个）' }));
    expect(await screen.findByText('清理备份失败')).toBeDefined();
  });

  it('does not stage restore or clean up when the confirm dialog is cancelled', async () => {
    vi.mocked(apiRequest).mockResolvedValueOnce([{ filename: 'backup-1.sqlite', encrypted: false, fileSize: 100, createdAt: '2026-08-04' }]);
    vi.mocked(window.confirm).mockReturnValue(false);

    render(<BackupsPage />, { wrapper });
    fireEvent.click(await screen.findByRole('button', { name: '暂存恢复' }));
    fireEvent.click(screen.getByRole('button', { name: '清理备份（保留 30 个）' }));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(apiRequest).not.toHaveBeenCalledWith('/backups/backup-1.sqlite/restore', expect.anything());
    expect(apiRequest).not.toHaveBeenCalledWith('/backups/cleanup', expect.anything());
    expect(window.confirm).toHaveBeenCalledWith('确认暂存恢复备份“backup-1.sqlite”？重启应用后生效。');
    expect(window.confirm).toHaveBeenCalledWith('确认清理过期备份（保留最近 30 个）？此操作不可撤销。');
  });
});
