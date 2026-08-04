// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BackupsPage } from './BackupsPage';
import { apiRequest } from './api';

vi.mock('./api', () => ({ apiRequest: vi.fn(), downloadCsv: vi.fn() }));

const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={new QueryClient()}>{children}</QueryClientProvider>
);

describe('BackupsPage', () => {
  afterEach(() => {
    cleanup();
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
    fireEvent.click(await screen.findByRole('button', { name: 'Stage restore' }));

    await waitFor(() => {
      expect(apiRequest).toHaveBeenCalledWith('/backups/backup-1.sqlite/restore', expect.objectContaining({ method: 'POST' }));
    });
    expect(await screen.findByText('Backup summary')).toBeDefined();
    expect(screen.getByText('Current summary')).toBeDefined();
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
    fireEvent.click(await screen.findByRole('button', { name: 'Create backup' }));
    expect(await screen.findByText('Backup created: backup-1.sqlite (encrypted)')).toBeDefined();

    fireEvent.click(screen.getByRole('button', { name: 'Verify' }));
    expect(await screen.findByText('Integrity: ok')).toBeDefined();

    fireEvent.click(screen.getByRole('button', { name: 'Stage restore' }));
    expect(await screen.findByText('restore failed')).toBeDefined();

    fireEvent.click(screen.getByRole('button', { name: 'Cleanup (keep 30)' }));
    expect(await screen.findByText('Kept 1, deleted 1')).toBeDefined();

    fireEvent.click(screen.getByRole('button', { name: 'Cleanup (keep 30)' }));
    expect(await screen.findByText('cleanup failed')).toBeDefined();

    fireEvent.click(screen.getByRole('button', { name: 'Stage restore' }));
    expect(await screen.findAllByText('No summary')).toHaveLength(2);

    fireEvent.click(screen.getByRole('button', { name: 'Create backup' }));
    expect(await screen.findByText('create failed')).toBeDefined();

    fireEvent.click(screen.getByRole('button', { name: 'Verify' }));
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
    fireEvent.click(await screen.findByRole('button', { name: 'Create backup' }));
    expect(await screen.findByText('Create failed')).toBeDefined();

    fireEvent.click(screen.getByRole('button', { name: 'Verify' }));
    expect(await screen.findByText('Verify failed')).toBeDefined();

    fireEvent.click(screen.getByRole('button', { name: 'Stage restore' }));
    expect(await screen.findByText('Restore staging failed')).toBeDefined();

    fireEvent.click(screen.getByRole('button', { name: 'Cleanup (keep 30)' }));
    expect(await screen.findByText('Cleanup failed')).toBeDefined();
  });
});
