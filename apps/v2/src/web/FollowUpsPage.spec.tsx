// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { FollowUpsPage } from './FollowUpsPage';
import { apiRequest } from './api';

vi.mock('./api', () => ({ apiRequest: vi.fn(), downloadCsv: vi.fn() }));

const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={new QueryClient()}>{children}</QueryClientProvider>
);

describe('FollowUpsPage', () => {
  afterEach(() => {
    cleanup();
    vi.mocked(apiRequest).mockReset();
  });

  it('completes a pending follow-up from the reminders table', async () => {
    vi.mocked(apiRequest)
      .mockResolvedValueOnce([{ id: 'fu-1', patientName: 'Demo Patient', planDate: '2026-08-04', status: 'PENDING', content: 'Call patient' }])
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce([]);

    render(<FollowUpsPage />, { wrapper });
    fireEvent.click(await screen.findByRole('button', { name: 'Complete' }));

    await waitFor(() => {
      expect(apiRequest).toHaveBeenCalledWith('/follow-ups/fu-1/complete', expect.objectContaining({ method: 'PATCH' }));
    });
    expect(await screen.findByText('Follow-up completed')).toBeDefined();
  });
});
