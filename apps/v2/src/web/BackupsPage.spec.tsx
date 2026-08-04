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
});
